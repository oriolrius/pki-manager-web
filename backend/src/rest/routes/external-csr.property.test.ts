/**
 * Property-based tests for the CSR parsers. `POST /api/v1/external/sign` gets
 * the CSR PEM from an integration (Kubernetes issuer, SCEP gateway, script), so
 * the text is untrusted. parseCsrPem must refuse every CSR whose signature does
 * not cover its content, and it must fail with an Error for every other text.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import forge from 'node-forge';
import { parseCsrPem, type ParsedCsr } from './external.routes.js';
import { convertCSRFormat, extractCSRExtensions, parseCSR, verifyCSR } from '../../crypto/csr.js';
import { NUM_RUNS, SLOW_NUM_RUNS, anyString, hostileString } from '../../test/property.js';

const kind = fc.constantFrom('kubernetes', 'scep', 'generic');

// One RSA key for the file: the properties are about parsing, not about keys.
const rsa = forge.pki.rsa.generateKeyPair({ bits: 2048 });

/** A public test CSR (ECDSA P-256, made with `openssl req`). It holds no secret. */
const EC_CSR = `-----BEGIN CERTIFICATE REQUEST-----
MIIBOzCB4QIBADAwMR8wHQYDVQQDDBZlYy1kZXZpY2UuYWNtZS5leGFtcGxlMQ0w
CwYDVQQKDARBY21lMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAETYVr37Ee1pk5
5o9e4A2iWhWhFeQERr9A4u1Ph3+7Dp5ENdBBRODGrHfztl1wp35+mnyh8juMZb6r
qiJjZeLjJqBPME0GCSqGSIb3DQEJDjFAMD4wJwYDVR0RBCAwHoIWZWMtZGV2aWNl
LmFjbWUuZXhhbXBsZYcEwAACBzATBgNVHSUEDDAKBggrBgEFBQcDAjAKBggqhkjO
PQQDAgNJADBGAiEA5UQJUeCdfW05Hd8VL0hKQHuk1dE2v95364NOW3Q+/ecCIQCO
0vOsIEhoEbeg0zG9VM2w5c/4sDmIfHQmW35TiroqbA==
-----END CERTIFICATE REQUEST-----
`;

const label = fc.string({ unit: fc.constantFrom(...'abcxyz0189'.split('')), minLength: 1, maxLength: 10 });
const domain = fc.array(label, { minLength: 2, maxLength: 4 }).map((labels) => labels.join('.'));

function makeCsr(cn: string, sanDns: string[], sanIp: string[]): string {
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = rsa.publicKey;
  csr.setSubject([{ name: 'commonName', value: cn }]);
  const altNames = [...sanDns.map((value) => ({ type: 2, value })), ...sanIp.map((ip) => ({ type: 7, ip }))];
  csr.setAttributes([
    {
      name: 'extensionRequest',
      extensions: [...(altNames.length > 0 ? [{ name: 'subjectAltName', altNames }] : []), { name: 'extKeyUsage', clientAuth: true }],
    },
  ]);
  csr.sign(rsa.privateKey, forge.md.sha256.create());
  return forge.pki.certificationRequestToPem(csr);
}

function pemToDer(pem: string): Buffer {
  return Buffer.from(forge.pem.decode(pem)[0].body, 'binary');
}

function derToPem(der: Buffer): string {
  return forge.pem.encode({ type: 'CERTIFICATE REQUEST', body: der.toString('binary') });
}

/** The identity that the certificate gets from the CSR. */
const identity = (p: ParsedCsr) => ({ cn: p.cn, subjectDn: p.subjectDn, sanDns: p.sanDns, sanIp: p.sanIp, sanEmail: p.sanEmail, bc: p.hasBasicConstraints });

function expectParsedShape(p: ParsedCsr): void {
  expect(typeof p.cn).toBe('string');
  expect(typeof p.subjectDn).toBe('string');
  expect(typeof p.hasBasicConstraints).toBe('boolean');
  for (const list of [p.sanDns, p.sanIp, p.sanEmail]) {
    expect(Array.isArray(list)).toBe(true);
    for (const item of list) expect(typeof item).toBe('string');
  }
}

