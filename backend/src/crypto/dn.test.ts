/**
 * Regression tests for a defect that the property test found
 * (dn.property.test.ts): parseDN split the text with a look-behind for one
 * backslash, so a value that ends with a backslash took the next field.
 */
import { describe, it, expect } from 'vitest';
import { formatDN, parseDN } from './dn.js';

describe('parseDN', () => {
  it('reads the fields of a plain DN', () => {
    expect(parseDN('CN=portal.acme.example,O=Acme,C=ES')).toEqual({ CN: 'portal.acme.example', O: 'Acme', C: 'ES' });
  });

  it('keeps an escaped comma in the value', () => {
    expect(parseDN('CN=Acme\\, Inc.,C=ES')).toEqual({ CN: 'Acme, Inc.', C: 'ES' });
  });

  it('does not let a value that ends with a backslash take the next field', () => {
    const dn = { CN: 'a\\', O: 'Acme', C: 'ES' };
    expect(formatDN(dn)).toBe('CN=a\\\\,O=Acme,C=ES');
    expect(parseDN(formatDN(dn))).toEqual(dn);
  });

  it('does not let a value add a field', () => {
    const dn = { CN: 'x,O=Evil Corp' };
    expect(parseDN(formatDN(dn))).toEqual(dn);
  });
});
