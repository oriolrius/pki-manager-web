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

import { createPkcs12Bundle } from '../crypto/pkcs12.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

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
        ? 'Failed to convert to JKS format. Ensure Java keytool is available on the server.'
        : 'Failed to create JKS truststore. Ensure Java keytool is available on the server.'
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
  /** Password for the JKS file (minimum 6 chars, defaults to 'changeit') */
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
  /** Password for the JKS file (minimum 6 chars, defaults to 'changeit') */
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
 * @throws JKSKeytoolError if keytool conversion fails
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

  // Create PKCS#12 as intermediate format (certificate + private key + CA chain).
  // Uses openssl so EC keys are supported (node-forge cannot encode them).
  const p12Buffer = await createPkcs12Bundle({
    certPem: certificatePem,
    privateKeyPem,
    chainPems: [caCertificatePem],
    password: password || '',
    friendlyName: alias || commonName,
  });

  // Create temp directory for keytool operations
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jks-keystore-'));
  const p12Path = path.join(tempDir, 'temp.p12');
  const jksPath = path.join(tempDir, 'keystore.jks');

  try {
    await fs.writeFile(p12Path, p12Buffer);

    // JKS requires a password (minimum 6 characters)
    // If no password provided, use a default one
    const jksPassword = password || 'changeit';
    const srcPassword = password || '';

    // Import the certificate with its private key from PKCS#12
    const keytoolCmd = `keytool -importkeystore -srckeystore "${p12Path}" -srcstoretype PKCS12 -srcstorepass "${srcPassword}" -destkeystore "${jksPath}" -deststoretype JKS -deststorepass "${jksPassword}" -noprompt 2>&1`;

    try {
      await execAsync(keytoolCmd);
    } catch (keytoolError: any) {
      throw new JKSKeytoolError('keystore');
    }

    // Read the JKS file
    const jksBuffer = await fs.readFile(jksPath);

    return {
      data: jksBuffer.toString('base64'),
      mimeType: 'application/x-java-keystore',
      filename: `${commonName}-${serialShort}-keystore.jks`,
    };
  } finally {
    // Clean up temp files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate a JKS Truststore containing only CA certificate(s)
 *
 * @param input - The truststore input parameters
 * @returns JKS result with base64-encoded data
 * @throws JKSKeytoolError if keytool import fails
 */
export async function generateJKSTruststore(input: JKSTruststoreInput): Promise<JKSResult> {
  const { caCertificatePem, caSubjectDn, password, commonName, serialShort } = input;

  // Create temp directory for keytool operations
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jks-truststore-'));
  const jksPath = path.join(tempDir, 'truststore.jks');
  const caCertPath = path.join(tempDir, 'ca.pem');

  try {
    await fs.writeFile(caCertPath, caCertificatePem);

    // JKS requires a password (minimum 6 characters)
    const jksPassword = password || 'changeit';

    // Extract CA CN for alias
    const caCnMatch = caSubjectDn.match(/CN=([^,]+)/);
    const caCn = caCnMatch ? caCnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'ca';
    const caAlias = `ca-${caCn}`.toLowerCase();

    // Import CA certificate as trusted certificate entry
    // Note: -storetype JKS is required since Java 9+ defaults to PKCS#12
    const importCaCmd = `keytool -importcert -alias "${caAlias}" -file "${caCertPath}" -keystore "${jksPath}" -storetype JKS -storepass "${jksPassword}" -noprompt 2>&1`;

    try {
      await execAsync(importCaCmd);
    } catch (keytoolError: any) {
      throw new JKSKeytoolError('truststore');
    }

    // Read the JKS file
    const jksBuffer = await fs.readFile(jksPath);

    return {
      data: jksBuffer.toString('base64'),
      mimeType: 'application/x-java-keystore',
      filename: `${commonName}-${serialShort}-truststore.jks`,
    };
  } finally {
    // Clean up temp files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
