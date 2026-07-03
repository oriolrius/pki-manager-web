/**
 * Per-host KRL distribution state derivation (BLK-07, decision-016).
 *
 * Derived ONLY from existing server-side telemetry — public per-CA fetches are
 * anonymous, so the server cannot see more than this:
 * - `effective`: ssh_hosts.last_krl_version (stamped when the ECIES 200 served
 *   ciphertext) equals the current per-host version_hash. Honesty rule: this
 *   means "ciphertext served to the host puller at <servedAt>", NOT
 *   confirmation of install (a callback would be needed for that).
 * - `pending`: a newer composed KRL exists that the host has not pulled yet
 *   (covers post-block waiting and generic propagation).
 * - `lifting`: same, but the most recent block event on the host is a LIFT —
 *   the admin must never tell a user access is restored while the host still
 *   enforces the old KRL (unblock is symmetric, decision-016).
 * - `unknown`: the host has NO usable ECIES registration (opensshHostPubkey
 *   null or an ECIES-unsupported key type) — blocks cannot land via ECIES;
 *   pinned derivation rule.
 *
 * `unsignedLatest` is a DISTINCT cause, not a state: when KMS signing failed,
 * the latest row persisted unsigned — signature-requiring krl-client hosts
 * keep last-good and reject it (fail-stale), while host_puller.sh installs it.
 * Surfaced so it is never silent.
 */
import { eq } from 'drizzle-orm';
import { sshHostBlocks } from '../db/schema.js';
import { getSshHostKrlService } from './ssh-host-krl.service.js';
import type { ServiceContext } from './types.js';

export type HostKrlState = 'effective' | 'pending' | 'lifting' | 'unknown';

export interface HostKrlStateInfo {
  state: HostKrlState;
  /** Latest per-host KRL persisted WITHOUT a CA signature (KMS signRaw failed):
   * krl-client hosts fail-stale on last-good until a signed row lands. */
  unsignedLatest: boolean;
  /** Version the server last SERVED to the host (ECIES 200), or null. */
  lastKrlVersion: string | null;
  /** When ciphertext was last served/304-refreshed — the tooltip timestamp. */
  servedAt: string | null;
  /** Current head of the host's composed lineage, or null before first generation. */
  currentVersionHash: string | null;
}

export interface HostTelemetry {
  opensshHostPubkey: string | null;
  hostKeyAlgorithm: string | null;
  lastKrlVersion: string | null;
  lastKrlFetchAt: Date | string | null;
}

export interface LatestHostKrl {
  versionHash: string;
  caSignature: unknown | null;
}

export interface BlockEvent {
  status: 'active' | 'lifted';
  createdAt: Date | string;
  liftedAt: Date | string | null;
}

/** The only ECIES-capable host key type (local-decrypt P-256 model, decision-015). */
export const ECIES_KEY_ALGORITHM = 'ecdsa-sha2-nistp256';

export function hasUsableEciesRegistration(host: Pick<HostTelemetry, 'opensshHostPubkey' | 'hostKeyAlgorithm'>): boolean {
  return !!host.opensshHostPubkey && host.hostKeyAlgorithm === ECIES_KEY_ALGORITHM;
}

/** Pure derivation — unit-testable without a DB. */
export function deriveHostKrlState(
  host: HostTelemetry,
  latest: LatestHostKrl | null,
  blockEvents: BlockEvent[]
): HostKrlStateInfo {
  const base = {
    unsignedLatest: !!latest && !latest.caSignature,
    lastKrlVersion: host.lastKrlVersion ?? null,
    servedAt: host.lastKrlFetchAt ? new Date(host.lastKrlFetchAt).toISOString() : null,
    currentVersionHash: latest?.versionHash ?? null,
  };

  if (!hasUsableEciesRegistration(host)) return { state: 'unknown', ...base };
  if (latest && host.lastKrlVersion === latest.versionHash) return { state: 'effective', ...base };

  // Version mismatch (or nothing generated/served yet): pending — unless the
  // most recent block event on this host is a lift, then it is a LIFT in
  // flight and must read as "lifting", never as restored.
  let lastCreate = 0;
  let lastLift = 0;
  for (const e of blockEvents) {
    const created = new Date(e.createdAt).getTime();
    if (created > lastCreate) lastCreate = created;
    if (e.status === 'lifted' && e.liftedAt) {
      const lifted = new Date(e.liftedAt).getTime();
      if (lifted > lastLift) lastLift = lifted;
    }
  }
  const state: HostKrlState = lastLift > lastCreate ? 'lifting' : 'pending';
  return { state, ...base };
}

/** DB-backed convenience used by the BLK-08 read model. */
export async function getHostKrlState(ctx: ServiceContext, host: { id: string } & HostTelemetry): Promise<HostKrlStateInfo> {
  const latest = await getSshHostKrlService().getLatestRow(ctx, host.id);
  const events = (await ctx.db
    .select({ status: sshHostBlocks.status, createdAt: sshHostBlocks.createdAt, liftedAt: sshHostBlocks.liftedAt })
    .from(sshHostBlocks)
    .where(eq(sshHostBlocks.hostId, host.id))) as BlockEvent[];
  return deriveHostKrlState(host, latest, events);
}
