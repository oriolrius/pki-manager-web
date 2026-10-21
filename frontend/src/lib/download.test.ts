import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { downloadFile } from './download';
import { getAccessToken } from './auth/token';
vi.mock('./auth/token', () => ({ getAccessToken: vi.fn() }));
const request = vi.fn();
const createObjectURL = vi.fn((_blob: Blob) => 'blob:download');
const revokeObjectURL = vi.fn();
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.mocked(getAccessToken).mockResolvedValue('current-token');
});
afterEach(() => {
  vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});
it('authenticates the request and saves a blob with the requested filename', async () => {
  request.mockResolvedValue(new Response('certificate'));
  let savedName = '';
  click.mockImplementation(function (this: HTMLAnchorElement) { savedName = this.download; });
  await downloadFile('/api/v1/cas/id/download?format=p12-truststore', 'root.p12');
  expect(request).toHaveBeenCalledWith('/api/v1/cas/id/download?format=p12-truststore', { headers: { Authorization: 'Bearer current-token' }, redirect: 'error' });
  expect(savedName).toBe('root.p12');
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download]')).toBeNull();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
});
it('supports installations without OIDC', async () => {
  vi.mocked(getAccessToken).mockResolvedValue(null);
  request.mockResolvedValue(new Response('certificate'));
  await downloadFile('/download', 'ca.pem');
  expect(request).toHaveBeenCalledWith('/download', { headers: {}, redirect: 'error' });
});
it.each([401, 403, 500])('does not save error responses (%s)', async (status) => {
  request.mockResolvedValue(new Response('error', { status }));
  await expect(downloadFile('/download', 'ca.pem')).rejects.toThrow(status === 401 ? 'sign in again' : `HTTP ${status}`);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
});
it('does not trigger a download after a network failure', async () => {
  request.mockRejectedValue(new Error('network failure'));
  await expect(downloadFile('/download', 'ca.pem')).rejects.toThrow('network failure');
  expect(click).not.toHaveBeenCalled();
});

it.each([
  ['application/x-pkcs12', 'root-truststore.p12', [48, 130, 0, 128, 255]],
  ['application/x-x509-ca-cert', 'root.der', [48, 130, 255, 0]],
  ['application/x-java-keystore', 'root.jks', [254, 237, 254, 237, 0]],
  ['application/x-pem-file', 'root.pem', Array.from(new TextEncoder().encode('-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----\n'))],
])('decodes the CA JSON envelope into exact %s file bytes', async (mimeType, filename, expected) => {
  const data = btoa(String.fromCharCode(...expected));
  request.mockResolvedValue(new Response(JSON.stringify({ data, mimeType, filename }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }));
  let savedName = '';
  click.mockImplementation(function (this: HTMLAnchorElement) { savedName = this.download; });
  await downloadFile('/download', 'fallback.bin');
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe(mimeType);
  expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(expected);
  expect(savedName).toBe(filename);
  expect(click).toHaveBeenCalledOnce();
});
it.each([
  { error: { message: 'unexpected error' } },
  { data: 123, mimeType: 'application/x-pkcs12', filename: 'root.p12' },
  { data: 'not base64!', mimeType: 'application/x-pkcs12', filename: 'root.p12' },
])('rejects invalid JSON download payloads without saving them', async (payload) => {
  request.mockResolvedValue(new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  }));
  await expect(downloadFile('/download', 'root.p12')).rejects.toThrow('Download failed: invalid certificate');
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
});
