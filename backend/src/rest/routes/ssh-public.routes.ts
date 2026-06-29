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
import { certAuthorityLine } from '../../services/ssh-config.js';

export function registerSshPublicRoutes(server: FastifyInstance): void {
  const ctx = { db, ipAddress: null };
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
      text(reply, 'ssh_host_ed25519_key-cert.pub');
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
      text(reply, '10-ssh-ca.conf');
      return host.sshdConfig;
    } catch {
      reply.code(404);
      return 'not found\n';
    }
  });
}
