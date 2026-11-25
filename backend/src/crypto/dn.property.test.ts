/**
 * Property-based tests for the Distinguished Name text format (dn.ts).
 * The subject fields come from the request body; formatDN writes them to the
 * text that the database and the KMS get, and parseDN reads such a text back.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatDN, parseDN, validateDN, isDNEqual, cloneDN } from './dn.js';
import type { DistinguishedName } from './types.js';
import { NUM_RUNS, anyString, hostileString } from '../test/property.js';

const KEYS = ['CN', 'OU', 'O', 'L', 'ST', 'C', 'E'] as const;

/** A field value as formatDN keeps it: not empty, no whitespace at the ends. */
const value = fc
  .oneof(hostileString(30), anyString(30), fc.constantFrom('a\\', '\\', 'a\\,O=evil', 'x,O=evil', 'a=b', '#hex', 'a+b', '"q"', 'a;b', '<a>'))
  .filter((v) => v.length > 0 && v === v.trim());

const dn = fc.dictionary(fc.constantFrom(...KEYS), value) as fc.Arbitrary<DistinguishedName>;

describe('formatDN / parseDN (property)', () => {
  it('parseDN(formatDN(dn)) gives the same DN: a value cannot add or change a field', () => {
    fc.assert(
      fc.property(dn, (input) => {
        const parsed = parseDN(formatDN(input));
        expect(parsed).toEqual(input);
        expect(isDNEqual(parsed, input)).toBe(true);
      }),
      { numRuns: NUM_RUNS * 3 },
    );
  });

  it('formatDN writes the fields in the fixed order and skips empty fields', () => {
    fc.assert(
      fc.property(dn, (input) => {
        const text = formatDN(input);
        const keys = KEYS.filter((key) => input[key]);
        let from = 0;
        for (const key of keys) {
          const at = text.indexOf(`${key}=`, from);
          expect(at).toBeGreaterThanOrEqual(0);
          from = at + 1;
        }
        if (keys.length === 0) expect(text).toBe('');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('parseDN never throws and returns only known fields', () => {
    fc.assert(
      fc.property(fc.oneof(anyString(), hostileString(80)), (text) => {
        const parsed = parseDN(text);
        for (const [key, field] of Object.entries(parsed)) {
          expect(KEYS).toContain(key);
          expect(typeof field).toBe('string');
        }
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('validateDN never throws, and a valid DN has a CN and a 2-character C', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...KEYS), fc.oneof(anyString(10), fc.constant(''), fc.constant('  '))), (input) => {
        const result = validateDN(input as DistinguishedName);
        expect(result.valid).toBe(result.errors.length === 0);
        if (result.valid) {
          expect((input.CN ?? '').trim()).not.toBe('');
          if (input.C) expect(input.C).toHaveLength(2);
        }
        expect(cloneDN(input as DistinguishedName)).toEqual(input);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
