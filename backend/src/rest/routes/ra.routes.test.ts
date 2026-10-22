import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';
import { db, sqliteDb } from '../../db/client.js';
import { auditLog, certificateAuthorities, certificates, integrationRAs, integrations } from '../../db/schema.js';
import { externalRoutes } from './external.routes.js';
import { IntegrationService } from '../../services/integration.service.js';

const { operation, signCertificate, getCertificate } = vi.hoisted(() => ({ operation: vi.fn(), signCertificate: vi.fn(), getCertificate: vi.fn() }));
vi.mock('../../kms/service.js', () => ({ getKMSService: () => ({ performRAOperation: operation, signCertificate, getCertificate }) }));
const kp = forge.pki.rsa.generateKeyPair(2048);
const ca = forge.pki.createCertificate(); ca.publicKey = kp.publicKey; ca.serialNumber = '01';
ca.validity.notBefore = new Date(Date.now() - 86400e3); ca.validity.notAfter = new Date(Date.now() + 3650 * 86400e3);
ca.setSubject([{ name: 'commonName', value: 'RA Test CA' }]); ca.setIssuer(ca.subject.attributes);
ca.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
ca.sign(kp.privateKey, forge.md.sha256.create());
const caPem = forge.pki.certificateToPem(ca);
const keys = new Map<string, string>();
const certs = new Map<string, string>();
const caId = randomUUID();
const caKMSId = `ca-${caId}`;

function certificate(publicId: string, notBefore = new Date(Date.now() - 60e3), notAfter = new Date(Date.now() + 90 * 86400e3)) {
  const cert = forge.pki.createCertificate(); cert.publicKey = forge.pki.publicKeyFromPem(keys.get(publicId)!);
  cert.serialNumber = randomUUID().replace(/-/g, ''); cert.validity.notBefore = notBefore; cert.validity.notAfter = notAfter;
  cert.setSubject([{ name: 'commonName', value: 'SCEP Registration Authority' }]); cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', clientAuth: true }]);
  cert.sign(kp.privateKey, forge.md.sha256.create()); return forge.pki.certificateToPem(cert);
}

