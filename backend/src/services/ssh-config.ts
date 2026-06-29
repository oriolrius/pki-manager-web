/**
 * SSH config-snippet generators + input validation shared by the SSH services,
 * REST routes, and (via DTOs) the UI. The copy-paste snippet is the milestone's
 * central UX primitive (doc-006).
 */

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

/** sshd_config drop-in presenting a host cert + trusting the User CA. */
export function sshdConfigDropIn(opts?: {
  hostKeyPath?: string;
  certPath?: string;
  userCaPath?: string;
  authPrincipalsPath?: string;
  revokedKeysPath?: string;
}): string {
  const hostKey = opts?.hostKeyPath ?? '/etc/ssh/ssh_host_ed25519_key';
  const cert = opts?.certPath ?? '/etc/ssh/ssh_host_ed25519_key-cert.pub';
  const userCa = opts?.userCaPath ?? '/etc/ssh/ssh-user-ca.pub';
  const authPrincipals = opts?.authPrincipalsPath ?? '/etc/ssh/auth_principals/%u';
  const revoked = opts?.revokedKeysPath ?? '/etc/ssh/revoked_keys';
  return [
    '# /etc/ssh/sshd_config.d/10-ssh-ca.conf — managed by PKI Manager',
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
export function sshClientConfig(opts: { hostPattern: string; identityFile?: string }): string {
  const id = opts.identityFile ?? '~/.ssh/id_ed25519';
  return [
    `Host ${opts.hostPattern}`,
    `  IdentityFile ${id}`,
    `  CertificateFile ${id}-cert.pub`,
    '  IdentitiesOnly yes',
    '',
  ].join('\n');
}
