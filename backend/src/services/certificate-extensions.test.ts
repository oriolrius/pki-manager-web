/**
 * Regression tests for a defect that the property test found
 * (certificate-extensions.property.test.ts): a SAN value went into the extension
 * text without a check, so a line break in the value added a line to the text.
 */
import { describe, it, expect } from 'vitest';
import { buildCertificateExtensions, CertificateValidationError } from './certificate.service.js';

describe('buildCertificateExtensions', () => {
  it('builds one SAN line with the requested entries', () => {
    const text = buildCertificateExtensions({
      certificateType: 'server',
      sanDns: ['portal.acme.example', '*.acme.example'],
      sanIp: ['192.0.2.10', '2001:db8::10'],
      sanEmail: ['maria.puig+pki@acme.example'],
      cdpUrl: 'https://pki.acme.example/crl/ca-1.crl',
    });
    expect(text.split('\n')).toEqual([
      '[ v3_ca ]',
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      'subjectAltName=DNS:portal.acme.example,DNS:*.acme.example,IP:192.0.2.10,IP:2001:db8::10,email:maria.puig+pki@acme.example',
      'subjectKeyIdentifier=hash',
      'authorityKeyIdentifier=keyid:always',
      'crlDistributionPoints=URI:https://pki.acme.example/crl/ca-1.crl',
      '',
    ]);
  });

  it.each([
    ['sanEmail', 'a@a.a\nbasicConstraints=critical,CA:TRUE'],
    ['sanEmail', 'a@a.a\r\nkeyUsage=critical,keyCertSign,cRLSign'],
    ['sanEmail', 'a@a.a,DNS:evil.example'],
    ['sanDns', 'device.example\nbasicConstraints=critical,CA:TRUE'],
    ['sanDns', 'device.example,DNS:evil.example'],
    ['sanDns', 'device.example\u2028subjectAltName=DNS:evil.example'],
    ['sanDns', 'device.example '],
    ['sanDns', '$ENV::HOME'],
    ['sanDns', 'device.example#'],
    ['sanDns', ''],
    ['sanIp', '192.0.2.1\nbasicConstraints=critical,CA:TRUE'],
    ['sanIp', '192.0.2.1,DNS:evil.example'],
    ['sanIp', 'not-an-ip'],
  ])('refuses %s %j for every certificate type', (field, value) => {
    for (const certificateType of ['server', 'client', 'dual', 'code_signing', 'email'] as const) {
      expect(() => buildCertificateExtensions({ certificateType, [field]: [value] })).toThrow(CertificateValidationError);
    }
  });

  it('refuses a CRL URL that holds a line break', () => {
    expect(() =>
      buildCertificateExtensions({ certificateType: 'server', cdpUrl: 'https://pki.acme.example/crl\nbasicConstraints=CA:TRUE' }),
    ).toThrow(CertificateValidationError);
  });
});
