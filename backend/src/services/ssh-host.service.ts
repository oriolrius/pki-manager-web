/**
 * SSH host certificate service (SSH-12). Register a host (pasted host pubkey),
 * issue a Host-CA-signed cert (principals = FQDN + IPs), and produce a ready-to-
 * paste sshd_config drop-in. Never accepts a private key.
 */
import { randomUUID } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { sshHosts, sshCas, sshCertificates } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { getSshCertService } from './ssh-cert.service.js';
import { sshdConfigDropIn, isValidHostId } from './ssh-config.js';
import type { ServiceContext } from './types.js';

const DEFAULT_HOST_TTL = 52 * 7 * 24 * 3600; // +52w

export class SshHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshHostError';
  }
}

export interface SshHostDto {
  id: string;
  fqdn: string;
  displayName: string | null;
  addresses: string[];
  status: 'pending' | 'active' | 'offboarded';
  hasPubkey: boolean;
  currentCertId: string | null;
  kmsPubkeyId: string | null;
  lastKrlVersion: string | null;
  lastKrlFetchAt: string | null;
  enrolledAt: string | null;
}

function hostDto(row: any): SshHostDto {
  return {
    id: row.id,
    fqdn: row.fqdn,
    displayName: row.displayName ?? null,
    addresses: row.addresses ? JSON.parse(row.addresses) : [],
    status: row.status,
    hasPubkey: !!row.opensshHostPubkey,
    currentCertId: row.currentCertId ?? null,
    kmsPubkeyId: row.kmsPubkeyId ?? null,
    lastKrlVersion: row.lastKrlVersion ?? null,
    lastKrlFetchAt: row.lastKrlFetchAt ? new Date(row.lastKrlFetchAt).toISOString() : null,
    enrolledAt: row.enrolledAt ? new Date(row.enrolledAt).toISOString() : null,
  };
}

