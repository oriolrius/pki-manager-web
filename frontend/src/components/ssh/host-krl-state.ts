/**
 * Per-host KRL distribution state presentation (BLK-09, decision-016).
 * Pure helpers so the pill derivation is unit-testable. The admin never sees
 * serials, fingerprints, or KRL mechanics — only these four states and the
 * honest tooltip.
 */

export interface HostKrlStateInfo {
  state: 'effective' | 'pending' | 'lifting' | 'unknown';
  unsignedLatest: boolean;
  servedAt: string | null;
}

export function stateLabel(state: HostKrlStateInfo['state']): string {
  switch (state) {
    case 'effective':
      return 'Effective';
    case 'pending':
      return 'Pending';
    case 'lifting':
      return 'Lifting';
    case 'unknown':
      return 'Unknown';
  }
}

/** Green Effective / yellow Pending + Lifting / gray Unknown (STATUS_STYLES palette). */
export function statePillClasses(state: HostKrlStateInfo['state']): string {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';
  switch (state) {
    case 'effective':
      return `${base} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`;
    case 'pending':
    case 'lifting':
      return `${base} bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`;
    case 'unknown':
      return `${base} bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200`;
  }
}

/** Pinned honest copy: Effective ≠ verified install; Unknown = unenforceable. */
export function stateTooltip(info: HostKrlStateInfo): string {
  if (info.state === 'unknown') {
    return 'Unknown (public fetch) — this host has no usable encrypted-KRL registration; blocks cannot land via this channel.';
  }
  const served = info.servedAt ? new Date(info.servedAt).toLocaleString() : 'never';
  let tip = `served to host puller at ${served} — not confirmation of install`;
  if (info.unsignedLatest) {
    tip += '. Latest KRL is UNSIGNED (KMS signing failed): krl-client hosts keep their last-good KRL until a signed one lands.';
  }
  return tip;
}
