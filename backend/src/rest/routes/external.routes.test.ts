/**
 * External issuer /sign wiring tests (TASK-109.22).
 *
 * The KMS and cluster services are mocked so these run without a live KMS: they verify the
 * ROUTE logic — that /sign signs the CSR via kms.signCertificate(preserveCsrKey) using the
 * cluster CA's kmsCertificateId, stores a k8s cert (no private key), returns cert+chain, and
 * is idempotent on requestUid. The real KMS behaviour (CSR-key preservation, extension
 * fidelity) is validated separately by src/kms/spike-csr-certify.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import forge from 'node-forge';

// --- mocks (vi.hoisted so the fns exist when the mock factories run at import time) ---
const { signCertificate, getCertificate, verifyToken } = vi.hoisted(() => ({
  signCertificate: vi.fn(),
  getCertificate: vi.fn(),
  verifyToken: vi.fn(),
}));
vi.mock('../../kms/service.js', () => ({
  getKMSService: () => ({ signCertificate, getCertificate }),
}));
vi.mock('../../services/cluster.service.js', () => ({
  getClusterService: () => ({ verifyToken }),
}));

import { externalRoutes } from './external.routes.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

// CA used as the issuer
const caKp = forge.pki.rsa.generateKeyPair({ bits: 2048 });
const caCert = forge.pki.createCertificate();
caCert.publicKey = caKp.publicKey;
caCert.serialNumber = '01';
caCert.validity.notBefore = new Date(Date.now() - 86400e3);
caCert.validity.notAfter = new Date(Date.now() + 3650 * 86400e3);
caCert.setSubject([{ name: 'commonName', value: 'Test K8s CA' }, { shortName: 'O', value: 'Test' }, { shortName: 'C', value: 'US' }]);
caCert.setIssuer(caCert.subject.attributes);
caCert.sign(caKp.privateKey, forge.md.sha256.create());
const caCertPem = forge.pki.certificateToPem(caCert);

// Helper: build a leaf cert PEM (mimics what the KMS would return)
function makeLeafPem(csrPem: string): string {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = csr.publicKey!;
  leaf.serialNumber = '00' + randomUUID().replace(/-/g, '').slice(0, 30);
  leaf.validity.notBefore = new Date();
  leaf.validity.notAfter = new Date(Date.now() + 90 * 86400e3);
  leaf.setSubject(csr.subject.attributes);
  leaf.setIssuer(caCert.subject.attributes);
  leaf.sign(caKp.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(leaf);
}

// Helper: cert-manager-style CSR (CN + DNS SAN)
function makeCsr(cn = 'svc.default.svc'): string {
  const kp = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = kp.publicKey;
  csr.setSubject([{ name: 'commonName', value: cn }]);
  csr.setAttributes([{ name: 'extensionRequest', extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: cn }] }] }]);
  csr.sign(kp.privateKey, forge.md.sha256.create());
  return forge.pki.certificationRequestToPem(csr);
}

describe('External /sign wiring (KMS certify)', () => {
  let app: FastifyInstance;
  const caId = randomUUID();
  const clusterId = randomUUID();
  const KMS_LEAF_ID = 'kms-leaf-id';
  const CA_KMS_CERT_ID = 'kms-ca-cert-id';

  beforeAll(async () => {
    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: 'CN=Test K8s CA,O=Test,C=US',
      serialNumber: '01',
      keyAlgorithm: 'RSA-2048',
      notBefore: new Date(Date.now() - 86400e3),
      notAfter: new Date(Date.now() + 3650 * 86400e3),
      kmsKeyId: 'kms-ca-key-id',
      kmsCertificateId: CA_KMS_CERT_ID,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    app = Fastify();
    await app.register(externalRoutes, { prefix: '/api/v1/external' });
    await app.ready();
  });

  afterAll(async () => {
    await db.delete(certificates).where(eq(certificates.caId, caId));
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
    await app.close();
  });

  beforeEach(async () => {
    await db.delete(certificates).where(eq(certificates.caId, caId));
    verifyToken.mockReset().mockResolvedValue({ id: clusterId, name: 'c1', caId });
    getCertificate.mockReset().mockImplementation(async (id: string) =>
      id === CA_KMS_CERT_ID ? caCertPem : makeLeafPem(lastCsr));
    signCertificate.mockReset().mockResolvedValue({ certificateId: KMS_LEAF_ID, certificateData: '' });
  });

  let lastCsr = '';
  async function postSign(body: Record<string, unknown>) {
    lastCsr = (body.csrPem as string) ?? lastCsr;
    return app.inject({
      method: 'POST',
      url: '/api/v1/external/sign',
      headers: { authorization: 'Bearer test-token' },
      payload: body,
    });
  }

  it('signs a CSR via the KMS and stores a k8s certificate (no private key)', async () => {
    const csrPem = makeCsr();
    const requestUid = randomUUID();
    const res = await postSign({ csrPem, requestUid, certificateType: 'server', k8sNamespace: 'default', k8sResource: 'svc' });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.idempotent).toBe(false);
    expect(json.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(json.chainPem).toBe(caCertPem);
    expect(json.serialNumber).toBeTruthy();

    // KMS was asked to preserve the CSR key and sign with the CA's KMS cert
    expect(signCertificate).toHaveBeenCalledTimes(1);
    const arg = signCertificate.mock.calls[0][0];
    expect(arg.preserveCsrKey).toBe(true);
    expect(arg.issuerCertificateId).toBe(CA_KMS_CERT_ID);
    expect(arg.csr).toBe(csrPem);
    expect(arg.x509Extensions).toContain('CA:FALSE');

    // DB row: k8s source, KMS cert id stored, no leaf key
    const rows = await db.select().from(certificates).where(eq(certificates.requestUid, requestUid));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe('k8s');
    expect(rows[0].kmsCertificateId).toBe(KMS_LEAF_ID);
    expect(rows[0].kmsKeyId).toBeNull();
    expect(rows[0].k8sClusterId).toBe(clusterId);
  });

  it('is idempotent on requestUid (no second KMS sign)', async () => {
    const csrPem = makeCsr();
    const requestUid = randomUUID();
    const first = await postSign({ csrPem, requestUid });
    expect(first.statusCode).toBe(200);

    const second = await postSign({ csrPem, requestUid });
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().id).toBe(first.json().id);
    // signed only once
    expect(signCertificate).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when csrPem/requestUid are missing', async () => {
    const res = await postSign({ requestUid: randomUUID() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('returns 409 when the cluster CA is not active', async () => {
    await db.update(certificateAuthorities).set({ status: 'revoked' }).where(eq(certificateAuthorities.id, caId));
    const res = await postSign({ csrPem: makeCsr(), requestUid: randomUUID() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CA_NOT_ACTIVE');
    await db.update(certificateAuthorities).set({ status: 'active' }).where(eq(certificateAuthorities.id, caId));
  });
});
