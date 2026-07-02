/**
 * SSH monitoring metrics (SSH-MON). Machine-readable counts for alerting: certs
 * expiring within the TTL window, KRLs past next_update, and hosts that have
 * stopped pulling (last fetch older than 2x the pull interval). With +1w user
 * TTLs and pull-based KRL, a missed renewal or a stalled host must be detectable.
 */
import { and, eq, lt } from 'drizzle-orm';
import { sshCertificates, sshKrls, sshCas, sshHosts } from '../db/schema.js';
import type { ServiceContext } from './types.js';

export interface SshMetrics {
  expiringSoon: number;
  expiringSoonWindowSeconds: number;
  krlsPastNextUpdate: number;
  casWithoutKrl: number;
  stalePullingHosts: number;
  pullIntervalSeconds: number;
  generatedAt: string;
}

const DEFAULT_TTL_WINDOW = 7 * 24 * 3600; // 1w
const DEFAULT_PULL_INTERVAL = 15 * 60; // 15m

export class SshMonService {
  async metrics(ctx: ServiceContext, opts?: { ttlWindowSeconds?: number; pullIntervalSeconds?: number }): Promise<SshMetrics> {
    const ttlWindow = opts?.ttlWindowSeconds ?? DEFAULT_TTL_WINDOW;
    const pullInterval = opts?.pullIntervalSeconds ?? DEFAULT_PULL_INTERVAL;
    const now = Date.now();

    const expiring = await ctx.db
      .select({ id: sshCertificates.id })
      .from(sshCertificates)
      .where(and(eq(sshCertificates.status, 'active'), lt(sshCertificates.validBefore, new Date(now + ttlWindow * 1000))));

    const cas = await ctx.db.select({ id: sshCas.id }).from(sshCas).where(eq(sshCas.status, 'active'));
    let krlsPastNextUpdate = 0;
    let casWithoutKrl = 0;
    for (const ca of cas as any[]) {
      const latest = (
        await ctx.db.select().from(sshKrls).where(eq(sshKrls.caId, ca.id)).orderBy(sshKrls.krlNumber).limit(1)
      )[0];
      const newest = (await ctx.db.select().from(sshKrls).where(eq(sshKrls.caId, ca.id))) as any[];
      const last = newest.sort((a, b) => b.krlNumber - a.krlNumber)[0];
      if (!last) casWithoutKrl += 1;
      else if (new Date(last.nextUpdate).getTime() < now) krlsPastNextUpdate += 1;
      void latest;
    }

    // Hosts eligible for encrypted KRL distribution (ecdsa-nistp256 host key, the
    // local-decrypt ECIES model — KRLC-02) that have stopped pulling.
    const distHosts = (await ctx.db
      .select()
      .from(sshHosts)
      .where(and(eq(sshHosts.status, 'active'), eq(sshHosts.hostKeyAlgorithm, 'ecdsa-sha2-nistp256')))) as any[];
    const staleCutoff = now - 2 * pullInterval * 1000;
    const stalePullingHosts = distHosts.filter((h) => {
      const last = h.lastKrlFetchAt ? new Date(h.lastKrlFetchAt).getTime() : 0;
      return last < staleCutoff;
    }).length;

    return {
      expiringSoon: expiring.length,
      expiringSoonWindowSeconds: ttlWindow,
      krlsPastNextUpdate,
      casWithoutKrl,
      stalePullingHosts,
      pullIntervalSeconds: pullInterval,
      generatedAt: new Date(now).toISOString(),
    };
  }
}

let instance: SshMonService | null = null;
export function getSshMonService(): SshMonService {
  if (!instance) instance = new SshMonService();
  return instance;
}
