/**
 * Real Cosmian KMS check for the external sign path (issues #25 and #28): the KMS certifies an
 * ECDSA CSR and an empty-subject CSR with a SAN, keeping the CSR's own public key
 * (preserveCsrKey), as POST /api/v1/external/sign does. Skipped when no KMS is reachable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate, createPublicKey } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { appRouter } from '../../trpc/router.js';
import { createContext } from '../../trpc/context.js';
import { getKMSService } from '../../kms/service.js';
import { isKmsAvailable } from '../../test/kms-helper.js';

let kmsAvailable = false;
let caCertId = '';
const dir = mkdtempSync(join(tmpdir(), 'ext-sign-kms-'));

/** Make a CSR with openssl; returns [csrPem, spkiDer of the CSR key]. */
function csr(name: string, keyArgs: string[], subj: string, san: string): [string, Buffer] {
  const key = join(dir, `${name}.key`), out = join(dir, `${name}.csr`);
  execFileSync('openssl', ['req', '-new', ...keyArgs, '-nodes', '-keyout', key, '-out', out, '-subj', subj,
    '-addext', `subjectAltName=${san}`, '-addext', 'keyUsage=digitalSignature', '-addext', 'extendedKeyUsage=clientAuth'], { stdio: 'ignore' });
  const spki = createPublicKey(readFileSync(key)).export({ type: 'spki', format: 'der' });
  return [readFileSync(out, 'utf8'), spki];
}

beforeAll(async () => {
  kmsAvailable = await isKmsAvailable();
  if (!kmsAvailable) return;
  const caller = appRouter.createCaller(await createContext({ req: {} as FastifyRequest, res: {} as FastifyReply }));
  const ca = await caller.ca.create({
    subject: { commonName: `ext-sign-kms-${Date.now()}`, organization: 'Example Corp', country: 'ES' },
    keyAlgorithm: 'RSA-2048',
    validityYears: 2,
  } as never);
  caCertId = (ca as { kmsCertificateId?: string }).kmsCertificateId ?? '';
  if (!caCertId) {
    const { db } = await import('../../db/client.js');
    const { certificateAuthorities } = await import('../../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const row = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, (ca as { id: string }).id));
    caCertId = row[0].kmsCertificateId;
  }
}, 120_000);

describe('external sign against the real KMS', () => {
  const cases: Array<[string, string[], string, string]> = [
    ['ecdsa-p256', ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256'], '/CN=p256.example.internal/O=Example Corp/C=ES', 'DNS:p256.example.internal'],
    ['ecdsa-p384', ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-384'], '/CN=p384.example.internal/O=Example Corp/C=ES', 'DNS:p384.example.internal'],
    ['empty-subject', ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256'], '/', 'DNS:app.example.internal'],
  ];
  for (const [name, keyArgs, subj, san] of cases) {
    it(`certifies a ${name} CSR with its own key`, async (ctx) => {
      if (!kmsAvailable) return ctx.skip();
      const [csrPem, spki] = csr(name, keyArgs, subj, san);
      const kms = getKMSService();
      const info = await kms.signCertificate({ csr: csrPem, issuerCertificateId: caCertId, daysValid: 30, preserveCsrKey: true, x509Extensions: '' });
      const cert = new X509Certificate(await kms.getCertificate(info.certificateId));
      expect(cert.publicKey.export({ type: 'spki', format: 'der' }).equals(spki)).toBe(true);
      expect(cert.subjectAltName).toContain(san.replace('DNS:', ''));
    }, 60_000);
  }
});
