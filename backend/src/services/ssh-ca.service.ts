/**
 * SSH CA lifecycle (SSH-10, SSH-IMPORT, SSH-32a rotation support).
 * An SSH CA is a non-exportable ECDSA-P256 KMS keypair with a published OpenSSH
 * public key — no X.509 cert. Trust anchors publish both keys during rotation.
 */
import { randomUUID } from 'crypto';
import { eq, and, gt, inArray, isNull } from 'drizzle-orm';
import { sshCas, sshCertificates, sshHosts } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { resolveZone, assertZoneUsable } from './ssh-zone.service.js';
import type { ServiceContext } from './types.js';

export type SshCaType = 'user' | 'host';

export interface SshCaDto {
  id: string;
  zoneId: string;
  caType: SshCaType;
  label: string | null;
  opensshPublicKey: string;
  fingerprintSha256: string;
  keyAlgorithm: string;
  status: 'active' | 'rotating' | 'retired';
  nextSerial: number;
  predecessorCaId: string | null;
  createdAt: string;
}

/** Fleet re-issue report for a CA — the decision-028 §4 retirement gate. */
export interface CaReissueReport {
  ca: { id: string; caType: SshCaType; status: string; zoneId: string; label: string | null };
  /** The active CA of the same (zone, type) that subjects should re-issue under. */
  successorCaId: string | null;
  now: string;
  /** Still-live certs signed by this CA — retiring it would invalidate these. */
  liveCertsUnderThisCa: number;
  /** Informational: live certs already re-issued under the successor. */
  reissuedUnderSuccessor: number;
  /** Safe to retire iff no live cert is still under this CA. */
  safeToRetire: boolean;
  pending: Array<{
    certId: string;
    certType: SshCaType;
    serial: string;
    keyId: string;
    subject: string | null;
    validBefore: string;
  }>;
}

export interface TrustAnchors {
  /** TrustedUserCAKeys lines (User CA[s], incl. predecessor during rotation). */
  userCaKeys: string[];
  /** Host CA public-key lines for @cert-authority entries. */
  hostCaKeys: string[];
}

export class SshCaExistsError extends Error {
  constructor(caType: string, zone?: string) {
    super(
      zone
        ? `an active ${caType} SSH CA already exists in zone '${zone}' (one active CA per type per zone)`
        : `an active ${caType} SSH CA already exists (one active CA per type)`
    );
    this.name = 'SshCaExistsError';
  }
}
export class SshCaAlgorithmError extends Error {
  constructor(algo: string) {
    super(`SSH CA must be ECDSA nistp256 (PKCS#11 v2.40 / Cosmian compatibility), got '${algo}'`);
    this.name = 'SshCaAlgorithmError';
  }
}
export class SshCaNotFoundError extends Error {
  constructor(public id: string) {
    super(`SSH CA ${id} not found`);
    this.name = 'SshCaNotFoundError';
  }
}

