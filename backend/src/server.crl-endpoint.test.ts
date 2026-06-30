/**
 * Public CRL HTTP endpoint tests — exercised against the REAL handler.
 *
 * Boots a Fastify instance and registers the production `publicCrlRoutes` plugin (the same one
 * server.ts mounts), then serves a REAL node-forge/Node-crypto-signed CRL seeded into the DB.
 * This replaces the previous suite which tested a divergent inline COPY of the handler with a
 * hand-pasted mock PEM. KMS is not required (the CRL is pre-signed and stored).
 *
 * Validates: PEM (.crl, application/x-pem-file) and DER (.der, application/pkix-crl) serving,
 * the DER body is structurally valid + round-trips, RFC 5280 caching headers, 400/404 handling,
 * and that the lazy-regen-on-expiry branch degrades gracefully (serves the stale CRL when the
 * KMS-backed regeneration cannot run).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { certificateAuthorities, crls } from './db/schema.js';
import { publicCrlRoutes } from './rest/routes/public-crl.routes.js';
import { generateCRL } from './crypto/crl.js';
import { CRLReason } from './crypto/types.js';

/** Build a self-signed CA cert + key for signing a test CRL. */
function makeCa() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3650 * 864e5);
  const attrs = [
    { name: 'commonName', value: 'Endpoint Test CA' },
    { shortName: 'O', value: 'Test' },
    { shortName: 'C', value: 'US' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

describe('Public CRL HTTP endpoint (real handler)', () => {
  let server: FastifyInstance;
  const caId = randomUUID();
  const expiredCaId = randomUUID();
  const noCrlCaId = randomUUID();
  const revokedSerial = '0a1b2c3d4e5f';
  let crlPem: string;

  beforeAll(async () => {
    const ca = makeCa();

    // CA with a fresh, valid CRL.
    crlPem = generateCRL({
      issuer: { CN: 'Endpoint Test CA', O: 'Test', C: 'US' },
      crlNumber: 3,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 7 * 864e5),
      revokedCertificates: [{ serialNumber: revokedSerial, revocationDate: new Date(), reason: CRLReason.KEY_COMPROMISE }],
      signingKey: ca.keyPem,
      signatureAlgorithm: 'SHA256-RSA',
      issuerCertificate: ca.certPem,
    }).pem;

    const caRow = (id: string) => ({
      id,
      kmsCertificateId: `fake-cert-${id}`,
      kmsKeyId: `fake-key-${id}`,
      subjectDn: 'CN=Endpoint Test CA,O=Test,C=US',
      serialNumber: randomUUID(),
      keyAlgorithm: 'RSA-2048',
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 3650 * 864e5),
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(certificateAuthorities).values([caRow(caId), caRow(expiredCaId), caRow(noCrlCaId)] as any);

    await db.insert(crls).values({
      id: randomUUID(),
      caId,
      crlNumber: 3,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 7 * 864e5),
      crlPem,
      revokedCount: 1,
      createdAt: new Date(),
    } as any);

    // An already-expired CRL: the lazy-regen branch will try (and best-effort fail, fake KMS ids)
    // and must then serve this stale CRL rather than erroring.
    await db.insert(crls).values({
      id: randomUUID(),
      caId: expiredCaId,
      crlNumber: 1,
      thisUpdate: new Date(Date.now() - 14 * 864e5),
      nextUpdate: new Date(Date.now() - 1 * 864e5),
      crlPem,
      revokedCount: 1,
      createdAt: new Date(Date.now() - 14 * 864e5),
    } as any);

    server = Fastify({ logger: false });
    await server.register(publicCrlRoutes);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    for (const id of [caId, expiredCaId, noCrlCaId]) {
      await db.delete(crls).where(eq(crls.caId, id)).execute().catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, id)).execute().catch(() => {});
    }
  });

  it('serves PEM (.crl) with application/x-pem-file and the signed body', async () => {
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.crl` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-pem-file');
    expect(res.body).toContain('-----BEGIN X509 CRL-----');
    expect(res.body.trim()).toBe(crlPem.trim());
  });

  it('serves DER (.der) with application/pkix-crl that is structurally valid DER', async () => {
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.der` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pkix-crl');
    const der = res.rawPayload; // Buffer
    // Round-trip: DER -> ASN.1 -> re-encode equals the served bytes; and PEM body matches.
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')));
    expect(asn1.type).toBe(forge.asn1.Type.SEQUENCE);
    const reBase64 = forge.util.encode64(forge.asn1.toDer(asn1).getBytes());
    const expectedBase64 = crlPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    expect(reBase64).toBe(expectedBase64);
  });

  it('sets RFC 5280 caching headers', async () => {
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.crl` });
    expect(res.headers['last-modified']).toBeTruthy();
    expect(res.headers['expires']).toBeTruthy();
    expect(String(res.headers['cache-control'])).toMatch(/public, max-age=\d+/);
  });

  it('returns 400 for an invalid format', async () => {
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.txt` });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown CA', async () => {
    const res = await server.inject({ method: 'GET', url: `/crl/${randomUUID()}.crl` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the CA exists but has no CRL', async () => {
    const res = await server.inject({ method: 'GET', url: `/crl/${noCrlCaId}.crl` });
    expect(res.statusCode).toBe(404);
  });

  it('lazy-regen on expiry degrades gracefully: serves the stale CRL when regeneration cannot run', async () => {
    // expiredCaId has a past-nextUpdate CRL and fake KMS ids, so regenerateForCa fails best-effort.
    const res = await server.inject({ method: 'GET', url: `/crl/${expiredCaId}.crl` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('-----BEGIN X509 CRL-----');
  });
});
