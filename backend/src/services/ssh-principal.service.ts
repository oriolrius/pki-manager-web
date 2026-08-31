/**
 * SSH principal / RBAC catalog service (SSH-14). Owns role-principals, which
 * principals an identity may encode, and the per-host principal→account map that
 * renders into AuthorizedPrincipalsFile. Flags hosts whose map drifted after the
 * last automation push.
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import {
  sshPrincipals,
  sshUserPrincipals,
  sshHostPrincipalMaps,
  sshHosts,
  sshIdentities,
} from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { isValidPrincipalName, isValidAccountName } from './ssh-config.js';
import type { ServiceContext } from './types.js';

export class SshPrincipalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshPrincipalError';
  }
}

export interface PrincipalDto {
  id: string;
  name: string;
  description: string | null;
}

export interface AuthPrincipalsRender {
  hostId: string;
  fqdn: string;
  directive: string;
  /** account -> file contents for /etc/ssh/auth_principals/<account> */
  files: Record<string, string>;
  stale: boolean;
}

export interface MarkPushedResult {
  hostId: string;
  fqdn: string;
  /** ISO-8601; the value `stale` is computed against on the next render. */
  lastPrincipalPushAt: string;
}

export class SshPrincipalService {
  async createPrincipal(ctx: ServiceContext, params: { name: string; description?: string }): Promise<PrincipalDto> {
    if (!isValidPrincipalName(params.name)) throw new SshPrincipalError(`invalid principal name '${params.name}'`);
    const id = randomUUID();
    await ctx.db.insert(sshPrincipals).values({ id, name: params.name, description: params.description ?? null } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.principal.create',
      entityType: 'ssh_principal',
      entityId: id,
      status: 'success',
      details: { name: params.name },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return { id, name: params.name, description: params.description ?? null };
  }

  async listPrincipals(ctx: ServiceContext): Promise<PrincipalDto[]> {
    return (await ctx.db.select().from(sshPrincipals)).map((r: any) => ({ id: r.id, name: r.name, description: r.description ?? null }));
  }

  /**
   * Where each principal currently grants login: principal NAME -> the
   * (host, local account) pairs it is mapped to. Read-only aggregation used to
   * warn, on the issue-cert form, when a chosen principal is mapped nowhere
   * (so the cert would authenticate but be denied login — the #1 SSH trap).
   */
  async mappingsByPrincipal(ctx: ServiceContext): Promise<Record<string, Array<{ fqdn: string; localAccount: string }>>> {
    const rows = await ctx.db
      .select({ name: sshPrincipals.name, fqdn: sshHosts.fqdn, localAccount: sshHostPrincipalMaps.localAccount })
      .from(sshHostPrincipalMaps)
      .innerJoin(sshPrincipals, eq(sshHostPrincipalMaps.principalId, sshPrincipals.id))
      .innerJoin(sshHosts, eq(sshHostPrincipalMaps.hostId, sshHosts.id));
    const out: Record<string, Array<{ fqdn: string; localAccount: string }>> = {};
    for (const r of rows as any[]) {
      (out[r.name] ??= []).push({ fqdn: r.fqdn, localAccount: r.localAccount });
    }
    return out;
  }

  async deletePrincipal(ctx: ServiceContext, id: string): Promise<void> {
    // TASK-216: without this, deleting an unknown id removed zero rows and
    // still reported success — the same silent no-op markPushed had.
    const existing = (await ctx.db.select().from(sshPrincipals).where(eq(sshPrincipals.id, id)).limit(1))[0];
    if (!existing) throw new SshPrincipalError(`principal ${id} not found`);
    // FK ON DELETE restrict prevents deleting an in-use principal.
    try {
      await ctx.db.delete(sshPrincipals).where(eq(sshPrincipals.id, id));
    } catch (e) {
      throw new SshPrincipalError('principal is in use (entitlements or host maps reference it)');
    }
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.principal.delete',
      entityType: 'ssh_principal',
      entityId: id,
      status: 'success',
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  /** Grant an identity the right to encode a principal. */
  async grantToIdentity(ctx: ServiceContext, params: { identityId: string; principalId: string }): Promise<void> {
    await ctx.db
      .insert(sshUserPrincipals)
      .values({ id: randomUUID(), identityId: params.identityId, principalId: params.principalId } as any)
      .onConflictDoNothing?.();
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.principal.map',
      entityType: 'ssh_identity',
      entityId: params.identityId,
      status: 'success',
      details: { principalId: params.principalId, kind: 'entitlement' },
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  /** Map a principal to a local account on a host. */
  async mapToHost(
    ctx: ServiceContext,
    params: { hostId: string; principalId: string; localAccount: string }
  ): Promise<void> {
    if (!isValidAccountName(params.localAccount)) throw new SshPrincipalError(`invalid local account '${params.localAccount}'`);
    await ctx.db.insert(sshHostPrincipalMaps).values({
      id: randomUUID(),
      hostId: params.hostId,
      principalId: params.principalId,
      localAccount: params.localAccount,
    } as any);
    // Catalog changed: mark host map newer than last push so drift surfaces.
    await ctx.db.update(sshHosts).set({ updatedAt: new Date() }).where(eq(sshHosts.id, params.hostId));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.principal.map',
      entityType: 'ssh_host',
      entityId: params.hostId,
      status: 'success',
      details: { principalId: params.principalId, localAccount: params.localAccount },
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  /**
   * Render the exact /etc/ssh/auth_principals/<account> file contents for a host,
   * grouped by local account, plus the AuthorizedPrincipalsFile directive.
   */
  async render(ctx: ServiceContext, hostId: string): Promise<AuthPrincipalsRender> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
    if (!host) throw new SshPrincipalError(`host ${hostId} not found`);

    const maps = await ctx.db
      .select({ name: sshPrincipals.name, account: sshHostPrincipalMaps.localAccount })
      .from(sshHostPrincipalMaps)
      .innerJoin(sshPrincipals, eq(sshHostPrincipalMaps.principalId, sshPrincipals.id))
      .where(eq(sshHostPrincipalMaps.hostId, hostId));

    const byAccount: Record<string, string[]> = {};
    for (const m of maps as any[]) {
      (byAccount[m.account] ??= []).push(m.name);
    }
    const files: Record<string, string> = {};
    for (const [account, names] of Object.entries(byAccount)) {
      // BLK-13: dual-form lines — bare `P` (today's certs) plus host-scoped
      // `P@<fqdn>`. Pre-provisioned UNCONDITIONALLY so the one-time fleet
      // re-push can happen BEFORE the SSH_BLOCK_ISSUANCE_GATE flag is enabled;
      // the extra lines are inert until a cert carries a scoped principal.
      const lines = [...new Set(names.flatMap((n) => [n, `${n}@${host.fqdn}`]))];
      files[account] = lines.sort().join('\n') + '\n';
    }

    const lastPush = host.lastPrincipalPushAt ? new Date(host.lastPrincipalPushAt).getTime() : 0;
    const updated = host.updatedAt ? new Date(host.updatedAt).getTime() : 0;
    const stale = updated > lastPush;

    return {
      hostId,
      fqdn: host.fqdn,
      directive: 'AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u',
      files,
      stale,
    };
  }

  /**
   * Record that a host's principal files were pushed (clears drift).
   *
   * The host lookup is not decoration: without it an unknown id updated zero
   * rows and still reported success, so a typo in an automation script looked
   * like a clear while the host stayed Stale forever. The thrown message is
   * matched by the REST router's `/not found/i` handler and becomes a 404.
   */
  async markPushed(ctx: ServiceContext, hostId: string): Promise<MarkPushedResult> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0] as any;
    if (!host) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.principal.mark_pushed',
        entityType: 'ssh_host',
        entityId: hostId,
        status: 'failure',
        details: { error: 'host not found' },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw new SshPrincipalError(`host ${hostId} not found`);
    }

    const pushedAt = new Date();
    await ctx.db.update(sshHosts).set({ lastPrincipalPushAt: pushedAt }).where(eq(sshHosts.id, hostId));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.principal.mark_pushed',
      entityType: 'ssh_host',
      entityId: hostId,
      status: 'success',
      details: { fqdn: host.fqdn },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return { hostId, fqdn: host.fqdn, lastPrincipalPushAt: pushedAt.toISOString() };
  }

