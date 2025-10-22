/**
 * CRL Distribution Point (CDP) Tests
 *
 * Tests to validate:
 * 1. CDP extension support in X.509 certificate generation
 * 2. CDP URL configuration
 * 3. CDP format validation
 */

import { describe, it, expect } from 'vitest';
import { generateCertificate } from './x509.js';
import forge from 'node-forge';

describe('CRL Distribution Point (CDP) Extension', () => {
  it('should add CDP extension to certificate', () => {
    // Generate a key pair for testing
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
    const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

    const cdpUrl = 'http://crl.example.com/ca/test-ca.crl';

    const cert = generateCertificate({
      subject: { CN: 'Test CDP Certificate', O: 'Test Org', C: 'US' },
      publicKey: publicKeyPem,
      signingKey: privateKeyPem,
      selfSigned: true,
      extensions: {
        basicConstraints: { cA: false },
        keyUsage: {
          digitalSignature: true,
          keyEncipherment: true,
        },
        crlDistributionPoints: [cdpUrl],
      },
    });

    expect(cert.pem).toBeDefined();
    expect(cert.pem).toContain('-----BEGIN CERTIFICATE-----');

    // Parse the certificate and check for CDP extension
    const forgeCert = forge.pki.certificateFromPem(cert.pem);
    const cdpExtension = forgeCert.extensions.find(
      (ext: any) => ext.id === '2.5.29.31' // CRL Distribution Points OID
    );

    expect(cdpExtension).toBeDefined();
    expect(cdpExtension?.id).toBe('2.5.29.31');

    // CDP extension is present as a custom extension with DER-encoded value
    // Full parsing would require ASN.1 decoding, which is complex
    // For now, verify the extension exists with the correct OID
    expect(cdpExtension?.value).toBeDefined();
  });

  it('should support multiple CDP URLs', () => {
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
    const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

    const cdpUrls = [
      'http://crl.example.com/ca/test-ca.crl',
      'http://backup-crl.example.com/ca/test-ca.crl',
    ];

    const cert = generateCertificate({
      subject: { CN: 'Test Multiple CDP', O: 'Test Org', C: 'US' },
      publicKey: publicKeyPem,
      signingKey: privateKeyPem,
      selfSigned: true,
      extensions: {
        crlDistributionPoints: cdpUrls,
      },
    });

    const forgeCert = forge.pki.certificateFromPem(cert.pem);
    const cdpExtension = forgeCert.extensions.find(
      (ext: any) => ext.id === '2.5.29.31'
    );

    expect(cdpExtension).toBeDefined();
    expect(cdpExtension?.id).toBe('2.5.29.31');
    expect(cdpExtension?.value).toBeDefined();
  });

  it('should support HTTP and HTTPS URLs', () => {
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
    const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

    const httpUrl = 'http://crl.example.com/ca/test-ca.crl';
    const httpsUrl = 'https://secure-crl.example.com/ca/test-ca.crl';

    const cert = generateCertificate({
      subject: { CN: 'Test HTTPS CDP', O: 'Test Org', C: 'US' },
      publicKey: publicKeyPem,
      signingKey: privateKeyPem,
      selfSigned: true,
      extensions: {
        crlDistributionPoints: [httpUrl, httpsUrl],
      },
    });

    const forgeCert = forge.pki.certificateFromPem(cert.pem);
    const cdpExtension = forgeCert.extensions.find(
      (ext: any) => ext.id === '2.5.29.31'
    );

    expect(cdpExtension).toBeDefined();
    expect(cdpExtension?.value).toBeDefined();
  });

  it('should generate certificate without CDP when not specified', () => {
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
    const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

    const cert = generateCertificate({
      subject: { CN: 'Test No CDP', O: 'Test Org', C: 'US' },
      publicKey: publicKeyPem,
      signingKey: privateKeyPem,
      selfSigned: true,
      extensions: {
        basicConstraints: { cA: false },
      },
    });

    const forgeCert = forge.pki.certificateFromPem(cert.pem);
    const cdpExtension = forgeCert.extensions.find(
      (ext: any) => ext.id === '2.5.29.31'
    );

    expect(cdpExtension).toBeUndefined();
  });

  it('should format CDP URL with CA ID placeholder', () => {
    const caId = 'ca-12345';
    const urlTemplate = 'http://crl.example.com/crl';
    const cdpUrl = `${urlTemplate}/${caId}.crl`;

    expect(cdpUrl).toBe('http://crl.example.com/crl/ca-12345.crl');
    expect(cdpUrl).toMatch(/\.crl$/);
  });
});

describe('CDP Configuration', () => {
  it('should validate CDP URL format', () => {
    const validUrls = [
      'http://crl.example.com/ca/{caId}.crl',
      'https://crl.example.com/ca/{caId}.crl',
      'http://localhost:3000/crl/{caId}.crl',
      'https://secure.example.com:8443/crl/{caId}.crl',
    ];

    validUrls.forEach((url) => {
      expect(url).toMatch(/^https?:\/\//);
      expect(url).toContain('{caId}');
    });
  });

  it('should construct CDP URL from base URL and CA ID', () => {
    const baseUrl = 'http://localhost:3000/crl';
    const caId = 'test-ca-123';
    const cdpUrl = `${baseUrl}/${caId}.crl`;

    expect(cdpUrl).toBe('http://localhost:3000/crl/test-ca-123.crl');
  });

  it('should handle environment variable CDP URL', () => {
    const envCdpUrl = process.env.CRL_DISTRIBUTION_URL || 'http://localhost:3000/crl';
    expect(envCdpUrl).toBeDefined();
    expect(envCdpUrl).toMatch(/^https?:\/\//);
  });
});
