/**
 * Service-layer unit tests for CRLService.list / getLatest / generate error paths.
 * DB-backed but KMS-free: CA + CRL rows are seeded directly, and only the non-KMS branches
 * (pagination, lookup, validity status, DER projection, not-found / invalid-status errors)
 * are exercised. KMS-backed signing is covered by crl-revocation.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { certificateAuthorities, crls } from '../db/schema.js';
import {
  getCRLService,
  CRLCANotFoundError,
  CRLNotFoundError,
  CRLInvalidCAStatusError,
} from './crl.service.js';
import { generateCRL } from '../crypto/crl.js';

const ctx = { db, ipAddress: '127.0.0.1' };

function signedCrlPem(crlNumber: number, nextUpdate: Date): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3650 * 864e5);
  const attrs = [{ name: 'commonName', value: 'Svc Test CA' }, { shortName: 'O', value: 'T' }, { shortName: 'C', value: 'US' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'subjectKeyIdentifier' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return generateCRL({
    issuer: { CN: 'Svc Test CA', O: 'T', C: 'US' },
    crlNumber,
    thisUpdate: new Date(),
    nextUpdate,
    revokedCertificates: [],
    signingKey: forge.pki.privateKeyToPem(keys.privateKey),
    signatureAlgorithm: 'SHA256-RSA',
    issuerCertificate: forge.pki.certificateToPem(cert),
  }).pem;
}

describe('CRLService (DB-only behaviours)', () => {
  const activeCaId = randomUUID();
  const expiredCaId = randomUUID();
  const emptyCaId = randomUUID();

  const caRow = (id: string, status: 'active' | 'expired') => ({
    id,
    kmsCertificateId: `cert-${id}`,
    kmsKeyId: `key-${id}`,
    subjectDn: 'CN=Svc Test CA,O=T,C=US',
    serialNumber: randomUUID(),
    keyAlgorithm: 'RSA-2048',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 3650 * 864e5),
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    await db.insert(certificateAuthorities).values([
      caRow(activeCaId, 'active'),
      caRow(expiredCaId, 'expired'),
      caRow(emptyCaId, 'active'),
    ] as any);

    // Three CRLs for the active CA: numbers 1,2,3 (3 is newest); #3 is expired (past nextUpdate).
    const future = new Date(Date.now() + 7 * 864e5);
    const past = new Date(Date.now() - 864e5);
    const rows = [
      { n: 1, next: future },
      { n: 2, next: future },
      { n: 3, next: past },
    ].map((r) => ({
      id: randomUUID(),
      caId: activeCaId,
      crlNumber: r.n,
      thisUpdate: new Date(Date.now() - 864e5),
      nextUpdate: r.next,
      crlPem: signedCrlPem(r.n, r.next),
      revokedCount: 0,
      createdAt: new Date(Date.now() - (4 - r.n) * 3600e3),
    }));
    await db.insert(crls).values(rows as any);
  });

  afterAll(async () => {
    for (const id of [activeCaId, expiredCaId, emptyCaId]) {
      await db.delete(crls).where(eq(crls.caId, id)).catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, id)).catch(() => {});
    }
  });

  const svc = getCRLService();

  describe('list', () => {
    it('paginates newest-first with correct totalCount', async () => {
      const page1 = await svc.list(ctx, { caId: activeCaId, limit: 2, offset: 0 });
      expect(page1.totalCount).toBe(3);
      expect(page1.items.map((i) => i.crlNumber)).toEqual([3, 2]);
      const page2 = await svc.list(ctx, { caId: activeCaId, limit: 2, offset: 2 });
      expect(page2.items.map((i) => i.crlNumber)).toEqual([1]);
    });

    it('throws CRLCANotFoundError for an unknown CA', async () => {
      await expect(svc.list(ctx, { caId: randomUUID() })).rejects.toBeInstanceOf(CRLCANotFoundError);
    });
  });

  describe('getLatest', () => {
    it('returns the newest CRL with an expired validityStatus and base64 DER (no armor)', async () => {
      const latest = await svc.getLatest(ctx, { caId: activeCaId });
      expect(latest!.crlNumber).toBe(3);
      expect(latest!.validityStatus).toBe('expired');
      expect(latest!.crlDer).toBeTruthy();
      expect(latest!.crlDer).not.toContain('-----');
      expect(latest!.crlDer).not.toMatch(/\s/);
      // The DER decodes to a valid ASN.1 SEQUENCE.
      const der = Buffer.from(latest!.crlDer!, 'base64').toString('binary');
      expect(forge.asn1.fromDer(der).type).toBe(forge.asn1.Type.SEQUENCE);
    });

    it('returns a specific CRL by crlNumber with a valid validityStatus', async () => {
      const crl1 = await svc.getLatest(ctx, { caId: activeCaId, crlNumber: 1 });
      expect(crl1!.crlNumber).toBe(1);
      expect(crl1!.validityStatus).toBe('valid');
    });

    it('throws CRLNotFoundError for a missing crlNumber', async () => {
      await expect(svc.getLatest(ctx, { caId: activeCaId, crlNumber: 999 })).rejects.toBeInstanceOf(CRLNotFoundError);
    });

    it('returns null when the CA exists but has no CRL', async () => {
      await expect(svc.getLatest(ctx, { caId: emptyCaId })).resolves.toBeNull();
    });

    it('throws CRLCANotFoundError for an unknown CA', async () => {
      await expect(svc.getLatest(ctx, { caId: randomUUID() })).rejects.toBeInstanceOf(CRLCANotFoundError);
    });
  });

  describe('generate (pre-KMS error paths)', () => {
    it('throws CRLCANotFoundError for an unknown CA', async () => {
      await expect(svc.generate(ctx, { caId: randomUUID() })).rejects.toBeInstanceOf(CRLCANotFoundError);
    });

    it('throws CRLInvalidCAStatusError when the CA is neither active nor revoked', async () => {
      await expect(svc.generate(ctx, { caId: expiredCaId })).rejects.toBeInstanceOf(CRLInvalidCAStatusError);
    });

    it('regenerateForCa swallows errors and returns false (best-effort)', async () => {
      // Unknown CA -> generate throws -> regenerateForCa must resolve false, not throw.
      await expect(svc.regenerateForCa(ctx, randomUUID())).resolves.toBe(false);
    });
  });
});
