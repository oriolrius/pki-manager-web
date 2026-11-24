/**
 * Export passwords and aliases come from users. They must never be parsed as shell syntax,
 * and must never appear in a process argv. These tests feed shell metacharacters through the
 * keystore exports and check that (1) the keystore is valid with exactly that password and
 * (2) no injected command ran.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateJKSKeystore, generateJKSTruststore } from './jks.service.js';
import { createPkcs12Bundle, encryptPrivateKeyPem } from '../crypto/pkcs12.js';

let dir: string;
let certPem: string;
let keyPem: string;
const marker = () => join(dir, 'pwned');
/** Every payload tries to create the marker file through a different shell construct. */
const payloads = () => [
  `x"; touch ${marker()}; echo "`,
  `$(touch ${marker()})`,
  `\`touch ${marker()}\``,
  `a' ; touch ${marker()} ; '`,
  `p&&touch ${marker()}`,
];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pki-no-shell-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'),
    '-subj', '/CN=no-shell.example', '-days', '2'], { stdio: 'ignore' });
  certPem = readFileSync(join(dir, 'c.pem'), 'utf8');
  keyPem = readFileSync(join(dir, 'k.pem'), 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** keytool -list must open the store with exactly this password (passed via env, not argv). */
function keytoolOpens(b64: string, password: string): boolean {
  const f = join(dir, `s-${Math.random().toString(36).slice(2)}.jks`);
  writeFileSync(f, Buffer.from(b64, 'base64'));
  try {
    execFileSync('keytool', ['-list', '-keystore', f, '-storepass:env', 'KS_PASS'], { env: { ...process.env, KS_PASS: password }, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('keystore exports never use a shell', () => {
  it('JKS keystore: shell metacharacters in the password are just password characters', async () => {
    for (const password of payloads()) {
      const res = await generateJKSKeystore({ certificatePem: certPem, privateKeyPem: keyPem, caCertificatePem: certPem, password, alias: 'leaf', commonName: 'no-shell.example', serialShort: '01' });
      expect(keytoolOpens(res.data, password)).toBe(true);
      expect(existsSync(marker())).toBe(false);
    }
  });

  it('JKS truststore: shell metacharacters in the password do not run', async () => {
    for (const password of payloads()) {
      const res = await generateJKSTruststore({ caCertificatePem: certPem, caSubjectDn: 'CN=no-shell.example', password, commonName: 'no-shell.example', serialShort: '01' });
      expect(keytoolOpens(res.data, password)).toBe(true);
      expect(existsSync(marker())).toBe(false);
    }
  });

  it('PKCS#12 and encrypted key: the password does not run and still decrypts', async () => {
    for (const password of payloads()) {
      const p12 = await createPkcs12Bundle({ certPem, privateKeyPem: keyPem, password });
      const f = join(dir, 'b.p12');
      writeFileSync(f, p12);
      execFileSync('openssl', ['pkcs12', '-in', f, '-noout', '-passin', 'env:P12_PASS'], { env: { ...process.env, P12_PASS: password }, stdio: 'ignore' });
      const enc = await encryptPrivateKeyPem(keyPem, password);
      expect(enc).toContain('ENCRYPTED PRIVATE KEY');
      expect(existsSync(marker())).toBe(false);
    }
  });
});
