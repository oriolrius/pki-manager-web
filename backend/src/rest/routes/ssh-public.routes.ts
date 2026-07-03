/**
 * Public SSH download endpoints (SSH-18) — trust material a host/Ansible fetches
 * with no auth, registered like the public /crl route (bare server.get OUTSIDE
 * the /api/v1 OpenAPI/auth block). The public raw KRL bytes route (/krl/:caId.bin)
 * is owned separately by SSH-22.
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';
import { certAuthorityLine, hostCertFilename, SSHD_DROPIN_FILENAME } from '../../services/ssh-config.js';
import { rateLimitOk } from '../middleware/ssh-rate-limit.js';

export function registerSshPublicRoutes(server: FastifyInstance): void {
  const ctx = { db, ipAddress: null };

  /** Fetch the freshest KRL row, lazily (re)generating when missing or stale. */
  async function freshestKrl(caId: string): Promise<any | null> {
    const svc = getSshKrlService();
    let row = await svc.getLatestRow(ctx, caId).catch(() => null);
    const stale = row && new Date(row.nextUpdate).getTime() < Date.now();
    if (!row || stale) {
      try {
        await svc.generate(ctx, caId);
        row = await svc.getLatestRow(ctx, caId);
      } catch {
        // signing unavailable: fall back to last-good bytes if we have them.
      }
    }
    return row;
  }

  // Public BARE KRL bytes for sshd's RevokedKeys (SSH-22). sshd does NOT verify
  // any signature on this file — integrity rests on TLS + 0444 root-owned perms.
  // ETag/If-None-Match/304 + lazy-regen + last-good fallback are new here.
  server.get('/krl/:caId.bin', async (req, reply) => {
    if (!rateLimitOk(`krl:${req.ip}`, 120, 60_000)) {
      reply.code(429);
      return 'rate limited\n';
    }
    const { caId } = req.params as { caId: string };
    const row = await freshestKrl(caId);
    if (!row) {
      reply.code(404);
      return 'no KRL\n';
    }
    const version = row.versionHash as string;
    const inm = (req.headers['if-none-match'] as string | undefined)?.trim();
    reply.header('ETag', version);
    reply.header('X-KRL-Version', version);
    reply.header('Last-Modified', new Date(row.thisUpdate).toUTCString());
    reply.header('Expires', new Date(row.nextUpdate).toUTCString());
    const maxAge = Math.max(0, Math.floor((new Date(row.nextUpdate).getTime() - Date.now()) / 1000));
    reply.header('Cache-Control', `public, max-age=${maxAge}`);
    if (inm && inm === version) {
      return reply.code(304).send();
    }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="revoked_keys"');
    return Buffer.from(row.krlBlob);
  });

  // Signed envelope for the (deferred) puller: bare KRL + detached CA signature.
  server.get('/krl/:caId.json', async (req, reply) => {
    const { caId } = req.params as { caId: string };
    const row = await freshestKrl(caId);
    if (!row) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'no KRL' } };
    }
    return {
      krl_b64: Buffer.from(row.krlBlob).toString('base64'),
      ca_signature_b64: row.caSignature ? Buffer.from(row.caSignature).toString('base64') : null,
      krl_version: row.versionHash,
      signed_at: new Date(row.thisUpdate).toISOString(),
    };
  });
  const text = (reply: any, filename?: string) => {
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    if (filename) reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  };

  // A single CA's OpenSSH public key.
  server.get('/ssh/cas/:id/ca.pub', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ca = await getSshCaService().get(ctx, id);
      text(reply, `ssh-${ca.caType}-ca.pub`);
      return ca.opensshPublicKey.trim() + '\n';
    } catch {
      reply.code(404);
      return 'not found\n';
    }
  });

  // TrustedUserCAKeys file contents (all active/rotating User CAs).
  server.get('/ssh/trusted-user-ca-keys', async (_req, reply) => {
    const anchors = await getSshCaService().getTrustAnchors(ctx);
    text(reply, 'ssh-user-ca.pub');
    return anchors.userCaKeys.map((k) => k.trim()).join('\n') + (anchors.userCaKeys.length ? '\n' : '');
  });

  // Host CA public key(s) — the KRL puller trust anchor (BLK-10). Installed at
  // HOST_CA_PATH (/etc/ssh/ssh-host-ca.pub) by the Ansible role; krl-client's
  // default --ca-pubkey. Composed per-host KRLs are signed with the Host-CA
  // key (decision-016 pinned req #1) — NOT the User CA.
  server.get('/ssh/host-ca-keys', async (_req, reply) => {
    const anchors = await getSshCaService().getTrustAnchors(ctx);
    text(reply, 'ssh-host-ca.pub');
    return anchors.hostCaKeys.map((k) => k.trim()).join('\n') + (anchors.hostCaKeys.length ? '\n' : '');
  });

  // @cert-authority known_hosts lines for the Host CA(s), for a pattern.
  server.get('/ssh/cert-authority', async (req, reply) => {
    const pattern = ((req.query as any)?.pattern as string) || '*';
    const anchors = await getSshCaService().getTrustAnchors(ctx);
    text(reply);
    return anchors.hostCaKeys.map((k) => certAuthorityLine(k, pattern)).join('\n') + (anchors.hostCaKeys.length ? '\n' : '');
  });

  // A host's current certificate (HostCertificate).
  server.get('/ssh/hosts/:id/cert.pub', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const host = await getSshHostService().get(ctx, id);
      if (!host.currentCert) {
        reply.code(404);
        return 'no certificate issued\n';
      }
      text(reply, hostCertFilename(host.hostKeyAlgorithm));
      return host.currentCert.endsWith('\n') ? host.currentCert : host.currentCert + '\n';
    } catch {
      reply.code(404);
      return 'not found\n';
    }
  });

  // The ready-to-paste sshd_config drop-in for a host.
  server.get('/ssh/hosts/:id/sshd-config', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const host = await getSshHostService().get(ctx, id);
      text(reply, SSHD_DROPIN_FILENAME);
      return host.sshdConfig;
    } catch {
      reply.code(404);
      return 'not found\n';
    }
  });
}
