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
