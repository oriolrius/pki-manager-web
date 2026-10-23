import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { integrations, certificateAuthorities, auditLog, certificates } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { ServiceContext } from './types.js';

const TOKEN_PREFIX = 'pkimg_';

export class IntegrationNotFoundError extends Error {
  constructor(id: string) {
    super(`Integration not found: ${id}`);
    this.name = 'IntegrationNotFoundError';
  }
}

export class IntegrationRevokedError extends Error {
  constructor(id: string) {
    super(`Integration is revoked: ${id}`);
    this.name = 'IntegrationRevokedError';
  }
}

export class IntegrationCANotFoundError extends Error {
  constructor(caId: string) {
    super(`CA not found for integration: ${caId}`);
    this.name = 'IntegrationCANotFoundError';
  }
}

export type IntegrationKind = 'kubernetes' | 'scep' | 'generic';

export interface RegisterIntegrationParams {
  name: string;
  description?: string;
  caId: string;
  createdBy?: string;
  kind?: IntegrationKind;
}

export interface RegisterIntegrationResult {
  id: string;
  name: string;
  caId: string;
  kind: IntegrationKind;
  // Plaintext token, shown ONCE at creation, never returned again
  token: string;
  tokenPrefix: string;
  createdAt: string;
}

export interface IntegrationListItem {
  id: string;
  name: string;
  description: string | null;
  caId: string;
  caSubjectDn: string;
  kind: IntegrationKind;
  tokenPrefix: string;
  createdBy: string | null;
  lastSeen: Date | null;
  revokedAt: Date | null;
  status: 'active' | 'revoked' | 'idle';
  certificatesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): { token: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}${raw}`;
  const prefix = token.slice(0, 12);
  const hash = hashToken(token);
  return { token, prefix, hash };
}

export class IntegrationService {
  async register(ctx: ServiceContext, params: RegisterIntegrationParams): Promise<RegisterIntegrationResult> {
    try {
      return await this.registerIdentity(ctx, params);
    } catch (error) {
      await this.auditFailure(ctx, 'integration.register', params.caId, error);
      throw error;
    }
  }

  async revoke(ctx: ServiceContext, id: string): Promise<{ id: string; revokedAt: string }> {
    try {
      return await this.revokeIdentity(ctx, id);
    } catch (error) {
      await this.auditFailure(ctx, 'integration.revoke', id, error);
      throw error;
    }
  }

  private async auditFailure(ctx: ServiceContext, operation: string, entityId: string, error: unknown) {
    await ctx.db.insert(auditLog).values({
      id: randomUUID(), operation, entityType: 'integration', entityId,
      status: 'failure', ipAddress: ctx.ipAddress,
      details: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown failure' }),
    });
  }

  /**
   * Register a new service integration bound to a single CA. Returns plaintext token once.
   */
  private async registerIdentity(ctx: ServiceContext, params: RegisterIntegrationParams): Promise<RegisterIntegrationResult> {
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, params.caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new IntegrationCANotFoundError(params.caId);
    }
    if (ca[0].status !== 'active') {
      throw new IntegrationCANotFoundError(`${params.caId} (status=${ca[0].status})`);
    }

    const id = randomUUID();
    const { token, prefix, hash } = generateToken();
    const now = new Date();

    await ctx.db.insert(integrations).values({
      id,
      name: params.name,
      description: params.description ?? null,
      caId: params.caId,
      kind: params.kind ?? 'generic',
      tokenHash: hash,
      tokenPrefix: prefix,
      createdBy: params.createdBy ?? null,
      lastSeen: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'integration.register',
      entityType: 'integration',
      entityId: id,
      status: 'success',
      details: JSON.stringify({ name: params.name, caId: params.caId, createdBy: params.createdBy }),
      ipAddress: ctx.ipAddress,
    });

    logger.info({ integrationId: id, name: params.name, caId: params.caId }, 'Integration registered');

    return {
      id,
      name: params.name,
      caId: params.caId,
      kind: params.kind ?? 'generic',
      token,
      tokenPrefix: prefix,
      createdAt: now.toISOString(),
    };
  }

  async list(ctx: ServiceContext): Promise<IntegrationListItem[]> {
    const rows = await ctx.db
      .select({
        id: integrations.id,
        name: integrations.name,
        kind: integrations.kind,
        description: integrations.description,
        caId: integrations.caId,
        caSubjectDn: certificateAuthorities.subjectDn,
        tokenPrefix: integrations.tokenPrefix,
        createdBy: integrations.createdBy,
        lastSeen: integrations.lastSeen,
        revokedAt: integrations.revokedAt,
        createdAt: integrations.createdAt,
        updatedAt: integrations.updatedAt,
      })
      .from(integrations)
      .leftJoin(certificateAuthorities, eq(integrations.caId, certificateAuthorities.id));

    const idleThresholdMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const items: IntegrationListItem[] = [];
    for (const r of rows) {
      const countRows = await ctx.db
        .select({ c: sql<number>`count(*)` })
        .from(certificates)
        .where(eq(certificates.integrationId, r.id));
      const count = Number(countRows[0]?.c ?? 0);

      let status: IntegrationListItem['status'] = 'active';
      if (r.revokedAt) status = 'revoked';
      else if (!r.lastSeen || now - new Date(r.lastSeen).getTime() > idleThresholdMs) status = 'idle';

      items.push({
        id: r.id,
        name: r.name,
        kind: r.kind,
        description: r.description,
        caId: r.caId,
        caSubjectDn: r.caSubjectDn ?? '',
        tokenPrefix: r.tokenPrefix,
        createdBy: r.createdBy,
        lastSeen: r.lastSeen,
        revokedAt: r.revokedAt,
        status,
        certificatesCount: count,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
    return items;
  }

  async getById(ctx: ServiceContext, id: string): Promise<IntegrationListItem> {
    const all = await this.list(ctx);
    const found = all.find((c) => c.id === id);
    if (!found) throw new IntegrationNotFoundError(id);
    return found;
  }

  private async revokeIdentity(ctx: ServiceContext, id: string): Promise<{ id: string; revokedAt: string }> {
    const existing = await ctx.db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    if (!existing || existing.length === 0) throw new IntegrationNotFoundError(id);
    if (existing[0].revokedAt) throw new IntegrationRevokedError(id);

    const now = new Date();
    await ctx.db
      .update(integrations)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(integrations.id, id));

    await ctx.db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'integration.revoke',
      entityType: 'integration',
      entityId: id,
      status: 'success',
      details: JSON.stringify({ name: existing[0].name }),
      ipAddress: ctx.ipAddress,
    });

    logger.info({ integrationId: id }, 'Integration revoked');
    return { id, revokedAt: now.toISOString() };
  }

  /**
   * Verify bearer token. Returns integration if valid + active, null otherwise.
   * Constant-time comparison via timingSafeEqual on SHA-256 hashes.
   * Updates lastSeen on success.
   */
  async verifyToken(ctx: ServiceContext, token: string): Promise<{
    id: string;
    name: string;
    caId: string;
    kind: IntegrationKind;
  } | null> {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const prefix = token.slice(0, 12);
    const hash = hashToken(token);

    const candidates = await ctx.db
      .select()
      .from(integrations)
      .where(and(eq(integrations.tokenPrefix, prefix), isNull(integrations.revokedAt)));

    const incoming = Buffer.from(hash, 'hex');
    for (const c of candidates) {
      const stored = Buffer.from(c.tokenHash, 'hex');
      if (stored.length !== incoming.length) continue;
      if (timingSafeEqual(stored, incoming)) {
        // Persist usage metadata before returning the verified identity.
        await ctx.db
          .update(integrations)
          .set({ lastSeen: new Date() })
          .where(eq(integrations.id, c.id));
        return { id: c.id, name: c.name, caId: c.caId, kind: c.kind };
      }
    }
    return null;
  }
}

let instance: IntegrationService | null = null;
export function getIntegrationService(): IntegrationService {
  if (!instance) instance = new IntegrationService();
  return instance;
}
