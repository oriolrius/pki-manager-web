/**
 * SSH external/automation signing API (SSH-19). Fleet-token-authenticated
 * endpoints the Ansible role and CI call. Registered at top level (like /crl) so
 * it bypasses the OIDC preHandler; auth is the bearer fleet token instead.
 * Idempotent on the Idempotency-Key header. Issued certs are source=automation.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { eq as eqcol, and as andcol, desc as desccol } from 'drizzle-orm';
import { sshHosts, sshIdentities, sshIdempotency, sshCertificates, sshCas } from '../../db/schema.js';
import { isValidHostId, validateCidrList, isValidPrincipalName } from '../../services/ssh-config.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';
import { getSshFleetTokenService, type SshTokenOp, type VerifiedToken } from '../../services/ssh-fleet-token.service.js';
import { getKMSService } from '../../kms/service.js';
import { createAuditLog } from '../../lib/audit.js';
import { rateLimitOk } from '../middleware/ssh-rate-limit.js';

const eciesEnabled = () => process.env.SSH_ECIES_ENABLED === 'true';
const KRL_VALID_FOR_SECONDS = parseInt(process.env.KRL_VALID_FOR_SECONDS || '1800', 10);

const signHostBody = z.object({
  fqdn: z.string().refine(isValidHostId),
  addresses: z.array(z.string().min(1)).default([]),
  opensshHostPubkey: z.string().min(1),
  validForSeconds: z.number().int().positive().optional(),
  keyId: z.string().max(255).optional(),
});

const signUserBody = z.object({
  subject: z.string().min(1).max(255),
  sshPublicKey: z.string().min(1),
  principals: z.array(z.string().refine(isValidPrincipalName)).min(1),
  extensions: z.array(z.string()).optional(),
  forceCommand: z.string().max(1024).optional(),
  sourceAddress: z.string().max(512).optional().refine((v) => v === undefined || validateCidrList(v).ok, 'invalid CIDR'),
  validForSeconds: z.number().int().positive().optional(),
  keyId: z.string().max(255).optional(),
});

const err = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ error: { code, message } });

export function registerSshExternalRoutes(server: FastifyInstance): void {
  const base = '/api/v1/external/ssh';

  async function authn(req: any, reply: FastifyReply, op: SshTokenOp): Promise<VerifiedToken | null> {
    const auth = (req.headers['authorization'] as string | undefined) ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const verified = await getSshFleetTokenService().verify({ db, ipAddress: req.ip }, token, req.ip);
    if (!verified) {
      err(reply, 401, 'UNAUTHORIZED', 'missing or invalid fleet token');
      return null;
    }
    if (!verified.opSet.includes(op)) {
      err(reply, 403, 'FORBIDDEN', `token is not scoped for ${op}`);
      return null;
    }
    if (!rateLimitOk(`ssh-ext:${verified.id}`, 120, 60_000)) {
      err(reply, 429, 'RATE_LIMITED', 'too many requests for this token');
      return null;
    }
    return verified;
  }

  /** Return a cached response for a repeated Idempotency-Key, else null. */
  async function cached(req: any): Promise<any | null> {
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) return null;
    const row = (await db.select().from(sshIdempotency).where(eq(sshIdempotency.key, key)).limit(1))[0];
    return row ? JSON.parse(row.response) : null;
  }
  async function remember(req: any, tokenId: string, certId: string, response: any): Promise<void> {
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) return;
    await db.insert(sshIdempotency).values({ key, tokenId, certId, response: JSON.stringify(response) } as any).onConflictDoNothing?.();
  }

  // ---- POST /sign-host ----
  server.post(`${base}/sign-host`, async (req, reply) => {
    const token = await authn(req, reply, 'sign-host');
    if (!token) return;
    const prev = await cached(req);
    if (prev) return prev;

    const parsed = signHostBody.safeParse(req.body);
    if (!parsed.success) return err(reply, 400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
    const body = parsed.data;
    const ctx = { db, ipAddress: req.ip };

    try {
      // Upsert host by fqdn.
      let host = (await db.select().from(sshHosts).where(eq(sshHosts.fqdn, body.fqdn)).limit(1))[0];
      if (!host) {
        const created = await getSshHostService().register(ctx, {
          fqdn: body.fqdn,
          addresses: body.addresses,
          opensshHostPubkey: body.opensshHostPubkey,
        });
        host = (await db.select().from(sshHosts).where(eq(sshHosts.id, created.id)).limit(1))[0];
      } else if (host.opensshHostPubkey !== body.opensshHostPubkey.trim()) {
        await db.update(sshHosts).set({ opensshHostPubkey: body.opensshHostPubkey.trim(), updatedAt: new Date() }).where(eq(sshHosts.id, host.id));
      }
      const issued = await getSshHostService().issue(ctx, {
        hostId: host.id,
        caId: token.hostCaId ?? undefined,
        validForSeconds: body.validForSeconds,
        keyId: body.keyId,
        sourceType: 'automation',
      });
      const response = { hostId: host.id, certOpenssh: issued.cert.certOpenssh, serial: issued.cert.serial, keyId: issued.cert.keyId, validBefore: issued.cert.validBefore };
      await remember(req, token.id, issued.cert.id, response);
      await createAuditLog({ db, operation: 'ssh.external.sign', entityType: 'ssh_certificate', entityId: issued.cert.id, status: 'success', details: { tokenId: token.id, fqdn: body.fqdn, op: 'sign-host' }, ipAddress: req.ip });
      return response;
    } catch (e: any) {
      return err(reply, 400, 'SSH_ERROR', e?.message ?? 'sign-host failed');
    }
  });

  // ---- POST /sign-user ----
  server.post(`${base}/sign-user`, async (req, reply) => {
    const token = await authn(req, reply, 'sign-user');
    if (!token) return;
    const prev = await cached(req);
    if (prev) return prev;

    const parsed = signUserBody.safeParse(req.body);
    if (!parsed.success) return err(reply, 400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
    const body = parsed.data;
    const ctx = { db, ipAddress: req.ip };

    try {
      let ident = (await db.select().from(sshIdentities).where(eq(sshIdentities.subject, body.subject)).limit(1))[0];
      if (!ident) {
        const created = await getSshUserService().createIdentity(ctx, { subject: body.subject });
        ident = (await db.select().from(sshIdentities).where(eq(sshIdentities.id, created.id)).limit(1))[0];
      }
      const issued = await getSshUserService().issue(ctx, {
        identityId: ident.id,
        caId: token.userCaId ?? undefined,
        sshPublicKey: body.sshPublicKey,
        principals: body.principals,
        extensions: body.extensions as any,
        forceCommand: body.forceCommand,
        sourceAddress: body.sourceAddress,
        validForSeconds: body.validForSeconds,
        keyId: body.keyId,
        sourceType: 'automation',
      });
      const response = { identityId: ident.id, certOpenssh: issued.cert.certOpenssh, serial: issued.cert.serial, keyId: issued.cert.keyId, validBefore: issued.cert.validBefore };
      await remember(req, token.id, issued.cert.id, response);
      await createAuditLog({ db, operation: 'ssh.external.sign', entityType: 'ssh_certificate', entityId: issued.cert.id, status: 'success', details: { tokenId: token.id, subject: body.subject, op: 'sign-user' }, ipAddress: req.ip });
      return response;
    } catch (e: any) {
      return err(reply, 400, 'SSH_ERROR', e?.message ?? 'sign-user failed');
    }
  });

  // ---- POST /register-host-pubkey (SSH-15; ECIES path, gated by SSH_ECIES_ENABLED) ----
  server.post(`${base}/register-host-pubkey`, async (req, reply) => {
    const token = await authn(req, reply, 'register-host-pubkey');
    if (!token) return;
    if (!eciesEnabled()) return err(reply, 501, 'NOT_IMPLEMENTED', 'the ECIES KRL path is disabled (set SSH_ECIES_ENABLED=true)');
    const fqdn = (req.body as any)?.fqdn ?? (req.body as any)?.host_id;
    if (!fqdn || !isValidHostId(fqdn)) return err(reply, 400, 'VALIDATION_ERROR', 'fqdn required');
    const host = (await db.select().from(sshHosts).where(eqcol(sshHosts.fqdn, fqdn)).limit(1))[0];
    if (!host) return err(reply, 404, 'NOT_FOUND', `host ${fqdn} not registered`);
    try {
      const ids = await getSshHostService().registerEciesKey({ db, ipAddress: req.ip }, host.id);
      return { hostId: host.id, kmsPublicKeyId: ids.kmsPublicKeyId, hostPrivKeyId: ids.kmsPrivateKeyId };
    } catch (e: any) {
      return err(reply, 400, 'SSH_ERROR', e?.message ?? 'registration failed');
    }
  });

  // ---- POST /krl (SSH-24 encrypted per-host distribution) ----
  // No app auth: ECIES means only the target host can decrypt (the 404-vs-200
  // host oracle is an accepted bounded disclosure). host_id is in the BODY.
  server.post(`${base}/krl`, async (req, reply) => {
    if (!rateLimitOk(`ecies-krl:${req.ip}`, 120, 60_000)) return err(reply, 429, 'RATE_LIMITED', 'too many requests');
    if (!eciesEnabled()) return err(reply, 501, 'NOT_IMPLEMENTED', 'the ECIES KRL path is disabled (set SSH_ECIES_ENABLED=true)');
    const hostId = (req.body as any)?.host_id;
    if (!hostId || !isValidHostId(hostId)) return err(reply, 400, 'VALIDATION_ERROR', 'host_id required in body');
    const host = (await db.select().from(sshHosts).where(eqcol(sshHosts.fqdn, hostId)).limit(1))[0];
    if (!host || !host.kmsPubkeyId) return err(reply, 404, 'NOT_FOUND', 'host not registered for KRL distribution');

    // Resolve the host's CA (via its current cert, else the active host CA).
    let caId: string | undefined;
    if (host.currentCertId) {
      const c = (await db.select().from(sshCertificates).where(eqcol(sshCertificates.id, host.currentCertId)).limit(1))[0];
      caId = c?.caId;
    }
    if (!caId) {
      const ca = (await db.select().from(sshCas).where(andcol(eqcol(sshCas.caType, 'host'), eqcol(sshCas.status, 'active'))).limit(1))[0];
      caId = ca?.id;
    }
    if (!caId) return err(reply, 503, 'NO_CA', 'no host CA available');

    const svc = getSshKrlService();
    let row = await svc.getLatestRow({ db, ipAddress: req.ip }, caId);
    if (!row || new Date(row.nextUpdate).getTime() < Date.now()) {
      try {
        await svc.generate({ db, ipAddress: req.ip }, caId);
        row = await svc.getLatestRow({ db, ipAddress: req.ip }, caId);
      } catch { /* keep last-good */ }
    }
    if (!row) return err(reply, 503, 'NO_KRL', 'no KRL available');

    const version = row.versionHash as string;
    const inm = (req.headers['if-none-match'] as string | undefined)?.trim();
    if (inm && inm === version) {
      reply.header('X-KRL-Version', version);
      return reply.code(304).send();
    }

    const payload = Buffer.from(
      JSON.stringify({
        krl: Buffer.from(row.krlBlob).toString('base64'),
        ca_signature: row.caSignature ? Buffer.from(row.caSignature).toString('base64') : null,
        krl_version: version,
        valid_until: Math.floor(Date.now() / 1000) + KRL_VALID_FOR_SECONDS,
        host_id: hostId,
      })
    );
    try {
      const ciphertext = await getKMSService().eciesEncrypt(host.kmsPubkeyId, payload);
      await db.update(sshHosts).set({ lastKrlFetchAt: new Date(), lastKrlVersion: version }).where(eqcol(sshHosts.id, host.id));
      reply.header('X-KRL-Version', version);
      reply.header('Content-Type', 'application/octet-stream');
      return ciphertext;
    } catch (e: any) {
      return err(reply, 500, 'ENCRYPT_FAILED', e?.message ?? 'ECIES encryption failed');
    }
  });
  void desccol;
}
