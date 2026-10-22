/** 192 bits from Web Crypto; the 64-character alphabet avoids modulo bias. */
export function generateExportPassword(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join('');
}
