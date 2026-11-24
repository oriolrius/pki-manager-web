/**
 * Fleet-token helpers (TASK-244): op catalogue, presets and the client-side
 * mirror of the backend mint rules (SshFleetTokenService.mint). The backend
 * stays the authority; this only gives instant feedback.
 */
export type SshTokenOp = 'sign-host' | 'sign-user' | 'register-host-pubkey' | 'get-principals';

export const TOKEN_OPS: { op: SshTokenOp; help: string }[] = [
  { op: 'sign-host', help: 'Sign the host’s own SSH host key with the Host CA. Needs a Host CA.' },
  {
    op: 'register-host-pubkey',
    help: 'Register the host’s ECDSA key so it can decrypt the KRL (live revocation). Needs a Host CA.',
  },
  { op: 'get-principals', help: 'Read the host’s AuthorizedPrincipals mapping (who may log in as which account).' },
  { op: 'sign-user', help: 'Sign SSH user certificates with the User CA (CI pipelines). Needs a User CA.' },
];

export const TOKEN_PRESETS: { id: string; label: string; ops: SshTokenOp[]; help: string }[] = [
  {
    id: 'host',
    label: 'Self-provisioning host (no KRL)',
    ops: ['sign-host', 'get-principals'],
    help: 'The host signs its own key and reads its principals. No live revocation.',
  },
  {
    id: 'host-krl',
    label: 'Self-provisioning host with KRL (recommended)',
    ops: ['sign-host', 'get-principals', 'register-host-pubkey'],
    help: 'Same as above, plus the host registers its key so revocations reach it.',
  },
  {
    id: 'ci-user',
    label: 'CI user certs',
    ops: ['sign-user'],
    help: 'A pipeline requests short-lived SSH user certificates.',
  },
];

export const needsHostCa = (ops: SshTokenOp[]) => ops.includes('sign-host') || ops.includes('register-host-pubkey');
export const needsUserCa = (ops: SshTokenOp[]) => ops.includes('sign-user');

/** Returns the first blocking problem, or null when the form can be submitted. */
export function validateMint(input: {
  name: string;
  ops: SshTokenOp[];
  hostCaId: string;
  userCaId: string;
}): string | null {
  if (!input.name.trim()) return 'Give the token a name.';
  if (input.ops.length === 0) return 'Select at least one operation.';
  if (needsUserCa(input.ops) && !input.userCaId) return 'sign-user needs a User CA.';
  if (needsHostCa(input.ops) && !input.hostCaId) return 'sign-host and register-host-pubkey need a Host CA.';
  return null;
}

// ---- sign-user limits (TASK-247) ----

/** Suggested max certificate lifetime for a CI token: 15 minutes. */
export const DEFAULT_CI_MAX_LIFETIME = 900;

export const LIFETIME_PRESETS: { seconds: number; label: string }[] = [
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes (suggested for CI)' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 8 * 3600, label: '8 hours' },
  { seconds: 24 * 3600, label: '1 day' },
  { seconds: 7 * 24 * 3600, label: '1 week' },
];

export const UNRESTRICTED_WARNING =
  'No limits: this token can sign any principal, for any lifetime, in its zone. If it leaks, it opens every host of the zone.';

export const UNRESTRICTED_HINT =
  'This token can sign any principal with any lifetime in its zone. Mint a limited token and revoke this one.';

/** "15 min", "8 h", "1 d", "90 s" — compact lifetime for the table. */
export function formatLifetime(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** A sign-user token minted without any limit (all tokens minted before TASK-247). */
export function isUnrestrictedSignUser(t: {
  opSet: string[];
  allowedPrincipals?: string[] | null;
  maxValidForSeconds?: number | null;
}): boolean {
  return t.opSet.includes('sign-user') && !t.allowedPrincipals?.length && t.maxValidForSeconds == null;
}
