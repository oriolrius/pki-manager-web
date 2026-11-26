import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { constants, generateKeyPairSync, publicEncrypt, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { auditLog, certificateAuthorities, certificates, integrationRAs, integrations } from '../../db/schema.js';
import { externalRoutes } from './external.routes.js';
import { IntegrationService } from '../../services/integration.service.js';
import { OpenBaoError, verifyDigestSignature } from '../../openbao/ra-transit.js';

// Cosmian stays the issuing CA backend; the RA key goes to a fake OpenBao Transit
// with a real RSA-3072 key (the live fork run is in docs/scep/openbao-ra.md).
const { operation, signCertificate, getCertificate, transit } = vi.hoisted(() => ({
  operation: vi.fn(), signCertificate: vi.fn(), getCertificate: vi.fn(),
  transit: { readKey: vi.fn(), ensureKey: vi.fn(), signDigest: vi.fn(), unwrapSessionKey: vi.fn() },
}));
vi.mock('../../kms/service.js', () => ({ getKMSService: () => ({ performRAOperation: operation, signCertificate, getCertificate }) }));
vi.mock('../../openbao/ra-transit.js', async original => ({ ...(await original<object>()), getOpenBaoRATransit: () => transit }));

const kp = forge.pki.rsa.generateKeyPair(2048);
const ca = forge.pki.createCertificate(); ca.publicKey = kp.publicKey; ca.serialNumber = '01';
ca.validity.notBefore = new Date(Date.now() - 86400e3); ca.validity.notAfter = new Date(Date.now() + 3650 * 86400e3);
ca.setSubject([{ name: 'commonName', value: 'RA OpenBao Test CA' }]); ca.setIssuer(ca.subject.attributes);
ca.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
ca.sign(kp.privateKey, forge.md.sha256.create());
const caPem = forge.pki.certificateToPem(ca);
const caId = randomUUID();
const caKMSId = `ca-${caId}`;
const certs = new Map<string, string>();
const baoKeys = new Map<string, { priv: KeyObject; pub: KeyObject }>();
const cosmianKeys = new Map<string, string>();

function issueFrom(publicKey: forge.pki.PublicKey, notBefore = new Date(Date.now() - 60e3), notAfter = new Date(Date.now() + 90 * 86400e3)) {
  const cert = forge.pki.createCertificate(); cert.publicKey = publicKey;
  cert.serialNumber = randomUUID().replace(/-/g, ''); cert.validity.notBefore = notBefore; cert.validity.notAfter = notAfter;
  cert.setSubject([{ name: 'commonName', value: 'SCEP Registration Authority' }]); cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }]);
  cert.sign(kp.privateKey, forge.md.sha256.create()); return forge.pki.certificateToPem(cert);
}

