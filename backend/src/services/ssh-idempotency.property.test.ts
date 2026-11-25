/**
 * Property-based tests for the Idempotency-Key header of the SSH signing API.
 * The header comes from the client of a fleet token.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readIdempotencyKey, requestFingerprint } from './ssh-idempotency.service.js';
import { NUM_RUNS, anyString } from '../test/property.js';

const printable = fc.string({ unit: fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c)), minLength: 1, maxLength: 255 });

describe('readIdempotencyKey (property)', () => {
  it('never throws; undefined only when the header is absent', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), anyString(300), printable), (raw) => {
        const result = readIdempotencyKey({ 'idempotency-key': raw });
        if (raw === undefined) expect(result).toBeUndefined();
        else expect(result === null || typeof result === 'string').toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(readIdempotencyKey({})).toBeUndefined();
  });

  it('accepts exactly 1..255 printable ASCII characters without spaces, and returns the key unchanged', () => {
    fc.assert(
      fc.property(fc.oneof(anyString(300), printable, printable.map((k) => `${k} `), printable.map((k) => `${k}\n`), printable.map((k) => k + k)), (raw) => {
        const documented = raw.length >= 1 && raw.length <= 255 && [...raw].every((ch) => ch.charCodeAt(0) >= 0x21 && ch.charCodeAt(0) <= 0x7e);
        expect(readIdempotencyKey({ 'idempotency-key': raw })).toBe(documented ? raw : null);
      }),
      { numRuns: NUM_RUNS * 2 },
    );
  });
});

describe('requestFingerprint (property)', () => {
  const fields = fc.dictionary(fc.string({ maxLength: 8 }), fc.oneof(fc.string({ maxLength: 12 }), fc.integer(), fc.array(fc.string({ maxLength: 6 }), { maxLength: 3 })), { maxKeys: 4 });

  it('is a SHA-256 hex text that depends on the endpoint and on the fields', () => {
    fc.assert(
      fc.property(fields, fields, (a, b) => {
        const host = requestFingerprint('sign-host', a);
        expect(host).toMatch(/^[0-9a-f]{64}$/);
        expect(requestFingerprint('sign-host', a)).toBe(host);
        expect(requestFingerprint('sign-user', a)).not.toBe(host);
        if (JSON.stringify(a) !== JSON.stringify(b)) expect(requestFingerprint('sign-host', b)).not.toBe(host);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