export class SshHostService {
  /** Register a host with its pasted public host key. */
  async register(
    ctx: ServiceContext,
    params: { fqdn: string; displayName?: string; addresses: string[]; opensshHostPubkey: string }
  ): Promise<SshHostDto> {
    if (!isValidHostId(params.fqdn)) throw new SshHostError(`invalid fqdn '${params.fqdn}'`);
    const parsed = parseSshPublicKey(params.opensshHostPubkey); // throws on private key / garbage
    const id = randomUUID();
    // principals = fqdn + any extra addresses, deduped, fqdn first.
    const addresses = Array.from(new Set([params.fqdn, ...params.addresses]));
    await ctx.db.insert(sshHosts).values({
      id,
      fqdn: params.fqdn,
      displayName: params.displayName ?? null,
      addresses: JSON.stringify(addresses),
      opensshHostPubkey: parsed.blob ? params.opensshHostPubkey.trim() : null,
      hostKeyAlgorithm: parsed.algo,
      status: 'pending',
    } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.host.register',
      entityType: 'ssh_host',
      entityId: id,
      status: 'success',
      details: { fqdn: params.fqdn, addresses },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return hostDto((await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, id)).limit(1))[0]);
  }

  /** Issue (or renew) a Host-CA-signed certificate for a registered host. */
  async issue(
    ctx: ServiceContext,
    params: { hostId: string; caId?: string; validForSeconds?: number; keyId?: string; serial?: bigint; sourceType?: 'manual' | 'automation' }
  ): Promise<{ host: SshHostDto; cert: { id: string; serial: string; keyId: string; certOpenssh: string; validBefore: string }; sshdConfig: string }> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, params.hostId)).limit(1))[0];
    if (!host) throw new SshHostError(`host ${params.hostId} not found`);
    if (host.status === 'offboarded') throw new SshHostError('host is offboarded; cannot issue certificates');
    if (!host.opensshHostPubkey) throw new SshHostError('host has no registered public key');

    const ca = await this.resolveHostCa(ctx, params.caId);
    const addresses: string[] = host.addresses ? JSON.parse(host.addresses) : [host.fqdn];
    const date = new Date().toISOString().slice(0, 10);
    const ttl = params.validForSeconds ?? DEFAULT_HOST_TTL;

    const priorCertId = host.currentCertId as string | null;
    const certSvc = getSshCertService();
    const signParams = {
      caId: ca.id,
      sshPublicKey: host.opensshHostPubkey,
      type: 'host' as const,
      keyId: params.keyId ?? `${host.fqdn}-${date}`,
      principals: addresses,
      serial: params.serial,
      validForSeconds: ttl,
      sourceType: params.sourceType ?? 'manual',
      hostId: host.id,
    };
    const cert = priorCertId
      ? await certSvc.renew(ctx, { ...signParams, supersedesCertId: priorCertId })
      : await certSvc.sign(ctx, signParams);

    await ctx.db
      .update(sshHosts)
      .set({ currentCertId: cert.id, status: 'active', enrolledAt: host.enrolledAt ?? new Date(), updatedAt: new Date() })
      .where(eq(sshHosts.id, host.id));

    const updated = hostDto((await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, host.id)).limit(1))[0]);
    return {
      host: updated,
      cert: { id: cert.id, serial: cert.serial, keyId: cert.keyId, certOpenssh: cert.certOpenssh, validBefore: cert.validBefore },
      sshdConfig: sshdConfigDropIn(),
    };
  }

  async list(ctx: ServiceContext): Promise<SshHostDto[]> {
    return (await ctx.db.select().from(sshHosts).orderBy(desc(sshHosts.createdAt))).map(hostDto);
  }

  async get(ctx: ServiceContext, id: string): Promise<SshHostDto & { sshdConfig: string; currentCert: string | null }> {
    const row = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, id)).limit(1))[0];
    if (!row) throw new SshHostError(`host ${id} not found`);
    let currentCert: string | null = null;
    if (row.currentCertId) {
      const c = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.id, row.currentCertId)).limit(1))[0];
      currentCert = c?.certOpenssh ?? null;
    }
    return { ...hostDto(row), sshdConfig: sshdConfigDropIn(), currentCert };
  }

  /** Mark the host's active cert revoked (eligible for the next KRL build). */
  async revokeCurrent(ctx: ServiceContext, id: string, reason?: string): Promise<void> {
    const row = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, id)).limit(1))[0];
    if (!row?.currentCertId) throw new SshHostError('host has no active certificate to revoke');
    await ctx.db
      .update(sshCertificates)
      .set({ status: 'revoked', revocationDate: new Date(), revocationReason: reason ?? null, updatedAt: new Date() })
      .where(eq(sshCertificates.id, row.currentCertId));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.host.revoke',
      entityType: 'ssh_certificate',
      entityId: row.currentCertId,
      status: 'success',
      details: { hostId: id, reason },
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  /**
   * Register a per-host ECIES keypair in the KMS, tagged by host (SSH-15, gated
   * on the SSH-23 spike which proved ECIES viable). Stores the public key id on
   * the host (for encryption); returns the private key id for the puller config.
   * The keypair's fingerprint is NOT the SSH host key — it is a dedicated
   * KMS-resident distribution key (matches host_puller.sh HOST_PRIV_KEY_ID).
   */
  async registerEciesKey(ctx: ServiceContext, hostId: string): Promise<{ kmsPublicKeyId: string; kmsPrivateKeyId: string }> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
    if (!host) throw new SshHostError(`host ${hostId} not found`);
    const { getKMSService } = await import('../kms/service.js');
    const { publicKeyId, privateKeyId } = await getKMSService().registerHostEciesKey(host.fqdn);
    await ctx.db.update(sshHosts).set({ kmsPubkeyId: publicKeyId, updatedAt: new Date() }).where(eq(sshHosts.id, hostId));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.host.register_pubkey',
      entityType: 'ssh_host',
      entityId: hostId,
      status: 'success',
      details: { kmsPublicKeyId: publicKeyId },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return { kmsPublicKeyId: publicKeyId, kmsPrivateKeyId: privateKeyId };
  }

  private async resolveHostCa(ctx: ServiceContext, caId?: string): Promise<any> {
    if (caId) {
      const ca = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, caId)).limit(1))[0];
      if (!ca) throw new SshHostError(`CA ${caId} not found`);
      if (ca.caType !== 'host') throw new SshHostError('selected CA is not a Host CA');
      return ca;
    }
    const ca = (
      await ctx.db.select().from(sshCas).where(and(eq(sshCas.caType, 'host'), eq(sshCas.status, 'active'))).limit(1)
    )[0];
    if (!ca) throw new SshHostError('no active Host CA — create one first');
    return ca;
  }
}

let instance: SshHostService | null = null;
export function getSshHostService(): SshHostService {
  if (!instance) instance = new SshHostService();
  return instance;
}
