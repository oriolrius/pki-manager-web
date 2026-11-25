/**
 * Property-based tests for the CN / SAN validators. The values come from the
 * request body of the certificate endpoints. The accepted rules are the ones in
 * docs/guides/private-ca.md ("Rules for names and validity").
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isIPv4, isIPv6 } from 'node:net';
import {
  validateCertificateValidity,
  validateDomainName,
  validateIPAddress,
  validateIPv4,
  validateIPv6,
  validateServerSANs,
} from './validation.js';
import { NUM_RUNS, anyString, hostileString } from '../test/property.js';

const LABEL = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

/** The documented rule for a domain name, written independently of the validator. */
function isDocumentedDomain(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  const labels = value.split('.');
  const rest = labels[0] === '*' ? labels.slice(1) : labels;
  if (rest.length < 2) return false;
  return rest.every((label) => label.length >= 1 && label.length <= 63 && LABEL.test(label));
}

const label = fc
  .tuple(
    fc.string({ unit: fc.constantFrom(...'abcxyzABC0189'.split('')), minLength: 1, maxLength: 1 }),
    fc.string({ unit: fc.constantFrom(...'abcxyzABC0189-'.split('')), maxLength: 20 }),
    fc.string({ unit: fc.constantFrom(...'abcxyzABC0189'.split('')), maxLength: 1 }),
  )
  .map(([first, middle, last]) => (middle.length > 0 && last.length === 0 ? first : first + middle + last));

const domain = fc
  .tuple(fc.boolean(), fc.array(label, { minLength: 2, maxLength: 5 }))
  .map(([wildcard, labels]) => (wildcard ? '*.' : '') + labels.join('.'));

/** A valid domain with one change: the usual way to get a near miss. */
const nearDomain = fc.tuple(domain, fc.nat(), hostileString(3)).map(([value, at, insert]) => {
  const i = at % (value.length + 1);
  return value.slice(0, i) + insert + value.slice(i);
});

/** A valid value with whitespace around it. The callers do not trim the value. */
const whitespace = fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u2028'), minLength: 1, maxLength: 3 });
const padded = (inner: fc.Arbitrary<string>) =>
  fc.tuple(fc.option(whitespace, { nil: '' }), inner, fc.option(whitespace, { nil: '' })).map((parts) => parts.join(''));

const anyInput = fc.oneof(anyString(), hostileString(), nearDomain, padded(domain), domain);

describe('validateDomainName (property)', () => {
  it('never throws and always returns a boolean verdict', () => {
    fc.assert(
      fc.property(anyInput, (value) => {
        const result = validateDomainName(value);
        expect(typeof result.valid).toBe('boolean');
        if (!result.valid) expect(typeof result.error).toBe('string');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts only values that satisfy the documented rules', () => {
    fc.assert(
      fc.property(anyInput, (value) => {
        if (validateDomainName(value).valid) expect(isDocumentedDomain(value)).toBe(true);
      }),
      { numRuns: NUM_RUNS * 3 },
    );
  });

  it('accepts every value that satisfies the documented rules', () => {
    fc.assert(
      fc.property(domain, (value) => {
        fc.pre(value.length <= 253);
        expect(validateDomainName(value)).toEqual({ valid: true });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('refuses a value that is not a string', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        fc.pre(typeof value !== 'string');
        expect(validateDomainName(value as string).valid).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const octet = fc.integer({ min: 0, max: 255 });
const ipv4 = fc.tuple(octet, octet, octet, octet).map((parts) => parts.join('.'));
const nearIp = fc.tuple(fc.oneof(ipv4, fc.ipV6()), fc.nat(), hostileString(3)).map(([value, at, insert]) => {
  const i = at % (value.length + 1);
  return value.slice(0, i) + insert + value.slice(i);
});
const digitsAndDots = fc.string({ unit: fc.constantFrom(...'0123456789.'.split('')), maxLength: 20 });
const anyIpInput = fc.oneof(anyString(60), nearIp, digitsAndDots, padded(fc.oneof(ipv4, fc.ipV6())), ipv4, fc.ipV6());

describe('IP address validators (property)', () => {
  it('validateIPv4 accepts exactly the dotted-decimal IPv4 addresses', () => {
    fc.assert(
      fc.property(anyIpInput, (value) => {
        expect(validateIPv4(value).valid).toBe(isIPv4(value));
      }),
      { numRuns: NUM_RUNS * 3 },
    );
  });

  it('validateIPv6 accepts only IPv6 addresses without a zone', () => {
    fc.assert(
      fc.property(anyIpInput, (value) => {
        if (validateIPv6(value).valid) {
          expect(isIPv6(value)).toBe(true);
          expect(value).not.toContain('%');
        }
      }),
      { numRuns: NUM_RUNS * 3 },
    );
  });

  it('validateIPv6 accepts the addresses that fast-check generates', () => {
    fc.assert(
      fc.property(fc.ipV6(), (value) => {
        expect(validateIPv6(value).valid).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('validateIPAddress agrees with the two validators and reports the version', () => {
    fc.assert(
      fc.property(anyIpInput, (value) => {
        const result = validateIPAddress(value);
        const v4 = validateIPv4(value).valid;
        const v6 = validateIPv6(value).valid;
        expect(result.valid).toBe(v4 || v6);
        if (result.valid) expect(result.version).toBe(v4 ? 4 : 6);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('validateServerSANs (property)', () => {
  it('is valid exactly when every entry is valid, with one error for each bad entry', () => {
    fc.assert(
      fc.property(
        fc.option(fc.array(fc.oneof(domain, nearDomain, anyString(40)), { maxLength: 6 }), { nil: undefined }),
        fc.option(fc.array(fc.oneof(ipv4, fc.ipV6(), nearIp, anyString(40)), { maxLength: 6 }), { nil: undefined }),
        (sanDns, sanIp) => {
          const result = validateServerSANs(sanDns, sanIp);
          const bad =
            (sanDns ?? []).filter((d) => !validateDomainName(d).valid).length +
            (sanIp ?? []).filter((ip) => !validateIPAddress(ip).valid).length;
          expect(result.errors).toHaveLength(bad);
          expect(result.valid).toBe(bad === 0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('validateCertificateValidity (property)', () => {
  it('accepts exactly the numbers from 1 to the maximum', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.double(), fc.integer(), fc.constantFrom(NaN, Infinity, -Infinity, 0, 1, 825, 826)),
        fc.integer({ min: 1, max: 5000 }),
        (days, max) => {
          const result = validateCertificateValidity(days, max);
          expect(result.valid).toBe(!Number.isNaN(days) && days >= 1 && days <= max);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('refuses a value that is not a number', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        fc.pre(typeof value !== 'number');
        expect(validateCertificateValidity(value as number).valid).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
