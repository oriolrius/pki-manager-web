/**
 * Per-host composed KRL service (BLK-03, decision-016).
 *
 *   KRL(host) = host-CA revocation set
 *             ∪ all non-retired user-CA revocation sets
 *             ∪ resolve(active blocks on host)
 *
 * Blocks are NOT revocations: resolve(identity) turns each active block into
 * (a) the serials of the identity's not-yet-expired user certs, grouped by
 * EACH cert's issuing-CA key blob REGARDLESS of that CA's status (a cert from
 * a since-retired CA keeps its serial section — fingerprints are only
 * belt-and-braces), and (b) the SHA256 fingerprint of every public key ever
 * certified for it (survives cert reissue over the same key and kills stray
 * authorized_keys entries — verified OpenSSH fact 3).
 *
 * Numbering draws from the GLOBAL ssh_krl_seq allocator shared with the
 * per-CA lineage (pinned req #4): the number is allocated BEFORE building
 * because it is embedded in the signed OpenSSH KRL header the puller's
 * anti-rollback compares. Signing uses the HOST-CA key (pinned req #1;
 * trust-anchor reconciliation is BLK-10). signRaw failure is non-fatal: the
 * row persists with ca_signature null (host_puller.sh installs it;
 * krl-client fail-stales on last-good until a signed row lands).
 */
import { randomUUID } from 'crypto';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';
import { sshCas, sshCertificates, sshRevocations, sshHosts, sshHostBlocks, sshHostKrls } from '../db/schema.js';
import { allocateKrlNumber } from '../db/krl-seq.js';
import { getKMSService } from '../kms/service.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { buildKrl, krlVersion } from '../crypto/ssh/krl.js';
import { fingerprintToHash } from './ssh-krl.service.js';
import type { ServiceContext } from './types.js';

const DEFAULT_NEXT_UPDATE_SECONDS = 3600; // 1h — lazy regen-on-fetch backstop

export class SshHostKrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshHostKrlError';
  }
}

export interface SshHostKrlDto {
  id: string;
  hostId: string;
  krlNumber: number;
  versionHash: string;
  revokedCount: number;
  blockCount: number;
  thisUpdate: string;
  nextUpdate: string;
  hasSignature: boolean;
}

