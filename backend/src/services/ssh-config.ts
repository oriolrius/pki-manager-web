/**
 * SSH config-snippet generators + input validation shared by the SSH services,
 * REST routes, and (via DTOs) the UI. The copy-paste snippet is the milestone's
 * central UX primitive (doc-006).
 *
 * This module is the SINGLE SOURCE OF TRUTH for every on-host path, filename, and
 * snippet string. Never hardcode '10-ssh-ca.conf', 'ssh_host_ed25519_key', or
 * 'id_ecdsa-cert.pub' anywhere else — derive from the canonical constants and the
 * algorithm-aware helpers below so the UI, REST downloads, and Ansible role can
 * never disagree (every artifact must be safe to paste verbatim).
 */
import type { SshKeyAlgo } from '../crypto/ssh/pubkey.js';

/** A printable, injection-safe grammar for principals and local account names. */
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._@-]{0,62})$/;
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

export function isValidPrincipalName(name: string): boolean {
  return NAME_RE.test(name);
}
export function isValidAccountName(name: string): boolean {
  return NAME_RE.test(name);
}
export function isValidHostId(host: string): boolean {
  return HOSTNAME_RE.test(host);
}

/** Validate a comma-separated list of IPv4/IPv6 CIDRs (for source-address). */
export function validateCidrList(value: string): { ok: boolean; bad?: string } {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, bad: '(empty)' };
  for (const p of parts) {
    if (!isCidr(p)) return { ok: false, bad: p };
  }
  return { ok: true };
}

function isCidr(s: string): boolean {
  const slash = s.lastIndexOf('/');
  if (slash < 0) return false;
  const addr = s.slice(0, slash);
  const prefix = Number(s.slice(slash + 1));
  if (!Number.isInteger(prefix)) return false;
  if (addr.includes(':')) {
    return prefix >= 0 && prefix <= 128 && isIpv6(addr);
  }
  return prefix >= 0 && prefix <= 32 && isIpv4(addr);
}
function isIpv4(a: string): boolean {
  const o = a.split('.');
  return o.length === 4 && o.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}
function isIpv6(a: string): boolean {
  // Accept a conservative IPv6 form (full or :: compressed).
  if (!/^[0-9a-fA-F:]+$/.test(a)) return false;
  const groups = a.split('::');
  if (groups.length > 2) return false;
  const all = a.replace('::', ':').split(':').filter(Boolean);
  return all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

// ── Canonical on-host paths (ONE agreed value per artifact) ─────────────────
/** The sshd drop-in filename, used everywhere (UI, REST download, Ansible). */
export const SSHD_DROPIN_FILENAME = '60-ssh-ca.conf';
/** Full path of the sshd drop-in. */
export const SSHD_DROPIN_PATH = `/etc/ssh/sshd_config.d/${SSHD_DROPIN_FILENAME}`;
/** Where each server installs the User CA public key (TrustedUserCAKeys). */
export const USER_CA_PATH = '/etc/ssh/ssh-user-ca.pub';
/** Where sshd reads the bare KRL (RevokedKeys). */
export const REVOKED_KEYS_PATH = '/etc/ssh/revoked_keys';
/** AuthorizedPrincipalsFile pattern (per local account via %u). */
export const AUTH_PRINCIPALS_PATTERN = '/etc/ssh/auth_principals/%u';

/** Short OpenSSH key-type token used in default key filenames. */
export function keyTypeToken(algo: SshKeyAlgo): 'ed25519' | 'ecdsa' {
  return algo === 'ecdsa-sha2-nistp256' ? 'ecdsa' : 'ed25519';
}
/** Default host private-key path for an algorithm, e.g. /etc/ssh/ssh_host_ed25519_key. */
export function hostKeyPathFor(algo: SshKeyAlgo): string {
  return `/etc/ssh/ssh_host_${keyTypeToken(algo)}_key`;
}
/** Host certificate filename for an algorithm, e.g. ssh_host_ed25519_key-cert.pub. */
export function hostCertFilename(algo: SshKeyAlgo): string {
  return `ssh_host_${keyTypeToken(algo)}_key-cert.pub`;
}
/** Default user private-key path for an algorithm, e.g. ~/.ssh/id_ed25519. */
export function userIdentityPathFor(algo: SshKeyAlgo): string {
  return `~/.ssh/id_${keyTypeToken(algo)}`;
}
/** Filename the user saves their signed cert as, e.g. id_ed25519-cert.pub. */
export function userCertFilename(algo: SshKeyAlgo): string {
  return `id_${keyTypeToken(algo)}-cert.pub`;
}

/** sshd_config drop-in presenting a host cert + trusting the User CA. */
export function sshdConfigDropIn(opts?: {
  hostKeyAlgorithm?: SshKeyAlgo;
  hostKeyPath?: string;
  certPath?: string;
  userCaPath?: string;
  authPrincipalsPath?: string;
  revokedKeysPath?: string;
}): string {
  const algo = opts?.hostKeyAlgorithm ?? 'ssh-ed25519';
  const hostKey = opts?.hostKeyPath ?? hostKeyPathFor(algo);
  const cert = opts?.certPath ?? `${hostKey}-cert.pub`;
  const userCa = opts?.userCaPath ?? USER_CA_PATH;
  const authPrincipals = opts?.authPrincipalsPath ?? AUTH_PRINCIPALS_PATTERN;
  const revoked = opts?.revokedKeysPath ?? REVOKED_KEYS_PATH;
  return [
    `# ${SSHD_DROPIN_PATH} — managed by PKI Manager`,
    `HostKey ${hostKey}`,
    `HostCertificate ${cert}`,
    `TrustedUserCAKeys ${userCa}`,
    `AuthorizedPrincipalsFile ${authPrincipals}`,
    `RevokedKeys ${revoked}`,
    '',
  ].join('\n');
}

/** A known_hosts @cert-authority line trusting a Host CA for a pattern. */
export function certAuthorityLine(hostCaPublicKey: string, pattern: string): string {
  return `@cert-authority ${pattern} ${hostCaPublicKey.trim()}`;
}

/** A ~/.ssh/config block selecting a user key + its certificate. */
export function sshClientConfig(opts: { hostPattern: string; identityFile?: string; keyAlgorithm?: SshKeyAlgo }): string {
  const id = opts.identityFile ?? userIdentityPathFor(opts.keyAlgorithm ?? 'ssh-ed25519');
  return [
    `Host ${opts.hostPattern}`,
    `  IdentityFile ${id}`,
    `  CertificateFile ${id}-cert.pub`,
    '  IdentitiesOnly yes',
    '',
  ].join('\n');
}
