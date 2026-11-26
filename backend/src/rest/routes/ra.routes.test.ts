import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, generateKeyPairSync, type KeyObject } from 'node:crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';
import { db, sqliteDb } from '../../db/client.js';
import { auditLog, certificateAuthorities, certificates, integrationRAs, integrations } from '../../db/schema.js';
import { externalRoutes } from './external.routes.js';
import { IntegrationService } from '../../services/integration.service.js';

// RA key operations go to OpenBao Transit (faked here with real RSA-3072 keys; the
// live fork run is in scep/README.md). `operation` is the old Cosmian RA entry
// point: it must never be called. The issuing CA facade is mocked.
const { operation, signCertificate, getCertificate, transit } = vi.hoisted(() => ({
  operation: vi.fn(), signCertificate: vi.fn(), getCertificate: vi.fn(),
  transit: { readKey: vi.fn(), ensureKey: vi.fn(), signDigest: vi.fn(), unwrapSessionKey: vi.fn() },
}));
vi.mock('../../kms/service.js', () => ({ getKMSService: () => ({ performRAOperation: operation, signCertificate, getCertificate }) }));
vi.mock('../../openbao/ra-transit.js', async original => ({ ...(await original<object>()), getOpenBaoRATransit: () => transit }));
const kp = forge.pki.rsa.generateKeyPair(2048);
const ca = forge.pki.createCertificate(); ca.publicKey = kp.publicKey; ca.serialNumber = '01';
ca.validity.notBefore = new Date(Date.now() - 86400e3); ca.validity.notAfter = new Date(Date.now() + 3650 * 86400e3);
ca.setSubject([{ name: 'commonName', value: 'RA Test CA' }]); ca.setIssuer(ca.subject.attributes);
ca.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
ca.sign(kp.privateKey, forge.md.sha256.create());
const caPem = forge.pki.certificateToPem(ca);
const keys = new Map<string, { priv: KeyObject; pub: KeyObject }>();
const certs = new Map<string, string>();
const caId = randomUUID();
const caKMSId = `ca-${caId}`;

const forgePublic = (name: string) => forge.pki.publicKeyFromPem(keys.get(name)!.pub.export({ type: 'spki', format: 'pem' }).toString());
const forgePrivate = (name: string) => forge.pki.privateKeyFromPem(keys.get(name)!.priv.export({ type: 'pkcs8', format: 'pem' }).toString());
function certificate(publicKey: forge.pki.PublicKey, notBefore = new Date(Date.now() - 60e3), notAfter = new Date(Date.now() + 90 * 86400e3)) {
  const cert = forge.pki.createCertificate(); cert.publicKey = publicKey;
  cert.serialNumber = randomUUID().replace(/-/g, ''); cert.validity.notBefore = notBefore; cert.validity.notAfter = notAfter;
  cert.setSubject([{ name: 'commonName', value: 'SCEP Registration Authority' }]); cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }]);
  cert.sign(kp.privateKey, forge.md.sha256.create()); return forge.pki.certificateToPem(cert);
}

