/**
 * SSH certificate signing primitive (SSH-11) — the single function host/user
 * services call. Wires the parser (SSH-02), encoder (SSH-01) and signRaw
 * (SSH-03): validates type↔CA, allocates a per-CA monotonic serial, applies a
 * host-only notBefore backdate, and persists the verbatim signed cert.
 */
import { randomUUID } from 'crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { sshCas, sshCertificates, sshHostBlocks, sshHosts, sshHostPrincipalMaps, sshPrincipals } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { buildSshCertTbs, assembleSshCert, SSH_CERT_NO_EXPIRY } from '../crypto/ssh/openssh-cert.js';
import { derToSshEcdsaSignature } from '../crypto/ssh/sign.js';
import type { ServiceContext } from './types.js';

export interface SignSshCertParams {
  caId: string;
  sshPublicKey: string; // OpenSSH authorized_keys line
  type: 'user' | 'host';
  keyId: string;
  principals: string[];
  serial?: bigint; // optional explicit serial; otherwise allocated
  validAfterSec?: number; // unix seconds; default now (host gets a backdate)
  validForSeconds: number;
  criticalOptions?: { forceCommand?: string; sourceAddress?: string };
  extensions?: string[];
  allowEmptyPrincipals?: boolean;
  sourceType?: 'manual' | 'automation';
  hostId?: string;
  identityId?: string;
}

export interface SignedSshCert {
  id: string;
  caId: string;
  certType: 'user' | 'host';
  serial: string;
  keyId: string;
  certOpenssh: string;
  fingerprint: string;
  validAfter: string;
  validBefore: string;
}

/** Host certs get a small notBefore backdate (PoC -5m) to tolerate clock skew; user certs do not. */
const HOST_BACKDATE_SECONDS = 300;

export class SshSignCaNotFoundError extends Error {
  constructor(public caId: string) {
    super(`SSH CA ${caId} not found`);
    this.name = 'SshSignCaNotFoundError';
  }
}
export class SshCaUnusableError extends Error {
  constructor(public caId: string, status: string) {
    super(`SSH CA ${caId} is ${status}; only active or rotating CAs can sign`);
    this.name = 'SshCaUnusableError';
  }
}
export class SshCertTypeMismatchError extends Error {
  constructor(certType: string, caType: string) {
    super(`cannot sign a ${certType} certificate with a ${caType} CA`);
    this.name = 'SshCertTypeMismatchError';
  }
}
export class SshPrincipalsNarrowedEmptyError extends Error {
  constructor(subjectHint: string) {
    super(
      `issuance gate: every requested principal resolves only to hosts where ${subjectHint} is blocked — refusing to issue an unusable certificate`
    );
    this.name = 'SshPrincipalsNarrowedEmptyError';
  }
}

/** BLK-13 optional hardening (decision-016, default OFF): zero-window blocks. */
const issuanceGateEnabled = () => process.env.SSH_BLOCK_ISSUANCE_GATE === 'true';

