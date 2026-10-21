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
import { getSshHostKrlService } from '../../services/ssh-host-krl.service.js';
import { certAuthorityLine, hostCertFilename, SSHD_DROPIN_FILENAME } from '../../services/ssh-config.js';
import { DEFAULT_ZONE_ID } from '../../services/ssh-zone.service.js';
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
  server.get('/krl/:caId.bin', { schema: { hide: true } }, async (req, reply) => {
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
  server.get('/krl/:caId.json', { schema: { hide: true } }, async (req, reply) => {
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
  // ── Public PER-HOST composed KRL (BLK-06) ──────────────────────────────────
  // Env-gated and DISABLED by default: it leaks per-host deny intel
  // unauthenticated (SSH_HOST_KRL_PUBLIC=true to enable). ECIES is the
  // preferred channel; the per-CA endpoints above stay for block-free/legacy
  // hosts. Same ETag/lazy-regen/last-good/rate-limit semantics as /krl/:caId.
  const hostKrlPublicEnabled = () => process.env.SSH_HOST_KRL_PUBLIC === 'true';

  /** Host row by id or fqdn (the Ansible role knows the fqdn). */
  async function findHost(idOrFqdn: string): Promise<any | null> {
    const { sshHosts } = await import('../../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const byId = (await db.select().from(sshHosts).where(eq(sshHosts.id, idOrFqdn)).limit(1))[0];
    if (byId) return byId;
    return (await db.select().from(sshHosts).where(eq(sshHosts.fqdn, idOrFqdn)).limit(1))[0] ?? null;
  }

  /** Freshest composed per-host row, lazily (re)generating; last-good on failure. */
  async function freshestHostKrl(hostId: string): Promise<any | null> {
    const svc = getSshHostKrlService();
    let row = await svc.getLatestRow(ctx, hostId).catch(() => null);
    const stale = row && new Date(row.nextUpdate).getTime() < Date.now();
    if (!row || stale) {
      try {
        await svc.generate(ctx, hostId);
        row = await svc.getLatestRow(ctx, hostId);
      } catch {
        // generation unavailable: keep last-good bytes if we have them.
      }
    }
    return row;
  }

  server.get('/krl/hosts/:hostId.bin', { schema: { hide: true } }, async (req, reply) => {
    if (!hostKrlPublicEnabled()) {
      reply.code(404);
      return 'per-host KRL public serving is disabled (SSH_HOST_KRL_PUBLIC)\n';
    }
    if (!rateLimitOk(`krlh:${req.ip}`, 120, 60_000)) {
      reply.code(429);
      return 'rate limited\n';
    }
    const { hostId } = req.params as { hostId: string };
    const host = await findHost(hostId);
    if (!host) {
      reply.code(404);
      return 'not found\n';
    }
    const row = await freshestHostKrl(host.id);
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
    if (inm && inm === version) return reply.code(304).send();
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="revoked_keys"');
    return Buffer.from(row.krlBlob);
  });

  server.get('/krl/hosts/:hostId.json', { schema: { hide: true } }, async (req, reply) => {
    if (!hostKrlPublicEnabled()) {
      reply.code(404);
      return { error: { code: 'DISABLED', message: 'per-host KRL public serving is disabled (SSH_HOST_KRL_PUBLIC)' } };
    }
    if (!rateLimitOk(`krlh:${req.ip}`, 120, 60_000)) {
      reply.code(429);
      return { error: { code: 'RATE_LIMITED', message: 'rate limited' } };
    }
    const { hostId } = req.params as { hostId: string };
    const host = await findHost(hostId);
    const row = host ? await freshestHostKrl(host.id) : null;
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

  // ZONE-08 (decision-017 §7): trust anchors are per-zone. The zoned routes are
  // authoritative; the legacy unscoped routes below serve the DEFAULT zone with
  // a Deprecation header so hosts already enrolled against production (the c1h1
  // VM against pki.joor.net) never break. resolveZone throws on an unknown zone.
  const renderUserCa = (reply: any, anchors: { userCaKeys: string[] }) => {
    text(reply, 'ssh-user-ca.pub');
    return anchors.userCaKeys.map((k) => k.trim()).join('\n') + (anchors.userCaKeys.length ? '\n' : '');
  };
  const renderHostCa = (reply: any, anchors: { hostCaKeys: string[] }) => {
    text(reply, 'ssh-host-ca.pub');
    return anchors.hostCaKeys.map((k) => k.trim()).join('\n') + (anchors.hostCaKeys.length ? '\n' : '');
  };
  const renderCertAuthority = (reply: any, anchors: { hostCaKeys: string[] }, pattern: string) => {
    text(reply);
    return anchors.hostCaKeys.map((k) => certAuthorityLine(k, pattern)).join('\n') + (anchors.hostCaKeys.length ? '\n' : '');
  };
  const deprecate = (reply: any, zonedPath: string) => {
    reply.header('Deprecation', 'true');
    reply.header('Link', `<${zonedPath}>; rel="successor-version"`);
  };

  // A single CA's OpenSSH public key.
  server.get('/ssh/cas/:id/ca.pub', { schema: { hide: true } }, async (req, reply) => {
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

  // ── Zone-scoped trust endpoints (authoritative) ────────────────────────────
  server.get('/ssh/zones/:zone/trusted-user-ca-keys', { schema: { hide: true } }, async (req, reply) => {
    const { zone } = req.params as { zone: string };
    try {
      return renderUserCa(reply, await getSshCaService().getTrustAnchors(ctx, zone));
    } catch {
      reply.code(404);
      return 'zone not found\n';
    }
  });
  server.get('/ssh/zones/:zone/host-ca-keys', { schema: { hide: true } }, async (req, reply) => {
    const { zone } = req.params as { zone: string };
    try {
      return renderHostCa(reply, await getSshCaService().getTrustAnchors(ctx, zone));
    } catch {
      reply.code(404);
      return 'zone not found\n';
    }
  });
  server.get('/ssh/zones/:zone/cert-authority', { schema: { hide: true } }, async (req, reply) => {
    const { zone } = req.params as { zone: string };
    const pattern = ((req.query as any)?.pattern as string) || '*';
    try {
      return renderCertAuthority(reply, await getSshCaService().getTrustAnchors(ctx, zone), pattern);
    } catch {
      reply.code(404);
      return 'zone not found\n';
    }
  });

  // ── Legacy unscoped trust endpoints (serve the DEFAULT zone, deprecated) ────
  // TrustedUserCAKeys file contents (default zone's active/rotating User CAs).
  server.get('/ssh/trusted-user-ca-keys', { schema: { hide: true } }, async (_req, reply) => {
    deprecate(reply, '/ssh/zones/default/trusted-user-ca-keys');
    return renderUserCa(reply, await getSshCaService().getTrustAnchors(ctx, DEFAULT_ZONE_ID));
  });

  // Host CA public key(s) — the KRL puller trust anchor (BLK-10). Installed at
  // HOST_CA_PATH (/etc/ssh/ssh-host-ca.pub) by the Ansible role; krl-client's
  // default --ca-pubkey. Composed per-host KRLs are signed with the Host-CA
  // key (decision-016 pinned req #1) — NOT the User CA.
  server.get('/ssh/host-ca-keys', { schema: { hide: true } }, async (_req, reply) => {
    deprecate(reply, '/ssh/zones/default/host-ca-keys');
    return renderHostCa(reply, await getSshCaService().getTrustAnchors(ctx, DEFAULT_ZONE_ID));
  });

  // @cert-authority known_hosts lines for the Host CA(s), for a pattern.
  server.get('/ssh/cert-authority', { schema: { hide: true } }, async (req, reply) => {
    const pattern = ((req.query as any)?.pattern as string) || '*';
    deprecate(reply, '/ssh/zones/default/cert-authority');
    return renderCertAuthority(reply, await getSshCaService().getTrustAnchors(ctx, DEFAULT_ZONE_ID), pattern);
  });

  // A host's current certificate (HostCertificate).
  server.get('/ssh/hosts/:id/cert.pub', { schema: { hide: true } }, async (req, reply) => {
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
  server.get('/ssh/hosts/:id/sshd-config', { schema: { hide: true } }, async (req, reply) => {
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
