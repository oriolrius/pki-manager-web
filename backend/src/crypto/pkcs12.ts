/**
 * Key and key store exports: encrypted PKCS#8, PKCS#12 (.p12/.pfx) and JKS.
 *
 * - Encrypted PKCS#8 keys: Node crypto (PBES2, AES-256-CBC, PBKDF2-HMAC-SHA256). No executable.
 * - PKCS#12 trust stores and every JKS store: the standard Java KeyStore API, through
 *   `KeyStoreExport.java` (needs `java`, the same runtime that keytool needs).
 * - PKCS#12 bundles with a private key: the `openssl` CLI. It is the only operation that still
 *   needs it, because the Java KeyStore API lowercases the friendlyName and encodes non-ASCII
 *   passwords wrongly for the legacy PBE-SHA1-3DES key bag. node-forge cannot encode EC keys.
 *   OpenSSL 3 uses PBES2 with AES-256-CBC, PBKDF2-HMAC-SHA256 and a SHA-256 MAC by default.
 */

import { execFile, spawn } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// openssl reads export passwords from its environment (`-passout env:NAME`) so they
// never appear in argv or the process list.
const PASS_ENV = 'PKI_EXPORT_PASSWORD';
const withPassword = (password: string) => ({ env: { ...process.env, [PASS_ENV]: password } });

export interface Pkcs12Input {
  /** Leaf certificate (PEM). */
  certPem: string;
  /** Leaf private key (PKCS#8, PKCS#1 or SEC1 PEM), or null for a CA truststore. */
  privateKeyPem: string | null;
  /** Enable SHA-1 and 3DES for older clients. */
  legacy?: boolean;
  /** Optional CA chain certificates (PEM) to include. */
  chainPems?: string[];
  /** Bundle password (may be empty). */
  password: string;
  /** Optional friendlyName / alias for the key+cert entry (the trusted entry of a truststore). */
  friendlyName?: string;
}

export interface JavaKeyStoreInput {
  type: 'PKCS12' | 'JKS';
  /** PKCS#12 encryption profile (ignored for JKS). */
  legacy?: boolean;
  storePassword: string;
  /** Password of the private key entry. Defaults to the store password. */
  keyPassword?: string;
  /** Entry alias (Java stores it in lowercase). */
  alias: string;
  /** Private key PEM for a key entry, or null for trusted certificate entries only. */
  privateKeyPem: string | null;
  /** Key entry: the leaf first, then its chain (any order). Trust store: the trusted certificates. */
  certPems: string[];
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
const HELPER_CLASS = 'KeyStoreExport';

/**
 * The Docker image compiles the helper next to this module (`KeyStoreExport.class`). From
 * source (dev, tests) Java runs `KeyStoreExport.java` in source-file mode instead.
 */
function javaHelperArgs(): string[] {
  const fast = ['-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1'];
  if (existsSync(join(HELPER_DIR, `${HELPER_CLASS}.class`))) return [...fast, '-cp', HELPER_DIR, HELPER_CLASS];
  return [...fast, join(HELPER_DIR, `${HELPER_CLASS}.java`)];
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64');

/**
 * Write a PKCS#12 or JKS key store with the Java KeyStore API and return its bytes. Passwords,
 * the alias and the key go to the helper on stdin: never in argv or the environment.
 */
export function createJavaKeyStore(input: JavaKeyStoreInput): Promise<Buffer> {
  // Java's PBEWithSHA1AndDESede drops the high bit of each password byte (it is not the RFC 7292
  // BMPString), so OpenSSL and Windows could not decrypt the file. The earlier keytool flow
  // failed on such passwords too.
  const nonAscii = [...input.storePassword, ...(input.keyPassword ?? '')].some((c) => c.charCodeAt(0) > 0x7f);
  if (input.type === 'PKCS12' && input.legacy && nonAscii) {
    return Promise.reject(new Error('A legacy PKCS#12 trust store needs an ASCII password'));
  }
  let keyLine = '';
  if (input.privateKeyPem !== null) {
    const key = createPrivateKey(input.privateKeyPem);
    if (!new X509Certificate(input.certPems[0]).checkPrivateKey(key)) {
      return Promise.reject(new Error('The private key does not match the certificate'));
    }
    keyLine = b64(key.export({ type: 'pkcs8', format: 'der' }));
  }
  const stdin = [
    b64(input.storePassword),
    b64(input.keyPassword ?? input.storePassword),
    b64(input.alias),
    keyLine,
    input.certPems.join('\n'),
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = spawn('java', [...javaHelperArgs(), input.type, input.legacy ? 'legacy' : 'modern'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(out));
      const detail = Buffer.concat(err).toString('utf8').trim().split('\n')[0] ?? '';
      reject(new Error(`Java key store export failed (${signal ?? `exit ${code}`}): ${detail}`));
    });
    child.stdin.on('error', () => {}); // a dead child reports through 'close'
    child.stdin.end(stdin);
  });
}

/**
 * Build a PKCS#12 bundle (cert + private key + optional CA chain) and return its DER bytes.
 * Works for both RSA and ECDSA keys. With `privateKeyPem: null` it builds a Java truststore
 * (trustedCertEntry, readable by OpenSSL too).
 */
export async function createPkcs12Bundle(input: Pkcs12Input): Promise<Buffer> {
  if (input.privateKeyPem === null) {
    return createJavaKeyStore({
      type: 'PKCS12',
      legacy: input.legacy,
      storePassword: input.password,
      alias: input.friendlyName || 'ca',
      privateKeyPem: null,
      certPems: [input.certPem, ...(input.chainPems ?? [])],
    });
  }

  const dir = await mkdtemp(join(tmpdir(), 'p12-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    const outPath = join(dir, 'out.p12');
    await writeFile(certPath, input.certPem);
    await writeFile(keyPath, input.privateKeyPem);

    const args = [
      'pkcs12',
      '-export',
      '-in',
      certPath,
      '-inkey',
      keyPath,
      '-out',
      outPath,
      '-passout',
      `env:${PASS_ENV}`,
    ];
    if (input.legacy) {
      args.push('-legacy', '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1');
    }
    if (input.friendlyName) {
      args.push('-name', input.friendlyName);
    }
    if (input.chainPems && input.chainPems.length > 0) {
      const caPath = join(dir, 'ca.pem');
      await writeFile(caPath, input.chainPems.join('\n'));
      args.push('-certfile', caPath);
    }

    await execFileAsync('openssl', args, withPassword(input.password));
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Encrypt a private key PEM with a password and return an `-----BEGIN ENCRYPTED PRIVATE KEY-----`
 * PEM (PKCS#8, PBES2: AES-256-CBC with PBKDF2-HMAC-SHA256, the same as
 * `openssl pkcs8 -topk8 -v2 aes-256-cbc`). Uses Node crypto; works for RSA and EC keys.
 * An empty password is an error: Node would write a key that no password decrypts.
 */
export async function encryptPrivateKeyPem(privateKeyPem: string, password: string): Promise<string> {
  if (password.length === 0) throw new Error('A password is required to encrypt a private key');
  return createPrivateKey(privateKeyPem).export({
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: password,
  }) as string;
}
