/**
 * PKCS#12 (.p12/.pfx) bundle creation.
 *
 * Uses the `openssl` CLI rather than node-forge so that BOTH RSA and ECDSA certificates can be
 * exported (node-forge cannot encode EC keys). OpenSSL 3 uses PBES2 with AES-256-CBC,
 * PBKDF2-HMAC-SHA256 and a SHA-256 MAC by default.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

// openssl reads export passwords from its environment (`-passout env:NAME`) so they
// never appear in argv or the process list.
const PASS_ENV = 'PKI_EXPORT_PASSWORD';
const withPassword = (password: string) => ({ env: { ...process.env, [PASS_ENV]: password } });

export interface Pkcs12Input {
  /** Leaf certificate (PEM). */
  certPem: string;
  /** Leaf private key (PKCS#8 or PKCS#1 PEM), or null for a CA truststore. */
  privateKeyPem: string | null;
  /** Enable SHA-1 and 3DES for older clients. */
  legacy?: boolean;
  /** Optional CA chain certificates (PEM) to include. */
  chainPems?: string[];
  /** Bundle password (may be empty). */
  password: string;
  /** Optional friendlyName / alias for the key+cert entry. */
  friendlyName?: string;
}

/**
 * Build a PKCS#12 bundle (cert + private key + optional CA chain) and return its DER bytes.
 * Works for both RSA and ECDSA keys.
 */
export async function createPkcs12Bundle(input: Pkcs12Input): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'p12-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    const outPath = join(dir, 'out.p12');
    await writeFile(certPath, input.certPem);

    const args = [
      'pkcs12',
      '-export',
      '-in',
      certPath,
      '-out',
      outPath,
      '-passout',
      `env:${PASS_ENV}`,
    ];
    if (input.privateKeyPem !== null) {
      await writeFile(keyPath, input.privateKeyPem);
      args.push('-inkey', keyPath);
    } else {
      args.push('-nokeys');
    }
    if (input.legacy) {
      args.push('-legacy', '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1');
    }
    if (input.privateKeyPem !== null && input.friendlyName) {
      args.push('-name', input.friendlyName);
    }
    if (input.chainPems && input.chainPems.length > 0) {
      const caPath = join(dir, 'ca.pem');
      await writeFile(caPath, input.chainPems.join('\n'));
      args.push('-certfile', caPath);
    }

    await execFileAsync('openssl', args, withPassword(input.password));
    if (input.privateKeyPem === null) {
      // Java needs a trustedCertEntry. Import into the existing PKCS#12 so keytool
      // preserves its encryption profile and accepts existing short REST passwords.
      await execFileAsync('keytool', [
        '-importcert', '-noprompt', '-alias', input.friendlyName || 'ca', '-file', certPath,
        '-keystore', outPath, '-storetype', 'PKCS12', '-storepass:env', PASS_ENV,
      ], withPassword(input.password));
    }
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Encrypt a private key PEM with a password (AES-256, PKCS#8) via openssl. Works for RSA and
 * EC keys, unlike node-forge's RSA-only `encryptRsaPrivateKey`. Returns an
 * `-----BEGIN ENCRYPTED PRIVATE KEY-----` PEM.
 */
export async function encryptPrivateKeyPem(privateKeyPem: string, password: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'keyenc-'));
  try {
    const inPath = join(dir, 'in.pem');
    const outPath = join(dir, 'out.pem');
    await writeFile(inPath, privateKeyPem);
    await execFileAsync('openssl', [
      'pkcs8',
      '-topk8',
      '-in',
      inPath,
      '-out',
      outPath,
      '-v2',
      'aes-256-cbc',
      '-passout',
      `env:${PASS_ENV}`,
    ], withPassword(password));
    return (await readFile(outPath)).toString('utf-8');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