export class SshCertService {
  /** Sign and persist an OpenSSH certificate. */
  async sign(ctx: ServiceContext, params: SignSshCertParams): Promise<SignedSshCert> {
    const ca = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, params.caId)).limit(1))[0];
    if (!ca) throw new SshSignCaNotFoundError(params.caId);
    if (ca.status !== 'active' && ca.status !== 'rotating') throw new SshCaUnusableError(params.caId, ca.status);
    if (ca.caType !== params.type) throw new SshCertTypeMismatchError(params.type, ca.caType);

    const subject = parseSshPublicKey(params.sshPublicKey);
    const caBlob = parseSshPublicKey(ca.opensshPublicKey).blob;

    // BLK-13 issuance gate: when the flag is ON and the identity has active
    // blocks, replace each bare principal with host-scoped `P@<fqdn>` forms
    // that exclude the blocked hosts — the cert is BORN unable to authenticate
    // there, bounding even a never-pulling host by the residual TTL. sign() is
    // the single choke point (UI issue, bulkRenew, external sign-user).
    let principals = params.principals;
    if (params.type === 'user' && params.identityId && issuanceGateEnabled()) {
      principals = await this.narrowPrincipalsForBlocks(ctx, params.identityId, principals);
    }

    const serial = params.serial ?? (await this.allocateSerial(ctx, params.caId));
    const nowSec = Math.floor(Date.now() / 1000);
    const backdate = params.type === 'host' ? HOST_BACKDATE_SECONDS : 0;
    const validAfterSec = (params.validAfterSec ?? nowSec) - backdate;
    const validBeforeSec = (params.validAfterSec ?? nowSec) + params.validForSeconds;

    const { tbs, certType, nonce } = buildSshCertTbs({
      subjectKey: subject,
      caPublicKeyBlob: caBlob,
      serial,
      type: params.type,
      keyId: params.keyId,
      principals,
      validAfter: BigInt(validAfterSec),
      validBefore: params.validForSeconds <= 0 ? SSH_CERT_NO_EXPIRY : BigInt(validBeforeSec),
      criticalOptions: params.criticalOptions,
      extensions: params.extensions,
      allowEmptyPrincipals: params.allowEmptyPrincipals,
    });

    const kms = getKMSService();
    let line: string;
    try {
      const der = await kms.signRaw(ca.kmsKeyId, tbs, { entityId: params.caId });
      ({ line } = assembleSshCert(tbs, derToSshEcdsaSignature(der), certType, params.keyId));
    } catch (error) {
      await createAuditLog({
        db: ctx.db,
        operation: 'ssh.cert.issue',
        entityType: 'ssh_certificate',
        entityId: null as unknown as string,
        status: 'failure',
        details: { caId: params.caId, type: params.type, error: String(error) },
        ipAddress: ctx.ipAddress ?? undefined,
      });
      throw error;
    }

    const id = randomUUID();
    const validBefore = params.validForSeconds <= 0 ? new Date(8640000000000000) : new Date(validBeforeSec * 1000);
    await ctx.db.insert(sshCertificates).values({
      id,
      caId: params.caId,
      certType: params.type,
      hostId: params.hostId ?? null,
      identityId: params.identityId ?? null,
      serial: serial.toString(),
      keyId: params.keyId,
      principals: JSON.stringify(principals),
      validAfter: new Date(validAfterSec * 1000),
      validBefore,
      extensions: params.extensions ? JSON.stringify(params.extensions) : null,
      criticalOptions: params.criticalOptions ? JSON.stringify(params.criticalOptions) : null,
      certOpenssh: line,
      subjectPubkeyFingerprint: subject.fingerprintSha256,
      kmsSigningKeyId: ca.kmsKeyId,
      status: 'active',
      sourceType: params.sourceType ?? 'manual',
    } as any);

    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.cert.issue',
      entityType: 'ssh_certificate',
      entityId: id,
      status: 'success',
      details: {
        caId: params.caId,
        type: params.type,
        serial: serial.toString(),
        keyId: params.keyId,
        principals,
        ...(principals !== params.principals ? { narrowedByIssuanceGate: true, requestedPrincipals: params.principals } : {}),
      },
      ipAddress: ctx.ipAddress ?? undefined,
    });

    logger.info({ id, caId: params.caId, type: params.type, serial: serial.toString() }, 'Signed SSH certificate');
    void nonce;

    // BLK-05 issuance trigger — sign() is the single choke point (UI issue,
    // bulkRenew, external sign-user all land here with identityId): a new user
    // cert for a blocked identity regenerates the affected hosts' KRLs
    // asynchronously. Identity resolution keys off params.identityId ONLY —
    // keyId is caller-settable and MUST NOT resolve identity (decision-016).
    if (params.type === 'user' && params.identityId) {
      const identityId = params.identityId;
      void import('./ssh-host-krl.service.js')
        .then(({ getSshHostKrlService }) => getSshHostKrlService().onUserCertIssued(ctx, identityId))
        .catch((e) => logger.warn({ identityId, error: String(e) }, 'post-issuance per-host KRL trigger failed'));
    }
    return {
      id,
      caId: params.caId,
      certType: params.type,
      serial: serial.toString(),
      keyId: params.keyId,
      certOpenssh: line,
      fingerprint: subject.fingerprintSha256,
      validAfter: new Date(validAfterSec * 1000).toISOString(),
      validBefore: validBefore.toISOString(),
    };
  }

  /**
   * Re-sign a certificate with a fresh serial + key_id, linking the prior cert
   * via superseded_by and (optionally) revoking it. Preserves the host/identity
   * link so audit correlation survives the key_id change.
   */
  async renew(
    ctx: ServiceContext,
    params: SignSshCertParams & { supersedesCertId: string }
  ): Promise<SignedSshCert> {
    const signed = await this.sign(ctx, params);
    await ctx.db
      .update(sshCertificates)
      .set({ supersededBy: signed.id, updatedAt: new Date() })
      .where(eq(sshCertificates.id, params.supersedesCertId));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.cert.renew',
      entityType: 'ssh_certificate',
      entityId: signed.id,
      status: 'success',
      details: { supersedes: params.supersedesCertId },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return signed;
  }

  /**
   * BLK-13: resolve each bare principal into `P@<fqdn>` for every non-blocked,
   * non-offboarded host that maps it; principals resolving ONLY to blocked
   * hosts are dropped. Requires the dual-form auth_principals lines render()
   * pre-provisions. No active blocks → principals pass through untouched.
   */
  private async narrowPrincipalsForBlocks(ctx: ServiceContext, identityId: string, requested: string[]): Promise<string[]> {
    const blocks = (await ctx.db
      .select({ hostId: sshHostBlocks.hostId })
      .from(sshHostBlocks)
      .where(and(eq(sshHostBlocks.identityId, identityId), eq(sshHostBlocks.status, 'active')))) as any[];
    if (!blocks.length) return requested;
    const blockedHostIds = new Set(blocks.map((b) => b.hostId));

    const maps = (await ctx.db
      .select({ name: sshPrincipals.name, hostId: sshHosts.id, fqdn: sshHosts.fqdn })
      .from(sshHostPrincipalMaps)
      .innerJoin(sshPrincipals, eq(sshHostPrincipalMaps.principalId, sshPrincipals.id))
      .innerJoin(sshHosts, eq(sshHostPrincipalMaps.hostId, sshHosts.id))
      .where(and(inArray(sshPrincipals.name, requested), ne(sshHosts.status, 'offboarded')))) as any[];

    const narrowed = new Set<string>();
    for (const p of requested) {
      for (const m of maps) {
        if (m.name === p && !blockedHostIds.has(m.hostId)) narrowed.add(`${p}@${m.fqdn}`);
      }
    }
    if (!narrowed.size) throw new SshPrincipalsNarrowedEmptyError(`identity ${identityId}`);
    logger.info({ identityId, requested, narrowed: [...narrowed] }, 'issuance gate narrowed principals for blocked identity');
    return [...narrowed].sort();
  }

  /**
   * Atomically allocate the next per-CA serial. better-sqlite3 is a single
   * writer, so UPDATE … +1 RETURNING is race-free (gaps allowed, never dupes).
   */
  private async allocateSerial(ctx: ServiceContext, caId: string): Promise<bigint> {
    const rows = await ctx.db
      .update(sshCas)
      .set({ nextSerial: sql`${sshCas.nextSerial} + 1`, updatedAt: new Date() })
      .where(eq(sshCas.id, caId))
      .returning({ nextSerial: sshCas.nextSerial });
    if (!rows.length) throw new SshSignCaNotFoundError(caId);
    return BigInt(rows[0].nextSerial - 1);
  }
}

let instance: SshCertService | null = null;
export function getSshCertService(): SshCertService {
  if (!instance) instance = new SshCertService();
  return instance;
}
