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
      return 'Enforced';
    case 'pending':
      return 'Rolling out';
    case 'lifting':
      return 'Clearing';
    case 'unknown':
      return 'Not enforced';
  }
}

/** Traffic-light palette: green Enforced / amber in-flight (Rolling out, Clearing) /
 *  red Not enforced — a block on a public-fetch host silently does nothing. */
export function statePillClasses(state: HostKrlStateInfo['state']): string {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';
  switch (state) {
    case 'effective':
      return `${base} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`;
    case 'pending':
    case 'lifting':
      return `${base} bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200`;
    case 'unknown':
      return `${base} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`;
  }
}

/** Plain-language tooltips. Keeps decision-016's honesty (delivery to the host is
 *  confirmed, the final on-disk install is not) without the KRL jargon. */
export function stateTooltip(info: HostKrlStateInfo): string {
  if (info.state === 'unknown') {
    return 'Not enforced — this host reads the shared public revocation list, not its own per-host list, so a block placed here cannot take effect. Move the host to its per-host (encrypted) channel to enforce blocks on it.';
  }
  const pulled = info.servedAt ? new Date(info.servedAt).toLocaleString() : 'not yet';
  let tip: string;
  switch (info.state) {
    case 'effective':
      tip = `Enforced — this host has pulled the revocation list that includes this block (last pull: ${pulled}). This confirms delivery to the host, not the final on-disk install.`;
      break;
    case 'pending':
      tip = `Rolling out — the block is placed, but this host hasn't pulled the updated revocation list yet (last pull: ${pulled}). It takes effect on the host's next pull, usually within minutes.`;
      break;
    case 'lifting':
      tip = `Clearing — the block was lifted, but this host still enforces the previous list until its next pull (last pull: ${pulled}). Access returns once it updates, usually within minutes.`;
      break;
  }
  if (info.unsignedLatest) {
    tip += ' Note: the newest revocation list could not be signed yet (signing-service issue), so hosts keep the last verified list until a signed one lands.';
  }
  return tip;
}
