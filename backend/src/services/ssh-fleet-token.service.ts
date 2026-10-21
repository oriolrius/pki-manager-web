/**
 * SSH automation fleet-token service (SSH-19). Mints bearer tokens for the
 * external signing API, stored only as a SHA-256 hash and verified in constant
 * time. One token is scoped to a CA pair (user/host) + an op-set. The plaintext
 * (pkimg_…) is returned exactly once at mint time.
 */
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { sshFleetTokens, sshCas } from '../db/schema.js';
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

export interface MintTokenParams {
  name: string;
  userCaId?: string;
  hostCaId?: string;
  opSet: SshTokenOp[];
  zone?: string;
}

export interface FleetTokenDto {
  id: string;
  zoneId: string;
  name: string;
  tokenPrefix: string;
  userCaId: string | null;
  hostCaId: string | null;
  opSet: SshTokenOp[];
  revoked: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface VerifiedToken {
  id: string;
  zoneId: string;
  name: string;
  userCaId: string | null;
  hostCaId: string | null;
  opSet: SshTokenOp[];
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
      revoked: false,
    } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.token.mint',
      entityType: 'ssh_token',
      entityId: id,
      status: 'success',
      details: { name: params.name, opSet: params.opSet, zone: zone.name },
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
    return { id: row.id, zoneId: row.zoneId, name: row.name, userCaId: row.userCaId ?? null, hostCaId: row.hostCaId ?? null, opSet: JSON.parse(row.opSet) };
  }
}

let instance: SshFleetTokenService | null = null;
export function getSshFleetTokenService(): SshFleetTokenService {
  if (!instance) instance = new SshFleetTokenService();
  return instance;
}