describe('OpenBao-bound SCEP RA (opt-in)', () => {
  let app: FastifyInstance;
  let bao: { id: string; token: string };
  let legacy: { id: string; token: string };
  const field = (tag: string, value: unknown) => ({ tag, value });
  const request = (token: string, op: string, payload?: object) => app.inject({ method: op === 'state' ? 'GET' : 'POST', url: `/external/ra/${op}`, headers: { authorization: `Bearer ${token}` }, ...(op === 'state' ? {} : { payload: payload ?? {} }) });
  const bindingOf = async (id: string) => (await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, id)))[0];

  beforeAll(async () => {
    await db.insert(certificateAuthorities).values({ id: caId, subjectDn: 'CN=RA OpenBao Test CA', serialNumber: randomUUID(), kmsKeyId: 'test-ca-key', kmsCertificateId: caKMSId, notBefore: ca.validity.notBefore, notAfter: ca.validity.notAfter, status: 'active' });
    const service = new IntegrationService();
    bao = await service.register({ db }, { name: 'RA openbao', caId, kind: 'scep' });
    legacy = await service.register({ db }, { name: 'RA legacy cosmian', caId, kind: 'scep' });
    app = Fastify(); await app.register(externalRoutes, { prefix: '/external' }); await app.ready();
  });
  beforeEach(() => {
    operation.mockReset().mockImplementation(async (op: string, fields: Array<{ tag: string; value: string }>) => {
      if (op === 'CreateKeyPair') {
        const generated = generateKeyPairSync('rsa', { modulusLength: 3072 });
        const id = `private-${randomUUID()}`; const publicId = `public-${randomUUID()}`;
        cosmianKeys.set(publicId, generated.publicKey.export({ type: 'spki', format: 'pem' }).toString()); cosmianKeys.set(id, 'private');
        return field('Response', [field('PrivateKeyUniqueIdentifier', id), field('PublicKeyUniqueIdentifier', publicId)]);
      }
      const id = fields.find(f => f.tag === 'UniqueIdentifier')?.value;
      if (!cosmianKeys.has(id!)) throw new Error('Unknown test KMS key');
      if (op === 'GetAttributes') return field('Response', [field('State', 'Active')]);
      if (op === 'Get') return field('Response', [field('KeyMaterial', forge.util.bytesToHex(forge.asn1.toDer(forge.pki.publicKeyToAsn1(forge.pki.publicKeyFromPem(cosmianKeys.get(id!)!))).getBytes()))]);
      if (op === 'Sign') return field('Response', [field('SignatureData', Buffer.alloc(384, 7).toString('hex'))]);
      return field('Response', []);
    });
    signCertificate.mockReset().mockImplementation(async (o: { csr?: string; publicKeyId?: string }) => {
      const id = randomUUID();
      if (o.csr) {
        const csr = forge.pki.certificationRequestFromPem(o.csr);
        if (!csr.verify()) throw new Error('CSR signature invalid');
        certs.set(id, issueFrom(csr.publicKey as forge.pki.PublicKey));
      } else certs.set(id, issueFrom(forge.pki.publicKeyFromPem(cosmianKeys.get(o.publicKeyId!)!)));
      return { certificateId: id };
    });
    getCertificate.mockReset().mockImplementation(async (id: string) => id === caKMSId ? caPem : certs.get(id));
    transit.readKey.mockReset().mockImplementation(async (name: string) => baoKeys.get(name)?.pub ?? null);
    transit.ensureKey.mockReset().mockImplementation(async (name: string, version: number) => {
      expect(version).toBe(1);
      if (!baoKeys.has(name)) { const g = generateKeyPairSync('rsa', { modulusLength: 3072 }); baoKeys.set(name, { priv: g.privateKey, pub: g.publicKey }); }
      return baoKeys.get(name)!.pub;
    });
    transit.signDigest.mockReset().mockImplementation(async (name: string, _v: number, digest: Buffer) => {
      const k = baoKeys.get(name)!;
      const forgeKey = forge.pki.privateKeyFromPem(k.priv.export({ type: 'pkcs8', format: 'pem' }).toString());
      const md = forge.md.sha256.create(); (md as unknown as { digest: () => forge.util.ByteStringBuffer }).digest = () => forge.util.createBuffer(digest.toString('binary'));
      return Buffer.from(forgeKey.sign(md), 'binary');
    });
    transit.unwrapSessionKey.mockReset().mockImplementation(async (name: string, _v: number, ciphertext: Buffer, length: number) => {
      const k = baoKeys.get(name)!;
      const forgeKey = forge.pki.privateKeyFromPem(k.priv.export({ type: 'pkcs8', format: 'pem' }).toString());
      const plain = Buffer.from(forgeKey.decrypt(ciphertext.toString('binary'), 'RSAES-PKCS1-V1_5'), 'binary');
      if (plain.length !== length) throw new Error('fallback key would not decrypt the content');
      return plain;
    });
  });
  afterAll(async () => {
    delete process.env.SCEP_RA_KEY_PROVIDER;
    await app.close();
    for (const identity of [bao, legacy]) {
      await db.delete(integrationRAs).where(eq(integrationRAs.integrationId, identity.id));
      await db.delete(certificates).where(eq(certificates.integrationId, identity.id));
      await db.delete(auditLog).where(eq(auditLog.entityId, identity.id));
      await db.delete(integrations).where(eq(integrations.id, identity.id));
    }
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
  });

  it('keeps Cosmian as the default and keeps a legacy binding on Cosmian after the switch', async () => {
    delete process.env.SCEP_RA_KEY_PROVIDER;
    expect((await request(legacy.token, 'provision')).statusCode).toBe(200);
    const binding = await bindingOf(legacy.id);
    expect(binding.keyProvider).toBe('cosmian'); expect(binding.keyVersion).toBeNull();
    expect(operation.mock.calls.some(([op]) => op === 'CreateKeyPair')).toBe(true);
    process.env.SCEP_RA_KEY_PROVIDER = 'openbao';
    operation.mockClear();
    expect((await request(legacy.token, 'sign', { digest: Buffer.alloc(32, 1).toString('base64') })).statusCode).toBe(200);
    expect(operation.mock.calls.at(-1)?.[0]).toBe('Sign');
    expect(transit.signDigest).not.toHaveBeenCalled();
  });

  it('provisions a new binding in OpenBao and issues its RA certificate with the Cosmian CA from an OpenBao-signed CSR', async () => {
    process.env.SCEP_RA_KEY_PROVIDER = 'openbao';
    const res = await request(bao.token, 'provision');
    expect(res.statusCode, res.body).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['certificatePem', 'previousCertificatesPem']);
    const binding = await bindingOf(bao.id);
    expect(binding.keyProvider).toBe('openbao');
    expect(binding.keyId).toMatch(/^scep-ra-[0-9a-f-]{36}$/);
    expect(binding.keyVersion).toBe(1); expect(binding.publicKeyId).toBeNull(); expect(binding.lease).toBeNull();
    expect(operation).not.toHaveBeenCalled(); // no Cosmian RA key operation
    const certify = signCertificate.mock.calls[0][0];
    expect(certify).toMatchObject({ preserveCsrKey: true, issuerCertificateId: caKMSId });
    expect(certify.publicKeyId).toBeUndefined();
    expect(certify.x509Extensions).toContain('keyEncipherment');
    const [row] = await db.select().from(certificates).where(eq(certificates.id, binding.certificateId!));
    expect(row.kmsKeyId).toBeNull(); // the Transit key name never goes to Cosmian code paths
    expect(JSON.stringify(res.json())).not.toContain(binding.keyId);
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, bao.id));
    expect(audit.find(r => r.operation === 'scep.ra.provision')?.details).toBe(JSON.stringify({ phase: 'completed', provider: 'openbao' }));
  });

  it('signs and unwraps with the bound key and fixed version only', async () => {
    const binding = await bindingOf(bao.id);
    const digest = randomBytes(32);
    const signed = await request(bao.token, 'sign', { digest: digest.toString('base64') });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(transit.signDigest).toHaveBeenCalledWith(binding.keyId, 1, digest, expect.anything());
    expect(verifyDigestSignature(baoKeys.get(binding.keyId!)!.pub, digest, Buffer.from(signed.json().data, 'base64'))).toBe(true);
    for (const length of [16, 24, 32]) {
      const sessionKey = randomBytes(length);
      const data = publicEncrypt({ key: baoKeys.get(binding.keyId!)!.pub, padding: constants.RSA_PKCS1_PADDING }, sessionKey).toString('base64');
      const res = await request(bao.token, 'decrypt', { data, sessionKeyLength: length });
      expect(res.statusCode, res.body).toBe(200);
      expect(Buffer.from(res.json().data, 'base64').equals(sessionKey)).toBe(true);
      expect(transit.unwrapSessionKey).toHaveBeenLastCalledWith(binding.keyId, 1, expect.any(Buffer), length);
    }
    expect((await request(bao.token, 'sign', { digest: digest.toString('base64'), keyId: 'scep-ra-other' })).statusCode).toBe(400);
    expect(operation).not.toHaveBeenCalled();
  });

  it('requires the session key length and gives one error for every OpenBao decryption failure', async () => {
    const data = Buffer.alloc(384, 5).toString('base64');
    const noLength = await request(bao.token, 'decrypt', { data });
    expect(noLength.statusCode).toBe(400);
    expect(transit.unwrapSessionKey).not.toHaveBeenCalled();
    transit.unwrapSessionKey.mockRejectedValueOnce(new OpenBaoError(400, 'session-key/pkcs1v15/x', 'secret server text'));
    const httpFailure = await request(bao.token, 'decrypt', { data, sessionKeyLength: 32 });
    transit.unwrapSessionKey.mockRejectedValueOnce(new Error('session key has the wrong length'));
    const lengthFailure = await request(bao.token, 'decrypt', { data, sessionKeyLength: 16 });
    for (const response of [httpFailure, lengthFailure]) {
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: { code: 'RA_OPERATION_FAILED', message: 'RA decryption failed' } });
    }
    transit.signDigest.mockRejectedValueOnce(new OpenBaoError(403, 'sign/x/sha2-256', 'permission denied'));
    const signFailure = await request(bao.token, 'sign', { digest: Buffer.alloc(32).toString('base64') });
    expect(signFailure.statusCode).toBe(502);
    expect(signFailure.body).not.toContain('permission denied');
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, bao.id));
    expect(rows.filter(r => r.operation === 'scep.ra.decrypt' && r.status === 'failure').map(r => JSON.parse(r.details!)))
      .toContainEqual({ phase: 'failed', statusCode: 502, code: 'RA_OPERATION_FAILED', provider: 'openbao' });
    expect(JSON.stringify(rows)).not.toContain(data);
    expect(JSON.stringify(rows)).not.toContain('secret server text');
  });

  it('renews the RA certificate with the same OpenBao key and version', async () => {
    const binding = await bindingOf(bao.id);
    const before = new Date(Date.now() - 80 * 86400e3); const after = new Date(Date.now() + 10 * 86400e3);
    const pub = forge.pki.publicKeyFromPem(baoKeys.get(binding.keyId!)!.pub.export({ type: 'spki', format: 'pem' }).toString());
    const old = issueFrom(pub, before, after);
    await db.update(integrationRAs).set({ certificatePem: old }).where(eq(integrationRAs.integrationId, bao.id));
    await db.update(certificates).set({ certificatePem: old, notBefore: before, notAfter: after }).where(eq(certificates.id, binding.certificateId!));
    signCertificate.mockClear(); transit.ensureKey.mockClear();
    const renewed = await request(bao.token, 'renew');
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(renewed.json().previousCertificatesPem).toContain(old);
    const updated = await bindingOf(bao.id);
    expect(updated.keyId).toBe(binding.keyId); expect(updated.keyVersion).toBe(1); expect(updated.certificateId).not.toBe(binding.certificateId);
    expect(signCertificate.mock.calls[0][0].csr).toContain('CERTIFICATE REQUEST');
    expect(transit.ensureKey).not.toHaveBeenCalled(); // renewal never creates a key
    expect(operation).not.toHaveBeenCalled();
  });

  it('fails closed when the OpenBao key disappeared, without publishing a new binding', async () => {
    const binding = await bindingOf(bao.id);
    await db.update(certificates).set({ notBefore: new Date(Date.now() - 90 * 86400e3), notAfter: new Date(Date.now() - 1000) }).where(eq(certificates.id, binding.certificateId!));
    transit.readKey.mockResolvedValueOnce(null);
    const res = await request(bao.token, 'renew');
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toBe('RA key operation failed');
    const unchanged = await bindingOf(bao.id);
    expect(unchanged.certificateId).toBe(binding.certificateId); expect(unchanged.lease).toBeNull();
    await db.update(certificates).set({ notBefore: new Date(Date.now() - 1000), notAfter: new Date(Date.now() + 80 * 86400e3) }).where(eq(certificates.id, binding.certificateId!));
  });

  it('fails closed with 503 when the provider is not configured', async () => {
    const binding = await bindingOf(bao.id);
    process.env.SCEP_RA_KEY_PROVIDER = 'vault';
    await db.update(integrationRAs).set({ keyId: null, keyProvider: 'cosmian', keyVersion: null, certificateId: null, certificatePem: null }).where(eq(integrationRAs.integrationId, bao.id));
    const res = await request(bao.token, 'provision');
    expect(res.statusCode).toBe(503);
    expect(operation).not.toHaveBeenCalled(); expect(transit.ensureKey).not.toHaveBeenCalled();
    process.env.SCEP_RA_KEY_PROVIDER = 'openbao';
    await db.update(integrationRAs).set({ keyId: binding.keyId, keyProvider: 'openbao', keyVersion: 1, certificateId: binding.certificateId, certificatePem: binding.certificatePem, lease: null, leaseUntil: null }).where(eq(integrationRAs.integrationId, bao.id));
  });
});