describe('backend-owned RA boundary', () => {
  let app: FastifyInstance;
  let first: { id: string; token: string };
  let second: { id: string; token: string };
  let generic: { id: string; token: string };
  const decryptLength: { value?: number; fail?: Error } = {};
  const request = (token: string, op: string, payload?: object) => app.inject({ method: op === 'state' ? 'GET' : 'POST', url: `/external/ra/${op}`, headers: { authorization: `Bearer ${token}` }, ...(op === 'state' ? {} : { payload: payload ?? {} }) });
  beforeAll(async () => {
    await db.insert(certificateAuthorities).values({ id: caId, subjectDn: 'CN=RA Test CA', serialNumber: randomUUID(), kmsKeyId: 'test-ca-key', kmsCertificateId: caKMSId, notBefore: ca.validity.notBefore, notAfter: ca.validity.notAfter, status: 'active' });
    const service = new IntegrationService();
    first = await service.register({ db }, { name: 'RA first', caId, kind: 'scep' });
    second = await service.register({ db }, { name: 'RA second', caId, kind: 'scep' });
    generic = await service.register({ db }, { name: 'RA generic', caId, kind: 'generic' });
    app = Fastify(); await app.register(externalRoutes, { prefix: '/external' }); await app.ready();
  });
  beforeEach(() => {
    operation.mockReset().mockRejectedValue(new Error('Cosmian RA path must not be used'));
    delete decryptLength.value; delete decryptLength.fail;
    transit.readKey.mockReset().mockImplementation(async (name: string) => keys.get(name)?.pub ?? null);
    transit.ensureKey.mockReset().mockImplementation(async (name: string, version: number) => {
      expect(version).toBe(1);
      if (!keys.has(name)) { const g = generateKeyPairSync('rsa', { modulusLength: 3072 }); keys.set(name, { priv: g.privateKey, pub: g.publicKey }); }
      return keys.get(name)!.pub;
    });
    transit.signDigest.mockReset().mockImplementation(async (name: string, _v: number, digest: Buffer) => {
      const md = forge.md.sha256.create(); (md as unknown as { digest: () => forge.util.ByteStringBuffer }).digest = () => forge.util.createBuffer(digest.toString('binary'));
      return Buffer.from(forgePrivate(name).sign(md), 'binary');
    });
    transit.unwrapSessionKey.mockReset().mockImplementation(async (_name: string, _v: number, _ciphertext: Buffer, length: number) => {
      if (decryptLength.fail) throw decryptLength.fail;
      return Buffer.alloc(decryptLength.value ?? length, 3);
    });
    signCertificate.mockReset().mockImplementation(async ({ csr }: { csr: string }) => {
      const request = forge.pki.certificationRequestFromPem(csr);
      if (!request.verify()) throw new Error('CSR signature invalid');
      const id = randomUUID(); certs.set(id, certificate(request.publicKey as forge.pki.PublicKey)); return { certificateId: id };
    });
    getCertificate.mockReset().mockImplementation(async (id: string) => id === caKMSId ? caPem : certs.get(id));
  });
  afterAll(async () => {
    await app.close();
    for (const identity of [first, second, generic]) {
      await db.delete(integrationRAs).where(eq(integrationRAs.integrationId, identity.id));
      await db.delete(certificates).where(eq(certificates.integrationId, identity.id));
      await db.delete(integrations).where(eq(integrations.id, identity.id));
    }
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
  });

  it('provisions an integration-bound OpenBao key and exposes only public state', async () => {
    const res = await request(first.token, 'provision');
    expect(res.statusCode, res.body).toBe(200); expect(res.json().certificatePem).toContain('BEGIN CERTIFICATE');
    expect(Object.keys(res.json()).sort()).toEqual(['certificatePem', 'previousCertificatesPem']);
    expect(transit.ensureKey).toHaveBeenCalledTimes(1);
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    expect(binding).toMatchObject({ keyProvider: 'openbao', keyVersion: 1, publicKeyId: null });
    transit.ensureKey.mockClear();
    expect((await request(first.token, 'provision')).statusCode).toBe(200);
    expect(transit.ensureKey).not.toHaveBeenCalled();
    expect((await request(second.token, 'state')).statusCode).toBe(404);
    expect(operation).not.toHaveBeenCalled();
  });
  it('cannot select another integration key and rejects non-SCEP identities', async () => {
    expect((await request(second.token, 'provision')).statusCode).toBe(200);
    transit.signDigest.mockClear();
    const digest = Buffer.alloc(32, 1).toString('base64');
    expect((await request(first.token, 'sign', { digest, keyId: 'test-ca-key' })).statusCode).toBe(400);
    expect((await request(generic.token, 'sign', { digest })).statusCode).toBe(403);
    expect(transit.signDigest).not.toHaveBeenCalled();
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    const signed = await request(first.token, 'sign', { digest });
    expect(signed.statusCode).toBe(200);
    expect(transit.signDigest.mock.calls.at(-1)?.[0]).toBe(binding.keyId);
    expect((await request(first.token, 'decrypt', { data: Buffer.alloc(384).toString('base64'), sessionKeyLength: 32 })).statusCode).toBe(200);
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, first.id));
    expect(rows.some(r => r.operation === 'scep.ra.sign' && r.status === 'success')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(digest);
  });
  it('requires the CMS session key length and gives one error for every unwrap failure', async () => {
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    const data = Buffer.alloc(384, 5).toString('base64');
    for (const length of [16, 24, 32]) {
      transit.unwrapSessionKey.mockClear();
      const exact = await request(first.token, 'decrypt', { data, sessionKeyLength: length });
      expect(exact.statusCode, exact.body).toBe(200);
      expect(Buffer.from(exact.json().data, 'base64').length).toBe(length);
      // The key identity comes from the integration binding, never from the request.
      expect(transit.unwrapSessionKey).toHaveBeenLastCalledWith(binding.keyId, 1, expect.any(Buffer), length);
    }
    // Without the length there is no unwrap at all.
    transit.unwrapSessionKey.mockClear();
    expect((await request(first.token, 'decrypt', { data })).statusCode).toBe(400);
    expect(transit.unwrapSessionKey).not.toHaveBeenCalled();
    decryptLength.fail = new Error('OpenBao: session key has the wrong length');
    const mismatch = await request(first.token, 'decrypt', { data, sessionKeyLength: 16 });
    decryptLength.fail = new Error('OpenBao: transport failure');
    const storeFailure = await request(first.token, 'decrypt', { data, sessionKeyLength: 16 });
    // A length mismatch and a key-store failure give the same response.
    for (const response of [mismatch, storeFailure]) {
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: { code: 'RA_OPERATION_FAILED', message: 'RA decryption failed' } });
    }
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, first.id));
    const decryptRows = rows.filter(r => r.operation === 'scep.ra.decrypt');
    expect(decryptRows.filter(r => r.status === 'failure').map(r => JSON.parse(r.details!))).toContainEqual({ phase: 'failed', statusCode: 502, code: 'RA_OPERATION_FAILED', provider: 'openbao' });
    expect(JSON.stringify(rows)).not.toContain(data);
    expect(JSON.stringify(rows)).not.toContain(Buffer.alloc(16, 3).toString('base64'));
  });
  it('accepts sessionKeyLength only as the JSON integer 16, 24 or 32, before audit and KMS', async () => {
    const data = Buffer.alloc(384).toString('base64');
    const before = (await db.select().from(auditLog).where(eq(auditLog.operation, 'scep.ra.decrypt'))).length;
    for (const sessionKeyLength of ['16', '0x10', 16.5, 8, 0, 64, -16, null, true, [16], { length: 16 }]) {
      const response = await request(first.token, 'decrypt', { data, sessionKeyLength });
      expect(response.statusCode, JSON.stringify(sessionKeyLength)).toBe(400);
      expect(response.json().error.code).toBe('BAD_REQUEST');
    }
    expect((await request(first.token, 'sign', { digest: Buffer.alloc(32).toString('base64'), sessionKeyLength: 32 })).statusCode).toBe(400);
    expect(transit.unwrapSessionKey).not.toHaveBeenCalled(); expect(transit.signDigest).not.toHaveBeenCalled();
    expect((await db.select().from(auditLog).where(eq(auditLog.operation, 'scep.ra.decrypt'))).length).toBe(before);
  });
  it('rejects algorithm overrides, malformed sizes and invalid tokens before cryptography', async () => {
    expect((await request(first.token, 'sign', { digest: 'AA==' })).statusCode).toBe(400);
    expect((await request(first.token, 'decrypt', { data: 'AA==' })).statusCode).toBe(400);
    expect((await request(first.token, 'sign', { digest: Buffer.alloc(32).toString('base64'), algorithm: 'SHA1' })).statusCode).toBe(400);
    expect((await request('invalid', 'state')).statusCode).toBe(401);
    expect(transit.signDigest).not.toHaveBeenCalled(); expect(transit.unwrapSessionKey).not.toHaveBeenCalled();
  });
  it('denies revoked CA/RA/token and prevents integration-token RA revocation', async () => {
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    const [cert] = await db.select().from(certificates).where(eq(certificates.id, binding.certificateId!));
    expect((await app.inject({ method: 'POST', url: '/external/revoke', headers: { authorization: `Bearer ${first.token}` }, payload: { serialNumber: cert.serialNumber } })).statusCode).toBe(403);
    await db.update(certificates).set({ status: 'revoked' }).where(eq(certificates.id, cert.id));
    expect((await request(first.token, 'sign', { digest: Buffer.alloc(32).toString('base64') })).statusCode).toBe(409);
    await db.update(certificates).set({ status: 'active' }).where(eq(certificates.id, cert.id));
    await db.update(certificateAuthorities).set({ status: 'revoked' }).where(eq(certificateAuthorities.id, caId));
    expect((await request(first.token, 'state')).statusCode).toBe(409);
    await db.update(certificateAuthorities).set({ status: 'active' }).where(eq(certificateAuthorities.id, caId));
    await db.update(integrations).set({ revokedAt: new Date() }).where(eq(integrations.id, first.id));
    expect((await request(first.token, 'state')).statusCode).toBe(401);
    await db.update(integrations).set({ revokedAt: null }).where(eq(integrations.id, first.id));
    expect(transit.signDigest).not.toHaveBeenCalled();
  });
  it('renews backend-owned state atomically and retains previous RA identity', async () => {
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    const before = new Date(Date.now() - 80 * 86400e3); const after = new Date(Date.now() + 10 * 86400e3);
    const old = certificate(forgePublic(binding.keyId!), before, after);
    await db.update(integrationRAs).set({ certificatePem: old }).where(eq(integrationRAs.integrationId, first.id));
    await db.update(certificates).set({ certificatePem: old, notBefore: before, notAfter: after }).where(eq(certificates.id, binding.certificateId!));
    const renewed = await request(first.token, 'renew');
    expect(renewed.statusCode).toBe(200); expect(renewed.json().previousCertificatesPem).toContain(old);
    const [updated] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    expect(updated.keyId).toBe(binding.keyId); expect(updated.keyVersion).toBe(1); expect(updated.certificateId).not.toBe(binding.certificateId);
    expect(transit.ensureKey).not.toHaveBeenCalled();
    signCertificate.mockClear(); expect((await request(first.token, 'renew')).statusCode).toBe(200);
    expect(signCertificate).not.toHaveBeenCalled();
  });
  it('fails closed before the key store when the RA audit intent cannot persist', async () => {
    sqliteDb.exec("CREATE TRIGGER reject_ra_audit BEFORE INSERT ON audit_log WHEN NEW.operation = 'scep.ra.sign' BEGIN SELECT RAISE(FAIL, 'simulated audit failure'); END");
    try {
      expect((await request(first.token, 'sign', { digest: Buffer.alloc(32).toString('base64') })).statusCode).toBe(500);
      expect(transit.signDigest).not.toHaveBeenCalled();
    } finally { sqliteDb.exec('DROP TRIGGER reject_ra_audit'); }
  });
  it('rejects issuing-CA serial reuse without publishing a replacement binding', async () => {
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    await db.update(certificates).set({ notBefore: new Date(Date.now() - 90 * 86400e3), notAfter: new Date(Date.now() - 1000) }).where(eq(certificates.id, binding.certificateId!));
    const collision = forge.pki.certificateFromPem(certificate(forgePublic(binding.keyId!), new Date(Date.now() - 1000), new Date(Date.now() + 100 * 86400e3)));
    collision.serialNumber = forge.pki.certificateFromPem(binding.certificatePem!).serialNumber;
    collision.sign(kp.privateKey, forge.md.sha256.create());
    signCertificate.mockImplementationOnce(async () => { const id = randomUUID(); certs.set(id, forge.pki.certificateToPem(collision)); return { certificateId: id }; });
    const response = await request(first.token, 'renew');
    expect(response.statusCode, response.body).toBe(409); expect(response.json().error.message).toContain('serial');
    const [unchanged] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    expect(unchanged.certificateId).toBe(binding.certificateId); expect(unchanged.lease).toBeNull();
  });

  it('authenticates before validating caller key selectors', async () => {
    const response = await request('invalid', 'sign', { digest: 'AA==', keyId: 'foreign' });
    expect(response.statusCode).toBe(401); expect(transit.signDigest).not.toHaveBeenCalled();
  });
  it('logs an RA failure once, including its error code', async () => {
    const before = await db.select().from(auditLog).where(eq(auditLog.entityId, generic.id));
    expect((await request(generic.token, 'sign', { digest: Buffer.alloc(32).toString('base64') })).statusCode).toBe(403);
    const after = await db.select().from(auditLog).where(eq(auditLog.entityId, generic.id));
    expect(after.length).toBe(before.length + 1);
    expect(after.find(row => !before.some(old => old.id === row.id))?.details).toContain('RA_OPERATION_FAILED');
  });
  it('resumes a recorded key after a transient key-store failure and lease expiry', async () => {
    const [old] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, second.id));
    await db.update(integrationRAs).set({ certificateId: null, certificatePem: null, previous: '[]' }).where(eq(integrationRAs.integrationId, second.id));
    transit.ensureKey.mockRejectedValueOnce(new Error('temporary OpenBao failure'));
    expect((await request(second.token, 'provision')).statusCode).toBe(502);
    transit.ensureKey.mockClear();
    expect((await request(second.token, 'provision')).statusCode).toBe(409);
    expect(transit.ensureKey).not.toHaveBeenCalled();
    await db.update(integrationRAs).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(integrationRAs.integrationId, second.id));
    const keysBefore = keys.size;
    expect((await request(second.token, 'provision')).statusCode).toBe(200);
    expect(keys.size).toBe(keysBefore); // the recorded key is reused, none is created
    const [recovered] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, second.id));
    expect(recovered.keyId).toBe(old.keyId); expect(recovered.lease).toBeNull();
    expect(signCertificate.mock.calls[0][0].x509Extensions).not.toContain('extendedKeyUsage');
  });
  it('recovers a failed initial allocation after its lease expires', async () => {
    await db.delete(integrationRAs).where(eq(integrationRAs.integrationId, second.id));
    transit.ensureKey.mockRejectedValueOnce(new Error('OpenBao unavailable'));
    expect((await request(second.token, 'provision')).statusCode).toBe(502);
    const [pending] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, second.id));
    // The generated name is recorded before the key exists, so a retry reads the same key.
    expect(pending.keyId).toMatch(/^scep-ra-/); expect(pending.keyProvider).toBe('openbao');
    await db.update(integrationRAs).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(integrationRAs.integrationId, second.id));
    expect((await request(second.token, 'provision')).statusCode).toBe(200);
    const [done] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, second.id));
    expect(done.keyId).toBe(pending.keyId);
    expect(operation).not.toHaveBeenCalled();
  });
});
