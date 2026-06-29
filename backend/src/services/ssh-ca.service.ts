/**
 * SSH CA lifecycle (SSH-10, SSH-IMPORT, SSH-32a rotation support).
 * An SSH CA is a non-exportable ECDSA-P256 KMS keypair with a published OpenSSH
 * public key — no X.509 cert. Trust anchors publish both keys during rotation.
 */
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { sshCas } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import type { ServiceContext } from './types.js';

export type SshCaType = 'user' | 'host';

export interface SshCaDto {
  id: string;
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

export interface TrustAnchors {
  /** TrustedUserCAKeys lines (User CA[s], incl. predecessor during rotation). */
  userCaKeys: string[];
  /** Host CA public-key lines for @cert-authority entries. */
  hostCaKeys: string[];
}

export class SshCaExistsError extends Error {
  constructor(caType: string) {
    super(`an active ${caType} SSH CA already exists (one active CA per type)`);
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
  /** Create a non-exportable ECDSA-P256 SSH CA (decision-011). */
  async create(ctx: ServiceContext, params: { caType: SshCaType; label?: string }): Promise<SshCaDto> {
    const kms = getKMSService();
    const id = randomUUID();
    // Guard against a second active CA of this type before touching the KMS.
    const existing = await ctx.db
      .select()
      .from(sshCas)
      .where(and(eq(sshCas.caType, params.caType), eq(sshCas.status, 'active')));
    if (existing.length) throw new SshCaExistsError(params.caType);

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
        details: { caType: params.caType, fingerprint: parsed.fingerprintSha256, kmsKeyId },
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
    params: { caType: SshCaType; label?: string; kmsKeyId: string; kmsPublicKeyId: string }
  ): Promise<SshCaDto> {
    const kms = getKMSService();
    const existing = await ctx.db
      .select()
      .from(sshCas)
      .where(and(eq(sshCas.caType, params.caType), eq(sshCas.status, 'active')));
    if (existing.length) throw new SshCaExistsError(params.caType);

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

  async list(ctx: ServiceContext): Promise<SshCaDto[]> {
    return (await ctx.db.select().from(sshCas)).map(toDto);
  }

  async get(ctx: ServiceContext, id: string): Promise<SshCaDto> {
    const row = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, id)).limit(1))[0];
    if (!row) throw new SshCaNotFoundError(id);
    return toDto(row);
  }

  /**
   * Publish trust anchors. During rotation both the active successor and the
   * 'rotating' predecessor of each type are emitted so no valid cert is rejected.
   */
  async getTrustAnchors(ctx: ServiceContext): Promise<TrustAnchors> {
    const cas = await ctx.db.select().from(sshCas);
    const usable = cas.filter((c: any) => c.status === 'active' || c.status === 'rotating');
    return {
      userCaKeys: usable.filter((c: any) => c.caType === 'user').map((c: any) => c.opensshPublicKey),
      hostCaKeys: usable.filter((c: any) => c.caType === 'host').map((c: any) => c.opensshPublicKey),
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
