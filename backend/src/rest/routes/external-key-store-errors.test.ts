/**
 * External issuer API on a key store outage (TASK-288): /sign answers 503 KEY_STORE_UNAVAILABLE
 * with Retry-After and no OpenBao detail, stores no certificate, and the retry with the same
 * requestUid after recovery issues exactly one certificate.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';

const { signCertificate, getCertificate, verifyToken, regenerateForCa } = vi.hoisted(() => ({
  signCertificate: vi.fn(), getCertificate: vi.fn(), verifyToken: vi.fn(), regenerateForCa: vi.fn(),
}));
vi.mock('../../kms/service.js', () => ({ getKMSService: () => ({ signCertificate, getCertificate }) }));
vi.mock('../../services/integration.service.js', () => ({ getIntegrationService: () => ({ verifyToken }) }));
vi.mock('../../services/crl.service.js', () => ({ getCRLService: () => ({ regenerateForCa }) }));

import { externalRoutes } from './external.routes.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { KeyStoreUnavailableError, toKeyStoreError } from '../../keystore/errors.js';
import { OpenBaoTransitError } from '../../openbao/x509-transit.js';

const caKp = forge.pki.rsa.generateKeyPair({ bits: 2048 });
function selfSigned(cn: string, key = caKp): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = key.publicKey;
  cert.serialNumber = '0' + randomUUID().replace(/-/g, '').slice(0, 20);
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 90 * 86400e3);
  cert.setSubject([{ name: 'commonName', value: cn }]);
  cert.setIssuer([{ name: 'commonName', value: 'External Outage CA' }]);
  cert.sign(caKp.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}
function csrPem(cn: string): string {
  const kp = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = kp.publicKey;
  csr.setSubject([{ name: 'commonName', value: cn }]);
  csr.setAttributes([{ name: 'extensionRequest', extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: cn }] }] }]);
  csr.sign(kp.privateKey, forge.md.sha256.create());
  return forge.pki.certificationRequestToPem(csr);
}

describe('External /sign on a key store outage', () => {
  let app: FastifyInstance;
  const caId = randomUUID();
  const caPem = selfSigned('External Outage CA');

  beforeAll(async () => {
    await db.insert(certificateAuthorities).values({
      id: caId, subjectDn: 'CN=External Outage CA', serialNumber: '01', keyAlgorithm: 'RSA-2048',
      notBefore: new Date(Date.now() - 86400e3), notAfter: new Date(Date.now() + 3650 * 86400e3),
      kmsKeyId: 'ca-key', kmsCertificateId: 'ca-cert', status: 'active', createdAt: new Date(), updatedAt: new Date(),
    });
    verifyToken.mockResolvedValue({ id: randomUUID(), name: 'outage', caId, kind: 'kubernetes' });
    regenerateForCa.mockResolvedValue(true);
    app = Fastify();
    await app.register(externalRoutes, { prefix: '/api/v1/external' });
    await app.ready();
  });

  afterAll(async () => {
    await db.delete(certificates).where(eq(certificates.caId, caId));
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
    await app.close();
  });

  it('answers 503 with Retry-After, then issues once on retry', async () => {
    const requestUid = randomUUID();
    const body = { csrPem: csrPem('outage.svc'), requestUid, certificateType: 'server', k8sNamespace: 'default', k8sResource: 'outage' };
    const sealed = toKeyStoreError(new OpenBaoTransitError(503, 'sign/<name>', 'Vault is sealed'), 'sign');
    expect(sealed).toBeInstanceOf(KeyStoreUnavailableError);
    signCertificate.mockRejectedValueOnce(sealed);

    const res = await app.inject({ method: 'POST', url: '/api/v1/external/sign', headers: { authorization: 'Bearer t' }, payload: body });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toEqual({ error: { code: 'KEY_STORE_UNAVAILABLE', message: 'The key store is unavailable; retry later' } });
    expect(res.body).not.toMatch(/sealed|OpenBao/i);
    expect(await db.select().from(certificates).where(eq(certificates.caId, caId))).toHaveLength(0);

    const leaf = selfSigned('outage.svc');
    signCertificate.mockResolvedValue({ certificateId: 'leaf-cert', certificateData: '' });
    getCertificate.mockImplementation(async (id: string) => (id === 'ca-cert' ? caPem : leaf));
    const retry = await app.inject({ method: 'POST', url: '/api/v1/external/sign', headers: { authorization: 'Bearer t' }, payload: body });
    expect(retry.statusCode, retry.body).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/api/v1/external/sign', headers: { authorization: 'Bearer t' }, payload: body });
    expect(again.json().idempotent).toBe(true);
    expect(await db.select().from(certificates).where(eq(certificates.caId, caId))).toHaveLength(1);
  });
});
