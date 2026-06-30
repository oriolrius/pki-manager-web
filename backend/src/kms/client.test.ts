/**
 * Unit tests for KMSClient.getCertificatePrivateKeyId — the KMIP GetAttributes/PrivateKeyLink
 * resolver that all CRL signing (and PKCS#12 export) depends on. fetch is mocked, so CI-safe.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KMSClient } from './client.js';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const res = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
  return vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);
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

  it('throws when there is no PrivateKeyLink', async () => {
    mockFetchOnce(attrsResponse([{ type: 'PublicKeyLink', id: 'pub-key-id' }]));
    await expect(client.getCertificatePrivateKeyId('cert-id')).rejects.toThrow(/PrivateKeyLink/);
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
  function captureFetch(): { bodies: any[] } {
    const bodies: any[] = [];
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ tag: 'Response', value: [] }), text: async () => '{}' } as any;
    });
    return { bodies };
  }

  function findVendorAttr(requestValue: any[], name: string): any | undefined {
    const attrs = requestValue.find((e: any) => e.tag === 'Attributes')?.value ?? [];
    return attrs
      .filter((a: any) => a.tag === 'Attribute')
      .map((a: any) => a.value)
      .find((v: any[]) => v.some((f) => f.tag === 'AttributeName' && f.value === name));
  }

  it('encodes daysValid as the cosmian requested_validity_days vendor attribute (Integer)', async () => {
    const cap = captureFetch();
    await client.certify({ subjectName: 'CN=test', daysValid: 3650, keyAlgorithm: 'RSA-4096' }).catch(() => {});
    const attr = findVendorAttr(cap.bodies[0].value, 'requested_validity_days');
    expect(attr).toBeDefined();
    expect(attr).toContainEqual({ tag: 'VendorIdentification', type: 'TextString', value: 'cosmian' });
    expect(attr).toContainEqual({ tag: 'AttributeValue', type: 'Integer', value: 3650 });
  });

  it('omits the validity attribute when daysValid is not provided', async () => {
    const cap = captureFetch();
    await client.certify({ subjectName: 'CN=test', keyAlgorithm: 'RSA-4096' }).catch(() => {});
    expect(findVendorAttr(cap.bodies[0].value, 'requested_validity_days')).toBeUndefined();
  });
});
