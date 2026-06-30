/**
 * Frontend mirror of the canonical SSH key-type → filename helpers in
 * backend/src/services/ssh-config.ts. These are stable OpenSSH naming
 * conventions; the backend remains the source of truth for the host deploy
 * bundle, while these cover the small client-only derivations on the user-cert
 * issuance handoff screen (where the filename depends on the pasted key type).
 */
export type SshKeyType = 'ssh-ed25519' | 'ecdsa-sha2-nistp256';

/** Short OpenSSH key-type token used in default key filenames. */
export function keyTypeToken(algo: SshKeyType): 'ed25519' | 'ecdsa' {
  return algo === 'ecdsa-sha2-nistp256' ? 'ecdsa' : 'ed25519';
}

/** Filename the user saves their signed cert as, e.g. id_ed25519-cert.pub. */
export function userCertFilename(algo: SshKeyType): string {
  return `id_${keyTypeToken(algo)}-cert.pub`;
}

/** Default user private-key path for an algorithm, e.g. ~/.ssh/id_ed25519. */
export function userIdentityPath(algo: SshKeyType): string {
  return `~/.ssh/id_${keyTypeToken(algo)}`;
}

/** A known_hosts @cert-authority line trusting a Host CA for a pattern. */
export function certAuthorityLine(hostCaKey: string, pattern: string): string {
  return `@cert-authority ${pattern} ${hostCaKey.trim()}`;
}
