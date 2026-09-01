/**
 * SSH Zones (decision-017, ZONE-02). A zone is a first-class grouping that acts
 * as a real SSH trust boundary: a host in zone Z trusts only Z's user CAs.
 *
 * The load-bearing piece is `resolveZone()` (amendment A1): it is IMPLICIT while
 * a single zone exists and FAIL-CLOSED the moment a second zone appears. Every
 * un-scoped issuance caller (the 33 existing SSH test files, the sibling CLI, the
 * Galaxy collection, the live pki.joor.net install) keeps working untouched
 * after the migration — and starts failing loudly, never silently signing with
 * the wrong trust domain's CA, once an operator creates a second zone.
 */
import { randomUUID } from 'crypto';
import { eq, ne } from 'drizzle-orm';
import { zones } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import type { ServiceContext } from './types.js';

export const DEFAULT_ZONE_ID = 'default';

/** URL-safe slug: lowercase alphanumerics and single dashes, 1..63 chars. */
const ZONE_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export function isValidZoneSlug(name: string): boolean {
  return ZONE_SLUG_RE.test(name);
}

export interface SshZoneDto {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export class SshZoneNotFoundError extends Error {
  constructor(public ref: string) {
    super(`zone '${ref}' not found`);
    this.name = 'SshZoneNotFoundError';
  }
}
export class SshZoneAmbiguousError extends Error {
  constructor(public available: string[]) {
    super(
      `zone is ambiguous — ${available.length} zones exist (${available.join(', ')}); specify one explicitly`
    );
    this.name = 'SshZoneAmbiguousError';
  }
}
export class SshZoneExistsError extends Error {
  constructor(name: string) {
    super(`a zone named '${name}' already exists`);
    this.name = 'SshZoneExistsError';
  }
}
export class SshZoneSlugError extends Error {
  constructor(name: string) {
    super(`invalid zone name '${name}' — must be a URL-safe slug (a-z, 0-9, dashes)`);
    this.name = 'SshZoneSlugError';
  }
}
export class SshZoneArchivedError extends Error {
  constructor(public zone: string) {
    super(`zone '${zone}' is archived — no new CAs, hosts, identities, principals or issuance`);
    this.name = 'SshZoneArchivedError';
  }
}

function toDto(row: any): SshZoneDto {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Resolve the operative zone for a call. See amendment A1:
 *  - explicit id-or-slug given → that zone, or SshZoneNotFoundError
 *  - omitted + exactly one non-archived zone → that zone
 *  - omitted + zero or several non-archived zones → SshZoneAmbiguousError
 * Returns the full zone row (callers commonly need `.id`).
 */
export async function resolveZone(ctx: ServiceContext, explicit?: string | null): Promise<any> {
  if (explicit != null && explicit !== '') {
    const row = (
      await ctx.db
        .select()
        .from(zones)
        .where(eq(zones.id, explicit))
        .limit(1)
    )[0] ?? (
      await ctx.db
        .select()
        .from(zones)
        .where(eq(zones.name, explicit))
        .limit(1)
    )[0];
    if (!row) throw new SshZoneNotFoundError(explicit);
    return row;
  }
  const active = (await ctx.db.select().from(zones).where(ne(zones.status, 'archived'))) as any[];
  if (active.length === 1) return active[0];
  throw new SshZoneAmbiguousError(active.map((z) => z.name).sort());
}

/** Convenience: resolveZone but return just the id. */
export async function resolveZoneId(ctx: ServiceContext, explicit?: string | null): Promise<string> {
  return (await resolveZone(ctx, explicit)).id;
}

/**
 * Assert a zone exists and is not archived — the gate for creating new CAs,
 * hosts, identities, principals and for issuance (amendment A3). Archiving keeps
 * serving existing trust material but blocks new entities.
 */
export async function assertZoneUsable(ctx: ServiceContext, zoneId: string): Promise<any> {
  const row = (await ctx.db.select().from(zones).where(eq(zones.id, zoneId)).limit(1))[0];
  if (!row) throw new SshZoneNotFoundError(zoneId);
  if (row.status === 'archived') throw new SshZoneArchivedError(row.name);
  return row;
}

export class SshZoneService {
  async list(ctx: ServiceContext, opts?: { includeArchived?: boolean }): Promise<SshZoneDto[]> {
    const rows = opts?.includeArchived
      ? await ctx.db.select().from(zones)
      : await ctx.db.select().from(zones).where(ne(zones.status, 'archived'));
    return (rows as any[]).map(toDto);
  }

  async get(ctx: ServiceContext, ref: string): Promise<SshZoneDto> {
    return toDto(await resolveZone(ctx, ref));
  }

  async create(
    ctx: ServiceContext,
    params: { name: string; displayName?: string; description?: string }
  ): Promise<SshZoneDto> {
    const name = params.name?.trim();
    if (!name || !isValidZoneSlug(name)) throw new SshZoneSlugError(params.name);
    const clash = (await ctx.db.select().from(zones).where(eq(zones.name, name)).limit(1))[0];
    if (clash) throw new SshZoneExistsError(name);

    const id = randomUUID();
    await ctx.db.insert(zones).values({
      id,
      name,
      displayName: params.displayName?.trim() || name,
      description: params.description ?? null,
      status: 'active',
    } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.zone.create',
      entityType: 'zone',
      entityId: id,
      status: 'success',
      details: { name },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    logger.info({ id, name }, 'Created SSH zone');
    return this.get(ctx, id);
  }

  /**
   * Update mutable metadata only. `name` (the slug) is immutable — it is a stable
   * URL/API key that hosts and clients reference; renaming would silently break
   * them. Zone membership of entities is likewise immutable (decision-017).
   */
  async update(
    ctx: ServiceContext,
    ref: string,
    params: { displayName?: string; description?: string }
  ): Promise<SshZoneDto> {
    const zone = await resolveZone(ctx, ref);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (params.displayName !== undefined) patch.displayName = params.displayName.trim() || zone.name;
    if (params.description !== undefined) patch.description = params.description ?? null;
    await ctx.db.update(zones).set(patch).where(eq(zones.id, zone.id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.zone.update',
      entityType: 'zone',
      entityId: zone.id,
      status: 'success',
      details: { fields: Object.keys(params) },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return this.get(ctx, zone.id);
  }

  /** Archive a zone (A3): blocks new entities/issuance, keeps serving existing trust material. */
  async archive(ctx: ServiceContext, ref: string): Promise<SshZoneDto> {
    const zone = await resolveZone(ctx, ref);
    await ctx.db.update(zones).set({ status: 'archived', updatedAt: new Date() }).where(eq(zones.id, zone.id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.zone.archive',
      entityType: 'zone',
      entityId: zone.id,
      status: 'success',
      details: { name: zone.name },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return this.get(ctx, zone.id);
  }

  /** Reactivate an archived zone. */
  async unarchive(ctx: ServiceContext, ref: string): Promise<SshZoneDto> {
    const zone = await resolveZone(ctx, ref);
    await ctx.db.update(zones).set({ status: 'active', updatedAt: new Date() }).where(eq(zones.id, zone.id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.zone.update',
      entityType: 'zone',
      entityId: zone.id,
      status: 'success',
      details: { name: zone.name, unarchived: true },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return this.get(ctx, zone.id);
  }
}

let instance: SshZoneService | null = null;
export function getSshZoneService(): SshZoneService {
  if (!instance) instance = new SshZoneService();
  return instance;
}
