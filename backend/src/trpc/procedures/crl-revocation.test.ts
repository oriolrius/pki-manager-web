/**
 * TASK-115 AC#2 — CRL revocation integration tests (real KMS).
 *
 * End-to-end: create a CA, issue a cert, revoke it, then assert the revoked serial appears
 * in the served CRL and the CRL signature verifies against the issuing CA. Exercises the
 * auto-regeneration wired into the tRPC and external revoke paths (TASK-113) on top of the
 * KMS-backed CRL signing (TASK-111). SKIPPED when KMS is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../router.js';
import { createContext } from '../context.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, crls } from '../../db/schema.js';
import { isKmsAvailable } from '../../test/kms-helper.js';
import { getKMSService } from '../../kms/service.js';
import { getCertificateService } from '../../services/certificate.service.js';
import { parseCRL, verifyCRL } from '../../crypto/crl.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const norm = (s: string) => s.toLowerCase().replace(/[:\s]/g, '').replace(/^0+(?=.)/, '');

const createdCaIds: string[] = [];
const createdCertIds: string[] = [];

async function caller() {
  const context = await createContext({ req: { ip: '127.0.0.1' } as FastifyRequest, res: {} as FastifyReply });
  return appRouter.createCaller(context);
}

describe('CRL revocation - KMS integration', () => {
  let kmsAvailable = false;
  let caId: string;
  let caCertPem: string;

  beforeAll(async () => {
    kmsAvailable = await isKmsAvailable();
    if (!kmsAvailable) {
      console.log('  ⚠️  Skipping CRL revocation integration tests - KMS not available');
      return;
    }
    const rnd = Math.random().toString(36).slice(2, 8);
    const c = await caller();
    const ca = await c.ca.create({
      subject: { commonName: `CRL Test CA ${rnd}`, organization: 'CRL Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityYears: 5,
    });
    caId = ca.id;
    createdCaIds.push(caId);

    const caRow = (await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId)))[0];
    caCertPem = await getKMSService().getCertificate(caRow.kmsCertificateId, caId);
  });

  afterAll(async () => {
    for (const id of createdCertIds) await db.delete(certificates).where(eq(certificates.id, id)).catch(() => {});
    for (const id of createdCaIds) {
      await db.delete(crls).where(eq(crls.caId, id)).catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, id)).catch(() => {});
    }
  });

  it('revoking a cert (tRPC) regenerates a CRL containing its serial, verifiable against the CA', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);

    const cert = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `leaf-${rnd}.example.com`, organization: 'CRL Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 90,
      sanDns: [`leaf-${rnd}.example.com`],
    });
    createdCertIds.push(cert.id);
    const serial = cert.serialNumber;

    // Revoke via tRPC — this should auto-regenerate the CA CRL (TASK-113).
    await c.certificate.revoke({ id: cert.id, reason: 'keyCompromise' });

    const latest = await c.crl.getLatest({ caId });
    expect(latest).toBeTruthy();
    expect(latest!.crlPem).toMatch(/-----BEGIN X509 CRL-----/);

    // The served CRL contains the revoked serial...
    const parsed = parseCRL(latest!.crlPem!);
    const norm = (s: string) => s.toLowerCase().replace(/[:\s]/g, '').replace(/^0+(?=.)/, '');
    const serials = parsed.revokedCertificates.map((r) => norm(r.serialNumber));
    expect(serials).toContain(norm(serial));

    // ...and its signature verifies against the issuing CA certificate.
    expect(verifyCRL(latest!.crlPem!, caCertPem)).toBe(true);

    // crlNumber is a positive monotonic counter.
    expect(parsed.crlNumber).toBeGreaterThanOrEqual(1);
  });

  it('a second revocation produces a CRL with a higher crlNumber and both serials', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);

    const before = await c.crl.getLatest({ caId });
    const beforeNumber = before?.crlNumber ?? 0;

    const cert = await c.certificate.issue({
      caId,
      certificateType: 'client',
      subject: { commonName: `client-${rnd}.example.com`, organization: 'CRL Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 90,
    });
    createdCertIds.push(cert.id);

    await c.certificate.revoke({ id: cert.id, reason: 'superseded' });

    const after = await c.crl.getLatest({ caId });
    expect(after!.crlNumber).toBeGreaterThan(beforeNumber);
    expect(verifyCRL(after!.crlPem!, caCertPem)).toBe(true);

    const parsed = parseCRL(after!.crlPem!);
    expect(parsed.revokedCertificates.map((r) => norm(r.serialNumber))).toContain(norm(cert.serialNumber));
  });

  it('revoking via the service layer (REST path) regenerates the CRL', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const cert = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `svc-rest-${rnd}.example.com`, organization: 'CRL Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 90,
      sanDns: [`svc-rest-${rnd}.example.com`],
    });
    createdCertIds.push(cert.id);

    // certificate.service.revoke is the method the REST route delegates to.
    await getCertificateService().revoke({ db, ipAddress: '127.0.0.1' }, { id: cert.id, reason: 'cessationOfOperation' });

    const latest = await c.crl.getLatest({ caId });
    const serials = parseCRL(latest!.crlPem!).revokedCertificates.map((r) => norm(r.serialNumber));
    expect(serials).toContain(norm(cert.serialNumber));
    expect(verifyCRL(latest!.crlPem!, caCertPem)).toBe(true);
  });

  it('bulkRevoke regenerates the CRL so every revoked serial appears (TASK-113 fix)', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const certs = await Promise.all(
      [0, 1].map((i) =>
        c.certificate.issue({
          caId,
          certificateType: 'client',
          subject: { commonName: `bulk-${rnd}-${i}.example.com`, organization: 'CRL Test', country: 'US' },
          keyAlgorithm: 'RSA-2048',
          validityDays: 90,
        }),
      ),
    );
    certs.forEach((cert) => createdCertIds.push(cert.id));

    const res = await c.certificate.bulkRevoke({ certificateIds: certs.map((x) => x.id), reason: 'superseded' });
    expect(res.successful).toBe(2);

    const latest = await c.crl.getLatest({ caId });
    const serials = parseCRL(latest!.crlPem!).revokedCertificates.map((r) => norm(r.serialNumber));
    for (const cert of certs) expect(serials).toContain(norm(cert.serialNumber));
    expect(verifyCRL(latest!.crlPem!, caCertPem)).toBe(true);
  });

  it('a CA created via ca.create stores a resolved kmsKeyId distinct from kmsCertificateId', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const row = (await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId)))[0];
    expect(row.kmsKeyId).toBeTruthy();
    expect(row.kmsKeyId).not.toBe(row.kmsCertificateId);
  });

  // NOTE: ECDSA CA key signing (the EC branch of resolveSignatureAlgorithm + EC generateCRL)
  // is covered at the unit level (crl.test.ts ECDSA + crl-helpers.test.ts). It is not exercised
  // end-to-end here because CA creation is restricted to RSA-2048/RSA-4096 by the API schema,
  // so a CA's signing key is always RSA in practice.
});
