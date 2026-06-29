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
import { sshHosts, sshIdentities, sshIdempotency } from '../../db/schema.js';
import { isValidHostId, validateCidrList, isValidPrincipalName } from '../../services/ssh-config.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshFleetTokenService, type SshTokenOp, type VerifiedToken } from '../../services/ssh-fleet-token.service.js';
import { createAuditLog } from '../../lib/audit.js';

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

  // ---- POST /register-host-pubkey (gated on the ECIES path, SSH-15/SSH-23) ----
  server.post(`${base}/register-host-pubkey`, async (req, reply) => {
    const token = await authn(req, reply, 'register-host-pubkey');
    if (!token) return;
    return err(reply, 501, 'NOT_IMPLEMENTED', 'host pubkey registration is enabled only when the ECIES KRL path is active (SSH-15/SSH-23)');
  });
}
