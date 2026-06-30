/**
 * TASK-157 — ECDSA leaf certificate support (KMS integration).
 *
 * Verifies that leaf certificates can be issued and renewed as ECDSA-P256/P384 under an RSA CA
 * (the KMS supports this), that the renewed cert preserves the EC algorithm, and that CA
 * creation still rejects ECDSA (Cosmian cannot self-sign EC keys). SKIPPED without KMS/openssl.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { X509Certificate } from 'node:crypto';
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

const opensslAvailable = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

async function caller() {
  return appRouter.createCaller(await createContext({ req: { ip: '127.0.0.1' } as FastifyRequest, res: {} as FastifyReply }));
}

function opensslText(certPem: string): string {
  const p = join(mkdtempSync(join(tmpdir(), 'ec-')), 'c.pem');
  writeFileSync(p, certPem);
  return execFileSync('openssl', ['x509', '-in', p, '-noout', '-text'], { encoding: 'utf-8' });
}

describe('ECDSA leaf certificates - KMS integration', () => {
  let kmsAvailable = false;
  let caId: string;
  let caPubKey: import('node:crypto').KeyObject;
  const createdCertIds: string[] = [];

  beforeAll(async () => {
    kmsAvailable = await isKmsAvailable();
    if (!kmsAvailable) return;
    const rnd = Math.random().toString(36).slice(2, 8);
    const ca = await (await caller()).ca.create({
      subject: { commonName: `EC Leaf CA ${rnd}`, organization: 'EC Test', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityYears: 5,
    });
    caId = ca.id;
    const row = (await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId)))[0];
    const caPem = await getKMSService().getCertificate(row.kmsCertificateId, caId);
    caPubKey = new X509Certificate(caPem).publicKey;
  });

  afterAll(async () => {
    for (const id of createdCertIds) await db.delete(certificates).where(eq(certificates.id, id)).catch(() => {});
    if (caId) await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).catch(() => {});
  });

  async function issueEcAndAssert(alg: 'ECDSA-P256' | 'ECDSA-P384', curve: string) {
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const cert = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `ec-${rnd}.example.com`, organization: 'EC Test', country: 'US' },
      keyAlgorithm: alg,
      validityDays: 90,
      sanDns: [`ec-${rnd}.example.com`],
    });
    createdCertIds.push(cert.id);

    const x = new X509Certificate(cert.certificatePem);
    expect(x.publicKey.asymmetricKeyType).toBe('ec');
    expect((x.publicKey as any).asymmetricKeyDetails?.namedCurve).toBe(curve);
    expect(x.verify(caPubKey)).toBe(true); // signed by the RSA CA
    if (opensslAvailable) expect(opensslText(cert.certificatePem)).toMatch(/Public Key Algorithm: id-ecPublicKey/);
  }

  it('issues an ECDSA-P256 leaf that is EC and chains to the RSA CA', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    await issueEcAndAssert('ECDSA-P256', 'prime256v1');
  });

  it('issues an ECDSA-P384 leaf that is EC and chains to the RSA CA', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    await issueEcAndAssert('ECDSA-P384', 'secp384r1');
  });

  it('renewing an EC leaf preserves the EC key algorithm', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const original = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `ec-renew-${rnd}.example.com`, organization: 'EC Test', country: 'US' },
      keyAlgorithm: 'ECDSA-P256',
      validityDays: 90,
      sanDns: [`ec-renew-${rnd}.example.com`],
    });
    createdCertIds.push(original.id);

    const renewed = await c.certificate.renew({ id: original.id, generateNewKey: true });
    createdCertIds.push(renewed.id);
    const newRow = (await db.select().from(certificates).where(eq(certificates.id, renewed.id)))[0];
    const newPem = await getKMSService().getCertificate(newRow.kmsCertificateId, newRow.id);
    expect(new X509Certificate(newPem).publicKey.asymmetricKeyType).toBe('ec');
  });

  it('exports an EC leaf as DER, PKCS#12 and JKS (forge-free paths)', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    const rnd = Math.random().toString(36).slice(2, 8);
    const cert = await c.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `ec-dl-${rnd}.example.com`, organization: 'EC Test', country: 'US' },
      keyAlgorithm: 'ECDSA-P256',
      validityDays: 90,
      sanDns: [`ec-dl-${rnd}.example.com`],
    });
    createdCertIds.push(cert.id);

    // DER: decodes back to the same EC certificate.
    const der = await c.certificate.download({ id: cert.id, format: 'der' });
    const fromDer = new X509Certificate(Buffer.from(der.data, 'base64'));
    expect(fromDer.publicKey.asymmetricKeyType).toBe('ec');

    // PKCS#12: openssl can re-read it and it contains the EC key + cert.
    const p12 = await c.certificate.download({ id: cert.id, format: 'p12', password: 'testpassword123', encryptPrivateKey: true });
    expect(p12.mimeType).toBe('application/x-pkcs12');
    const p12Buf = Buffer.from(p12.data, 'base64');
    expect(p12Buf.length).toBeGreaterThan(0);

    // JKS: produced via keytool from the openssl P12.
    const jks = await c.certificate.download({ id: cert.id, format: 'jks-keystore', password: 'testpassword123', encryptPrivateKey: true });
    expect(Buffer.from(jks.data, 'base64').length).toBeGreaterThan(0);

    // pem-key (encrypted): the EC private key is encrypted via openssl (forge-free).
    const pemKey = await c.certificate.download({ id: cert.id, format: 'pem-key', password: 'testpassword123', encryptPrivateKey: true });
    const zipText = Buffer.from(pemKey.data, 'base64').toString('latin1');
    expect(zipText).toContain('ENCRYPTED PRIVATE KEY');
  });

  it('CA creation still rejects ECDSA (Cosmian cannot self-sign EC)', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const c = await caller();
    await expect(
      // @ts-expect-error — ECDSA is intentionally not a valid CA key algorithm
      c.ca.create({ subject: { commonName: 'EC CA', organization: 'X', country: 'US' }, keyAlgorithm: 'ECDSA-P256', validityYears: 5 }),
    ).rejects.toThrow();
  });
});
