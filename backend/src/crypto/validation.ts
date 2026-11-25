/**
 * Certificate validation utilities
 */
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Validate a domain name (FQDN)
 * Supports wildcards in the first label only.
 *
 * The value is checked as given: the callers put it in the certificate without
 * a change, so a value with a space or a line break at an end is refused.
 */
export function validateDomainName(domain: string): { valid: boolean; error?: string } {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Domain name is required' };
  }

  if (domain !== domain.trim()) {
    return { valid: false, error: 'Domain name must not start or end with whitespace' };
  }

  if (domain.length > 253) {
    return { valid: false, error: 'Domain name exceeds maximum length of 253 characters' };
  }

  // Check for wildcard
  const isWildcard = domain.startsWith('*.');
  if (isWildcard) {
    // Wildcard can only be in the first label
    domain = domain.substring(2);
    if (domain.includes('*')) {
      return { valid: false, error: 'Wildcard (*) can only appear at the beginning' };
    }
  }

  // Split into labels
  const labels = domain.split('.');

  // Must have at least 2 labels (e.g., example.com)
  if (labels.length < 2) {
    return { valid: false, error: 'Domain name must have at least two labels' };
  }

  // Validate each label
  for (const label of labels) {
    if (label.length === 0) {
      return { valid: false, error: 'Domain label cannot be empty' };
    }

    if (label.length > 63) {
      return { valid: false, error: 'Domain label exceeds maximum length of 63 characters' };
    }

    // Label must start and end with alphanumeric
    if (!/^[a-zA-Z0-9]/.test(label)) {
      return { valid: false, error: `Domain label '${label}' must start with alphanumeric character` };
    }

    if (!/[a-zA-Z0-9]$/.test(label)) {
      return { valid: false, error: `Domain label '${label}' must end with alphanumeric character` };
    }

    // Label can contain alphanumeric and hyphens
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      return { valid: false, error: `Domain label '${label}' contains invalid characters` };
    }
  }

  return { valid: true };
}

/**
 * Validate an IPv4 address: four decimal numbers from 0 to 255, with no leading
 * zero ("010.0.0.1" is octal for some parsers) and no whitespace.
 */
export function validateIPv4(ip: string): { valid: boolean; error?: string } {
  if (!ip || typeof ip !== 'string') {
    return { valid: false, error: 'IP address is required' };
  }

  if (!isIPv4(ip)) {
    return { valid: false, error: 'Invalid IPv4 address format' };
  }

  return { valid: true };
}

/**
 * Validate an IPv6 address. A zone identifier ("fe80::1%eth0") is refused: it
 * has a meaning only on one host, and a certificate cannot carry it.
 */
export function validateIPv6(ip: string): { valid: boolean; error?: string } {
  if (!ip || typeof ip !== 'string') {
    return { valid: false, error: 'IP address is required' };
  }

  if (!isIPv6(ip) || ip.includes('%')) {
    return { valid: false, error: 'Invalid IPv6 address format' };
  }

  return { valid: true };
}

/**
 * Validate an IP address (either IPv4 or IPv6)
 */
export function validateIPAddress(ip: string): { valid: boolean; error?: string; version?: 4 | 6 } {
  // Try IPv4 first
  const ipv4Result = validateIPv4(ip);
  if (ipv4Result.valid) {
    return { valid: true, version: 4 };
  }

  // Try IPv6
  const ipv6Result = validateIPv6(ip);
  if (ipv6Result.valid) {
    return { valid: true, version: 6 };
  }

  return { valid: false, error: 'Invalid IP address (neither IPv4 nor IPv6)' };
}

/**
 * Validate Subject Alternative Names for server certificates
 */
export function validateServerSANs(sanDns?: string[], sanIp?: string[]): {
  valid: boolean;
  errors: string[]
} {
  const errors: string[] = [];

  // Validate DNS names
  if (sanDns && Array.isArray(sanDns)) {
    if (sanDns.length === 0) {
      // Having an empty array is ok, but if provided should have values
    } else {
      for (const dns of sanDns) {
        const result = validateDomainName(dns);
        if (!result.valid) {
          errors.push(`Invalid SAN DNS name '${dns}': ${result.error}`);
        }
      }
    }
  }

  // Validate IP addresses
  if (sanIp && Array.isArray(sanIp)) {
    if (sanIp.length === 0) {
      // Having an empty array is ok
    } else {
      for (const ip of sanIp) {
        const result = validateIPAddress(ip);
        if (!result.valid) {
          errors.push(`Invalid SAN IP address '${ip}': ${result.error}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate certificate validity period
 */
export function validateCertificateValidity(
  validityDays: number,
  maxDays: number = 825
): { valid: boolean; error?: string } {
  if (typeof validityDays !== 'number' || isNaN(validityDays)) {
    return { valid: false, error: 'Validity days must be a number' };
  }

  if (validityDays < 1) {
    return { valid: false, error: 'Validity days must be at least 1' };
  }

  if (validityDays > maxDays) {
    return { valid: false, error: `Validity days cannot exceed ${maxDays} days` };
  }

  return { valid: true };
}

/** Client certificates accept a local part and a domain with an interior dot. */
export function isClientCertificateEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const dot = value.indexOf('.', at + 2);
  return dot !== -1 && dot < value.length - 1;
}
