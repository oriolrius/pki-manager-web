/**
 * Issue #48 (real KMS): revoking a CA publishes a SIGNED CRL that lists the certificates the
 * revocation cascaded (reason caCompromise). Before the fix, revocation stored a CRL row with an
 * empty PEM and the public endpoint answered 503.
 * SKIPPED when KMS is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, crls } from '../../db/schema.js';
import { isKmsAvailable } from '../../test/kms-helper.js';
import { getKMSService } from '../../kms/service.js';
import { parseCRL, verifyCRL } from '../../crypto/crl.js';
import { CRLReason } from '../../crypto/types.js';
import { appRouter } from '../../trpc/router.js';
import { createContext } from '../../trpc/context.js';
import { publicCrlRoutes } from './public-crl.routes.js';
import { caRoutes } from './ca.routes.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const norm = (s: string) => s.toLowerCase().replace(/[:\s]/g, '').replace(/^0+/, '');

describe('CA revocation publishes a signed CRL (issue #48, KMS)', () => {
  let kms = false;
  let server: FastifyInstance;
  let caId: string;
  let certId: string;
  let certSerial: string;
  let revokeBody: any;

  beforeAll(async () => {
    kms = await isKmsAvailable();
    if (!kms) return;
    server = Fastify({ logger: false });
    await server.register(caRoutes, { prefix: '/api/v1/cas' });
    await server.register(publicCrlRoutes);
    await server.ready();

    const caller = appRouter.createCaller(
      await createContext({ req: {} as FastifyRequest, res: {} as FastifyReply }),
    );
    const suffix = Math.random().toString(36).slice(2, 8);
    const ca = await caller.ca.create({
      subject: { commonName: `Revoke CRL CA ${suffix}`, organization: 'T', country: 'ES' },
      keyAlgorithm: 'RSA-2048',
      validityYears: 5,
    });
    caId = ca.id;
    const cert = await caller.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `revoke-crl-${suffix}.example.com`, organization: 'T', country: 'ES' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 30,
      sanDns: [`revoke-crl-${suffix}.example.com`],
    });
    certId = cert.id;
    certSerial = (await db.select().from(certificates).where(eq(certificates.id, certId)))[0].serialNumber;

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/cas/${caId}/revoke`,
      payload: { reason: 'keyCompromise' },
    });
    expect(res.statusCode).toBe(200);
    revokeBody = res.json();
  });

  afterAll(async () => {
    if (!kms) return;
    await server.close();
    await db.delete(certificates).where(eq(certificates.caId, caId)).catch(() => {});
    await db.delete(crls).where(eq(crls.caId, caId)).catch(() => {});
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).catch(() => {});
  });

  it('reports the CRL it really generated', async (ctx) => {
    if (!kms) return ctx.skip();
    expect(revokeBody.cascadeRevokedCount).toBe(1);
    expect(revokeBody.crlGenerated).toBe(true);
    const newest = (await db.select().from(crls).where(eq(crls.caId, caId)).orderBy(desc(crls.crlNumber)).limit(1))[0];
    expect(revokeBody.crlId).toBe(newest.id);
    expect(newest.crlPem).toContain('-----BEGIN X509 CRL-----');
    // No unsigned (empty-PEM) row is written any more.
    const rows = await db.select().from(crls).where(eq(crls.caId, caId));
    expect(rows.every((r) => r.crlPem.length > 0)).toBe(true);
  });

  it('serves a CRL signed by the CA that lists the cascaded certificate as caCompromise', async (ctx) => {
    if (!kms) return ctx.skip();
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.crl` });
    expect(res.statusCode).toBe(200);

    const row = (await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId)))[0];
    expect(row.status).toBe('revoked');
    const caPem = await getKMSService().getCertificate(row.kmsCertificateId, caId);
    expect(verifyCRL(res.body, caPem)).toBe(true);

    const parsed = parseCRL(res.body, 'PEM');
    const entry = parsed.revokedCertificates.find((r) => norm(r.serialNumber) === norm(certSerial));
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe(CRLReason.CA_COMPROMISE);
  });
});
