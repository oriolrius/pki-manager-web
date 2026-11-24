import { isOIDCEnabled } from './oidc.js';

/** Error code returned (HTTP 403) when CA private-key export is switched off. */
export const CA_KEY_EXPORT_DISABLED = 'CA_KEY_EXPORT_DISABLED';
/** Error code returned (HTTP 403) when the caller is not an admin. */
export const CA_KEY_EXPORT_ADMIN_REQUIRED = 'CA_KEY_EXPORT_ADMIN_REQUIRED';

/** CA download formats that contain the CA private key. */
export const CA_KEYSTORE_FORMATS = ['p12-keystore', 'jks-keystore'] as const;

export function isCAKeyExportFormat(format: string): boolean {
  return (CA_KEYSTORE_FORMATS as readonly string[]).includes(format);
}

/**
 * ALLOW_CA_KEY_EXPORT (default false): when true, an admin may download a CA as a
 * keystore that contains its private key. Read at call time so tests can toggle it.
 */
export function isCAKeyExportEnabled(): boolean {
  return (process.env.ALLOW_CA_KEY_EXPORT ?? '').trim().toLowerCase() === 'true';
}

export type CAKeyExportDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/**
 * Decide whether a caller may export a CA private key.
 * Roles are only checked when OIDC is enabled (same rule as adminProcedure).
 */
export function decideCAKeyExport(user: { roles?: string[] } | undefined | null): CAKeyExportDecision {
  if (!isCAKeyExportEnabled()) {
    return {
      allowed: false,
      code: CA_KEY_EXPORT_DISABLED,
      message:
        'CA private key export is disabled. Set ALLOW_CA_KEY_EXPORT=true on the server to let an admin export CA keystores.',
    };
  }
  if (isOIDCEnabled() && !user?.roles?.includes('admin')) {
    return {
      allowed: false,
      code: CA_KEY_EXPORT_ADMIN_REQUIRED,
      message: 'Admin role required to export a CA private key.',
    };
  }
  return { allowed: true };
}
