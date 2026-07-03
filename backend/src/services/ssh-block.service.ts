/**
 * Per-host user access blocks (BLK-04, decision-016). One verb pair —
 * block/unblock — keyed (host, identity). Blocks are NOT revocations: the
 * identity's certs stay active (valid on every other host); enforcement is the
 * composed per-host KRL (BLK-03), regenerated SYNCHRONOUSLY on both mutations
 * (sub-second server-side; propagation is bounded by one pull interval either
 * way — unblock is symmetric, never faster).
 *
 * Lifecycle (decision-016): blocking a DISABLED identity is allowed
 * (pre-emptive — still denies unexpired certs); identity offboard supersedes
 * blocks (rows kept, annotated for the UI); host offboard retires the per-host
 * lineage and keeps block rows (moot, retained for audit) — new blocks on an
 * offboarded host are rejected because they could never be enforced.
 */
import { randomUUID } from 'crypto';
import { eq, and, desc, inArray, ne, gt } from 'drizzle-orm';
import { sshHosts, sshIdentities, sshCertificates, sshHostBlocks, sshHostKrls, sshPrincipals, sshUserPrincipals, sshHostPrincipalMaps } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { getSshHostKrlService, type SshHostKrlDto } from './ssh-host-krl.service.js';
import { deriveHostKrlState, type HostKrlStateInfo, type BlockEvent } from './ssh-host-state.js';
import type { ServiceContext } from './types.js';

export class SshBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshBlockError';
  }
}

/** Another identity certified for one of the target's public keys — a
 * fingerprint deny entry will lock BOTH out of this host (over-block). */
export interface SharedKeyCollision {
  identityId: string;
  subject: string;
  fingerprint: string;
}

export interface SshHostBlockDto {
  id: string;
  hostId: string;
  fqdn: string | null;
  identityId: string;
  subject: string | null;
  reason: string | null;
  status: 'active' | 'lifted';
  createdBy: string | null;
  createdAt: string;
  liftedBy: string | null;
  liftedAt: string | null;
  /** Identity offboarded (disabled + nothing left active): the global
   * revocation already covers every host; the block row is kept for audit. */
  supersededByOffboard: boolean;
}

export interface BlockResult {
  block: SshHostBlockDto;
  /** Null when the synchronous regeneration failed (lazy regen backstop applies). */
  krl: SshHostKrlDto | null;
  warnings: { sharedKeyCollisions: SharedKeyCollision[] };
}

export interface UnblockResult {
  block: SshHostBlockDto;
  krl: SshHostKrlDto | null;
}

