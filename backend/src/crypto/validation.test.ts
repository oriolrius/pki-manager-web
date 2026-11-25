/**
 * Regression tests for defects that the property tests found
 * (validation.property.test.ts). Each case is a shrunk counterexample.
 */
import { describe, it, expect } from 'vitest';
import { validateDomainName, validateIPAddress, validateIPv4, validateIPv6, validateServerSANs } from './validation.js';

describe('validateDomainName', () => {
  it('accepts the documented examples', () => {
    for (const value of ['portal.acme.example', '*.acme.example', 'a-b.example.com', 'xn--caf-dma.example']) {
      expect(validateDomainName(value)).toEqual({ valid: true });
    }
  });

  it('refuses the documented examples', () => {
    for (const value of ['portal', 'localhost', 'www.*.acme.example', '*.example', '*', 'a_b.example.com', '-a.example.com', 'a..example.com', '']) {
      expect(validateDomainName(value).valid).toBe(false);
    }
  });

  it('refuses whitespace around the name: the callers do not trim the value', () => {
    for (const value of [' portal.acme.example', 'portal.acme.example ', 'portal.acme.example\n', '\tportal.acme.example', '\u2028portal.acme.example']) {
      expect(validateDomainName(value).valid).toBe(false);
    }
  });
});

describe('IP address validators', () => {
  it('refuse whitespace around the address', () => {
    for (const value of ['\n0.0.0.0', '10.0.0.1 ', ' ::1', '::1\n']) {
      expect(validateIPAddress(value).valid).toBe(false);
    }
  });

  it('validateIPv4 refuses a leading zero, which some parsers read as octal', () => {
    expect(validateIPv4('010.0.0.1').valid).toBe(false);
    expect(validateIPv4('192.168.01.1').valid).toBe(false);
    expect(validateIPv4('192.168.1.1')).toEqual({ valid: true });
    expect(validateIPv4('256.1.1.1').valid).toBe(false);
  });

  it('validateIPv6 accepts an address with an IPv4 part at the end', () => {
    expect(validateIPv6('::0:0:0:0:0.0.0.0')).toEqual({ valid: true });
    expect(validateIPv6('64:ff9b::192.0.2.33')).toEqual({ valid: true });
    expect(validateIPv6('2001:db8::1')).toEqual({ valid: true });
  });

  it('validateIPv6 refuses a zone identifier', () => {
    expect(validateIPv6('fe80::1%eth0').valid).toBe(false);
  });

  it('validateIPAddress reports the version', () => {
    expect(validateIPAddress('192.0.2.1')).toEqual({ valid: true, version: 4 });
    expect(validateIPAddress('2001:db8::1')).toEqual({ valid: true, version: 6 });
  });
});

describe('validateServerSANs', () => {
  it('reports each bad entry', () => {
    const result = validateServerSANs(['ok.example.com', 'bad name.example.com\n'], ['192.0.2.1', '010.0.0.1']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
