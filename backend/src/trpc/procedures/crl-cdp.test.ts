/**
 * TASK-114 AC#3 — issued certificates carry a CRL Distribution Point.
 *
 * With CRL_DISTRIBUTION_URL configured, a certificate issued through the normal path must
 * embed a crlDistributionPoints extension pointing at the issuing CA's CRL endpoint, as
 * shown by `openssl x509 -ext crlDistributionPoints`. SKIPPED when KMS/openssl unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { appRouter } from '../router.js';
import { createContext } from '../context.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { isKmsAvailable } from '../../test/kms-helper.js';
import { getKMSService } from '../../kms/service.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

function cdpFromCert(certPem: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
  const p = join(dir, 'c.pem');
  writeFileSync(p, certPem);
  try {
    return execFileSync('openssl', ['x509', '-in', p, '-noout', '-ext', 'crlDistributionPoints'], { encoding: 'utf-8' });
  } catch (e: any) {
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
}

const opensslAvailable = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const createdCaIds: string[] = [];
const createdCertIds: string[] = [];
const CDP_BASE = 'http://crl.test.example/crl';
let savedEnv: string | undefined;

async function caller() {
  const context = await createContext({ req: { ip: '127.0.0.1' } as FastifyRequest, res: {} as FastifyReply });
  return appRouter.createCaller(context);
}

describe('CRL Distribution Point in issued certs - KMS integration', () => {
  let kmsAvailable = false;
  let caId: string;

  beforeAll(async () => {
    kmsAvailable = await isKmsAvailable();
    savedEnv = process.env.CRL_DISTRIBUTION_URL;
    process.env.CRL_DISTRIBUTION_URL = CDP_BASE;
    if (!kmsAvailable) return;
    const rnd = Math.random().toString(36).slice(2, 8);
    const ca = await (await caller()).ca.create({
      subject: { commonName: `CDP CA ${rnd}`, organization: 'CDP Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityYears: 5,
    });
    caId = ca.id;
    createdCaIds.push(caId);
  });

  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.CRL_DISTRIBUTION_URL;
    else process.env.CRL_DISTRIBUTION_URL = savedEnv;
    for (const id of createdCertIds) await db.delete(certificates).where(eq(certificates.id, id)).catch(() => {});
    for (const id of createdCaIds) await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, id)).catch(() => {});
  });

  it('embeds the configured CDP URL for the issuing CA', async (ctx) => {
    if (!kmsAvailable || !opensslAvailable) return ctx.skip();
    const rnd = Math.random().toString(36).slice(2, 8);
    const result = await (await caller()).certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `cdp-${rnd}.example.com`, organization: 'CDP Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 90,
      sanDns: [`cdp-${rnd}.example.com`],
    });
    createdCertIds.push(result.id);

    const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
    const p = join(dir, 'leaf.pem');
    writeFileSync(p, result.certificatePem);
    const ext = execFileSync('openssl', ['x509', '-in', p, '-noout', '-ext', 'crlDistributionPoints'], {
      encoding: 'utf-8',
    });
    expect(ext).toContain(`${CDP_BASE}/${caId}.crl`);
  });

  it('renewed certificates embed the CDP for the issuing CA (TASK-114)', async (ctx) => {
    if (!kmsAvailable || !opensslAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const original = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `renew-${rnd}.example.com`, organization: 'CDP Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 90,
      sanDns: [`renew-${rnd}.example.com`],
    });
    createdCertIds.push(original.id);

    const renewed = await c.certificate.renew({ id: original.id, generateNewKey: true });
    createdCertIds.push(renewed.id);

    // Fetch the renewed certificate's PEM and assert it carries the CDP.
    const newRow = (await db.select().from(certificates).where(eq(certificates.id, renewed.id)))[0];
    const newPem = await getKMSService().getCertificate(newRow.kmsCertificateId, newRow.id);
    expect(cdpFromCert(newPem)).toContain(`${CDP_BASE}/${caId}.crl`);
  });

  it('bulk renew succeeds and embeds the CDP (regression: issuerCertificateId + cdpUrl)', async (ctx) => {
    if (!kmsAvailable || !opensslAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const original = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `bulkrenew-${rnd}.example.com`, organization: 'CDP Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityDays: 90,
      sanDns: [`bulkrenew-${rnd}.example.com`],
    });
    createdCertIds.push(original.id);

    const res = await c.certificate.bulkRenew({ certificateIds: [original.id], generateNewKey: true });
    expect(res.successful).toBe(1); // previously 0 — bulk renew omitted issuerCertificateId

    const newRow = (await db.select().from(certificates).where(eq(certificates.renewedFromId, original.id)))[0];
    expect(newRow).toBeTruthy();
    createdCertIds.push(newRow.id);
    const newPem = await getKMSService().getCertificate(newRow.kmsCertificateId, newRow.id);
    expect(cdpFromCert(newPem)).toContain(`${CDP_BASE}/${caId}.crl`);
  });
});
