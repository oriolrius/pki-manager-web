import { getAccessToken } from './auth/token';

/** Download through the renewable OIDC session, without exposing tokens in URLs. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, redirect: 'error' });
  if (!response.ok) {
    throw new Error(response.status === 401
      ? 'Your session is missing or expired. Please sign in again.'
      : `Download failed (HTTP ${response.status}).`);
  }
  let blob: Blob;
  let downloadName = filename;
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json') {
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object'
      || !('data' in result) || typeof result.data !== 'string'
      || !('mimeType' in result) || typeof result.mimeType !== 'string'
      || !('filename' in result) || typeof result.filename !== 'string') {
      throw new Error('Download failed: invalid certificate response.');
    }
    // The CA REST API wraps every format, including PEM, in Base64 JSON.
    // Decode to bytes: writing the binary string as text corrupts DER/P12/JKS.
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
    } catch {
      throw new Error('Download failed: invalid certificate encoding.');
    }
    blob = new Blob([bytes], { type: result.mimeType });
    downloadName = result.filename;
  } else {
    blob = await response.blob();
  }
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = downloadName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}
