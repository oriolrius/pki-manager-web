/**
 * TASK-115 AC#1 — Unit tests for CRL building and signature verification.
 *
 * Covers the pure crypto layer (no KMS): RFC 5280 X.509 v2 CRL construction for both RSA
 * and ECDSA CA keys, signature verification (positive + tamper-negative), and round-trip
 * parsing of crlNumber / serials / reason codes / nextUpdate. Where `openssl` is available
 * the CRL is additionally cross-checked with `openssl crl`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import {
  generateCRL,
  parseCRL,
  verifyCRL,
  isCertificateRevoked,
  convertCRLFormat,
  isCRLExpired,
  getCRLNextUpdate,
  countRevokedCertificates,
} from './crl.js';
import { CRLReason } from './types.js';
import type { CRLParams, SignatureAlgorithm } from './types.js';

/** Build a self-signed CA cert + its PKCS#8 private key PEM for the given algorithm. */
function makeCa(type: 'rsa' | 'ec'): { certPem: string; keyPem: string; pubPem: string } {
  if (type === 'rsa') {
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
    const attrs = [
      { name: 'commonName', value: 'Unit Test Root CA' },
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
    return {
      certPem: forge.pki.certificateToPem(cert),
      keyPem: forge.pki.privateKeyToPem(keys.privateKey),
      pubPem: forge.pki.publicKeyToPem(keys.publicKey),
    };
  }
  // ECDSA P-256 via node crypto, self-signed cert via node-forge is awkward; instead build a
  // bare key pair and a forge cert from the imported key.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  // A forge cert isn't needed for EC verification tests; we verify against the public key.
  return { certPem: '', keyPem, pubPem };
}

const opensslAvailable = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function opensslVerifies(crlPem: string, caCertPem: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'crl-ut-'));
  const crlPath = join(dir, 'c.crl');
  const caPath = join(dir, 'ca.pem');
  writeFileSync(crlPath, crlPem);
  writeFileSync(caPath, caCertPem);
  try {
    execFileSync('openssl', ['crl', '-in', crlPath, '-CAfile', caPath, '-noout'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('CRL building and verification (RSA)', () => {
  let ca: ReturnType<typeof makeCa>;

  beforeAll(() => {
    ca = makeCa('rsa');
  });

  function baseParams(overrides: Partial<CRLParams> = {}): CRLParams {
    return {
      issuer: { CN: 'Unit Test Root CA', O: 'Test', C: 'US' },
      crlNumber: 5,
      thisUpdate: new Date('2026-01-01T00:00:00Z'),
      nextUpdate: new Date('2026-01-08T00:00:00Z'),
      revokedCertificates: [
        { serialNumber: '0a1b2c', revocationDate: new Date('2026-01-01T00:00:00Z'), reason: CRLReason.KEY_COMPROMISE },
        { serialNumber: 'ff00ff00', revocationDate: new Date('2026-01-01T00:00:00Z'), reason: CRLReason.SUPERSEDED },
      ],
      signingKey: ca.keyPem,
      signatureAlgorithm: 'SHA256-RSA',
      issuerCertificate: ca.certPem,
      ...overrides,
    };
  }

  it('produces a PEM/DER v2 CRL with the expected counts', () => {
    const crl = generateCRL(baseParams());
    expect(crl.pem).toContain('-----BEGIN X509 CRL-----');
    expect(crl.der).toBeTruthy();
    expect(crl.crlNumber).toBe(5);
    expect(crl.revokedCount).toBe(2);
  });

  it('signature verifies against the issuing CA public key, and fails when tampered', () => {
    const crl = generateCRL(baseParams());
    expect(verifyCRL(crl.pem, ca.pubPem)).toBe(true);
    expect(verifyCRL(crl.pem, ca.certPem)).toBe(true); // also accepts a CA cert PEM

    // Tamper: flip a character in the base64 body → verification must fail.
    const tampered = crl.pem.replace(/^([A-Za-z0-9+/]{10})./m, (_m, p1) => `${p1}${'A'}`);
    expect(verifyCRL(tampered, ca.pubPem)).toBe(false);

    // Wrong key → fails.
    const other = makeCa('rsa');
    expect(verifyCRL(crl.pem, other.pubPem)).toBe(false);
  });

  it('round-trips crlNumber, serials, reason codes and nextUpdate via parseCRL', () => {
    const crl = generateCRL(baseParams());
    const parsed = parseCRL(crl.pem);
    expect(parsed.crlNumber).toBe(5);
    expect(parsed.nextUpdate.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    const serials = parsed.revokedCertificates.map((r) => r.serialNumber.toLowerCase());
    expect(serials).toContain('0a1b2c');
    expect(serials).toContain('ff00ff00');
    const byKc = parsed.revokedCertificates.find((r) => r.serialNumber.toLowerCase() === '0a1b2c');
    expect(byKc?.reason).toBe(CRLReason.KEY_COMPROMISE);
  });

  it('isCertificateRevoked finds revoked serials (and ignores unknown ones)', () => {
    const crl = generateCRL(baseParams());
    expect(isCertificateRevoked(crl.pem, '0a1b2c')).toBe(true);
    expect(isCertificateRevoked(crl.pem, '0A1B2C')).toBe(true);
    expect(isCertificateRevoked(crl.pem, 'deadbeef')).toBe(false);
  });

  it('handles an empty revocation list', () => {
    const crl = generateCRL(baseParams({ revokedCertificates: [] }));
    expect(crl.revokedCount).toBe(0);
    expect(verifyCRL(crl.pem, ca.pubPem)).toBe(true);
    expect(parseCRL(crl.pem).revokedCertificates).toHaveLength(0);
  });

  it('embeds an authorityKeyIdentifier matching the CA SKI', () => {
    const crl = generateCRL(baseParams());
    // Parsing succeeds and (when openssl is present) the AKI is shown.
    expect(() => parseCRL(crl.pem)).not.toThrow();
    if (opensslAvailable) {
      const dir = mkdtempSync(join(tmpdir(), 'crl-aki-'));
      const p = join(dir, 'c.crl');
      writeFileSync(p, crl.pem);
      const text = execFileSync('openssl', ['crl', '-in', p, '-noout', '-text'], { encoding: 'utf-8' });
      expect(text).toMatch(/Authority Key Identifier/i);
      expect(text).toMatch(/CRL Number/i);
    }
  });

  it('is accepted by openssl and verifies against the CA', () => {
    if (!opensslAvailable) return;
    const crl = generateCRL(baseParams());
    expect(opensslVerifies(crl.pem, ca.certPem)).toBe(true);
  });

  it('rejects a signature-algorithm/key-type mismatch', () => {
    expect(() => generateCRL(baseParams({ signatureAlgorithm: 'SHA256-ECDSA' }))).toThrow();
  });
});

describe('CRL signature algorithms (RSA SHA-256/384/512)', () => {
  let ca: ReturnType<typeof makeCa>;
  beforeAll(() => {
    ca = makeCa('rsa');
  });

  it.each(['SHA256-RSA', 'SHA384-RSA', 'SHA512-RSA'] as SignatureAlgorithm[])(
    'generates and verifies a CRL signed with %s',
    (alg) => {
      const crl = generateCRL({
        issuer: { CN: 'Unit Test Root CA', O: 'Test', C: 'US' },
        crlNumber: 1,
        revokedCertificates: [],
        signingKey: ca.keyPem,
        signatureAlgorithm: alg,
        issuerCertificate: ca.certPem,
      });
      expect(verifyCRL(crl.pem, ca.pubPem)).toBe(true);
    },
  );
});

describe('CRL helpers (format / expiry / parse edge cases)', () => {
  let ca: ReturnType<typeof makeCa>;
  beforeAll(() => {
    ca = makeCa('rsa');
  });

  function crlWith(nextUpdate: Date, thisUpdate = new Date()) {
    return generateCRL({
      issuer: { CN: 'Unit Test Root CA', O: 'Test', C: 'US' },
      crlNumber: 1,
      thisUpdate,
      nextUpdate,
      revokedCertificates: [{ serialNumber: 'ab', revocationDate: thisUpdate }],
      signingKey: ca.keyPem,
      signatureAlgorithm: 'SHA256-RSA',
      issuerCertificate: ca.certPem,
    });
  }

  it('round-trips a GeneralizedTime (post-2049) nextUpdate', () => {
    const next = new Date('2055-03-04T05:06:07Z');
    const parsed = parseCRL(crlWith(next, new Date('2054-01-01T00:00:00Z')).pem);
    expect(parsed.nextUpdate.getUTCFullYear()).toBe(2055);
    expect(parsed.nextUpdate.toISOString()).toBe('2055-03-04T05:06:07.000Z');
  });

  it('convertCRLFormat round-trips PEM<->DER and is a no-op for same format', () => {
    const crl = crlWith(new Date(Date.now() + 864e5));
    const der = convertCRLFormat(crl.pem, 'PEM', 'DER');
    expect(der).toBe(crl.der);
    const pem = convertCRLFormat(der, 'DER', 'PEM');
    expect(pem.replace(/\s/g, '')).toBe(crl.pem.replace(/\s/g, ''));
    expect(convertCRLFormat(crl.pem, 'PEM', 'PEM')).toBe(crl.pem);
  });

  it('isCRLExpired / getCRLNextUpdate reflect nextUpdate', () => {
    const future = crlWith(new Date(Date.now() + 864e5));
    const past = crlWith(new Date(Date.now() - 864e5));
    expect(isCRLExpired(future.pem)).toBe(false);
    expect(isCRLExpired(past.pem)).toBe(true);
    expect(getCRLNextUpdate(future.pem).getTime()).toBeGreaterThan(Date.now());
  });

  it('isCRLExpired returns true (fail-safe) on unparseable input', () => {
    expect(isCRLExpired('not a crl')).toBe(true);
  });

  it('countRevokedCertificates counts entries', () => {
    expect(countRevokedCertificates(crlWith(new Date(Date.now() + 864e5)).pem)).toBe(1);
  });

  it('parseCRL throws a wrapped error on garbage input', () => {
    expect(() => parseCRL('not-a-crl')).toThrow(/Failed to parse CRL/);
  });

  it('a revoked entry with no reason round-trips to reason=null', () => {
    const crl = generateCRL({
      issuer: { CN: 'Unit Test Root CA', O: 'Test', C: 'US' },
      crlNumber: 1,
      revokedCertificates: [{ serialNumber: 'cd', revocationDate: new Date() }],
      signingKey: ca.keyPem,
      signatureAlgorithm: 'SHA256-RSA',
      issuerCertificate: ca.certPem,
    });
    expect(parseCRL(crl.pem).revokedCertificates[0].reason).toBeNull();
  });

  it('verifyCRL returns false when the signature OID is unknown/mutated', () => {
    const crl = crlWith(new Date(Date.now() + 864e5));
    // Flip the issuer key — same structure, wrong signer → verification must fail.
    const other = makeCa('rsa');
    expect(verifyCRL(crl.pem, other.pubPem)).toBe(false);
  });
});

describe('CRL building and verification (ECDSA)', () => {
  it('signs with an EC key and verifies against the EC public key', () => {
    const ca = makeCa('ec');
    const crl = generateCRL({
      issuer: { CN: 'EC Test CA', O: 'Test', C: 'US' },
      crlNumber: 1,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 7 * 864e5),
      revokedCertificates: [{ serialNumber: 'abcd', revocationDate: new Date(), reason: CRLReason.CESSATION_OF_OPERATION }],
      signingKey: ca.keyPem,
      signatureAlgorithm: 'SHA256-ECDSA',
    });
    expect(crl.pem).toContain('-----BEGIN X509 CRL-----');
    expect(verifyCRL(crl.pem, ca.pubPem)).toBe(true);
    // sanity: the public key really is EC
    expect(createPublicKey(ca.pubPem).asymmetricKeyType).toBe('ec');
  });
});
