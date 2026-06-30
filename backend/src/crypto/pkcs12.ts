/**
 * PKCS#12 (.p12/.pfx) bundle creation.
 *
 * Uses the `openssl` CLI rather than node-forge so that BOTH RSA and ECDSA certificates can be
 * exported (node-forge's pkcs12 cannot encode EC keys). Legacy PBE algorithms (PBE-SHA1-3DES +
 * SHA-1 MAC, via the OpenSSL 3 `-legacy` provider) are used so the output stays readable by
 * node-forge, `keytool` (for JKS conversion), and older clients — matching the previous
 * node-forge output's algorithms.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface Pkcs12Input {
  /** Leaf certificate (PEM). */
  certPem: string;
  /** Leaf private key (PEM, PKCS#8 or PKCS#1). */
  privateKeyPem: string;
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
    await writeFile(keyPath, input.privateKeyPem);
    await writeFile(certPath, input.certPem);

    const args = [
      'pkcs12',
      '-export',
      '-inkey',
      keyPath,
      '-in',
      certPath,
      '-out',
      outPath,
      '-passout',
      `pass:${input.password}`,
      // Legacy PBE keeps the bundle readable by node-forge / keytool / older clients.
      '-keypbe',
      'PBE-SHA1-3DES',
      '-certpbe',
      'PBE-SHA1-3DES',
      '-macalg',
      'sha1',
      '-legacy',
    ];
    if (input.friendlyName) {
      args.push('-name', input.friendlyName);
    }
    if (input.chainPems && input.chainPems.length > 0) {
      const caPath = join(dir, 'ca.pem');
      await writeFile(caPath, input.chainPems.join('\n'));
      args.push('-certfile', caPath);
    }

    await execFileAsync('openssl', args);
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
      `pass:${password}`,
    ]);
    return (await readFile(outPath)).toString('utf-8');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
