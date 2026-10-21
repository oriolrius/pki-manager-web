/**
 * SSH KRL service (SSH-21) — near-clone of crl.service. Revoke ops write
 * ssh_revocations rows; generate() builds the BARE unsigned OpenSSH KRL (what
 * sshd reads via RevokedKeys) AND a distinct detached CA signature (DER, SSH-04,
 * verified only by the optional puller — sshd does NOT verify it). Persists each
 * KRL with a monotonic number + sha256 version.
 */
import { randomUUID } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { sshCas, sshCertificates, sshRevocations, sshKrls, sshHosts, sshIdempotency } from '../db/schema.js';
import { allocateKrlNumber } from '../db/krl-seq.js';
import { getKMSService } from '../kms/service.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { buildKrl, krlVersion } from '../crypto/ssh/krl.js';
import type { ServiceContext } from './types.js';

const DEFAULT_NEXT_UPDATE_SECONDS = 3600; // 1h

export class SshKrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshKrlError';
  }
}

/**
 * Thrown by purgeCert when asked to hard-delete a cert that is BOTH revoked AND
 * still within its validity window, without `force`. Purging such a cert is a
 * security-relevant act (its serial is the KRL kill-switch), so the caller must
 * opt in explicitly. Maps to HTTP 409 / tRPC CONFLICT.
 */
export class SshCertPurgeForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshCertPurgeForbiddenError';
  }
}

export interface SshKrlDto {
  id: string;
  caId: string;
  krlNumber: number;
  versionHash: string;
  revokedCount: number;
  thisUpdate: string;
  nextUpdate: string;
  hasSignature: boolean;
}

export interface SshCertPurgeResult {
  ok: true;
  purged: { id: string; serial: string; caId: string; certType: string };
  /** true when the removed cert was revoked+valid and its serial was re-anchored as a standalone KRL directive so it stays revoked. */
  preservedSerial: boolean;
  /** true when a revoked+still-valid cert's serial was deliberately dropped from the KRL (re-enables any copy in the wild). */
  removedFromKrl: boolean;
  /** the regenerated CA KRL, present only when the purge could have changed it (i.e. the cert was revoked). */
  krl: SshKrlDto | null;
}

export function fingerprintToHash(fp: string): Buffer | null {
  // "SHA256:<base64-nopad>" -> 32 raw bytes
  const m = /^SHA256:(.+)$/.exec(fp.trim());
  if (!m) return null;
  let b64 = m[1];
  while (b64.length % 4) b64 += '=';
  const buf = Buffer.from(b64, 'base64');
  return buf.length === 32 ? buf : null;
}

