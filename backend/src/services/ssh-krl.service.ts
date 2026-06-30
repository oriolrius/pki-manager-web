/**
 * SSH KRL service (SSH-21) — near-clone of crl.service. Revoke ops write
 * ssh_revocations rows; generate() builds the BARE unsigned OpenSSH KRL (what
 * sshd reads via RevokedKeys) AND a distinct detached CA signature (DER, SSH-04,
 * verified only by the optional puller — sshd does NOT verify it). Persists each
 * KRL with a monotonic number + sha256 version.
 */
import { randomUUID } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { sshCas, sshCertificates, sshRevocations, sshKrls } from '../db/schema.js';
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

function fingerprintToHash(fp: string): Buffer | null {
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
    return this.generate(ctx, caId);
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

    const krlNumberRow = (
      await ctx.db.select().from(sshKrls).where(eq(sshKrls.caId, caId)).orderBy(desc(sshKrls.krlNumber)).limit(1)
    )[0];
    const krlNumber = krlNumberRow ? krlNumberRow.krlNumber + 1 : 1;
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
