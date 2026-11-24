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
