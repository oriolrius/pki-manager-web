/**
 * Certificate validation utilities
 */

/**
 * Validate a domain name (FQDN)
 * Supports wildcards in the first label only
 */
export function validateDomainName(domain: string): { valid: boolean; error?: string } {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Domain name is required' };
  }

  // Trim whitespace
  domain = domain.trim();

  if (domain.length === 0) {
    return { valid: false, error: 'Domain name cannot be empty' };
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
 * Validate an IPv4 address
 */
export function validateIPv4(ip: string): { valid: boolean; error?: string } {
  if (!ip || typeof ip !== 'string') {
    return { valid: false, error: 'IP address is required' };
  }

  ip = ip.trim();

  // IPv4 regex pattern
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Pattern);

  if (!match) {
    return { valid: false, error: 'Invalid IPv4 address format' };
  }

  // Validate each octet
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (octet < 0 || octet > 255) {
      return { valid: false, error: `IPv4 octet out of range: ${octet}` };
    }
  }

  return { valid: true };
}

/**
 * Validate an IPv6 address
 */
export function validateIPv6(ip: string): { valid: boolean; error?: string } {
  if (!ip || typeof ip !== 'string') {
    return { valid: false, error: 'IP address is required' };
  }

  ip = ip.trim();

  // IPv6 regex pattern (simplified, covers most cases)
  const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  if (!ipv6Pattern.test(ip)) {
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
