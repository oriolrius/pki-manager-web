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
import { getSshHostKrlService } from '../../services/ssh-host-krl.service.js';
import { getSshFleetTokenService, type SshTokenOp, type VerifiedToken } from '../../services/ssh-fleet-token.service.js';
import { eciesEncryptV1, EciesError } from '../../crypto/ssh/ecies.js';
import { createAuditLog } from '../../lib/audit.js';
import { rateLimitOk } from '../middleware/ssh-rate-limit.js';

const eciesEnabled = () => process.env.SSH_ECIES_ENABLED === 'true';
// BLK-06 cutover gate: default ON. The off-switch is SAFE because KRL numbers
// are globally monotonic across lineages (BLK-02/03) — per-CA rows generated
// after per-host rows still carry higher numbers, so pullers accept them.
const hostKrlServeEnabled = () => process.env.SSH_HOST_KRL_SERVE !== 'false';
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
        await db.update(sshHosts).set({ opensshHostPubkey: body.opensshHostPubkey.trim(), updatedAt: new Date() } as any).where(eq(sshHosts.id, host.id));
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

  // ---- POST /register-host-pubkey (KRLC-02; readiness for local-decrypt ECIES) ----
  // Local-key model (decision-015): the host's OWN ecdsa-sha2-nistp256 SSH host
  // key IS the ECIES key (already stored at host registration as opensshHostPubkey).
  // No KMS keypair is generated; this only confirms the host is eligible for
  // encrypted KRL distribution (its host key is a usable P-256 key).
  server.post(`${base}/register-host-pubkey`, async (req, reply) => {
    const token = await authn(req, reply, 'register-host-pubkey');
    if (!token) return reply;
    if (!eciesEnabled()) return err(reply, 501, 'NOT_IMPLEMENTED', 'the ECIES KRL path is disabled (set SSH_ECIES_ENABLED=true)');
    const fqdn = (req.body as any)?.fqdn ?? (req.body as any)?.host_id;
    if (!fqdn || !isValidHostId(fqdn)) return err(reply, 400, 'VALIDATION_ERROR', 'fqdn required');
    const host = (await db.select().from(sshHosts).where(eqcol(sshHosts.fqdn, fqdn)).limit(1))[0];
    if (!host) return err(reply, 404, 'NOT_FOUND', `host ${fqdn} not registered`);
    try {
      return await getSshHostService().registerEciesKey({ db, ipAddress: req.ip }, host.id);
    } catch (e: any) {
      return err(reply, 409, 'ECIES_KEY_UNSUPPORTED', e?.message ?? 'host not eligible for ECIES KRL');
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
    if (!host || !host.opensshHostPubkey) return err(reply, 404, 'NOT_FOUND', 'host not registered for KRL distribution');
    // Offboard is terminal: the per-host lineage is retired, so keep-alive
    // serving would hand a decommissioned host a frozen KRL with a fresh
    // valid_until on every pull (and audit-spam failed regens).
    if (host.status === 'offboarded') return err(reply, 404, 'NOT_FOUND', 'host is offboarded');

    let row: any | null = null;
    if (hostKrlServeEnabled()) {
      // BLK-06: the payload source is the freshest COMPOSED per-host row.
      const svc = getSshHostKrlService();
      row = await svc.getLatestRow({ db, ipAddress: req.ip }, host.id);
      if (!row) {
        // First fetch / cutover: synchronously generate the first composed row
        // (globally-seeded number, so it exceeds any per-CA number the host has
        // installed). On failure: not-initialized — NO per-CA fallback (doc-008
        // finding #4); pullers fail-stale on last-good and retry next interval.
        try {
          await svc.generate({ db, ipAddress: req.ip }, host.id);
          row = await svc.getLatestRow({ db, ipAddress: req.ip }, host.id);
        } catch { /* fall through to NO_KRL */ }
        if (!row) return err(reply, 503, 'NO_KRL', 'per-host KRL not initialized');
      } else if (new Date(row.nextUpdate).getTime() < Date.now()) {
        // Stale: lazy regen (the BLK-05 invalidation backstop); keep last-good on failure.
        try {
          await svc.generate({ db, ipAddress: req.ip }, host.id);
          row = await svc.getLatestRow({ db, ipAddress: req.ip }, host.id);
        } catch { /* keep last-good */ }
      }
    } else {
      // Legacy per-CA path (SSH_HOST_KRL_SERVE=false roll-back switch).
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
      row = await svc.getLatestRow({ db, ipAddress: req.ip }, caId);
      if (!row || new Date(row.nextUpdate).getTime() < Date.now()) {
        try {
          await svc.generate({ db, ipAddress: req.ip }, caId);
          row = await svc.getLatestRow({ db, ipAddress: req.ip }, caId);
        } catch { /* keep last-good */ }
      }
      if (!row) return err(reply, 503, 'NO_KRL', 'no KRL available');
    }

    const version = row.versionHash as string;
    const inm = (req.headers['if-none-match'] as string | undefined)?.trim();
    if (inm && inm === version) {
      // BLK-01 (pinned req #5): a 304 is a successful conditional pull — stamp the
      // fetch time or a healthy 15-min puller reads as stale between hourly regens.
      // last_krl_version stays 200-only (it records what was SERVED, not confirmed).
      await db.update(sshHosts).set({ lastKrlFetchAt: new Date() } as any).where(eqcol(sshHosts.id, host.id));
      reply.header('X-KRL-Version', version);
      return reply.code(304).send();
    }

    const payload = Buffer.from(
      JSON.stringify({
        krl: Buffer.from(row.krlBlob).toString('base64'),
        ca_signature: row.caSignature ? Buffer.from(row.caSignature).toString('base64') : null,
        krl_version: version,
        // Anti-rollback (KRLC-05 / TASK-175) reads the monotonic number from the
        // SIGNED KRL header (buildKrl embeds row.krlNumber as krl_version), not from
        // an unsigned JSON field — so a compromised server cannot inflate it.
        valid_until: Math.floor(Date.now() / 1000) + KRL_VALID_FOR_SECONDS,
        host_id: hostId,
      })
    );
    // Encrypt NATIVELY to the host's own ecdsa-sha2-nistp256 public key so the
    // host decrypts locally with /etc/ssh/ssh_host_ecdsa_key — no KMS (KRLC-02).
    let ciphertext: Buffer;
    try {
      ciphertext = eciesEncryptV1(host.opensshHostPubkey, payload);
    } catch (e: any) {
      // Host key is ed25519 (or otherwise not P-256): operator must provision an ecdsa host key.
      const unsupported = e instanceof EciesError;
      await createAuditLog({ db, operation: 'ssh.krl.distribute', entityType: 'ssh_host', entityId: host.id, status: 'failure', details: { host_id: hostId, error: unsupported ? 'ECIES_KEY_UNSUPPORTED' : 'ENCRYPT_FAILED', message: e?.message }, ipAddress: req.ip });
      if (unsupported) return err(reply, 404, 'ECIES_KEY_UNSUPPORTED', e.message);
      return err(reply, 500, 'ENCRYPT_FAILED', e?.message ?? 'ECIES encryption failed');
    }
    await db.update(sshHosts).set({ lastKrlFetchAt: new Date(), lastKrlVersion: version } as any).where(eqcol(sshHosts.id, host.id));
    await createAuditLog({ db, operation: 'ssh.krl.distribute', entityType: 'ssh_host', entityId: host.id, status: 'success', details: { host_id: hostId, krl_version: version, envelope_bytes: ciphertext.length, model: 'local-ecies' }, ipAddress: req.ip });
    reply.header('X-KRL-Version', version);
    reply.header('Content-Type', 'application/octet-stream');
    return ciphertext;
  });
  void desccol;
}
