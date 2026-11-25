/**
 * Key algorithm utilities and conversions
 */

import forge from 'node-forge';
import type { KeyAlgorithm, SignatureAlgorithm } from './types.js';

/**
 * Parse key algorithm string to get type and size
 */
export function parseKeyAlgorithm(algorithm: KeyAlgorithm): {
  type: 'RSA' | 'ECDSA';
  size: number;
  curve?: string;
} {
  switch (algorithm) {
    case 'RSA-2048':
      return { type: 'RSA', size: 2048 };
    case 'RSA-4096':
      return { type: 'RSA', size: 4096 };
    case 'ECDSA-P256':
      return { type: 'ECDSA', size: 256, curve: 'secp256r1' };
    case 'ECDSA-P384':
      return { type: 'ECDSA', size: 384, curve: 'secp384r1' };
    default:
      throw new Error(`Unsupported key algorithm: ${algorithm}`);
  }
}

/**
 * Get the default signature algorithm for a key algorithm
 */
export function getDefaultSignatureAlgorithm(keyAlgorithm: KeyAlgorithm): SignatureAlgorithm {
  const { type, size } = parseKeyAlgorithm(keyAlgorithm);

  if (type === 'RSA') {
    // Use SHA-256 for RSA-2048, SHA-384 for RSA-4096
    return size >= 4096 ? 'SHA384-RSA' : 'SHA256-RSA';
  } else {
    // ECDSA
    return size >= 384 ? 'SHA384-ECDSA' : 'SHA256-ECDSA';
  }
}

/**
 * Parse signature algorithm to get hash algorithm and key type
 */
export function parseSignatureAlgorithm(algorithm: SignatureAlgorithm): {
  hash: string;
  keyType: 'RSA' | 'ECDSA';
} {
  if (!algorithm || typeof algorithm !== 'string') {
    throw new Error(`Invalid signature algorithm: ${algorithm}`);
  }

  const parts = algorithm.split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid signature algorithm format: ${algorithm}`);
  }

  const hash = parts[0]; // e.g., 'SHA256'
  const keyType = parts[1] as 'RSA' | 'ECDSA';

  if (!hash || !keyType) {
    throw new Error(`Invalid signature algorithm components: ${algorithm}`);
  }

  return { hash, keyType };
}

/**
 * Get forge message digest algorithm name from signature algorithm
 */
export function getForgeDigestAlgorithm(signatureAlgorithm: SignatureAlgorithm): string {
  const { hash } = parseSignatureAlgorithm(signatureAlgorithm);
  return hash.toLowerCase(); // 'SHA256' -> 'sha256'
}

/**
 * Convert PEM key to forge key object
 */
export function pemToForgeKey(
  pem: string,
  type: 'private' | 'public',
): forge.pki.PrivateKey | forge.pki.PublicKey {
  try {
    if (type === 'private') {
      return forge.pki.privateKeyFromPem(pem);
    } else {
      return forge.pki.publicKeyFromPem(pem);
    }
  } catch (error) {
    throw new Error(
      `Failed to parse ${type} key from PEM: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Convert forge key to PEM string
 */
export function forgeKeyToPem(
  key: forge.pki.PrivateKey | forge.pki.PublicKey,
  type: 'private' | 'public',
): string {
  try {
    if (type === 'private') {
      return forge.pki.privateKeyToPem(key as forge.pki.PrivateKey);
    } else {
      return forge.pki.publicKeyToPem(key as forge.pki.PublicKey);
    }
  } catch (error) {
    throw new Error(
      `Failed to convert ${type} key to PEM: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Validate that a key matches the expected algorithm
 */
export function validateKeyAlgorithm(
  key: forge.pki.PrivateKey | forge.pki.PublicKey,
  expectedAlgorithm: KeyAlgorithm,
): boolean {
  const { type, size } = parseKeyAlgorithm(expectedAlgorithm);

  // Check if key is RSA
  const isRSA = 'n' in key && 'e' in key;

  if (type === 'RSA') {
    if (!isRSA) {
      return false;
    }
    // Check RSA key size
    const rsaKey = key as forge.pki.rsa.PrivateKey | forge.pki.rsa.PublicKey;
    const keySize = rsaKey.n.bitLength();
    return keySize === size;
  } else {
    // ECDSA validation would require additional checks
    // For now, just check it's not RSA
    return !isRSA;
  }
}

/**
 * Generate a random serial number: 20 bytes, 159 random bits.
 *
 * RFC 5280 4.1.2.2: the serial is a positive INTEGER of at most 20 octets. The
 * top bit of the first byte is cleared so the DER INTEGER is positive, and the
 * first byte is never 0 so the value keeps its 20 octets. A first byte of 0xff
 * followed by a byte >= 0x80 was a negative number that DER encodes with fewer
 * octets, so the parsed serial was not the generated one.
 */
export function generateSerialNumber(): string {
  const bytes = forge.random.getBytesSync(20);
  const first = (bytes.charCodeAt(0) & 0x7f) || 0x01;
  return forge.util.bytesToHex(String.fromCharCode(first) + bytes.slice(1));
}

/**
 * Convert serial number to forge format
 */
export function serialNumberToForge(serialNumber: string | number): string {
  if (typeof serialNumber === 'number') {
    return serialNumber.toString(16);
  }
  // Remove any colons or spaces
  return serialNumber.replace(/[:\s]/g, '');
}

/**
 * Validate serial number format
 */
export function validateSerialNumber(serialNumber: string | number): boolean {
  if (typeof serialNumber === 'number') {
    return serialNumber > 0;
  }
  // Check if it's a valid hex string
  return /^[0-9a-fA-F]+$/.test(serialNumber.replace(/[:\s]/g, ''));
}