describe('backend-owned RA boundary', () => {
  let app: FastifyInstance;
  let first: { id: string; token: string };
  let second: { id: string; token: string };
  let generic: { id: string; token: string };
  const field = (tag: string, value: unknown) => ({ tag, value });
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
    operation.mockReset().mockImplementation(async (op: string, fields: Array<{ tag: string; value: string }>) => {
      if (op === 'CreateKeyPair') {
        const generated = generateKeyPairSync('rsa', { modulusLength: 3072 });
        const id = `private-${randomUUID()}`; const publicId = `public-${randomUUID()}`;
        keys.set(id, generated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
        keys.set(publicId, generated.publicKey.export({ type: 'spki', format: 'pem' }).toString());
        return field('Response', [field('PrivateKeyUniqueIdentifier', id), field('PublicKeyUniqueIdentifier', publicId)]);
      }
      const id = fields.find(f => f.tag === 'UniqueIdentifier')?.value;
      if (!keys.has(id!)) throw new Error('Unknown test KMS key');
      if (op === 'Get') return field('Response', [field('KeyMaterial', forge.util.bytesToHex(forge.asn1.toDer(forge.pki.publicKeyToAsn1(forge.pki.publicKeyFromPem(keys.get(id!)!))).getBytes()))]);
      if (op === 'Sign') return field('Response', [field('SignatureData', Buffer.alloc(384, 7).toString('hex'))]);
      if (op === 'Decrypt') return field('Response', [field('Data', Buffer.alloc(32, 3).toString('hex'))]);
      return field('Response', []);
    });
    signCertificate.mockReset().mockImplementation(async ({ publicKeyId }: { publicKeyId: string }) => {
      const id = randomUUID(); certs.set(id, certificate(publicKeyId)); return { certificateId: id };
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

  it('provisions Sensitive integration-bound keys and exposes only public state', async () => {
    const res = await request(first.token, 'provision');
    expect(res.statusCode).toBe(200); expect(res.json().certificatePem).toContain('BEGIN CERTIFICATE');
    expect(Object.keys(res.json()).sort()).toEqual(['certificatePem', 'previousCertificatesPem']);
    const created = operation.mock.calls.find(([op]) => op === 'CreateKeyPair')!;
    expect(JSON.stringify(created)).toContain('Sensitive'); expect(JSON.stringify(created)).toContain('true');
    operation.mockClear();
    expect((await request(first.token, 'provision')).statusCode).toBe(200);
    expect(operation).not.toHaveBeenCalled();
    expect((await request(second.token, 'state')).statusCode).toBe(404);
  });
  it('cannot select another integration key and rejects non-SCEP identities', async () => {
    expect((await request(second.token, 'provision')).statusCode).toBe(200);
    operation.mockClear();
    const digest = Buffer.alloc(32, 1).toString('base64');
    expect((await request(first.token, 'sign', { digest, keyId: 'test-ca-key' })).statusCode).toBe(400);
    expect((await request(generic.token, 'sign', { digest })).statusCode).toBe(403);
    expect(operation).not.toHaveBeenCalled();
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    const signed = await request(first.token, 'sign', { digest });
    expect(signed.statusCode).toBe(200);
    expect(operation.mock.calls.at(-1)?.[1]).toContainEqual(expect.objectContaining({ tag: 'UniqueIdentifier', value: binding.keyId }));
    expect((await request(first.token, 'decrypt', { data: Buffer.alloc(384).toString('base64') })).statusCode).toBe(200);
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, first.id));
    expect(rows.some(r => r.operation === 'scep.ra.sign' && r.status === 'success')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(digest);
  });
  it('rejects algorithm overrides, malformed sizes and invalid tokens before cryptography', async () => {
    expect((await request(first.token, 'sign', { digest: 'AA==' })).statusCode).toBe(400);
    expect((await request(first.token, 'decrypt', { data: 'AA==' })).statusCode).toBe(400);
    expect((await request(first.token, 'sign', { digest: Buffer.alloc(32).toString('base64'), algorithm: 'SHA1' })).statusCode).toBe(400);
    expect((await request('invalid', 'state')).statusCode).toBe(401);
    expect(operation).not.toHaveBeenCalled();
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
    expect(operation).not.toHaveBeenCalled();
  });
  it('renews backend-owned state atomically and retains previous RA identity', async () => {
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    const before = new Date(Date.now() - 80 * 86400e3); const after = new Date(Date.now() + 10 * 86400e3);
    const old = certificate(binding.publicKeyId!, before, after);
    await db.update(integrationRAs).set({ certificatePem: old }).where(eq(integrationRAs.integrationId, first.id));
    await db.update(certificates).set({ certificatePem: old, notBefore: before, notAfter: after }).where(eq(certificates.id, binding.certificateId!));
    const renewed = await request(first.token, 'renew');
    expect(renewed.statusCode).toBe(200); expect(renewed.json().previousCertificatesPem).toContain(old);
    const [updated] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    expect(updated.keyId).toBe(binding.keyId); expect(updated.certificateId).not.toBe(binding.certificateId);
    signCertificate.mockClear(); expect((await request(first.token, 'renew')).statusCode).toBe(200);
    expect(signCertificate).not.toHaveBeenCalled();
  });
  it('fails closed before KMS when the RA audit intent cannot persist', async () => {
    sqliteDb.exec("CREATE TRIGGER reject_ra_audit BEFORE INSERT ON audit_log WHEN NEW.operation = 'scep.ra.sign' BEGIN SELECT RAISE(FAIL, 'simulated audit failure'); END");
    try {
      expect((await request(first.token, 'sign', { digest: Buffer.alloc(32).toString('base64') })).statusCode).toBe(500);
      expect(operation).not.toHaveBeenCalled();
    } finally { sqliteDb.exec('DROP TRIGGER reject_ra_audit'); }
  });
  it('rejects KMS serial reuse without publishing a replacement binding', async () => {
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    await db.update(certificates).set({ notBefore: new Date(Date.now() - 90 * 86400e3), notAfter: new Date(Date.now() - 1000) }).where(eq(certificates.id, binding.certificateId!));
    const collision = forge.pki.certificateFromPem(certificate(binding.publicKeyId!, new Date(Date.now() - 1000), new Date(Date.now() + 100 * 86400e3)));
    collision.serialNumber = forge.pki.certificateFromPem(binding.certificatePem!).serialNumber;
    collision.sign(kp.privateKey, forge.md.sha256.create());
    signCertificate.mockImplementationOnce(async () => { const id = randomUUID(); certs.set(id, forge.pki.certificateToPem(collision)); return { certificateId: id }; });
    const response = await request(first.token, 'renew');
    expect(response.statusCode, response.body).toBe(409); expect(response.json().error.message).toContain('serial');
    const [unchanged] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, first.id));
    expect(unchanged.certificateId).toBe(binding.certificateId); expect(unchanged.lease).toBeNull();
  });

});
