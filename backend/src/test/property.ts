/**
 * Shared settings for the property-based tests (`*.property.test.ts`, fast-check).
 *
 * The runs are bounded so that the normal suite stays fast. Set FC_NUM_RUNS to
 * search longer on your machine, for example `FC_NUM_RUNS=20000 pnpm test property`.
 * fast-check prints the seed and the shrunk counterexample of a failure: put the
 * counterexample in a unit test when you fix the defect.
 */
import fc from 'fast-check';

const fromEnv = Number(process.env.FC_NUM_RUNS);

/** Number of generated cases for one property. */
export const NUM_RUNS = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 300;

/** Run count for a property that does slow work (key generation, signatures). */
export const SLOW_NUM_RUNS = Math.max(20, Math.floor(NUM_RUNS / 10));

/** Any string: every Unicode code point, lone surrogates included. */
export const anyString = (maxLength = 300): fc.Arbitrary<string> =>
  fc.oneof(
    fc.string({ unit: 'binary', maxLength }),
    fc.string({ maxLength }),
    fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength }).map((units) => String.fromCharCode(...units)),
  );

/** Characters that often break a text format: separators, escapes, line breaks. */
export const hostileString = (maxLength = 40): fc.Arbitrary<string> =>
  fc.string({
    unit: fc.constantFrom(...'aZ09 .-_*@:/\\,;=+"<>#\n\r\t\0'.split(''), '\u2028', '\u00e9', '\u{1F600}'),
    maxLength,
  });
