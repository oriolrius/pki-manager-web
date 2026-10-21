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
  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}