export class SshHostKrlService {
  /** Build + persist the composed per-host KRL and its detached Host-CA signature. */
  async generate(ctx: ServiceContext, hostId: string): Promise<SshHostKrlDto> {
    try {
      return await this.generateInner(ctx, hostId);
    } catch (e: any) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.host_krl.generate',
        entityType: 'ssh_host_krl',
        entityId: hostId,
        status: 'failure',
        details: { hostId, error: e?.message ?? String(e) },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw e;
    }
  }

  private async generateInner(ctx: ServiceContext, hostId: string): Promise<SshHostKrlDto> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
    if (!host) throw new SshHostKrlError(`SSH host ${hostId} not found`);
    // Host offboard retires this host's KRL lineage (decision-016 lifecycle);
    // its block rows stay for audit but no new artifacts are produced.
    if (host.status === 'offboarded') throw new SshHostKrlError(`host ${hostId} is offboarded — per-host KRL lineage retired`);

    const allCas = (await ctx.db.select().from(sshCas)) as any[];
    const caById = new Map<string, any>(allCas.map((c) => [c.id, c]));
    const caBlobCache = new Map<string, Buffer>();
    const caBlob = (caId: string): Buffer | null => {
      if (!caBlobCache.has(caId)) {
        const ca = caById.get(caId);
        if (!ca) return null;
        caBlobCache.set(caId, parseSshPublicKey(ca.opensshPublicKey).blob);
      }
      return caBlobCache.get(caId)!;
    };

    // Serial groups per issuing CA + SHA256 fingerprint entries, deduped.
    const serialsByCa = new Map<string, Set<string>>();
    const addSerial = (caId: string, serial: string) => {
      if (!serialsByCa.has(caId)) serialsByCa.set(caId, new Set());
      serialsByCa.get(caId)!.add(serial);
    };
    const hashByHex = new Map<string, Buffer>();
    const addHash = (h: Buffer | null) => {
      if (h) hashByHex.set(h.toString('hex'), h);
    };

    // 1. Union of every non-retired CA's revocation set (host CAs — the set the
    //    composed artifact displaces, pinned req #2 — AND user CAs — the bonus
    //    fix: revoked user certs finally reach ECIES-pulling hosts).
    const unionCas = allCas.filter((c) => c.status !== 'retired');
    const unionCaIds = unionCas.map((c) => c.id);
    if (unionCaIds.length) {
      const revokedCerts = (await ctx.db
        .select({ caId: sshCertificates.caId, serial: sshCertificates.serial })
        .from(sshCertificates)
        .where(and(inArray(sshCertificates.caId, unionCaIds), eq(sshCertificates.status, 'revoked')))) as any[];
      for (const c of revokedCerts) addSerial(c.caId, c.serial);
      const directives = (await ctx.db
        .select()
        .from(sshRevocations)
        .where(inArray(sshRevocations.caId, unionCaIds))) as any[];
      for (const d of directives) {
        if (d.targetType === 'serial' && d.serial) addSerial(d.caId, d.serial);
        if (d.targetType === 'key_fingerprint' && d.keyFingerprint) addHash(fingerprintToHash(d.keyFingerprint));
      }
    }

    // 2. resolve(active blocks on this host). Block resolution keys off
    //    ssh_certificates.identity_id ONLY — never keyId (decision-016 hardening).
    const blocks = (await ctx.db
      .select()
      .from(sshHostBlocks)
      .where(and(eq(sshHostBlocks.hostId, hostId), eq(sshHostBlocks.status, 'active')))) as any[];
    const now = Date.now();
    if (blocks.length) {
      const identityIds = [...new Set(blocks.map((b) => b.identityId))];
      const certs = (await ctx.db
        .select()
        .from(sshCertificates)
        .where(and(inArray(sshCertificates.identityId, identityIds), eq(sshCertificates.certType, 'user')))) as any[];
      for (const cert of certs) {
        // (a) serials of not-yet-expired certs, grouped by the ISSUING CA — even a
        //     retired one (the host may still trust it; fingerprints alone are
        //     belt-and-braces, not the primary deny).
        if (new Date(cert.validBefore).getTime() > now) addSerial(cert.caId, cert.serial);
        // (b) every key ever certified for the identity, by SHA256 fingerprint.
        addHash(fingerprintToHash(cert.subjectPubkeyFingerprint));
      }
    }

    // 3. Allocate the header number BEFORE building — it is embedded in the
    //    signed KRL header (krl.ts) that anti-rollback compares.
    const krlNumber = await allocateKrlNumber(ctx.db);
    const nowSec = Math.floor(now / 1000);

    const certSerials: Array<{ caKeyBlob: Buffer; serials: bigint[] }> = [];
    for (const [caId, serials] of serialsByCa) {
      if (!serials.size) continue;
      const blob = caBlob(caId);
      if (!blob) {
        logger.warn({ hostId, caId }, 'composed KRL: issuing CA row missing; dropping its serial group');
        continue;
      }
      certSerials.push({ caKeyBlob: blob, serials: [...serials].map((s) => BigInt(s)) });
    }
    const hashes = [...hashByHex.values()];

    const blob = buildKrl({
      certSerials,
      keyHashesSha256: hashes.length ? hashes : undefined,
      krlVersionNumber: BigInt(krlNumber),
      generatedDate: BigInt(nowSec),
      comment: `pki-manager ssh host ${host.fqdn} composed KRL`,
    });
    const version = krlVersion(blob);

    // 4. Detached signature with the HOST-CA key (pinned req #1). The host's own
    //    CA lineage (via its current cert) wins; else the active host CA.
    const signingCa = await this.resolveHostCa(ctx, host, caById);
    let signature: Buffer | null = null;
    let signError: string | null = null;
    try {
      signature = await getKMSService().signRaw(signingCa.kmsKeyId, blob, { entityId: signingCa.id });
    } catch (e: any) {
      signError = e?.message ?? String(e);
      logger.warn({ hostId, caId: signingCa.id, error: signError }, 'per-host KRL signing failed; persisting unsigned row');
    }

    const id = randomUUID();
    const thisUpdate = new Date(nowSec * 1000);
    const nextUpdate = new Date((nowSec + DEFAULT_NEXT_UPDATE_SECONDS) * 1000);
    const revokedCount = certSerials.reduce((n, g) => n + g.serials.length, 0) + hashes.length;
    const blockCount = blocks.length;
    await ctx.db.insert(sshHostKrls).values({
      id,
      hostId,
      krlNumber,
      versionHash: version,
      krlBlob: blob,
      caSignature: signature,
      thisUpdate,
      nextUpdate,
      revokedCount,
      blockCount,
    } as any);

    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.host_krl.generate',
      entityType: 'ssh_host_krl',
      entityId: id,
      // Unsigned persistence is a real (recoverable) failure mode: krl-client
      // hosts fail-stale on it. Row details carry everything either way.
      status: signature ? 'success' : 'failure',
      details: {
        hostId,
        fqdn: host.fqdn,
        krlNumber,
        version,
        revokedCount,
        blockCount,
        signed: !!signature,
        ...(signError ? { signError } : {}),
      },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    logger.info({ hostId, fqdn: host.fqdn, krlNumber, version, revokedCount, blockCount, signed: !!signature }, 'Generated per-host SSH KRL');

    return {
      id,
      hostId,
      krlNumber,
      versionHash: version,
      revokedCount,
      blockCount,
      thisUpdate: thisUpdate.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
      hasSignature: !!signature,
    };
  }

  /** The Host CA whose key signs this host's composed KRL. */
  private async resolveHostCa(ctx: ServiceContext, host: any, caById: Map<string, any>): Promise<any> {
    if (host.currentCertId) {
      const cert = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.id, host.currentCertId)).limit(1))[0];
      const ca = cert ? caById.get(cert.caId) : undefined;
      if (ca && ca.caType === 'host' && ca.status !== 'retired') return ca;
    }
    const active = (await ctx.db
      .select()
      .from(sshCas)
      .where(and(eq(sshCas.caType, 'host'), ne(sshCas.status, 'retired')))
      .limit(1))[0];
    if (!active) throw new SshHostKrlError('no non-retired host CA available to sign the composed KRL');
    return active;
  }

  /** Latest per-host KRL row (or null). Used by the serving endpoints and state derivation. */
  async getLatestRow(ctx: ServiceContext, hostId: string): Promise<any | null> {
    return (
      (await ctx.db
        .select()
        .from(sshHostKrls)
        .where(eq(sshHostKrls.hostId, hostId))
        .orderBy(desc(sshHostKrls.krlNumber))
        .limit(1))[0] ?? null
    );
  }

  async getLatest(ctx: ServiceContext, hostId: string): Promise<SshHostKrlDto | null> {
    const row = await this.getLatestRow(ctx, hostId);
    if (!row) return null;
    return {
      id: row.id,
      hostId: row.hostId,
      krlNumber: row.krlNumber,
      versionHash: row.versionHash,
      revokedCount: row.revokedCount,
      blockCount: row.blockCount,
      thisUpdate: new Date(row.thisUpdate).toISOString(),
      nextUpdate: new Date(row.nextUpdate).toISOString(),
      hasSignature: !!row.caSignature,
    };
  }
}

let instance: SshHostKrlService | null = null;
export function getSshHostKrlService(): SshHostKrlService {
  if (!instance) instance = new SshHostKrlService();
  return instance;
}
