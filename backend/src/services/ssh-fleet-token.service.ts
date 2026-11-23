/**
 * SSH automation fleet-token service (SSH-19). Mints bearer tokens for the
 * external signing API, stored only as a SHA-256 hash and verified in constant
 * time. One token is scoped to a CA pair (user/host) + an op-set. The plaintext
 * (pkimg_…) is returned exactly once at mint time.
 */
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { sshFleetTokens, sshCas, sshPrincipals } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { resolveZone, assertZoneUsable } from './ssh-zone.service.js';
import type { ServiceContext } from './types.js';

export type SshTokenOp = 'sign-host' | 'sign-user' | 'register-host-pubkey' | 'get-principals';

export class SshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshTokenError';
  }
}

/** A sign-user request exceeds the token limits (TASK-247) — a 403, not a 400. */
export class SshTokenLimitError extends SshTokenError {
  constructor(message: string) {
    super(message);
    this.name = 'SshTokenLimitError';
  }
}

const MAX_TTL = 10 * 366 * 24 * 3600;

export interface MintTokenParams {
  name: string;
  userCaId?: string;
  hostCaId?: string;
  opSet: SshTokenOp[];
  zone?: string;
  /** sign-user only (TASK-247): principal names from the token zone catalog. */
  allowedPrincipals?: string[];
  /** sign-user only (TASK-247): longest certificate the token may request, in seconds. */
  maxValidForSeconds?: number;
}

/** sign-user limits carried by a token (TASK-247). null = no limit. */
export interface SshTokenLimits {
  allowedPrincipals: string[] | null;
  maxValidForSeconds: number | null;
}

