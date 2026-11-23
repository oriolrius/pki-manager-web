/**
 * User-facing copy for the SSH principal screens (TASK-245 / TASK-248), kept
 * out of the component files so React fast refresh works and tests (and the
 * training-video script) can import the exact wording.
 */

/** Confirm copy for removing one mapping (TASK-245). Exported for tests and the video script. */
export function unmapConfirmCopy(principal: string, account: string) {
  return {
    title: `Remove mapping ${principal} → ${account}?`,
    description:
      `This host keeps accepting principal “${principal}” for login as “${account}” until the updated ` +
      'auth_principals files are deployed to it. Until then the host shows “Stale — needs push”.',
    confirmLabel: 'Remove mapping',
    tone: 'danger' as const,
  };
}

export const GRANTS_EXPLAINER =
  'Principals this identity may receive in its certificates. They are enforced when a certificate is issued with the entitlement check, and they feed the host Access list.';

/** Confirm copy for removing one grant. Exported for tests and the video script. */
export function revokeGrantConfirmCopy(principal: string, subject: string) {
  return {
    title: `Remove grant “${principal}” from ${subject}?`,
    description:
      `New certificates issued with the entitlement check can no longer carry “${principal}”. ` +
      'Certificates already issued keep it until they expire or are revoked.',
    confirmLabel: 'Remove grant',
    tone: 'danger' as const,
  };
}

/** TASK-248: the subtle per-row source tag (label + hover text). */
export const ACCESS_SOURCE: Record<'certificate' | 'grant' | 'both', { label: string; hint: string }> = {
  certificate: {
    label: 'certificate',
    hint: 'Holds a live certificate whose principals map to an account on this host.',
  },
  grant: {
    label: 'grant',
    hint: 'Granted a principal that maps to an account on this host. Needs a certificate with it to log in.',
  },
  both: {
    label: 'certificate + grant',
    hint: 'Holds a live certificate for this host and is granted its principal.',
  },
};
