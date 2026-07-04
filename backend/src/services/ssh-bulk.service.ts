/**
 * SSH bulk operations (SSH-BULK). Short TTLs make bulk renewal the dominant
 * steady-state op. Bulk renew re-signs a set of certs (new serial + superseded_by
 * link, SSH-11 semantics); bulk revoke marks a set revoked (feeding the next KRL).
 * Returns per-item results for progress feedback.
 */
import { eq, and, lt, inArray } from 'drizzle-orm';
import { sshCertificates } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { subjectPubkeyFromCert } from '../crypto/ssh/pubkey.js';
import { getSshCertService } from './ssh-cert.service.js';
import type { ServiceContext } from './types.js';

const DEFAULT_TTL = { host: 52 * 7 * 24 * 3600, user: 7 * 24 * 3600 };

export interface BulkItemResult {
  certId: string;
  ok: boolean;
  newCertId?: string;
  serial?: string;
  error?: string;
}

export class SshBulkService {
  /** List active certs expiring within `withinSeconds`. */
  async expiring(ctx: ServiceContext, withinSeconds: number): Promise<any[]> {
    const cutoff = new Date(Date.now() + withinSeconds * 1000);
    const rows = await ctx.db
      .select()
      .from(sshCertificates)
      .where(and(eq(sshCertificates.status, 'active'), lt(sshCertificates.validBefore, cutoff)));
    return (rows as any[]).map((r) => ({
      id: r.id,
      certType: r.certType,
      keyId: r.keyId,
      serial: r.serial,
      validBefore: new Date(r.validBefore).toISOString(),
    }));
  }

  async bulkRevoke(ctx: ServiceContext, certIds: string[], reason?: string): Promise<{ revoked: number; results: BulkItemResult[] }> {
    const results: BulkItemResult[] = [];
    for (const certId of certIds) {
      try {
        const updated = await ctx.db
          .update(sshCertificates)
          .set({ status: 'revoked', revocationDate: new Date(), revocationReason: reason ?? null, updatedAt: new Date() })
          .where(and(eq(sshCertificates.id, certId), eq(sshCertificates.status, 'active')))
          .returning({ id: sshCertificates.id });
        results.push({ certId, ok: updated.length > 0, error: updated.length ? undefined : 'not found or already revoked' });
      } catch (e: any) {
        results.push({ certId, ok: false, error: e?.message });
      }
    }
    // BLK-05: these status flips feed composed per-host KRLs — one coalesced
    // invalidation for the whole batch (clamp + eager regen of blocked hosts).
    if (results.some((r) => r.ok)) {
      const { getSshHostKrlService } = await import('./ssh-host-krl.service.js');
      await getSshHostKrlService().onRevocation(ctx);
    }
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.cert.revoke',
      entityType: 'ssh_certificate',
      entityId: 'bulk',
      status: 'success',
      details: { count: results.filter((r) => r.ok).length, reason, bulk: true },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return { revoked: results.filter((r) => r.ok).length, results };
  }

  async bulkRenew(ctx: ServiceContext, certIds: string[]): Promise<{ renewed: number; results: BulkItemResult[] }> {
    const results: BulkItemResult[] = [];
    const certSvc = getSshCertService();
    const rows = await ctx.db.select().from(sshCertificates).where(inArray(sshCertificates.id, certIds));
    const byId = new Map((rows as any[]).map((r) => [r.id, r]));

    for (const certId of certIds) {
      const cert = byId.get(certId);
      if (!cert) {
        results.push({ certId, ok: false, error: 'not found' });
        continue;
      }
      try {
        const subjectPub = subjectPubkeyFromCert(cert.certOpenssh);
        const signed = await certSvc.renew(ctx, {
          caId: cert.caId,
          sshPublicKey: subjectPub,
          type: cert.certType,
          keyId: cert.keyId,
          principals: JSON.parse(cert.principals),
          extensions: cert.extensions ? JSON.parse(cert.extensions) : undefined,
          criticalOptions: cert.criticalOptions ? JSON.parse(cert.criticalOptions) : undefined,
          validForSeconds: DEFAULT_TTL[cert.certType as 'host' | 'user'],
          hostId: cert.hostId ?? undefined,
          identityId: cert.identityId ?? undefined,
          supersedesCertId: cert.id,
        });
        results.push({ certId, ok: true, newCertId: signed.id, serial: signed.serial });
      } catch (e: any) {
        results.push({ certId, ok: false, error: e?.message });
      }
    }
    return { renewed: results.filter((r) => r.ok).length, results };
  }
}

let instance: SshBulkService | null = null;
export function getSshBulkService(): SshBulkService {
  if (!instance) instance = new SshBulkService();
  return instance;
}