export interface FleetTokenDto {
  id: string;
  zoneId: string;
  name: string;
  tokenPrefix: string;
  userCaId: string | null;
  hostCaId: string | null;
  opSet: SshTokenOp[];
  /** sign-user limits; both null on a token minted without limits ("unrestricted"). */
  allowedPrincipals: string[] | null;
  maxValidForSeconds: number | null;
  revoked: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface VerifiedToken extends SshTokenLimits {
  id: string;
  zoneId: string;
  name: string;
  userCaId: string | null;
  hostCaId: string | null;
  opSet: SshTokenOp[];
}

const limitsOf = (row: any): SshTokenLimits => ({
  allowedPrincipals: row.allowedPrincipals ? JSON.parse(row.allowedPrincipals) : null,
  maxValidForSeconds: row.maxValidForSeconds ?? null,
});

/**
 * Check a sign-user request against the token limits (TASK-247). Returns the
 * validForSeconds to sign with, or throws SshTokenLimitError. A host-scoped
 * `P@<host>` is accepted when `P` is allowed (it is strictly narrower).
 */
export function applySignUserLimits(
  token: SshTokenLimits & { name: string },
  req: { principals: string[]; validForSeconds?: number },
  defaultValidForSeconds: number
): number {
  if (token.allowedPrincipals) {
    const allowed = new Set(token.allowedPrincipals);
    const denied = req.principals.filter((p) => !allowed.has(p) && !(p.includes('@') && allowed.has(p.slice(0, p.indexOf('@')))));
    if (denied.length)
      throw new SshTokenLimitError(
        `token "${token.name}" may not sign principal(s) ${denied.join(', ')} — allowed: ${token.allowedPrincipals.join(', ')}`
      );
  }
  const max = token.maxValidForSeconds;
  if (req.validForSeconds !== undefined) {
    if (max !== null && req.validForSeconds > max)
      throw new SshTokenLimitError(
        `token "${token.name}" may sign certificates of at most ${max} s; requested ${req.validForSeconds} s`
      );
    return req.validForSeconds;
  }
  return max !== null ? Math.min(defaultValidForSeconds, max) : defaultValidForSeconds;
}

const PREFIX = 'pkimg_';
const hashToken = (plain: string) => createHash('sha256').update(plain).digest('hex');

function dto(row: any): FleetTokenDto {
  return {
    id: row.id,
    zoneId: row.zoneId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    userCaId: row.userCaId ?? null,
    hostCaId: row.hostCaId ?? null,
    opSet: JSON.parse(row.opSet),
    ...limitsOf(row),
    revoked: !!row.revoked,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export class SshFleetTokenService {
  /** Mint a token. Returns the plaintext ONCE (never stored). */
  async mint(ctx: ServiceContext, params: MintTokenParams): Promise<{ token: string; record: FleetTokenDto }> {
    if (params.opSet.length === 0) throw new SshTokenError('opSet must not be empty');
    if (params.opSet.includes('sign-user') && !params.userCaId) throw new SshTokenError('sign-user requires a userCaId');
    if ((params.opSet.includes('sign-host') || params.opSet.includes('register-host-pubkey')) && !params.hostCaId)
      throw new SshTokenError('sign-host/register-host-pubkey require a hostCaId');
    const providedCas: any[] = [];
    for (const caId of [params.userCaId, params.hostCaId].filter(Boolean) as string[]) {
      const ca = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, caId)).limit(1))[0];
      if (!ca) throw new SshTokenError(`CA ${caId} not found`);
      providedCas.push(ca);
    }
    // The token's zone (decision-017 A2): explicit, else inferred from the CA
    // pair, else fail-closed. The user/host CA pair MUST belong to that zone.
    const zone = params.zone
      ? await resolveZone(ctx, params.zone)
      : providedCas.length
        ? await resolveZone(ctx, providedCas[0].zoneId)
        : await resolveZone(ctx);
    await assertZoneUsable(ctx, zone.id);
    for (const ca of providedCas) {
      if (ca.zoneId !== zone.id)
        throw new SshTokenError(`CA ${ca.id} belongs to a different zone than '${zone.name}'`);
    }

    // sign-user limits (TASK-247): only meaningful on a sign-user token, and the
    // principals must be real catalog entries of the token's zone.
    const hasLimits = params.allowedPrincipals !== undefined || params.maxValidForSeconds !== undefined;
    if (hasLimits && !params.opSet.includes('sign-user'))
      throw new SshTokenError('allowedPrincipals / maxValidForSeconds apply only to a token with sign-user');
    let allowedPrincipals: string[] | null = null;
    if (params.allowedPrincipals !== undefined) {
      allowedPrincipals = [...new Set(params.allowedPrincipals)].sort();
      if (!allowedPrincipals.length) throw new SshTokenError('allowedPrincipals must not be empty (omit it for no limit)');
      const found = (await ctx.db
        .select({ name: sshPrincipals.name })
        .from(sshPrincipals)
        .where(and(eq(sshPrincipals.zoneId, zone.id), inArray(sshPrincipals.name, allowedPrincipals)))) as any[];
      const known = new Set(found.map((r) => r.name));
      const unknown = allowedPrincipals.filter((p) => !known.has(p));
      if (unknown.length)
        throw new SshTokenError(`principal(s) ${unknown.join(', ')} are not in the catalog of zone '${zone.name}'`);
    }
    const maxValidForSeconds = params.maxValidForSeconds ?? null;
    if (maxValidForSeconds !== null && (!Number.isInteger(maxValidForSeconds) || maxValidForSeconds <= 0 || maxValidForSeconds > MAX_TTL))
      throw new SshTokenError('maxValidForSeconds must be a positive whole number of seconds (at most ~10 years)');

    const plain = PREFIX + randomBytes(24).toString('base64url');
    const id = randomUUID();
    await ctx.db.insert(sshFleetTokens).values({
      id,
      zoneId: zone.id,
      name: params.name,
      tokenHash: hashToken(plain),
      tokenPrefix: plain.slice(0, 12),
      userCaId: params.userCaId ?? null,
      hostCaId: params.hostCaId ?? null,
      opSet: JSON.stringify(params.opSet),
      allowedPrincipals: allowedPrincipals ? JSON.stringify(allowedPrincipals) : null,
      maxValidForSeconds,
      revoked: false,
    } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.token.mint',
      entityType: 'ssh_token',
      entityId: id,
      status: 'success',
      details: { name: params.name, opSet: params.opSet, zone: zone.name, allowedPrincipals, maxValidForSeconds },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    const record = dto((await ctx.db.select().from(sshFleetTokens).where(eq(sshFleetTokens.id, id)).limit(1))[0]);
    return { token: plain, record };
  }

  async list(ctx: ServiceContext): Promise<FleetTokenDto[]> {
    return (await ctx.db.select().from(sshFleetTokens)).map(dto);
  }

  async revoke(ctx: ServiceContext, id: string): Promise<void> {
    await ctx.db.update(sshFleetTokens).set({ revoked: true }).where(eq(sshFleetTokens.id, id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.token.revoke',
      entityType: 'ssh_token',
      entityId: id,
      status: 'success',
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  /**
   * Verify a presented bearer token (constant-time). Returns the scope or null.
   * Updates last_seen on success.
   */
  async verify(ctx: ServiceContext, presented: string | undefined, ip?: string): Promise<VerifiedToken | null> {
    if (!presented || !presented.startsWith(PREFIX)) return null;
    const hash = hashToken(presented);
    const row = (await ctx.db.select().from(sshFleetTokens).where(eq(sshFleetTokens.tokenHash, hash)).limit(1))[0];
    if (!row || row.revoked) return null;
    // Constant-time confirm (hash lookup already matched, but be explicit).
    const a = Buffer.from(hash);
    const b = Buffer.from(row.tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    await ctx.db.update(sshFleetTokens).set({ lastSeenAt: new Date(), lastSeenIp: ip ?? null }).where(eq(sshFleetTokens.id, row.id));
    return {
      id: row.id,
      zoneId: row.zoneId,
      name: row.name,
      userCaId: row.userCaId ?? null,
      hostCaId: row.hostCaId ?? null,
      opSet: JSON.parse(row.opSet),
      ...limitsOf(row),
    };
  }
}

let instance: SshFleetTokenService | null = null;
export function getSshFleetTokenService(): SshFleetTokenService {
  if (!instance) instance = new SshFleetTokenService();
  return instance;
}
