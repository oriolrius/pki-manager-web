/**
 * JKS (Java KeyStore) Service
 *
 * Shared service for generating JKS keystores and truststores.
 * Used by both tRPC and REST API layers.
 *
 * JKS Keystore: Contains certificate + private key (PrivateKeyEntry)
 * - Used when an application needs to present its own identity (e.g., server SSL, client auth)
 *
 * JKS Truststore: Contains CA certificates only (TrustedCertEntry)
 * - Used when an application needs to verify certificates signed by a CA
 */

import { createJavaKeyStore } from '../crypto/pkcs12.js';
import { execFile } from 'node:child_process';

/**
 * Runs keytool without a shell, so no argument (password, alias, path) is ever
 * parsed as shell syntax. Pass passwords as `-storepass:env NAME` with the value
 * in `secrets`: they reach keytool through its environment and never appear in
 * argv or the process list. stdin is closed so a missing password fails instead
 * of waiting on an interactive prompt. Used by the multi-entry bulk JKS downloads.
 */
export function runKeytool(args: string[], secrets: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'keytool',
      args,
      { env: { ...process.env, ...secrets }, timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin?.end();
  });
}

// Custom error classes for JKS operations
export class JKSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JKSError';
  }
}

export class JKSNoPrivateKeyError extends JKSError {
  constructor() {
    super('Certificate does not have a private key. JKS Keystore requires a private key.');
    this.name = 'JKSNoPrivateKeyError';
  }
}

export class JKSKeytoolError extends JKSError {
  constructor(operation: 'keystore' | 'truststore') {
    super(
      operation === 'keystore'
        ? 'Failed to convert to JKS format. Ensure Java is available on the server.'
        : 'Failed to create JKS truststore. Ensure Java is available on the server.'
    );
    this.name = 'JKSKeytoolError';
  }
}

// Input types for JKS generation
export interface JKSKeystoreInput {
  /** Certificate PEM content */
  certificatePem: string;
  /** Private key PEM content */
  privateKeyPem: string;
  /** CA certificate PEM content (for chain) */
  caCertificatePem: string;
  /** Store password (defaults to 'changeit'); the key entry password (defaults to empty) */
  password?: string;
  /** Friendly name/alias for the certificate entry */
  alias?: string;
  /** Common name from certificate (for filename) */
  commonName: string;
  /** Serial number short (for filename) */
  serialShort: string;
}

export interface JKSTruststoreInput {
  /** CA certificate PEM content */
  caCertificatePem: string;
  /** CA subject DN (to extract CN for alias) */
  caSubjectDn: string;
  /** Store password (defaults to 'changeit') */
  password?: string;
  /** Common name from certificate (for filename) */
  commonName: string;
  /** Serial number short (for filename) */
  serialShort: string;
}

export interface JKSResult {
  /** Base64-encoded JKS data */
  data: string;
  /** MIME type */
  mimeType: string;
  /** Suggested filename */
  filename: string;
}

/**
 * Generate a JKS Keystore containing certificate + private key + CA chain
 *
 * @param input - The keystore input parameters
 * @returns JKS result with base64-encoded data
 * @throws JKSKeytoolError if Java cannot write the key store
 */
export async function generateJKSKeystore(input: JKSKeystoreInput): Promise<JKSResult> {
  const {
    certificatePem,
    privateKeyPem,
    caCertificatePem,
    password,
    alias,
    commonName,
    serialShort,
  } = input;

  // One Java KeyStore API call (RSA and EC). Without a password the store password is
  // 'changeit' and the key entry password is empty, as the earlier keytool conversion made it.
  let jksBuffer: Buffer;
  try {
    jksBuffer = await createJavaKeyStore({
      type: 'JKS',
      storePassword: password || 'changeit',
      keyPassword: password || '',
      alias: alias || commonName,
      privateKeyPem,
      certPems: [certificatePem, caCertificatePem],
    });
  } catch {
    throw new JKSKeytoolError('keystore');
  }

  return {
    data: jksBuffer.toString('base64'),
    mimeType: 'application/x-java-keystore',
    filename: `${commonName}-${serialShort}-keystore.jks`,
  };
}

/**
 * Generate a JKS Truststore containing only CA certificate(s)
 *
 * @param input - The truststore input parameters
 * @returns JKS result with base64-encoded data
 * @throws JKSKeytoolError if Java cannot write the key store
 */
export async function generateJKSTruststore(input: JKSTruststoreInput): Promise<JKSResult> {
  const { caCertificatePem, caSubjectDn, password, commonName, serialShort } = input;

  // Extract CA CN for alias
  const caCnMatch = caSubjectDn.match(/CN=([^,]+)/);
  const caCn = caCnMatch ? caCnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'ca';
  const caAlias = `ca-${caCn}`.toLowerCase();

  // CA certificate as a trusted certificate entry
  let jksBuffer: Buffer;
  try {
    jksBuffer = await createJavaKeyStore({
      type: 'JKS',
      storePassword: password || 'changeit',
      alias: caAlias,
      privateKeyPem: null,
      certPems: [caCertificatePem],
    });
  } catch {
    throw new JKSKeytoolError('truststore');
  }

  return {
    data: jksBuffer.toString('base64'),
    mimeType: 'application/x-java-keystore',
    filename: `${commonName}-${serialShort}-truststore.jks`,
  };
}