function toDto(row: any): SshCaDto {
  return {
    id: row.id,
    zoneId: row.zoneId,
    caType: row.caType,
    label: row.label ?? null,
    opensshPublicKey: row.opensshPublicKey,
    fingerprintSha256: row.fingerprintSha256,
    keyAlgorithm: row.keyAlgorithm,
    status: row.status,
    nextSerial: row.nextSerial,
    predecessorCaId: row.predecessorCaId ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

export class SshCaService {
  /** Create a non-exportable ECDSA-P256 SSH CA (decision-011), scoped to a zone. */
  async create(ctx: ServiceContext, params: { caType: SshCaType; label?: string; zone?: string }): Promise<SshCaDto> {
    const kms = getKMSService();
    const id = randomUUID();
    // Resolve + gate the zone (fail-closed if ambiguous; blocked if archived).
    const zone = await resolveZone(ctx, params.zone);
    await assertZoneUsable(ctx, zone.id);
    // Guard against a second active CA of this type IN THIS ZONE before the KMS.
    const existing = await ctx.db
      .select()
      .from(sshCas)
      .where(and(eq(sshCas.zoneId, zone.id), eq(sshCas.caType, params.caType), eq(sshCas.status, 'active')));
    if (existing.length) throw new SshCaExistsError(params.caType, zone.name);

    let kmsKeyId = '';
    let kmsPublicKeyId = '';
    try {
      const keys = await kms.createSshCaKeyPair({ tags: [`ssh-${params.caType}-ca`, 'ssh-ca'], sensitive: true, entityId: id });
      kmsKeyId = keys.privateKeyId;
      kmsPublicKeyId = keys.publicKeyId;
      const line = await kms.getSshPublicKeyLine(kmsPublicKeyId, params.label ?? `ssh-${params.caType}-ca`);
      const parsed = parseSshPublicKey(line);

      await ctx.db.insert(sshCas).values({
        id,
        zoneId: zone.id,
        caType: params.caType,
        label: params.label ?? null,
        kmsKeyId,
        kmsPublicKeyId,
        opensshPublicKey: line,
        fingerprintSha256: parsed.fingerprintSha256,
        keyAlgorithm: 'ECDSA-P256',
        status: 'active',
      } as any);

      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.ca.create',
        entityType: 'ssh_ca',
        entityId: id,
        status: 'success',
        details: { caType: params.caType, zone: zone.name, fingerprint: parsed.fingerprintSha256, kmsKeyId },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      logger.info({ id, caType: params.caType, fingerprint: parsed.fingerprintSha256 }, 'Created SSH CA');
      return toDto((await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0]);
    } catch (error) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.ca.create',
        entityType: 'ssh_ca',
        entityId: id,
        status: 'failure',
        details: { caType: params.caType, error: String(error) },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw error;
    }
  }

  /**
   * Adopt an existing, already-KMS-resident EC CA keypair (SSH-IMPORT) without
   * regenerating it (no fleet re-trust). Verifies the key is usable by signing &
   * verifying a probe before persisting.
   */
  async import(
    ctx: ServiceContext,
    params: { caType: SshCaType; label?: string; kmsKeyId: string; kmsPublicKeyId: string; zone?: string }
  ): Promise<SshCaDto> {
    const kms = getKMSService();
    const zone = await resolveZone(ctx, params.zone);
    await assertZoneUsable(ctx, zone.id);
    const existing = await ctx.db
      .select()
      .from(sshCas)
      .where(and(eq(sshCas.zoneId, zone.id), eq(sshCas.caType, params.caType), eq(sshCas.status, 'active')));
    if (existing.length) throw new SshCaExistsError(params.caType, zone.name);

    const line = await kms.getSshPublicKeyLine(params.kmsPublicKeyId, params.label ?? `ssh-${params.caType}-ca`);
    const parsed = parseSshPublicKey(line);
    if (parsed.algo !== 'ecdsa-sha2-nistp256') throw new SshCaAlgorithmError(parsed.algo);

    // Prove the key can sign and the signature verifies (decision-011 path).
    const probe = Buffer.from(`ssh-ca-import-probe:${parsed.fingerprintSha256}`);
    const der = await kms.signRaw(params.kmsKeyId, probe);
    const ok = await kms.signatureVerify(params.kmsPublicKeyId, probe, der);
    if (!ok) throw new Error('imported CA key failed a sign/verify probe; refusing to adopt');

    const id = randomUUID();
    await ctx.db.insert(sshCas).values({
      id,
      zoneId: zone.id,
      caType: params.caType,
      label: params.label ?? null,
      kmsKeyId: params.kmsKeyId,
      kmsPublicKeyId: params.kmsPublicKeyId,
      opensshPublicKey: line,
      fingerprintSha256: parsed.fingerprintSha256,
      keyAlgorithm: 'ECDSA-P256',
      status: 'active',
    } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.ca.import',
      entityType: 'ssh_ca',
      entityId: id,
      status: 'success',
      details: { caType: params.caType, fingerprint: parsed.fingerprintSha256, kmsKeyId: params.kmsKeyId },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return toDto((await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0]);
  }

  async list(ctx: ServiceContext, opts?: { zoneId?: string }): Promise<SshCaDto[]> {
    const rows = opts?.zoneId
      ? await ctx.db.select().from(sshCas).where(eq(sshCas.zoneId, opts.zoneId))
      : await ctx.db.select().from(sshCas);
    return (rows as any[]).map(toDto);
  }

  async get(ctx: ServiceContext, id: string): Promise<SshCaDto> {
    const row = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0];
    if (!row) throw new SshCaNotFoundError(id);
    return toDto(row);
  }

  /**
   * Publish trust anchors for a zone (decision-017 §5 — the zone IS the trust
   * boundary). During rotation both the active successor and the 'rotating'
   * predecessor of each type are emitted so no valid cert is rejected. The zone
   * is resolved fail-closed (A1): omit it only while a single zone exists.
   */
  async getTrustAnchors(ctx: ServiceContext, zone?: string): Promise<TrustAnchors> {
    const z = await resolveZone(ctx, zone);
    const cas = await ctx.db.select().from(sshCas).where(eq(sshCas.zoneId, z.id));
    const usable = cas.filter((c: any) => c.status === 'active' || c.status === 'rotating');
    return {
      userCaKeys: usable.filter((c: any) => c.caType === 'user').map((c: any) => c.opensshPublicKey),
      hostCaKeys: usable.filter((c: any) => c.caType === 'host').map((c: any) => c.opensshPublicKey),
    };
  }

  /**
   * Rotate a CA (SSH-32a): mark the predecessor 'rotating' (still trusted until
   * its certs expire), provision a successor active CA linked to it. Both keys
   * are published by getTrustAnchors during overlap; new issuance uses the
   * successor (resolvers pick the active CA).
   */
  async rotate(ctx: ServiceContext, id: string, overlapSeconds = 53 * 7 * 24 * 3600): Promise<{ predecessor: SshCaDto; successor: SshCaDto }> {
    const old = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0];
    if (!old) throw new SshCaNotFoundError(id);
    if (old.status !== 'active') throw new SshCaAlgorithmError(`only an active CA can be rotated (status: ${old.status})`);

    // (1) VALIDATE ZONE up front, before any write. An archived (or otherwise
    // unusable) zone aborts here so a rotation can never strand the predecessor
    // — the old code demoted first and only then discovered the zone was
    // archived, leaving the zone with a 'rotating'-only CA and no active one.
    const zone = await resolveZone(ctx, old.zoneId);
    await assertZoneUsable(ctx, zone.id);

    // (2) CREATE SUCCESSOR keypair in the KMS (async/external) BEFORE touching
    // the DB. A KMS failure leaves the predecessor active and untouched.
    const successorId = randomUUID();
    const label = `${old.label ?? old.caType} (rotated ${new Date().toISOString().slice(0, 10)})`;
    const kms = getKMSService();
    try {
      const keys = await kms.createSshCaKeyPair({ tags: [`ssh-${old.caType}-ca`, 'ssh-ca'], sensitive: true, entityId: successorId });
      const line = await kms.getSshPublicKeyLine(keys.publicKeyId, label);
      const parsed = parseSshPublicKey(line);

      // (3) ATOMIC SWAP: demote predecessor + insert active successor in a
      // single synchronous better-sqlite3 transaction, so the DB never shows a
      // partial state (either both apply or neither). The demote must run
      // before the insert because uq_ssh_cas_active_type forbids two 'active'
      // CAs per (zone, ca_type); wrapping both in one transaction makes the
      // physical order invisible to any other reader.
      ctx.db.transaction((tx: any) => {
        tx.update(sshCas)
          .set({ status: 'rotating', retireAfter: new Date(Date.now() + overlapSeconds * 1000), updatedAt: new Date() })
          .where(eq(sshCas.id, id))
          .run();
        tx.insert(sshCas)
          .values({
            id: successorId,
            zoneId: zone.id,
            caType: old.caType,
            label,
            kmsKeyId: keys.privateKeyId,
            kmsPublicKeyId: keys.publicKeyId,
            opensshPublicKey: line,
            fingerprintSha256: parsed.fingerprintSha256,
            keyAlgorithm: 'ECDSA-P256',
            status: 'active',
            predecessorCaId: id,
          } as any)
          .run();
      });
    } catch (error) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.ca.rotate',
        entityType: 'ssh_ca',
        entityId: successorId,
        status: 'failure',
        details: { predecessor: id, caType: old.caType, error: String(error) },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw error;
    }

    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.ca.rotate',
      entityType: 'ssh_ca',
      entityId: successorId,
      status: 'success',
      details: { predecessor: id, caType: old.caType },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    logger.info({ predecessor: id, successor: successorId, caType: old.caType }, 'Rotated SSH CA');
    return { predecessor: await this.get(ctx, id), successor: await this.get(ctx, successorId) };
  }

  /** Retire a 'rotating' predecessor once its certs have expired. */
  async retire(ctx: ServiceContext, id: string): Promise<SshCaDto> {
    const row = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0];
    if (!row) throw new SshCaNotFoundError(id);
    await ctx.db.update(sshCas).set({ status: 'retired', updatedAt: new Date() }).where(eq(sshCas.id, id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.ca.rotate',
      entityType: 'ssh_ca',
      entityId: id,
      status: 'success',
      details: { action: 'retire-predecessor' },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return this.get(ctx, id);
  }

  /**
   * Fleet re-issue report for a CA — the retirement gate (decision-028 §4). A CA
   * is safe to retire once it has signed ZERO still-live certificates: retiring
   * it invalidates everything it signed, so any subject whose LIVE cert is still
   * under this CA has not yet re-issued under the zone's active successor.
   *
   * "live" = status 'active' AND not past validBefore. `pending` lists exactly
   * the certs (with host fqdn where known) that block retirement.
   */
  async reissueReport(ctx: ServiceContext, caId: string): Promise<CaReissueReport> {
    const ca = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, caId)).limit(1))[0];
    if (!ca) throw new SshCaNotFoundError(caId);

    // The active CA of the same (zone, type) — what subjects should re-issue under.
    const successor = (
      await ctx.db
        .select()
        .from(sshCas)
        .where(and(eq(sshCas.zoneId, ca.zoneId), eq(sshCas.caType, ca.caType), eq(sshCas.status, 'active')))
        .limit(1)
    )[0];

    const now = new Date();
    // A cert counts as "live" only if it is the operative one: active, not past
    // validBefore, and NOT superseded by a renewal (renew() sets supersededBy but
    // leaves status='active', so a re-issued cert's predecessor must be excluded
    // or the gate would never open).
    const liveUnderOld = (await ctx.db
      .select()
      .from(sshCertificates)
      .where(
        and(
          eq(sshCertificates.caId, caId),
          eq(sshCertificates.status, 'active'),
          isNull(sshCertificates.supersededBy),
          gt(sshCertificates.validBefore, now)
        )
      )) as any[];

    const reissuedUnderSuccessor = successor
      ? (
          (await ctx.db
            .select()
            .from(sshCertificates)
            .where(
              and(
                eq(sshCertificates.caId, successor.id),
                eq(sshCertificates.status, 'active'),
                isNull(sshCertificates.supersededBy),
                gt(sshCertificates.validBefore, now)
              )
            )) as any[]
        ).length
      : 0;

    // Resolve host fqdns for the blocking certs (user certs carry identityId instead).
    const hostIds = [...new Set(liveUnderOld.map((c) => c.hostId).filter(Boolean) as string[])];
    const hosts = hostIds.length
      ? ((await ctx.db.select().from(sshHosts).where(inArray(sshHosts.id, hostIds))) as any[])
      : [];
    const fqdnById = new Map(hosts.map((h) => [h.id, h.fqdn as string]));

    const pending = liveUnderOld.map((c) => ({
      certId: c.id as string,
      certType: c.certType as SshCaType,
      serial: c.serial as string,
      keyId: c.keyId as string,
      subject: c.hostId ? (fqdnById.get(c.hostId) ?? null) : ((c.identityId as string | null) ?? null),
      validBefore: new Date(c.validBefore).toISOString(),
    }));

    return {
      ca: { id: ca.id, caType: ca.caType, status: ca.status, zoneId: ca.zoneId, label: ca.label ?? null },
      successorCaId: successor?.id ?? null,
      now: now.toISOString(),
      liveCertsUnderThisCa: liveUnderOld.length,
      reissuedUnderSuccessor,
      safeToRetire: liveUnderOld.length === 0,
      pending,
    };
  }

  /** Retire (revoke) a CA. */
  async revoke(ctx: ServiceContext, id: string, reason?: string): Promise<SshCaDto> {
    const row = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0];
    if (!row) throw new SshCaNotFoundError(id);
    await ctx.db
      .update(sshCas)
      .set({ status: 'retired', revocationDate: new Date(), revocationReason: reason ?? null, updatedAt: new Date() })
      .where(eq(sshCas.id, id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.ca.revoke',
      entityType: 'ssh_ca',
      entityId: id,
      status: 'success',
      details: { reason },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return this.get(ctx, id);
  }
}

let instance: SshCaService | null = null;
export function getSshCaService(): SshCaService {
  if (!instance) instance = new SshCaService();
  return instance;
}