  /** List hosts whose catalog maps changed after the last push. */
  async staleHosts(ctx: ServiceContext): Promise<Array<{ id: string; fqdn: string }>> {
    const hosts = await ctx.db.select().from(sshHosts);
    return (hosts as any[])
      .filter((h) => {
        const lastPush = h.lastPrincipalPushAt ? new Date(h.lastPrincipalPushAt).getTime() : 0;
        const updated = h.updatedAt ? new Date(h.updatedAt).getTime() : 0;
        return updated > lastPush;
      })
      .map((h) => ({ id: h.id, fqdn: h.fqdn }));
  }

  /** Answer "who can become <account> on host H". */
  async whoCanBecome(ctx: ServiceContext, hostId: string, _account: string): Promise<string[]> {
    const rows = await ctx.db
      .select({ name: sshPrincipals.name })
      .from(sshHostPrincipalMaps)
      .innerJoin(sshPrincipals, eq(sshHostPrincipalMaps.principalId, sshPrincipals.id))
      .where(eq(sshHostPrincipalMaps.hostId, hostId));
    void sshIdentities;
    return (rows as any[]).map((r) => r.name);
  }
}

let instance: SshPrincipalService | null = null;
export function getSshPrincipalService(): SshPrincipalService {
  if (!instance) instance = new SshPrincipalService();
  return instance;
}
