/**
 * SSH host certificate service (SSH-12). Register a host (pasted host pubkey),
 * issue a Host-CA-signed cert (principals = FQDN + IPs), and produce a ready-to-
 * paste sshd_config drop-in. Never accepts a private key.
 */
import { randomUUID } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { sshHosts, sshCas, sshCertificates } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { parseSshPublicKey, type SshKeyAlgo } from '../crypto/ssh/pubkey.js';
import { getSshCertService } from './ssh-cert.service.js';
import {
  sshdConfigDropIn,
  isValidHostId,
  hostKeyPathFor,
  hostCertFilename,
  SSHD_DROPIN_PATH,
  SSHD_DROPIN_FILENAME,
  USER_CA_PATH,
  REVOKED_KEYS_PATH,
} from './ssh-config.js';
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
  /** Algorithm of the registered host key — drives the cert/key filenames. */
  hostKeyAlgorithm: SshKeyAlgo;
  currentCertId: string | null;
  kmsPubkeyId: string | null;
  lastKrlVersion: string | null;
  lastKrlFetchAt: string | null;
  enrolledAt: string | null;
}

/** One file an admin must place on the host, with its target path + perms. */
export interface HostDeployFile {
  /** Short label for the UI (e.g. "User CA public key"). */
  name: string;
  /** Absolute path on the host where the file belongs. */
  path: string;
  /** Suggested download filename. */
  filename: string;
  /** Verbatim file contents. */
  content: string;
  /** Octal mode hint (e.g. "0444"). */
  mode: string;
  /** True for the per-account auth_principals files (carry the stale flag). */
  isAuthPrincipals?: boolean;
}

/** Everything a host admin must place on ONE server, assembled from live data. */
export interface HostDeployBundle {
  fqdn: string;
  hostKeyAlgorithm: SshKeyAlgo;
  /** Host CA id powering the KRL URL, or null if no CA/cert resolved yet. */
  hostCaId: string | null;
  /** False when the host has no issued certificate yet. */
  hasCert: boolean;
  /** Ordered list of files to place on the server. */
  files: HostDeployFile[];
  /** True if principal maps changed since the last push (auth_principals stale). */
  principalsStale: boolean;
  /** KRL refresh setup (the /krl/<caId>.bin URL + a ready cron snippet), or null. */
  krl: { url: string; setup: string } | null;
  /** Validate + reload commands. */
  reloadCommands: string;
  /** Plain-language prerequisites callout. */
  prerequisites: string;
}

