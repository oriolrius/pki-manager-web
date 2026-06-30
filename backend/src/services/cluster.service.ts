import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { clusters, certificateAuthorities, auditLog, certificates } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { ServiceContext } from './types.js';

const TOKEN_PREFIX = 'pkimg_';

export class ClusterNotFoundError extends Error {
  constructor(id: string) {
    super(`Cluster not found: ${id}`);
    this.name = 'ClusterNotFoundError';
  }
}

export class ClusterRevokedError extends Error {
  constructor(id: string) {
    super(`Cluster is revoked: ${id}`);
    this.name = 'ClusterRevokedError';
  }
}

export class ClusterCANotFoundError extends Error {
  constructor(caId: string) {
    super(`CA not found for cluster: ${caId}`);
    this.name = 'ClusterCANotFoundError';
  }
}

export interface RegisterClusterParams {
  name: string;
  description?: string;
  caId: string;
  createdBy?: string;
}

export interface RegisterClusterResult {
  id: string;
  name: string;
  caId: string;
  // Plaintext token, shown ONCE at creation, never returned again
  token: string;
  tokenPrefix: string;
  createdAt: string;
}

export interface ClusterListItem {
  id: string;
  name: string;
  description: string | null;
  caId: string;
  caSubjectDn: string;
  tokenPrefix: string;
  createdBy: string | null;
  lastSeen: Date | null;
  revokedAt: Date | null;
  status: 'active' | 'revoked' | 'idle';
  k8sCertificatesCount: number;
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

export class ClusterService {
  /**
   * Register a new k8s cluster bound to a single CA. Returns plaintext token once.
   */
  async register(ctx: ServiceContext, params: RegisterClusterParams): Promise<RegisterClusterResult> {
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, params.caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new ClusterCANotFoundError(params.caId);
    }
    if (ca[0].status !== 'active') {
      throw new ClusterCANotFoundError(`${params.caId} (status=${ca[0].status})`);
    }

    const id = randomUUID();
    const { token, prefix, hash } = generateToken();
    const now = new Date();

    await ctx.db.insert(clusters).values({
      id,
      name: params.name,
      description: params.description ?? null,
      caId: params.caId,
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
      operation: 'cluster.register',
      entityType: 'cluster',
      entityId: id,
      status: 'success',
      details: JSON.stringify({ name: params.name, caId: params.caId, createdBy: params.createdBy }),
      ipAddress: ctx.ipAddress,
    } as any);

    logger.info({ clusterId: id, name: params.name, caId: params.caId }, 'Cluster registered');

    return {
      id,
      name: params.name,
      caId: params.caId,
      token,
      tokenPrefix: prefix,
      createdAt: now.toISOString(),
    };
  }

  async list(ctx: ServiceContext): Promise<ClusterListItem[]> {
    const rows = await ctx.db
      .select({
        id: clusters.id,
        name: clusters.name,
        description: clusters.description,
        caId: clusters.caId,
        caSubjectDn: certificateAuthorities.subjectDn,
        tokenPrefix: clusters.tokenPrefix,
        createdBy: clusters.createdBy,
        lastSeen: clusters.lastSeen,
        revokedAt: clusters.revokedAt,
        createdAt: clusters.createdAt,
        updatedAt: clusters.updatedAt,
      })
      .from(clusters)
      .leftJoin(certificateAuthorities, eq(clusters.caId, certificateAuthorities.id));

    const idleThresholdMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const items: ClusterListItem[] = [];
    for (const r of rows) {
      const countRows = await ctx.db
        .select({ c: sql<number>`count(*)` })
        .from(certificates)
        .where(eq(certificates.k8sClusterId, r.id));
      const count = Number(countRows[0]?.c ?? 0);

      let status: ClusterListItem['status'] = 'active';
      if (r.revokedAt) status = 'revoked';
      else if (!r.lastSeen || now - new Date(r.lastSeen).getTime() > idleThresholdMs) status = 'idle';

      items.push({
        id: r.id,
        name: r.name,
        description: r.description,
        caId: r.caId,
        caSubjectDn: r.caSubjectDn ?? '',
        tokenPrefix: r.tokenPrefix,
        createdBy: r.createdBy,
        lastSeen: r.lastSeen,
        revokedAt: r.revokedAt,
        status,
        k8sCertificatesCount: count,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
    return items;
  }

  async getById(ctx: ServiceContext, id: string): Promise<ClusterListItem> {
    const all = await this.list(ctx);
    const found = all.find((c) => c.id === id);
    if (!found) throw new ClusterNotFoundError(id);
    return found;
  }

  async revoke(ctx: ServiceContext, id: string): Promise<{ id: string; revokedAt: string }> {
    const existing = await ctx.db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
    if (!existing || existing.length === 0) throw new ClusterNotFoundError(id);
    if (existing[0].revokedAt) throw new ClusterRevokedError(id);

    const now = new Date();
    await ctx.db
      .update(clusters)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(clusters.id, id));

    await ctx.db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'cluster.revoke',
      entityType: 'cluster',
      entityId: id,
      status: 'success',
      details: JSON.stringify({ name: existing[0].name }),
      ipAddress: ctx.ipAddress,
    } as any);

    logger.info({ clusterId: id }, 'Cluster revoked');
    return { id, revokedAt: now.toISOString() };
  }

  /**
   * Verify bearer token. Returns cluster if valid + active, null otherwise.
   * Constant-time comparison via timingSafeEqual on SHA-256 hashes.
   * Updates lastSeen on success.
   */
  async verifyToken(ctx: ServiceContext, token: string): Promise<{
    id: string;
    name: string;
    caId: string;
  } | null> {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const prefix = token.slice(0, 12);
    const hash = hashToken(token);

    const candidates = await ctx.db
      .select()
      .from(clusters)
      .where(and(eq(clusters.tokenPrefix, prefix), isNull(clusters.revokedAt)));

    const incoming = Buffer.from(hash, 'hex');
    for (const c of candidates) {
      const stored = Buffer.from(c.tokenHash, 'hex');
      if (stored.length !== incoming.length) continue;
      if (timingSafeEqual(stored, incoming)) {
        // Update last_seen async, don't await on hot path
        ctx.db
          .update(clusters)
          .set({ lastSeen: new Date() })
          .where(eq(clusters.id, c.id))
          .catch?.((e: unknown) => logger.warn({ err: e }, 'Failed to update cluster.lastSeen'));
        return { id: c.id, name: c.name, caId: c.caId };
      }
    }
    return null;
  }
}

let instance: ClusterService | null = null;
export function getClusterService(): ClusterService {
  if (!instance) instance = new ClusterService();
  return instance;
}
