/**
 * Block / Unblock UI flows (BLK-09, decision-016) with injected effects so the
 * confirm copy, warnings, and invalidation are unit-testable. The pinned
 * decision copy lives HERE and only here.
 */
import type { HostKrlStateInfo } from './host-krl-state';

export interface SharedKeyCollision {
  identityId: string;
  subject: string;
  fingerprint: string;
}

export interface BlockFlowDeps {
  confirmFn: (message: string) => boolean | Promise<boolean>;
  promptFn: (message: string) => string | null | Promise<string | null>;
  alertFn: (message: string, variant?: 'success' | 'error') => void;
  /** Pre-block over-block check (trpc ssh.block.collisions). */
  fetchCollisions: (identityId: string) => Promise<SharedKeyCollision[]>;
  block: (input: { hostId: string; identityId: string; reason?: string }) => Promise<unknown>;
  unblock: (input: { hostId: string; identityId: string }) => Promise<unknown>;
  invalidate: () => void;
}

export interface BlockTarget {
  hostId: string;
  fqdn: string;
  identityId: string;
  subject: string;
  hostState: HostKrlStateInfo['state'];
}

/** Exact decision-016 confirm copy + the two pinned warnings. */
export function buildBlockConfirmMessage(
  target: Pick<BlockTarget, 'subject' | 'fqdn' | 'hostState'>,
  collisions: SharedKeyCollision[]
): string {
  let msg = `Block ${target.subject} on ${target.fqdn}? Access to all other hosts is unaffected.`;
  if (collisions.length) {
    const others = [...new Set(collisions.map((c) => c.subject))].join(', ');
    msg += `\n\nWarning: this key is also certified for ${others} — blocking will deny both on this host.`;
  }
  if (target.hostState === 'unknown') {
    msg +=
      '\n\nWARNING: this host fetches the per-CA KRL — the block will NOT be enforced until it is switched to the per-host channel.';
  }
  return msg;
}

export async function blockFlow(deps: BlockFlowDeps, target: BlockTarget): Promise<boolean> {
  let collisions: SharedKeyCollision[] = [];
  try {
    collisions = await deps.fetchCollisions(target.identityId);
  } catch {
    // Pre-check is advisory; the block response carries the warnings again.
  }
  if (!(await deps.confirmFn(buildBlockConfirmMessage(target, collisions)))) return false;
  const reason = (await deps.promptFn('Optional reason for the block:')) ?? undefined;
  try {
    const result = (await deps.block({
      hostId: target.hostId,
      identityId: target.identityId,
      reason: reason?.trim() || undefined,
    })) as { warnings?: { sharedKeyCollisions?: SharedKeyCollision[] } } | undefined;
    deps.invalidate();
    let msg = `${target.subject} blocked on ${target.fqdn}. The host enforces it on its next KRL pull (shown as Pending until then).`;
    // Backstop: the block RESPONSE re-reports collisions, so the over-block
    // warning is never silently lost when the pre-check query failed.
    const confirmed = result?.warnings?.sharedKeyCollisions ?? [];
    if (confirmed.length && !collisions.length) {
      const others = [...new Set(confirmed.map((c) => c.subject))].join(', ');
      msg += `\n\nWarning: this key is also certified for ${others} — they are ALSO denied on this host.`;
    }
    deps.alertFn(msg, 'success');
    return true;
  } catch (e) {
    deps.alertFn(`Block failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return false;
  }
}

export async function unblockFlow(
  deps: BlockFlowDeps,
  target: Pick<BlockTarget, 'hostId' | 'fqdn' | 'identityId' | 'subject'>
): Promise<boolean> {
  const ok = await deps.confirmFn(
    `Unblock ${target.subject} on ${target.fqdn}? The host keeps enforcing the old KRL until its next pull (shown as Lifting until it lands).`
  );
  if (!ok) return false;
  try {
    await deps.unblock({ hostId: target.hostId, identityId: target.identityId });
    deps.invalidate();
    deps.alertFn(
      `Block lifted for ${target.subject} on ${target.fqdn}. Shown as Lifting until the host pulls the new KRL.`,
      'success'
    );
    return true;
  } catch (e) {
    deps.alertFn(`Unblock failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return false;
  }
}
