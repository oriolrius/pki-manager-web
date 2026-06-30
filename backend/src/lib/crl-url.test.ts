/**
 * Unit tests for the CDP URL helper (TASK-114 AC#2). Pure, CI-safe (no KMS/DB).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { crlDistributionUrl } from './crl-url.js';

const saved = process.env.CRL_DISTRIBUTION_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.CRL_DISTRIBUTION_URL;
  else process.env.CRL_DISTRIBUTION_URL = saved;
});

describe('crlDistributionUrl', () => {
  it('returns undefined when CRL_DISTRIBUTION_URL is unset', () => {
    delete process.env.CRL_DISTRIBUTION_URL;
    expect(crlDistributionUrl('ca-123')).toBeUndefined();
  });

  it('returns undefined for a blank/whitespace value', () => {
    process.env.CRL_DISTRIBUTION_URL = '   ';
    expect(crlDistributionUrl('ca-123')).toBeUndefined();
  });

  it('builds <base>/<caId>.crl', () => {
    process.env.CRL_DISTRIBUTION_URL = 'http://crl.example.com/crl';
    expect(crlDistributionUrl('ca-123')).toBe('http://crl.example.com/crl/ca-123.crl');
  });

  it('trims one or many trailing slashes from the base', () => {
    process.env.CRL_DISTRIBUTION_URL = 'http://crl.example.com/crl///';
    expect(crlDistributionUrl('abc')).toBe('http://crl.example.com/crl/abc.crl');
  });

  it('trims surrounding whitespace in the configured base', () => {
    process.env.CRL_DISTRIBUTION_URL = '  http://h/crl  ';
    expect(crlDistributionUrl('x')).toBe('http://h/crl/x.crl');
  });
});
