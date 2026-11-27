/**
 * Issues #22 and #29 (real KMS): a freshly created CA
 *  - returns the same keyAlgorithm in the create response as in the list, and
 *  - serves a valid, signed, EMPTY CRL (number 1) at its CRL URL right away; a CA whose CRL
 *    is missing gets one lazily on first request, with monotonic numbering.
 * SKIPPED when KMS is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import forge from 'node-forge';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificateAuthorities, crls, auditLog } from '../../db/schema.js';
import { isKmsAvailable } from '../../test/kms-helper.js';
import { getKMSService } from '../../kms/service.js';
import { parseCRL, verifyCRL } from '../../crypto/crl.js';
import { publicCrlRoutes } from './public-crl.routes.js';
import { caRoutes } from './ca.routes.js';

describe('CA creation: keyAlgorithm and initial CRL (KMS)', () => {
  let kms = false;
  let server: FastifyInstance;
  let caId: string;
  let createBody: { id: string; keyAlgorithm: string };

  beforeAll(async () => {
    kms = await isKmsAvailable();
    if (!kms) return;
    server = Fastify({ logger: false });
    await server.register(caRoutes, { prefix: '/api/v1/cas' });
    await server.register(publicCrlRoutes);
    await server.ready();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/cas/',
      payload: {
        subject: { commonName: `Initial CRL CA ${Math.random().toString(36).slice(2, 8)}`, organization: 'T', country: 'ES' },
        keyAlgorithm: 'RSA-2048',
        validityYears: 5,
      },
    });
    expect(res.statusCode).toBe(201);
    createBody = res.json();
    caId = createBody.id;
  });

  afterAll(async () => {
    if (!kms) return;
    await server.close();
    await db.delete(crls).where(eq(crls.caId, caId)).catch(() => {});
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).catch(() => {});
  });

  it('create response keyAlgorithm equals the list value (issue #29)', async (ctx) => {
    if (!kms) return ctx.skip();
    expect(createBody.keyAlgorithm).toBe('RSA-2048');
    const list = await server.inject({ method: 'GET', url: '/api/v1/cas/?limit=100&sortBy=issuedDate&sortOrder=desc' });
    expect(list.statusCode).toBe(200);
    const item = list.json<{ items: { id: string; keyAlgorithm: string }[] }>().items.find((c) => c.id === caId);
    expect(item!.keyAlgorithm).toBe(createBody.keyAlgorithm);
  });

  it('serves a signed empty CRL #1 immediately after creation (issue #22)', async (ctx) => {
    if (!kms) return ctx.skip();
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.crl` });
    expect(res.statusCode).toBe(200);
    const parsed = parseCRL(res.body, 'PEM');
    expect(parsed.revokedCertificates).toHaveLength(0);
    const first = await db.select().from(crls).where(eq(crls.caId, caId));
    expect(first).toHaveLength(1);
    expect(first[0].crlNumber).toBe(1);
    const row = (await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId)))[0];
    const caPem = await getKMSService().getCertificate(row.kmsCertificateId, caId);
    expect(verifyCRL(res.body, caPem)).toBe(true);
    const audit = await db.select().from(auditLog).where(eq(auditLog.operation, 'crl.generate'));
    expect(audit.some((a) => a.status === 'success')).toBe(true);
  });

  it('lazily generates the first CRL for a CA that has none, keeping numbering monotonic', async (ctx) => {
    if (!kms) return ctx.skip();
    await db.delete(crls).where(eq(crls.caId, caId));
    const res = await server.inject({ method: 'GET', url: `/crl/${caId}.der` });
    expect(res.statusCode).toBe(200);
    expect(forge.asn1.fromDer(forge.util.createBuffer(res.rawPayload.toString('binary'))).type).toBe(forge.asn1.Type.SEQUENCE);
    const rows = await db.select().from(crls).where(eq(crls.caId, caId)).orderBy(desc(crls.crlNumber));
    expect(rows).toHaveLength(1);
    // CRL 1 was published before its row was deleted: a number is never used twice.
    expect(rows[0].crlNumber).toBe(2);
  });
});