function hostDto(row: any): SshHostDto {
  return {
    id: row.id,
    fqdn: row.fqdn,
    displayName: row.displayName ?? null,
    addresses: row.addresses ? JSON.parse(row.addresses) : [],
    status: row.status,
    hasPubkey: !!row.opensshHostPubkey,
    hostKeyAlgorithm: (row.hostKeyAlgorithm as SshKeyAlgo) ?? 'ssh-ed25519',
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
      sshdConfig: sshdConfigDropIn({ hostKeyAlgorithm: (host.hostKeyAlgorithm as SshKeyAlgo) ?? 'ssh-ed25519' }),
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
    return { ...hostDto(row), sshdConfig: sshdConfigDropIn({ hostKeyAlgorithm: (row.hostKeyAlgorithm as SshKeyAlgo) ?? 'ssh-ed25519' }), currentCert };
  }

  /**
   * Assemble EVERY file a host admin must place on this server, in one bundle,
   * from live data — so nothing is forgotten (notably the User CA public key and
   * the auth_principals files, which the old UI made you fetch from other pages).
   * All paths/filenames come from ssh-config.ts so they are paste-safe.
   */
  async buildHostDeployBundle(ctx: ServiceContext, hostId: string): Promise<HostDeployBundle> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
    if (!host) throw new SshHostError(`host ${hostId} not found`);
    const algo = (host.hostKeyAlgorithm as SshKeyAlgo) ?? 'ssh-ed25519';

    // Resolve the current cert (and the CA that signed it, for the KRL URL).
    let currentCert: string | null = null;
    let hostCaId: string | null = null;
    if (host.currentCertId) {
      const c = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.id, host.currentCertId)).limit(1))[0];
      currentCert = c?.certOpenssh ?? null;
      hostCaId = c?.caId ?? null;
    }
    if (!hostCaId) {
      const ca = (await ctx.db.select().from(sshCas).where(and(eq(sshCas.caType, 'host'), eq(sshCas.status, 'active'))).limit(1))[0];
      hostCaId = ca?.id ?? null;
    }

    // Pull in the User CA trust file and the auth_principals files (the two
    // artifacts the old host page never emitted) from their owning services.
    const { getSshCaService } = await import('./ssh-ca.service.js');
    const { getSshPrincipalService } = await import('./ssh-principal.service.js');
    const anchors = await getSshCaService().getTrustAnchors(ctx);
    const principals = await getSshPrincipalService().render(ctx, hostId);

    const hostKeyPath = hostKeyPathFor(algo);
    const files: HostDeployFile[] = [];
    if (currentCert) {
      files.push({
        name: 'Host certificate',
        path: `${hostKeyPath}-cert.pub`,
        filename: hostCertFilename(algo),
        content: currentCert.endsWith('\n') ? currentCert : currentCert + '\n',
        mode: '0444',
      });
    }
    files.push({
      name: 'User CA public key (TrustedUserCAKeys)',
      path: USER_CA_PATH,
      filename: 'ssh-user-ca.pub',
      content: anchors.userCaKeys.map((k) => k.trim()).join('\n') + (anchors.userCaKeys.length ? '\n' : ''),
      mode: '0444',
    });
    files.push({
      name: `sshd drop-in (${SSHD_DROPIN_FILENAME})`,
      path: SSHD_DROPIN_PATH,
      filename: SSHD_DROPIN_FILENAME,
      content: sshdConfigDropIn({ hostKeyAlgorithm: algo }),
      mode: '0644',
    });
    for (const [account, content] of Object.entries(principals.files)) {
      files.push({
        name: `AuthorizedPrincipals for '${account}'`,
        path: `/etc/ssh/auth_principals/${account}`,
        filename: account,
        content,
        mode: '0644',
        isAuthPrincipals: true,
      });
    }

    const krl = hostCaId
      ? {
          url: `/krl/${hostCaId}.bin`,
          setup: [
            '# RevokedKeys must exist or sshd refuses to start — create it once:',
            `sudo install -m 0444 /dev/null ${REVOKED_KEYS_PATH}`,
            '',
            '# Keep it fresh (cron, every 15 min) — replace YOUR-PKI-HOST:',
            `*/15 * * * * root curl -fsS -o ${REVOKED_KEYS_PATH}.new "https://YOUR-PKI-HOST/krl/${hostCaId}.bin" && install -m 0444 -o root -g root ${REVOKED_KEYS_PATH}.new ${REVOKED_KEYS_PATH}`,
            '',
          ].join('\n'),
        }
      : null;

    return {
      fqdn: host.fqdn,
      hostKeyAlgorithm: algo,
      hostCaId,
      hasCert: !!currentCert,
      files,
      principalsStale: principals.stale,
      krl,
      reloadCommands: 'sudo sshd -t && sudo systemctl reload ssh   # unit is "ssh" on Debian/Ubuntu, "sshd" on RHEL-family',
      prerequisites:
        'Before you start: NTP/chrony must be running (certificate validity depends on the clock), and the local accounts your principals map to must already exist on this host.',
    };
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

  /**
   * Decommission a host in one action (SSH-32b): revoke its outstanding certs
   * (feeding the KRL), remove its principal maps, destroy its KMS ECIES key if
   * registered, and set status 'offboarded'. Succeeds even with no ECIES key.
   */
  async offboard(ctx: ServiceContext, hostId: string, reason = 'host decommissioned'): Promise<void> {
    const host = (await ctx.db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0];
    if (!host) throw new SshHostError(`host ${hostId} not found`);

    const { sshCertificates, sshHostPrincipalMaps } = await import('../db/schema.js');
    const { getSshKrlService } = await import('./ssh-krl.service.js');
    const krl = getSshKrlService();

    const certs = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.hostId, hostId))) as any[];
    for (const c of certs) {
      if (c.status === 'active') await krl.revokeByCert(ctx, c.id, reason);
    }
    await ctx.db.delete(sshHostPrincipalMaps).where(eq(sshHostPrincipalMaps.hostId, hostId));

    if (host.kmsPubkeyId) {
      try {
        const priv = String(host.kmsPubkeyId).replace(/_pk$/, '');
        const { getKMSService } = await import('../kms/service.js');
        await getKMSService().destroyKeyPair(priv, host.kmsPubkeyId);
      } catch {
        /* best effort */
      }
    }
    await ctx.db.update(sshHosts).set({ status: 'offboarded', currentCertId: null, kmsPubkeyId: null, updatedAt: new Date() }).where(eq(sshHosts.id, hostId));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.host.offboard',
      entityType: 'ssh_host',
      entityId: hostId,
      status: 'success',
      details: { reason, revoked: certs.filter((c) => c.status === 'active' || c.status === 'revoked').length },
      ipAddress: ctx.ipAddress ?? undefined,
    });
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
