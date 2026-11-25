/**
 * Unit tests for KMSClient.getCertificatePrivateKeyId — the KMIP GetAttributes/PrivateKeyLink
 * resolver that all CRL signing (and PKCS#12 export) depends on. fetch is mocked, so CI-safe.
 */
import type { KMIPElement, KMIPRequest } from './types.js';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KMSClient } from './client.js';
import { logger } from '../lib/logger.js';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const res = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, statusText: ok ? 'OK' : 'Error',
  });
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
}

function attrsResponse(links: Array<{ type: string; id: string }>) {
  return {
    tag: 'GetAttributesResponse',
    value: [
      { tag: 'UniqueIdentifier', type: 'TextString', value: 'cert-id' },
      {
        tag: 'Attributes',
        value: links.map((l) => ({
          tag: 'Link',
          value: [
            { tag: 'LinkType', type: 'Enumeration', value: l.type },
            { tag: 'LinkedObjectIdentifier', type: 'TextString', value: l.id },
          ],
        })),
      },
    ],
  };
}

describe('KMSClient.getCertificatePrivateKeyId', () => {
  afterEach(() => vi.restoreAllMocks());

  const client = new KMSClient({ url: 'http://kms.test', retryAttempts: 1 });

  it('returns the PrivateKeyLink id (not the public-key or certificate link)', async () => {
    mockFetchOnce(
      attrsResponse([
        { type: 'CertificateLink', id: 'other-cert' },
        { type: 'PublicKeyLink', id: 'pub-key-id' },
        { type: 'PrivateKeyLink', id: 'the-private-key-id' },
      ]),
    );
    await expect(client.getCertificatePrivateKeyId('cert-id')).resolves.toBe('the-private-key-id');
  });

  it('does not log sensitive KMIP request or response payloads at debug level', async () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    mockFetchOnce(attrsResponse([{ type: 'PrivateKeyLink', id: 'sensitive-response-marker' }]));
    await client.getCertificatePrivateKeyId('sensitive-request-marker');
    const logged = JSON.stringify(debug.mock.calls);
    expect(logged).not.toContain('sensitive-request-marker');
    expect(logged).not.toContain('sensitive-response-marker');
    expect(logged).toContain('GetAttributes');
  });

  it('throws when there is no PrivateKeyLink', async () => {
    mockFetchOnce(attrsResponse([{ type: 'PublicKeyLink', id: 'pub-key-id' }]));
    await expect(client.getCertificatePrivateKeyId('cert-id')).rejects.toThrow(/PrivateKeyLink/);
  });

  it('rejects a malformed certificate structure before decoding certificate bytes', async () => {
    mockFetchOnce({ tag: 'GetResponse', value: [{ tag: 'Certificate', value: 'invalid' }] });
    await expect(client.getCertificate('cert-id')).rejects.toThrow('Expected KMIP Certificate structure');
  });

  it('throws when the response has no Attributes', async () => {
    mockFetchOnce({ tag: 'GetAttributesResponse', value: [{ tag: 'UniqueIdentifier', type: 'TextString', value: 'cert-id' }] });
    await expect(client.getCertificatePrivateKeyId('cert-id')).rejects.toThrow(/No attributes/i);
  });
});

describe('KMSClient.certify — requested validity', () => {
  afterEach(() => vi.restoreAllMocks());

  const client = new KMSClient({ url: 'http://kms.test', retryAttempts: 1 });

  // Capture every KMIP request body the client POSTs; return a benign response so the
  // certify() follow-up Gets short-circuit. We only assert on the first (Certify) request.
  function captureFetch() {
    const bodies: KMIPRequest[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected KMIP JSON');
      bodies.push(JSON.parse(init.body));
      return Response.json({ tag: 'Response', value: [] });
    });
    return { bodies };
  }

  function children(element?: KMIPElement): KMIPElement[] {
    return Array.isArray(element?.value) ? element.value : [];
  }

  function findVendorAttr(requestValue: KMIPElement[], name: string) {
    return children(requestValue.find((e) => e.tag === 'Attributes'))
      .filter((a) => a.tag === 'Attribute')
      .map(children)
      .find((fields) => fields.some((f) => f.tag === 'AttributeName' && f.value === name));
  }

  it('encodes daysValid as the cosmian requested_validity_days vendor attribute (Integer)', async () => {
    const cap = captureFetch();
    await client.certify({ subjectName: 'CN=test', daysValid: 3650, keyAlgorithm: 'RSA-4096' }).catch(() => {});
    const attr = findVendorAttr(cap.bodies[0].value, 'requested_validity_days');
    expect(attr).toBeDefined();
    expect(attr).toContainEqual({ tag: 'VendorIdentification', type: 'TextString', value: 'cosmian' });
    expect(attr).toContainEqual({ tag: 'AttributeValue', type: 'Integer', value: 3650 });
  });

  it.each([undefined, 'issuing-ca-id'])('encodes CN-only subjects without inventing organization/country (issuer: %s)', async (issuerCertificateId) => {
    const cap = captureFetch();
    await client.certify({ subjectName: 'CN=SCEP Registration Authority', issuerCertificateId, publicKeyId: 'public-key-id' }).catch(() => {});
    const attributes = children(cap.bodies[0].value.find((field) => field.tag === 'Attributes'));
    const fields = children(attributes.find((field) => field.tag === 'CertificateAttributes'));
    expect(fields).toContainEqual({ tag: 'CertificateSubjectCn', type: 'TextString', value: 'SCEP Registration Authority' });
    for (const tag of ['CertificateSubjectO', 'CertificateSubjectC']) {
      expect(fields.filter((field) => field.tag === tag)).toEqual([{ tag, type: 'TextString', value: '' }]);
    }
    if (!issuerCertificateId) {
      for (const tag of ['CertificateIssuerO', 'CertificateIssuerC']) {
        expect(fields).toContainEqual({ tag, type: 'TextString', value: '' });
      }
    }
  });

  it('preserves supplied organization and country without duplicate fallback fields', async () => {
    const cap = captureFetch();
    await client.certify({ subjectName: 'CN=Device,O=Existing Org,C=DE', publicKeyId: 'public-key-id' }).catch(() => {});
    const attributes = children(cap.bodies[0].value.find((field) => field.tag === 'Attributes'));
    const fields = children(attributes.find((field) => field.tag === 'CertificateAttributes'));
    expect(fields.filter((field) => field.tag === 'CertificateSubjectO')).toEqual([{ tag: 'CertificateSubjectO', type: 'TextString', value: 'Existing Org' }]);
    expect(fields.filter((field) => field.tag === 'CertificateSubjectC')).toEqual([{ tag: 'CertificateSubjectC', type: 'TextString', value: 'DE' }]);
  });

  it('omits the validity attribute when daysValid is not provided', async () => {
    const cap = captureFetch();
    await client.certify({ subjectName: 'CN=test', keyAlgorithm: 'RSA-4096' }).catch(() => {});
    expect(findVendorAttr(cap.bodies[0].value, 'requested_validity_days')).toBeUndefined();
  });
});