export class SshBlockService {
  async block(
    ctx: ServiceContext,
    params: { hostId: string; identityId: string; reason?: string; createdBy?: string }
  ): Promise<BlockResult> {
    const { hostId, identityId } = params;
    try {
      const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
      if (!host) throw new SshBlockError(`host ${hostId} not found`);
      if (host.status === 'offboarded')
        throw new SshBlockError(`host ${host.fqdn} is offboarded — a block there could never be enforced`);
      const identity = (await ctx.db.select().from(sshIdentities).where(eq(sshIdentities.id, identityId)).limit(1))[0];
      if (!identity) throw new SshBlockError(`identity ${identityId} not found`);
      // identity.status === 'disabled' is fine: pre-emptive block still denies unexpired certs.

      const existing = (await ctx.db
        .select()
        .from(sshHostBlocks)
        .where(and(eq(sshHostBlocks.hostId, hostId), eq(sshHostBlocks.identityId, identityId), eq(sshHostBlocks.status, 'active')))
        .limit(1))[0];
      if (existing) throw new SshBlockError(`${identity.subject} is already blocked on ${host.fqdn}`);

      const warnings = { sharedKeyCollisions: await this.sharedKeyCollisions(ctx, identityId) };

      const id = randomUUID();
      await ctx.db.insert(sshHostBlocks).values({
        id,
        hostId,
        identityId,
        reason: params.reason ?? null,
        status: 'active',
        createdBy: params.createdBy ?? ctx.ipAddress ?? null,
      } as any);

      const krl = await this.regenerate(ctx, hostId);
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.host.block',
        entityType: 'ssh_host',
        entityId: hostId,
        status: 'success',
        details: { identityId, hostId, reason: params.reason ?? null, blockId: id, regenerated: !!krl, krlNumber: krl?.krlNumber },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      const dto = await this.getDto(ctx, id);
      return { block: dto, krl, warnings };
    } catch (e: any) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.host.block',
        entityType: 'ssh_host',
        entityId: hostId,
        status: 'failure',
        details: { identityId, hostId, reason: params.reason ?? null, error: e?.message ?? String(e) },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw e;
    }
  }

  async unblock(
    ctx: ServiceContext,
    params: { hostId: string; identityId: string; liftedBy?: string }
  ): Promise<UnblockResult> {
    const { hostId, identityId } = params;
    try {
      const row = (await ctx.db
        .select()
        .from(sshHostBlocks)
        .where(and(eq(sshHostBlocks.hostId, hostId), eq(sshHostBlocks.identityId, identityId), eq(sshHostBlocks.status, 'active')))
        .limit(1))[0];
      if (!row) throw new SshBlockError('no active block for this identity on this host');

      await ctx.db
        .update(sshHostBlocks)
        .set({ status: 'lifted', liftedBy: params.liftedBy ?? ctx.ipAddress ?? null, liftedAt: new Date() })
        .where(eq(sshHostBlocks.id, row.id));

      // Symmetric: the lift only reaches the host through a NEW composed KRL.
      const krl = await this.regenerate(ctx, hostId);
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.host.unblock',
        entityType: 'ssh_host',
        entityId: hostId,
        status: 'success',
        details: { identityId, hostId, blockId: row.id, regenerated: !!krl, krlNumber: krl?.krlNumber },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      const dto = await this.getDto(ctx, row.id);
      return { block: dto, krl };
    } catch (e: any) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.host.unblock',
        entityType: 'ssh_host',
        entityId: hostId,
        status: 'failure',
        details: { identityId, hostId, error: e?.message ?? String(e) },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw e;
    }
  }

  async listForHost(ctx: ServiceContext, hostId: string): Promise<SshHostBlockDto[]> {
    const rows = (await ctx.db
      .select({ block: sshHostBlocks, subject: sshIdentities.subject, fqdn: sshHosts.fqdn })
      .from(sshHostBlocks)
      .innerJoin(sshIdentities, eq(sshHostBlocks.identityId, sshIdentities.id))
      .innerJoin(sshHosts, eq(sshHostBlocks.hostId, sshHosts.id))
      .where(eq(sshHostBlocks.hostId, hostId))
      .orderBy(desc(sshHostBlocks.createdAt))) as any[];
    return this.annotate(ctx, rows);
  }

  async listForIdentity(ctx: ServiceContext, identityId: string): Promise<SshHostBlockDto[]> {
    const rows = (await ctx.db
      .select({ block: sshHostBlocks, subject: sshIdentities.subject, fqdn: sshHosts.fqdn })
      .from(sshHostBlocks)
      .innerJoin(sshIdentities, eq(sshHostBlocks.identityId, sshIdentities.id))
      .innerJoin(sshHosts, eq(sshHostBlocks.hostId, sshHosts.id))
      .where(eq(sshHostBlocks.identityId, identityId))
      .orderBy(desc(sshHostBlocks.createdAt))) as any[];
    return this.annotate(ctx, rows);
  }

  /** Other identities certified for any public key the target was certified
   * for: fingerprint entries deny the KEY under any CA (over-block warning). */
  async sharedKeyCollisions(ctx: ServiceContext, identityId: string): Promise<SharedKeyCollision[]> {
    const own = (await ctx.db
      .selectDistinct({ fp: sshCertificates.subjectPubkeyFingerprint })
      .from(sshCertificates)
      .where(and(eq(sshCertificates.identityId, identityId), eq(sshCertificates.certType, 'user')))) as any[];
    const fps = own.map((r) => r.fp);
    if (!fps.length) return [];
    const others = (await ctx.db
      .selectDistinct({
        identityId: sshCertificates.identityId,
        subject: sshIdentities.subject,
        fingerprint: sshCertificates.subjectPubkeyFingerprint,
      })
      .from(sshCertificates)
      .innerJoin(sshIdentities, eq(sshCertificates.identityId, sshIdentities.id))
      .where(
        and(
          inArray(sshCertificates.subjectPubkeyFingerprint, fps),
          eq(sshCertificates.certType, 'user'),
          ne(sshCertificates.identityId, identityId)
        )
      )) as any[];
    return others.map((r) => ({ identityId: r.identityId, subject: r.subject, fingerprint: r.fingerprint }));
  }

  // ---- BLK-08 read model (no N+1: fixed query count, grouped in JS) ----

  /** Batch per-host state derivation for a set of host rows. */
  private async stateForHosts(ctx: ServiceContext, hosts: any[]): Promise<Map<string, HostKrlStateInfo>> {
    const out = new Map<string, HostKrlStateInfo>();
    if (!hosts.length) return out;
    const hostIds = hosts.map((h) => h.id);
    const krlRows = (await ctx.db.select().from(sshHostKrls).where(inArray(sshHostKrls.hostId, hostIds))) as any[];
    const latestByHost = new Map<string, any>();
    for (const r of krlRows) {
      const cur = latestByHost.get(r.hostId);
      if (!cur || r.krlNumber > cur.krlNumber) latestByHost.set(r.hostId, r);
    }
    const events = (await ctx.db
      .select({ hostId: sshHostBlocks.hostId, status: sshHostBlocks.status, createdAt: sshHostBlocks.createdAt, liftedAt: sshHostBlocks.liftedAt })
      .from(sshHostBlocks)
      .where(inArray(sshHostBlocks.hostId, hostIds))) as any[];
    const eventsByHost = new Map<string, BlockEvent[]>();
    for (const e of events) {
      if (!eventsByHost.has(e.hostId)) eventsByHost.set(e.hostId, []);
      eventsByHost.get(e.hostId)!.push(e);
    }
    for (const h of hosts) {
      out.set(h.id, deriveHostKrlState(h, latestByHost.get(h.id) ?? null, eventsByHost.get(h.id) ?? []));
    }
    return out;
  }

  /**
   * "Who can currently reach this host" (decision-016 Access card): the
   * entitlement join whoCanBecome() discards — identity / via-roles / local
   * accounts — merged with active block rows and the per-host state.
   */
  async hostAccess(
    ctx: ServiceContext,
    hostId: string
  ): Promise<{
    hostId: string;
    fqdn: string;
    state: HostKrlStateInfo;
    entries: Array<{
      identityId: string;
      subject: string;
      identityStatus: string;
      viaRoles: string[];
      localAccounts: string[];
      blocked: boolean;
      block: SshHostBlockDto | null;
    }>;
  }> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
    if (!host) throw new SshBlockError(`host ${hostId} not found`);

    const entitled = (await ctx.db
      .select({
        identityId: sshUserPrincipals.identityId,
        subject: sshIdentities.subject,
        identityStatus: sshIdentities.status,
        role: sshPrincipals.name,
        localAccount: sshHostPrincipalMaps.localAccount,
      })
      .from(sshHostPrincipalMaps)
      .innerJoin(sshPrincipals, eq(sshHostPrincipalMaps.principalId, sshPrincipals.id))
      .innerJoin(sshUserPrincipals, eq(sshUserPrincipals.principalId, sshHostPrincipalMaps.principalId))
      .innerJoin(sshIdentities, eq(sshUserPrincipals.identityId, sshIdentities.id))
      .where(eq(sshHostPrincipalMaps.hostId, hostId))) as any[];

    const entries = new Map<
      string,
      { identityId: string; subject: string; identityStatus: string; viaRoles: Set<string>; localAccounts: Set<string>; blocked: boolean; block: SshHostBlockDto | null }
    >();
    for (const row of entitled) {
      if (!entries.has(row.identityId)) {
        entries.set(row.identityId, {
          identityId: row.identityId,
          subject: row.subject,
          identityStatus: row.identityStatus,
          viaRoles: new Set(),
          localAccounts: new Set(),
          blocked: false,
          block: null,
        });
      }
      const e = entries.get(row.identityId)!;
      e.viaRoles.add(row.role);
      e.localAccounts.add(row.localAccount);
    }

    // Blocked identities render even when not currently entitled (pre-emptive).
    const blocks = await this.listForHost(ctx, hostId);
    const active = blocks.filter((b) => b.status === 'active');
    const unlisted = active.filter((b) => !entries.has(b.identityId)).map((b) => b.identityId);
    const statusById = new Map<string, string>();
    if (unlisted.length) {
      const idents = (await ctx.db.select().from(sshIdentities).where(inArray(sshIdentities.id, unlisted))) as any[];
      for (const i of idents) statusById.set(i.id, i.status);
    }
    for (const b of active) {
      if (!entries.has(b.identityId)) {
        entries.set(b.identityId, {
          identityId: b.identityId,
          subject: b.subject ?? b.identityId,
          identityStatus: statusById.get(b.identityId) ?? 'active',
          viaRoles: new Set(),
          localAccounts: new Set(),
          blocked: true,
          block: b,
        });
      } else {
        const e = entries.get(b.identityId)!;
        e.blocked = true;
        e.block = b;
      }
    }

    const state = (await this.stateForHosts(ctx, [host])).get(host.id)!;
    return {
      hostId: host.id,
      fqdn: host.fqdn,
      state,
      entries: [...entries.values()]
        .map((e) => ({ ...e, viaRoles: [...e.viaRoles].sort(), localAccounts: [...e.localAccounts].sort() }))
        .sort((a, b) => a.subject.localeCompare(b.subject)),
    };
  }

  /** Users-page pills: the identity's ACTIVE blocks as {hostId, fqdn, state} tuples. */
  async listForIdentityWithState(
    ctx: ServiceContext,
    identityId: string
  ): Promise<Array<SshHostBlockDto & { state: HostKrlStateInfo }>> {
    const blocks = (await this.listForIdentity(ctx, identityId)).filter((b) => b.status === 'active');
    if (!blocks.length) return [];
    const hosts = (await ctx.db
      .select()
      .from(sshHosts)
      .where(inArray(sshHosts.id, [...new Set(blocks.map((b) => b.hostId))]))) as any[];
    const states = await this.stateForHosts(ctx, hosts);
    return blocks.map((b) => ({ ...b, state: states.get(b.hostId)! }));
  }

  /** KRL-page fleet propagation view: per-host {blockCount, state} in fixed queries. */
  async fleetDistribution(
    ctx: ServiceContext
  ): Promise<
    Array<{
      hostId: string;
      fqdn: string;
      status: string;
      blockCount: number;
      state: HostKrlStateInfo;
      krlNumber: number | null;
      lastKrlVersion: string | null;
      lastKrlFetchAt: string | null;
    }>
  > {
    const hosts = (await ctx.db.select().from(sshHosts).where(ne(sshHosts.status, 'offboarded'))) as any[];
    if (!hosts.length) return [];
    const states = await this.stateForHosts(ctx, hosts);
    const activeBlocks = (await ctx.db
      .select({ hostId: sshHostBlocks.hostId })
      .from(sshHostBlocks)
      .where(eq(sshHostBlocks.status, 'active'))) as any[];
    const blockCount = new Map<string, number>();
    for (const b of activeBlocks) blockCount.set(b.hostId, (blockCount.get(b.hostId) ?? 0) + 1);
    const krlRows = (await ctx.db.select().from(sshHostKrls).where(inArray(sshHostKrls.hostId, hosts.map((h) => h.id)))) as any[];
    const latestNumber = new Map<string, number>();
    for (const r of krlRows) {
      if ((latestNumber.get(r.hostId) ?? -1) < r.krlNumber) latestNumber.set(r.hostId, r.krlNumber);
    }
    return hosts
      .map((h) => ({
        hostId: h.id,
        fqdn: h.fqdn,
        status: h.status,
        blockCount: blockCount.get(h.id) ?? 0,
        state: states.get(h.id)!,
        krlNumber: latestNumber.get(h.id) ?? null,
        lastKrlVersion: h.lastKrlVersion ?? null,
        lastKrlFetchAt: h.lastKrlFetchAt ? new Date(h.lastKrlFetchAt).toISOString() : null,
      }))
      .sort((a, b) => a.fqdn.localeCompare(b.fqdn));
  }

  private async regenerate(ctx: ServiceContext, hostId: string): Promise<SshHostKrlDto | null> {
    try {
      return await getSshHostKrlService().generate(ctx, hostId);
    } catch (e) {
      // Non-fatal: the block/lift row is authoritative; the lazy regen-on-fetch
      // backstop (and BLK-05 invalidation) picks it up. generate() audited its
      // own failure.
      logger.warn({ hostId, error: String(e) }, 'synchronous per-host KRL regeneration failed after block mutation');
      return null;
    }
  }

  private async getDto(ctx: ServiceContext, blockId: string): Promise<SshHostBlockDto> {
    const rows = (await ctx.db
      .select({ block: sshHostBlocks, subject: sshIdentities.subject, fqdn: sshHosts.fqdn })
      .from(sshHostBlocks)
      .innerJoin(sshIdentities, eq(sshHostBlocks.identityId, sshIdentities.id))
      .innerJoin(sshHosts, eq(sshHostBlocks.hostId, sshHosts.id))
      .where(eq(sshHostBlocks.id, blockId))) as any[];
    return (await this.annotate(ctx, rows))[0];
  }

  /** Attach the superseded-by-offboard annotation: identity disabled AND no
   * active unexpired cert left — the SSH-32c global revocation covers every
   * host, so the per-host block is moot (kept for audit). */
  private async annotate(ctx: ServiceContext, rows: any[]): Promise<SshHostBlockDto[]> {
    const identityIds = [...new Set(rows.map((r) => r.block.identityId))];
    const superseded = new Set<string>();
    if (identityIds.length) {
      const idents = (await ctx.db
        .select()
        .from(sshIdentities)
        .where(inArray(sshIdentities.id, identityIds))) as any[];
      const disabled = idents.filter((i) => i.status === 'disabled').map((i) => i.id);
      if (disabled.length) {
        const live = (await ctx.db
          .selectDistinct({ identityId: sshCertificates.identityId })
          .from(sshCertificates)
          .where(
            and(
              inArray(sshCertificates.identityId, disabled),
              eq(sshCertificates.status, 'active'),
              gt(sshCertificates.validBefore, new Date())
            )
          )) as any[];
        const stillLive = new Set(live.map((r) => r.identityId));
        for (const id of disabled) if (!stillLive.has(id)) superseded.add(id);
      }
    }
    return rows.map((r) => ({
      id: r.block.id,
      hostId: r.block.hostId,
      fqdn: r.fqdn ?? null,
      identityId: r.block.identityId,
      subject: r.subject ?? null,
      reason: r.block.reason ?? null,
      status: r.block.status,
      createdBy: r.block.createdBy ?? null,
      createdAt: new Date(r.block.createdAt).toISOString(),
      liftedBy: r.block.liftedBy ?? null,
      liftedAt: r.block.liftedAt ? new Date(r.block.liftedAt).toISOString() : null,
      supersededByOffboard: superseded.has(r.block.identityId),
    }));
  }
}

let instance: SshBlockService | null = null;
export function getSshBlockService(): SshBlockService {
  if (!instance) instance = new SshBlockService();
  return instance;
}
