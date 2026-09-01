/**
 * SSH user certificate service (SSH-13). Manage identities and issue User-CA-
 * signed certs with role principals, an explicit extension whitelist, and
 * validated critical options (force-command, source-address CIDRs). Short TTL is
 * the primary revocation mechanism.
 */
import { randomUUID } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { sshIdentities, sshCas, sshCertificates, sshUserPrincipals, sshPrincipals } from '../db/schema.js';
import { createAuditLog } from '../lib/audit.js';
import { parseSshPublicKey, type SshKeyAlgo } from '../crypto/ssh/pubkey.js';
import { DEFAULT_USER_EXTENSIONS } from '../crypto/ssh/openssh-cert.js';
import { getSshCertService } from './ssh-cert.service.js';
import { sshClientConfig, validateCidrList, isValidPrincipalName } from './ssh-config.js';
import { resolveZone, assertZoneUsable } from './ssh-zone.service.js';
import type { ServiceContext } from './types.js';

const DEFAULT_USER_TTL = 7 * 24 * 3600; // +1w

export class SshUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshUserError';
  }
}

export interface SshIdentityDto {
  id: string;
  zoneId: string;
  subject: string;
  email: string | null;
  status: 'active' | 'disabled';
  createdAt: string;
}

function identityDto(row: any): SshIdentityDto {
  return {
    id: row.id,
    zoneId: row.zoneId,
    subject: row.subject,
    email: row.email ?? null,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export interface IssueUserCertParams {
  identityId: string;
  /** Optional explicit CA override (validated to be a User CA). Not surfaced in
   *  the issuance API/UI — the zone's active User CA is resolved implicitly. */
  caId?: string;
  sshPublicKey: string;
  principals: string[];
  extensions?: string[]; // explicit whitelist; defaults to all five
  forceCommand?: string;
  sourceAddress?: string; // comma-separated CIDRs
  validForSeconds?: number;
  keyId?: string;
  serial?: bigint;
  sourceType?: 'manual' | 'automation';
  /** Constrain principals to the identity's entitlement catalog (SSH-14). */
  enforceEntitlement?: boolean;
}

export class SshUserService {
  async createIdentity(
    ctx: ServiceContext,
    params: { subject: string; email?: string; externalSubject?: string; zone?: string }
  ): Promise<SshIdentityDto> {
    if (!params.subject?.trim()) throw new SshUserError('identity subject is required');
    const zone = await resolveZone(ctx, params.zone);
    await assertZoneUsable(ctx, zone.id);
    const id = randomUUID();
    await ctx.db.insert(sshIdentities).values({
      id,
      zoneId: zone.id,
      subject: params.subject,
      email: params.email ?? null,
      externalSubject: params.externalSubject ?? null,
      pubkeySource: 'per_request',
      status: 'active',
    } as any);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.identity.create',
      entityType: 'ssh_identity',
      entityId: id,
      status: 'success',
      details: { subject: params.subject, zone: zone.name },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    return identityDto((await ctx.db.select().from(sshIdentities).where(eq(sshIdentities.id, id)).limit(1))[0]);
  }

  async listIdentities(ctx: ServiceContext, opts?: { zoneId?: string }): Promise<SshIdentityDto[]> {
    const rows = opts?.zoneId
      ? await ctx.db
          .select()
          .from(sshIdentities)
          .where(eq(sshIdentities.zoneId, opts.zoneId))
          .orderBy(desc(sshIdentities.createdAt))
      : await ctx.db.select().from(sshIdentities).orderBy(desc(sshIdentities.createdAt));
    return (rows as any[]).map(identityDto);
  }

  /** Disable an identity (no new certs); revocation of existing certs is separate. */
  async disableIdentity(ctx: ServiceContext, id: string): Promise<void> {
    const row = (await ctx.db.select().from(sshIdentities).where(eq(sshIdentities.id, id)).limit(1))[0];
    if (!row) throw new SshUserError(`identity ${id} not found`);
    await ctx.db.update(sshIdentities).set({ status: 'disabled', updatedAt: new Date() }).where(eq(sshIdentities.id, id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.identity.disable',
      entityType: 'ssh_identity',
      entityId: id,
      status: 'success',
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  /**
   * Offboard an identity in one action (SSH-32c): revoke its outstanding user
   * certs (feeding the KRL) and disable it so no new certs can be issued.
   */
  async offboard(ctx: ServiceContext, id: string, reason = 'identity offboarded'): Promise<void> {
    const row = (await ctx.db.select().from(sshIdentities).where(eq(sshIdentities.id, id)).limit(1))[0];
    if (!row) throw new SshUserError(`identity ${id} not found`);
    const { getSshKrlService } = await import('./ssh-krl.service.js');
    const krl = getSshKrlService();
    const certs = (await ctx.db
      .select()
      .from(sshCertificates)
      .where(and(eq(sshCertificates.identityId, id), eq(sshCertificates.status, 'active')))) as any[];
    for (const c of certs) await krl.revokeByCert(ctx, c.id, reason);
    await ctx.db.update(sshIdentities).set({ status: 'disabled', updatedAt: new Date() }).where(eq(sshIdentities.id, id));
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.identity.disable',
      entityType: 'ssh_identity',
      entityId: id,
      status: 'success',
      details: { offboard: true, reason, revoked: certs.length },
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  async issue(
    ctx: ServiceContext,
    params: IssueUserCertParams
  ): Promise<{
    cert: { id: string; serial: string; keyId: string; certOpenssh: string; validBefore: string };
    keyType: SshKeyAlgo;
    sshClientConfig: string;
  }> {
    const identity = (await ctx.db.select().from(sshIdentities).where(eq(sshIdentities.id, params.identityId)).limit(1))[0];
    if (!identity) throw new SshUserError(`identity ${params.identityId} not found`);
    if (identity.status !== 'active') throw new SshUserError('identity is disabled; cannot issue certificates');
    // Archived zones block new issuance (amendment A3) but keep serving existing
    // trust material — see the KRL / trust-download paths, which do not gate.
    await assertZoneUsable(ctx, identity.zoneId);

    const parsedKey = parseSshPublicKey(params.sshPublicKey); // reject private key / garbage early; algo drives client filenames
    if (params.principals.length === 0) throw new SshUserError('at least one principal (role) is required');
    for (const p of params.principals) {
      if (!isValidPrincipalName(p)) throw new SshUserError(`invalid principal name '${p}'`);
    }
    if (params.sourceAddress) {
      const v = validateCidrList(params.sourceAddress);
      if (!v.ok) throw new SshUserError(`invalid source-address CIDR: '${v.bad}'`);
    }
    if (params.enforceEntitlement) await this.assertEntitled(ctx, params.identityId, params.principals);

    // Issuance uses the active User CA of the identity's OWN zone (decision-017
    // §6). The zone comes from the subject entity, never a UI-supplied caId.
    const ca = await this.resolveUserCa(ctx, identity.zoneId, params.caId);
    const criticalOptions =
      params.forceCommand || params.sourceAddress
        ? { forceCommand: params.forceCommand, sourceAddress: params.sourceAddress }
        : undefined;

    const cert = await getSshCertService().sign(ctx, {
      caId: ca.id,
      sshPublicKey: params.sshPublicKey,
      type: 'user',
      keyId: params.keyId ?? identity.subject,
      principals: params.principals,
      serial: params.serial,
      validForSeconds: params.validForSeconds ?? DEFAULT_USER_TTL,
      criticalOptions,
      extensions: params.extensions ?? [...DEFAULT_USER_EXTENSIONS],
      sourceType: params.sourceType ?? 'manual',
      identityId: identity.id,
    });

    return {
      cert: { id: cert.id, serial: cert.serial, keyId: cert.keyId, certOpenssh: cert.certOpenssh, validBefore: cert.validBefore },
      keyType: parsedKey.algo,
      sshClientConfig: sshClientConfig({ hostPattern: '*', keyAlgorithm: parsedKey.algo }),
    };
  }

  async listCertificates(ctx: ServiceContext, identityId?: string): Promise<any[]> {
    const q = ctx.db.select().from(sshCertificates).where(eq(sshCertificates.certType, 'user'));
    const rows = identityId
      ? await ctx.db
          .select()
          .from(sshCertificates)
          .where(and(eq(sshCertificates.certType, 'user'), eq(sshCertificates.identityId, identityId)))
      : await q;
    return rows.map((r: any) => ({
      id: r.id,
      serial: r.serial,
      keyId: r.keyId,
      principals: JSON.parse(r.principals),
      extensions: r.extensions ? JSON.parse(r.extensions) : [],
      criticalOptions: r.criticalOptions ? JSON.parse(r.criticalOptions) : {},
      status: r.status,
      validAfter: new Date(r.validAfter).toISOString(),
      validBefore: new Date(r.validBefore).toISOString(),
      certOpenssh: r.certOpenssh,
      revocationReason: r.revocationReason ?? null,
      revocationDate: r.revocationDate ? new Date(r.revocationDate).toISOString() : null,
    }));
  }

  async revoke(ctx: ServiceContext, certId: string, reason?: string): Promise<void> {
    const row = (await ctx.db.select().from(sshCertificates).where(eq(sshCertificates.id, certId)).limit(1))[0];
    if (!row) throw new SshUserError(`certificate ${certId} not found`);
    await ctx.db
      .update(sshCertificates)
      .set({ status: 'revoked', revocationDate: new Date(), revocationReason: reason ?? null, updatedAt: new Date() })
      .where(eq(sshCertificates.id, certId));
    // BLK-05: this status flip feeds composed per-host KRLs — invalidate them.
    const { getSshHostKrlService } = await import('./ssh-host-krl.service.js');
    await getSshHostKrlService().onRevocation(ctx);
    await createAuditLog({
      db: ctx.db,
      operation: 'ssh.cert.revoke',
      entityType: 'ssh_certificate',
      entityId: certId,
      status: 'success',
      details: { reason },
      ipAddress: ctx.ipAddress ?? undefined,
    });
  }

  private async assertEntitled(ctx: ServiceContext, identityId: string, principals: string[]): Promise<void> {
    const rows = await ctx.db
      .select({ name: sshPrincipals.name })
      .from(sshUserPrincipals)
      .innerJoin(sshPrincipals, eq(sshUserPrincipals.principalId, sshPrincipals.id))
      .where(eq(sshUserPrincipals.identityId, identityId));
    const allowed = new Set(rows.map((r: any) => r.name));
    const denied = principals.filter((p) => !allowed.has(p));
    if (denied.length) throw new SshUserError(`identity not entitled to principals: ${denied.join(', ')}`);
  }

  private async resolveUserCa(ctx: ServiceContext, zoneId: string, caId?: string): Promise<any> {
    if (caId) {
      const ca = (await ctx.db.select().from(sshCas).where(eq(sshCas.id, caId)).limit(1))[0];
      if (!ca) throw new SshUserError(`CA ${caId} not found`);
      if (ca.caType !== 'user') throw new SshUserError('selected CA is not a User CA');
      if (ca.zoneId !== zoneId) throw new SshUserError('selected CA belongs to a different zone');
      return ca;
    }
    const ca = (
      await ctx.db
        .select()
        .from(sshCas)
        .where(and(eq(sshCas.zoneId, zoneId), eq(sshCas.caType, 'user'), eq(sshCas.status, 'active')))
        .limit(1)
    )[0];
    if (!ca) throw new SshUserError('no active User CA in this zone — create one first');
    return ca;
  }
}

let instance: SshUserService | null = null;
export function getSshUserService(): SshUserService {
  if (!instance) instance = new SshUserService();
  return instance;
}