export class SshKrlService {
  private async getCa(ctx: ServiceContext, caId: string): Promise<any> {
    const ca = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, caId)).limit(1))[0];
    if (!ca) throw new SshKrlError(`SSH CA ${caId} not found`);
    return ca;
  }

  /** Revoke an issued cert by id: flip status + write a revocation directive, then regenerate. */
  async revokeByCert(ctx: ServiceContext, certId: string, reason?: string): Promise<SshKrlDto> {
    const cert = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.id, certId)).limit(1))[0];
    if (!cert) throw new SshKrlError(`certificate ${certId} not found`);
    await ctx.db
      .update(sshCertificates)
      .set({ status: 'revoked', revocationDate: new Date(), revocationReason: reason ?? null, updatedAt: new Date() })
      .where(eq(sshCertificates.id, certId));
    await ctx.db.insert(sshRevocations).values({
      id: randomUUID(),
      caId: cert.caId,
      targetType: 'cert',
      certId,
      serial: cert.serial,
      reason: reason ?? null,
      revokedBy: ctx.ipAddress ?? null,
    } as any);
    await this.invalidateHostLineages(ctx);
    return this.generate(ctx, cert.caId);
  }

  /** Emergency: revoke a raw public key by its SHA256 fingerprint. */
  async revokeByKeyFingerprint(ctx: ServiceContext, caId: string, fingerprint: string, reason?: string): Promise<SshKrlDto> {
    await this.getCa(ctx, caId);
    if (!fingerprintToHash(fingerprint)) throw new SshKrlError('fingerprint must be SHA256:<base64>');
    await ctx.db.insert(sshRevocations).values({
      id: randomUUID(),
      caId,
      targetType: 'key_fingerprint',
      keyFingerprint: fingerprint,
      reason: reason ?? null,
      revokedBy: ctx.ipAddress ?? null,
    } as any);
    await this.invalidateHostLineages(ctx);
    return this.generate(ctx, caId);
  }

  /** Revoke an explicit serial (without a catalogued cert). */
  async revokeBySerial(ctx: ServiceContext, caId: string, serial: string, reason?: string): Promise<SshKrlDto> {
    await this.getCa(ctx, caId);
    if (!/^\d+$/.test(serial)) throw new SshKrlError('serial must be a non-negative integer');
    await ctx.db.insert(sshRevocations).values({
      id: randomUUID(),
      caId,
      targetType: 'serial',
      serial,
      reason: reason ?? null,
      revokedBy: ctx.ipAddress ?? null,
    } as any);
    await this.invalidateHostLineages(ctx);
    return this.generate(ctx, caId);
  }

  /**
   * Hard-delete a certificate and every DB trace of it — the "undo a mis-issued
   * cert" primitive (as opposed to revoke, which keeps the row and adds it to the
   * KRL). Guard-railed because a certificate is a self-contained signed credential
   * that may already exist in copies outside this DB; deleting the row does NOT
   * recall it. The KRL is the ONLY thing that stops a still-valid copy, and the
   * KRL is *derived* from DB state, so this method is careful about it:
   *
   *   - `active` (never revoked) cert  → PURE PURGE. Its serial was never in the
   *     KRL, so deleting the row is KRL-neutral. This is the intended case: a cert
   *     created by mistake that never left the server.
   *   - `revoked` + still valid        → requires `force`. By DEFAULT the serial is
   *     re-anchored as a standalone `serial` directive so the KRL keeps revoking it
   *     (the cert record disappears, the kill-switch survives). Pass
   *     `dropRevocation` to ALSO remove it from the KRL — this re-enables any copy
   *     still in the wild, so it is a deliberate, separately-flagged act.
   *   - `expired` (any)                → purge freely; the clock already rejects it.
   *
   * Always writes an `ssh.cert.purge` audit row (the cert is gone, but the ACT of
   * removing it is not) — the project's state-change audit invariant.
   */
  async purgeCert(
    ctx: ServiceContext,
    certId: string,
    opts: { force?: boolean; dropRevocation?: boolean; reason?: string } = {}
  ): Promise<SshCertPurgeResult> {
    const cert = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.id, certId)).limit(1))[0];
    if (!cert) throw new SshKrlError(`certificate ${certId} not found`);

    const expired = new Date(cert.validBefore).getTime() <= Date.now();
    const revoked = cert.status === 'revoked';
    const force = opts.force === true;
    const dropRevocation = opts.dropRevocation === true;

    // Eligibility gate: purging a revoked, still-valid cert un-arms the KRL for it.
    if (revoked && !expired && !force) {
      throw new SshCertPurgeForbiddenError(
        `certificate ${certId} (serial ${cert.serial}) is revoked and still valid: purging it removes its record, ` +
          `and its serial is what the KRL uses to keep it revoked. Pass force=true to proceed — by default the serial ` +
          `is preserved in the KRL. Add dropRevocation=true to ALSO drop it from the KRL, which re-enables any copy ` +
          `still in the wild (only safe if this certificate never left the server).`
      );
    }

    const needRegen = revoked; // an active cert's serial was never in the KRL
    let preservedSerial = false;
    let removedFromKrl = false;

    // 1. Remove any revocation directive that points at this cert (targetType='cert').
    await ctx.db.delete(sshRevocations).where(eq(sshRevocations.certId, certId));

    // 2. Keep a revoked+still-valid serial revoked unless the caller explicitly drops it.
    if (revoked && !expired && !dropRevocation) {
      await ctx.db.insert(sshRevocations).values({
        id: randomUUID(),
        caId: cert.caId,
        targetType: 'serial',
        serial: cert.serial,
        reason: opts.reason ? `purge(preserve): ${opts.reason}` : 'purge: preserved revocation of removed cert',
        revokedBy: ctx.ipAddress ?? null,
      } as any);
      preservedSerial = true;
    } else if (revoked) {
      // expired-revoked (harmless) or explicit dropRevocation → serial leaves the KRL
      removedFromKrl = !expired;
    }

    // 3. Detach dangling references so the row can be deleted / no pointer is left behind.
    await ctx.db.update(sshCertificates).set({ supersededBy: null, updatedAt: new Date() }).where(eq(sshCertificates.supersededBy, certId));
    await ctx.db.update(sshHosts).set({ currentCertId: null, updatedAt: new Date() }).where(eq(sshHosts.currentCertId, certId));
    await ctx.db.delete(sshIdempotency).where(eq(sshIdempotency.certId, certId));

    // 4. Delete the cert row itself.
    await ctx.db.delete(sshCertificates).where(eq(sshCertificates.id, certId));

    // 5. Audit the ACT (the cert is gone; the record that it was purged is not).
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.cert.purge',
      entityType: 'ssh_certificate',
      entityId: certId,
      status: 'success',
      details: {
        caId: cert.caId,
        serial: cert.serial,
        certType: cert.certType,
        priorStatus: cert.status,
        expired,
        force,
        dropRevocation,
        preservedSerial,
        removedFromKrl,
        reason: opts.reason ?? null,
      },
      ipAddress: ctx.ipAddress ?? undefined,
    });

    // 6. Rebuild the CA KRL only when this cert could have been in it.
    let krl: SshKrlDto | null = null;
    if (needRegen) {
      await this.invalidateHostLineages(ctx);
      krl = await this.generate(ctx, cert.caId);
    }

    logger.info({ certId, serial: cert.serial, caId: cert.caId, preservedSerial, removedFromKrl }, 'Purged SSH certificate');
    return {
      ok: true,
      purged: { id: certId, serial: cert.serial, caId: cert.caId, certType: cert.certType },
      preservedSerial,
      removedFromKrl,
      krl,
    };
  }

  /**
   * BLK-05: every revocation invalidates the per-host lineages (cheap
   * next_update clamp; eager coalesced regen only where blocks exist).
   * Dynamic import — ssh-host-krl.service statically imports from this module.
   */
  private async invalidateHostLineages(ctx: ServiceContext): Promise<void> {
    const { getSshHostKrlService } = await import('./ssh-host-krl.service.js');
    await getSshHostKrlService().onRevocation(ctx);
  }

  /** Build + persist the bare KRL and its detached signature for a CA. */
  async generate(ctx: ServiceContext, caId: string): Promise<SshKrlDto> {
    const ca = await this.getCa(ctx, caId);
    const caBlob = parseSshPublicKey(ca.opensshPublicKey).blob;

    // Serials: every revoked cert of this CA + explicit 'serial' directives.
    const revokedCerts = await ctx.db
      .select({ serial: sshCertificates.serial })
      .from(sshCertificates)
      .where(and(eq(sshCertificates.caId, caId), eq(sshCertificates.status, 'revoked')));
    const directives = await ctx.db.select().from(sshRevocations).where(eq(sshRevocations.caId, caId));

    const serials = new Set<string>();
    for (const c of revokedCerts as any[]) serials.add(c.serial);
    const hashes: Buffer[] = [];
    for (const d of directives as any[]) {
      if (d.targetType === 'serial' && d.serial) serials.add(d.serial);
      if (d.targetType === 'key_fingerprint' && d.keyFingerprint) {
        const h = fingerprintToHash(d.keyFingerprint);
        if (h) hashes.push(h);
      }
    }

    // BLK-03: numbers come from the GLOBAL allocator shared with the per-host
    // lineage (pinned req #4) — read-max-then-insert raced across concurrent
    // regen triggers and restarted per lineage.
    const krlNumber = await allocateKrlNumber(ctx.db);
    const now = Math.floor(Date.now() / 1000);

    const blob = buildKrl({
      certSerials: serials.size ? [{ caKeyBlob: caBlob, serials: [...serials].map((s) => BigInt(s)) }] : [],
      keyHashesSha256: hashes.length ? hashes : undefined,
      krlVersionNumber: BigInt(krlNumber),
      generatedDate: BigInt(now),
      comment: `pki-manager ssh ${ca.caType} CA ${caId}`,
    });
    const version = krlVersion(blob);

    // Detached CA signature (DER) — SSH-04 pinned format; verified only by the puller.
    let signature: Buffer | null = null;
    try {
      signature = await getKMSService().signRaw(ca.kmsKeyId, blob, { entityId: caId });
    } catch (e) {
      logger.warn({ caId, error: String(e) }, 'KRL detached signing failed; serving bare KRL only');
    }

    const id = randomUUID();
    const thisUpdate = new Date(now * 1000);
    const nextUpdate = new Date((now + DEFAULT_NEXT_UPDATE_SECONDS) * 1000);
    const revokedCount = serials.size + hashes.length;
    await ctx.db.insert(sshKrls).values({
      id,
      caId,
      krlNumber,
      versionHash: version,
      krlBlob: blob,
      caSignature: signature,
      thisUpdate,
      nextUpdate,
      revokedCount,
    } as any);

    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.krl.generate',
      entityType: 'ssh_krl',
      entityId: id,
      status: 'success',
      details: { caId, krlNumber, version, revokedCount, signed: !!signature },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    logger.info({ caId, krlNumber, version, revokedCount }, 'Generated SSH KRL');

    return { id, caId, krlNumber, versionHash: version, revokedCount, thisUpdate: thisUpdate.toISOString(), nextUpdate: nextUpdate.toISOString(), hasSignature: !!signature };
  }

  /** Latest KRL row for a CA (or null). Used by the public/authenticated serving endpoints. */
  async getLatestRow(ctx: ServiceContext, caId: string): Promise<any | null> {
    return (
      (await ctx.db.select().from(sshKrls).where(eq(sshKrls.caId, caId)).orderBy(desc(sshKrls.krlNumber)).limit(1))[0] ?? null
    );
  }

  async getLatest(ctx: ServiceContext, caId: string): Promise<SshKrlDto | null> {
    const row = await this.getLatestRow(ctx, caId);
    if (!row) return null;
    return {
      id: row.id,
      caId: row.caId,
      krlNumber: row.krlNumber,
      versionHash: row.versionHash,
      revokedCount: row.revokedCount,
      thisUpdate: new Date(row.thisUpdate).toISOString(),
      nextUpdate: new Date(row.nextUpdate).toISOString(),
      hasSignature: !!row.caSignature,
    };
  }

  async listRevocations(ctx: ServiceContext, caId: string): Promise<any[]> {
    const rows = await ctx.db.select().from(sshRevocations).where(eq(sshRevocations.caId, caId)).orderBy(desc(sshRevocations.revokedAt));
    return (rows as any[]).map((r) => ({
      id: r.id,
      targetType: r.targetType,
      serial: r.serial,
      keyFingerprint: r.keyFingerprint,
      reason: r.reason,
      revokedAt: new Date(r.revokedAt).toISOString(),
    }));
  }
}

let instance: SshKrlService | null = null;
export function getSshKrlService(): SshKrlService {
  if (!instance) instance = new SshKrlService();
  return instance;
}
