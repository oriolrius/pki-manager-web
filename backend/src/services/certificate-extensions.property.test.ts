/**
 * Property-based tests for buildCertificateExtensions. It writes the SAN values
 * of the request into the extension text that the KMS reads (one `key=value` on
 * each line). A value must never be able to add a line or a SAN entry.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildCertificateExtensions, CertificateValidationError } from './certificate.service.js';
import { NUM_RUNS, anyString, hostileString } from '../test/property.js';

const KNOWN_KEYS = [
  'basicConstraints',
  'keyUsage',
  'extendedKeyUsage',
  'subjectAltName',
  'subjectKeyIdentifier',
  'authorityKeyIdentifier',
  'crlDistributionPoints',
];

const certificateType = fc.constantFrom('server', 'client', 'dual', 'code_signing', 'email') as fc.Arbitrary<
  'server' | 'client' | 'dual' | 'code_signing' | 'email'
>;

const label = fc.string({ unit: fc.constantFrom(...'abcxyz0189'.split('')), minLength: 1, maxLength: 12 });
const domain = fc.array(label, { minLength: 2, maxLength: 4 }).map((labels) => labels.join('.'));
const email = fc.tuple(label, domain).map(([user, host]) => `${user}@${host}`);

/** A good value with an attack text at one end or in the middle. */
const injected = (good: fc.Arbitrary<string>) =>
  fc
    .tuple(
      good,
      fc.constantFrom(
        '\nbasicConstraints=critical,CA:TRUE',
        '\r\nkeyUsage=critical,keyCertSign,cRLSign',
        ',DNS:evil.example',
        ',IP:203.0.113.9',
        '\n[ v3_ca ]\nbasicConstraints=CA:TRUE',
        ' ',
        '\n',
        '\u2028subjectAltName=DNS:evil.example',
        '\\',
        '#',
        '$ENV::HOME',
        '"',
      ),
      fc.boolean(),
    )
    .map(([value, attack, before]) => (before ? attack + value : value + attack));

const sanList = (good: fc.Arbitrary<string>) =>
  fc.option(fc.array(fc.oneof(good, good, injected(good), hostileString(20), anyString(20)), { maxLength: 4 }), { nil: undefined });

function check(text: string, expected: string[]): void {
  const lines = text.split('\n');
  expect(lines[0]).toBe('[ v3_ca ]');
  expect(lines[lines.length - 1]).toBe('');
  const seen = new Set<string>();
  for (const line of lines.slice(1, -1)) {
    const key = line.slice(0, line.indexOf('='));
    expect(KNOWN_KEYS).toContain(key);
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    // No character that ends a line or starts a comment, an escape or a variable.
    // eslint-disable-next-line no-control-regex
    expect(line).not.toMatch(/[\u0000-\u001f\u007f\u0085\u2028\u2029\\#$"']/);
  }
  expect(lines).toContain('basicConstraints=critical,CA:FALSE');
  const san = lines.find((line) => line.startsWith('subjectAltName='));
  if (expected.length === 0) {
    expect(san).toBeUndefined();
  } else {
    // Exactly the requested entries, in order: no value added an entry.
    expect(san).toBe(`subjectAltName=${expected.join(',')}`);
    expect(san!.slice('subjectAltName='.length).split(',')).toEqual(expected);
  }
}

describe('buildCertificateExtensions (property)', () => {
  it('returns only the lines it was asked for, or refuses the request', () => {
    fc.assert(
      fc.property(certificateType, sanList(domain), sanList(fc.oneof(fc.ipV4(), fc.ipV6())), sanList(email), (type, sanDns, sanIp, sanEmail) => {
        let text: string;
        try {
          text = buildCertificateExtensions({ certificateType: type, sanDns, sanIp, sanEmail });
        } catch (error) {
          expect(error).toBeInstanceOf(CertificateValidationError);
          return;
        }
        check(text, [
          ...(sanDns ?? []).map((v) => `DNS:${v}`),
          ...(sanIp ?? []).map((v) => `IP:${v}`),
          ...(sanEmail ?? []).map((v) => `email:${v}`),
        ]);
      }),
      { numRuns: NUM_RUNS * 3 },
    );
  });

  it('accepts domain names, wildcards, IP addresses and email addresses', () => {
    fc.assert(
      fc.property(
        certificateType,
        fc.array(fc.oneof(domain, domain.map((d) => `*.${d}`)), { maxLength: 4 }),
        fc.array(fc.oneof(fc.ipV4(), fc.ipV6()), { maxLength: 4 }),
        fc.array(email, { maxLength: 4 }),
        (type, sanDns, sanIp, sanEmail) => {
          const text = buildCertificateExtensions({ certificateType: type, sanDns, sanIp, sanEmail });
          check(text, [...sanDns.map((v) => `DNS:${v}`), ...sanIp.map((v) => `IP:${v}`), ...sanEmail.map((v) => `email:${v}`)]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('refuses a CRL URL that can add a line', () => {
    fc.assert(
      fc.property(fc.oneof(hostileString(30), anyString(30), fc.webUrl()), (cdpUrl) => {
        let text: string;
        try {
          text = buildCertificateExtensions({ certificateType: 'server', cdpUrl });
        } catch (error) {
          expect(error).toBeInstanceOf(CertificateValidationError);
          return;
        }
        check(text, []);
        if (cdpUrl) expect(text).toContain(`crlDistributionPoints=URI:${cdpUrl}\n`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