describe('parseCsrPem (property)', () => {
  it('fails with an Error for a text that is not a CSR', () => {
    const armored = fc
      .tuple(fc.constantFrom('CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST', 'CERTIFICATE', 'PRIVATE KEY'), fc.uint8Array({ maxLength: 200 }))
      .map(([type, body]) => forge.pem.encode({ type, body: Buffer.from(body).toString('binary') }));
    const nested = fc
      .tuple(fc.integer({ min: 1, max: 3000 }), fc.constantFrom('3080', '30820000', 'a080', '2480'))
      .map(([depth, hex]) => derToPem(Buffer.from(hex.repeat(depth), 'hex')));
    fc.assert(
      fc.property(fc.oneof(anyString(), hostileString(80), armored, nested), kind, (text, k) => {
        try {
          expectParsedShape(parseCsrPem(text, k));
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round trip: reads the CN and the SANs that the CSR was made with', () => {
    fc.assert(
      fc.property(domain, fc.array(domain, { maxLength: 3 }), fc.array(fc.ipV4(), { maxLength: 2 }), kind, (cn, sanDns, sanIp, k) => {
        const parsed = parseCsrPem(makeCsr(cn, sanDns, sanIp), k);
        expect(identity(parsed)).toEqual({ cn, subjectDn: `CN=${cn}`, sanDns, sanIp, sanEmail: [], bc: false });
      }),
      { numRuns: SLOW_NUM_RUNS },
    );
  });

  const rsaDer = pemToDer(makeCsr('device.acme.example', ['device.acme.example', 'alt.acme.example'], ['192.0.2.7']));
  const ecDer = pemToDer(EC_CSR);

  it('reads the two reference CSRs', () => {
    expect(identity(parseCsrPem(derToPem(rsaDer), 'scep'))).toEqual({
      cn: 'device.acme.example',
      subjectDn: 'CN=device.acme.example',
      sanDns: ['device.acme.example', 'alt.acme.example'],
      sanIp: ['192.0.2.7'],
      sanEmail: [],
      bc: false,
    });
    expect(identity(parseCsrPem(EC_CSR, 'scep'))).toEqual({
      cn: 'ec-device.acme.example',
      subjectDn: 'CN=ec-device.acme.example,O=Acme',
      sanDns: ['ec-device.acme.example'],
      sanIp: ['192.0.2.7'],
      sanEmail: [],
      bc: false,
    });
  });

  it.each([
    ['RSA', rsaDer],
    ['ECDSA', ecDer],
  ])('a changed %s CSR is refused, or it gives the identity that was signed', (_name, der) => {
    const original = identity(parseCsrPem(derToPem(der), 'generic'));
    fc.assert(
      fc.property(fc.nat({ max: der.length - 1 }), fc.integer({ min: 1, max: 255 }), kind, (at, mask, k) => {
        const changed = Buffer.from(der);
        changed[at] ^= mask;
        let parsed: ParsedCsr;
        try {
          parsed = parseCsrPem(derToPem(changed), k);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          return;
        }
        // Accepted: the change did not touch the signed content.
        expect(identity(parsed)).toEqual(original);
      }),
      { numRuns: NUM_RUNS * 2 },
    );
  });

  it('a truncated CSR is refused', () => {
    fc.assert(
      fc.property(fc.constantFrom(rsaDer, ecDer), fc.nat(), kind, (der, n, k) => {
        const cut = der.subarray(0, n % der.length);
        expect(() => parseCsrPem(derToPem(cut), k)).toThrow(Error);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('crypto/csr.ts parsers (property)', () => {
  const pem = makeCsr('device.acme.example', ['device.acme.example'], ['192.0.2.7']);

  it('verifyCSR and extractCSRExtensions never throw', () => {
    fc.assert(
      fc.property(fc.oneof(anyString(), hostileString(80), fc.constant(pem.slice(0, 200))), (text) => {
        expect(verifyCSR(text)).toBe(false);
        expect(extractCSRExtensions(text)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(verifyCSR(pem)).toBe(true);
    expect(extractCSRExtensions(pem).length).toBeGreaterThan(0);
  });

  it('parseCSR and convertCSRFormat fail with an Error for a text that is not a CSR', () => {
    fc.assert(
      fc.property(fc.oneof(anyString(), hostileString(80)), fc.constantFrom('PEM', 'DER') as fc.Arbitrary<'PEM' | 'DER'>, (text, format) => {
        expect(() => parseCSR(text, format)).toThrow(Error);
        expect(() => convertCSRFormat(text, format, format === 'PEM' ? 'DER' : 'PEM')).toThrow(Error);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round trip: PEM -> DER -> PEM gives the same CSR', () => {
    fc.assert(
      fc.property(domain, fc.array(domain, { maxLength: 2 }), (cn, sanDns) => {
        const original = makeCsr(cn, sanDns, []);
        const der = convertCSRFormat(original, 'PEM', 'DER');
        const again = convertCSRFormat(der, 'DER', 'PEM');
        expect(pemToDer(again).equals(pemToDer(original))).toBe(true);
        expect(Buffer.from(der, 'base64').equals(pemToDer(original))).toBe(true);
        expect(parseCSR(again).subject).toEqual({ CN: cn });
        expect(parseCSR(der, 'DER').subject).toEqual({ CN: cn });
      }),
      { numRuns: SLOW_NUM_RUNS },
    );
  });
});
