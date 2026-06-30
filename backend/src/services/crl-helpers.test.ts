/**
 * Unit tests for crl.service pure helpers: mapRevocationReason + resolveSignatureAlgorithm.
 * CI-safe (no KMS/DB).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mapRevocationReason, resolveSignatureAlgorithm } from './crl.service.js';
import { CRLReason } from '../crypto/types.js';

describe('mapRevocationReason', () => {
  const cases: Array<[string | null | undefined, CRLReason]> = [
    ['keyCompromise', CRLReason.KEY_COMPROMISE],
    ['key_compromise', CRLReason.KEY_COMPROMISE],
    ['key-compromise', CRLReason.KEY_COMPROMISE],
    ['caCompromise', CRLReason.CA_COMPROMISE],
    ['ca_compromise', CRLReason.CA_COMPROMISE],
    ['affiliationChanged', CRLReason.AFFILIATION_CHANGED],
    ['superseded', CRLReason.SUPERSEDED],
    ['cessationOfOperation', CRLReason.CESSATION_OF_OPERATION],
    ['certificateHold', CRLReason.CERTIFICATE_HOLD],
    ['privilegeWithdrawn', CRLReason.PRIVILEGE_WITHDRAWN],
    ['aaCompromise', CRLReason.AA_COMPROMISE],
    // colon-suffixed detail is stripped before mapping
    ['keyCompromise: lost laptop', CRLReason.KEY_COMPROMISE],
    // null / empty / unknown fall back to UNSPECIFIED
    [null, CRLReason.UNSPECIFIED],
    [undefined, CRLReason.UNSPECIFIED],
    ['', CRLReason.UNSPECIFIED],
    ['unspecified', CRLReason.UNSPECIFIED],
    ['totally-bogus', CRLReason.UNSPECIFIED],
  ];

  it.each(cases)('maps %s -> %d', (input, expected) => {
    expect(mapRevocationReason(input)).toBe(expected);
  });
});

describe('resolveSignatureAlgorithm', () => {
  let rsa2048: string;
  let rsa4096: string;
  let ecP256: string;
  let ecP384: string;

  beforeAll(() => {
    rsa2048 = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    rsa4096 = generateKeyPairSync('rsa', { modulusLength: 4096 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    ecP256 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    ecP384 = generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  });

  it('uses the recorded CA keyAlgorithm when known (no key inspection needed)', () => {
    expect(resolveSignatureAlgorithm('RSA-2048', rsa2048)).toBe('SHA256-RSA');
    expect(resolveSignatureAlgorithm('RSA-4096', rsa4096)).toBe('SHA384-RSA');
    expect(resolveSignatureAlgorithm('ECDSA-P256', ecP256)).toBe('SHA256-ECDSA');
    expect(resolveSignatureAlgorithm('ECDSA-P384', ecP384)).toBe('SHA384-ECDSA');
  });

  it('infers from the private key when CA keyAlgorithm is null/unknown', () => {
    expect(resolveSignatureAlgorithm(null, rsa2048)).toBe('SHA256-RSA');
    expect(resolveSignatureAlgorithm(null, rsa4096)).toBe('SHA384-RSA');
    expect(resolveSignatureAlgorithm(undefined, ecP256)).toBe('SHA256-ECDSA');
    expect(resolveSignatureAlgorithm('garbage', ecP384)).toBe('SHA384-ECDSA');
  });
});
