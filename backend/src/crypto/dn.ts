/**
 * Distinguished Name (DN) parsing and formatting utilities
 */

import forge from 'node-forge';
import type { DistinguishedName } from './types.js';

/**
 * DN attribute OIDs (Object Identifiers)
 */
const DN_OID_MAP: Record<string, string> = {
  CN: '2.5.4.3',
  O: '2.5.4.10',
  OU: '2.5.4.11',
  C: '2.5.4.6',
  ST: '2.5.4.8',
  L: '2.5.4.7',
  E: '1.2.840.113549.1.9.1', // Email address
};

/**
 * Reverse mapping: OID to short name
 */
const OID_TO_SHORT_NAME: Record<string, string> = Object.entries(DN_OID_MAP).reduce(
  (acc, [key, value]) => {
    acc[value] = key;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Convert DistinguishedName object to node-forge attributes array
 */
export function dnToForgeAttributes(dn: DistinguishedName): forge.pki.CertificateField[] {
  const attributes: forge.pki.CertificateField[] = [];

  // Order matters for DN: CN, OU, O, L, ST, C, E
  const orderedKeys: Array<keyof DistinguishedName> = ['CN', 'OU', 'O', 'L', 'ST', 'C', 'E'];

  for (const key of orderedKeys) {
    const value = dn[key];
    if (value) {
      attributes.push({
        name: key,
        value: value,
        shortName: key,
        type: DN_OID_MAP[key], // Add OID type
      });
    }
  }

  return attributes;
}

/**
 * Convert node-forge attributes array to DistinguishedName object
 */
export function forgeAttributesToDn(
  attributes: forge.pki.CertificateField[],
): DistinguishedName {
  const dn: DistinguishedName = {};

  for (const attr of attributes) {
    const shortName = attr.shortName || OID_TO_SHORT_NAME[attr.type || ''];
    if (shortName && attr.value) {
      // attr.value can be string or any[], convert to string if needed
      const value = Array.isArray(attr.value) ? attr.value.join(',') : attr.value;
      dn[shortName as keyof DistinguishedName] = value;
    }
  }

  return dn;
}

/**
 * Format DN as a string (RFC 2253 format)
 * Example: "CN=example.com,O=Example Org,C=US"
 */
export function formatDN(dn: DistinguishedName): string {
  const parts: string[] = [];

  // Order: CN, OU, O, L, ST, C, E
  const orderedKeys: Array<keyof DistinguishedName> = ['CN', 'OU', 'O', 'L', 'ST', 'C', 'E'];

  for (const key of orderedKeys) {
    const value = dn[key];
    if (value) {
      // Escape special characters per RFC 2253
      const escapedValue = value.replace(/([,+"\\<>;])/g, '\\$1');
      parts.push(`${key}=${escapedValue}`);
    }
  }

  return parts.join(',');
}

/**
 * Parse DN string (RFC 2253 format) to DistinguishedName object
 * Example: "CN=example.com,O=Example Org,C=US"
 */
export function parseDN(dnString: string): DistinguishedName {
  const dn: DistinguishedName = {};

  // Split by comma, but respect escaped commas
  const parts = dnString.split(/(?<!\\),/);

  for (const part of parts) {
    const trimmed = part.trim();
    const equalIndex = trimmed.indexOf('=');

    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, equalIndex).trim().toUpperCase();
    let value = trimmed.substring(equalIndex + 1).trim();

    // Unescape special characters
    value = value.replace(/\\([,+"\\<>;])/g, '$1');

    if (key in DN_OID_MAP) {
      dn[key as keyof DistinguishedName] = value;
    }
  }

  return dn;
}

/**
 * Validate Distinguished Name
 */
export function validateDN(dn: DistinguishedName): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // CN is required
  if (!dn.CN || dn.CN.trim() === '') {
    errors.push('Common Name (CN) is required');
  }

  // Country code must be 2 characters
  if (dn.C && dn.C.length !== 2) {
    errors.push('Country (C) must be a 2-letter code');
  }

  // Check for empty values
  for (const [key, value] of Object.entries(dn)) {
    if (value && typeof value === 'string' && value.trim() === '') {
      errors.push(`${key} cannot be empty`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if two DNs are equal
 */
export function isDNEqual(dn1: DistinguishedName, dn2: DistinguishedName): boolean {
  const keys1 = Object.keys(dn1).sort();
  const keys2 = Object.keys(dn2).sort();

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) {
      return false;
    }

    const key = keys1[i] as keyof DistinguishedName;
    if (dn1[key] !== dn2[key]) {
      return false;
    }
  }

  return true;
}

/**
 * Create a simple DN with just a Common Name
 */
export function createSimpleDN(commonName: string): DistinguishedName {
  return { CN: commonName };
}

/**
 * Clone a DN object
 */
export function cloneDN(dn: DistinguishedName): DistinguishedName {
  return { ...dn };
}
