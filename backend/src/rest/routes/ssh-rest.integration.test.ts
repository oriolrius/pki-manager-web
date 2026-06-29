/**
 * SSH-18 REST integration — public download endpoints + authenticated /api/v1/ssh
 * CRUD via a standalone Fastify instance (server.ts auto-starts, so we build our
 * own). Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSshPublicRoutes } from './ssh-public.routes.js';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshCertificates, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshIdentities, sshPrincipals } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KMS = process.env.KMS_AVAILABLE === 'true';

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) {
    try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ }
  }
  for (const t of [sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!KMS)('SSH-18 REST + public downloads', () => {
  let app: FastifyInstance;
  let work: string;
  let userCa: any;
  let hostCa: any;
  let hostId: string;

  beforeAll(async () => {
    process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
    work = mkdtempSync(join(tmpdir(), 'ssh-rest-'));
    await wipe();
    app = Fastify();
    registerSshPublicRoutes(app);
    await app.register(sshRoutes, { prefix: '/api/v1/ssh' });
    await app.ready();

    userCa = await getSshCaService().create({ db, ipAddress: null }, { caType: 'user', label: 'REST User CA' });
    hostCa = await getSshCaService().create({ db, ipAddress: null }, { caType: 'host', label: 'REST Host CA' });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'h'), '-N', '', '-q']);
    const host = await getSshHostService().register({ db, ipAddress: null }, { fqdn: 'rest.lab.local', addresses: ['10.9.9.9'], opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8') });
    hostId = host.id;
    await getSshHostService().issue({ db, ipAddress: null }, { hostId });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await wipe();
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('serves TrustedUserCAKeys publicly matching the User CA', async () => {
    const r = await app.inject({ method: 'GET', url: '/ssh/trusted-user-ca-keys' });
    expect(r.statusCode).toBe(200);
    expect(r.body.trim()).toBe(userCa.opensshPublicKey.trim());
    expect(r.headers['content-type']).toContain('text/plain');
  });

  it('serves a @cert-authority line for the Host CA with a custom pattern', async () => {
    const r = await app.inject({ method: 'GET', url: '/ssh/cert-authority?pattern=*.lab.local' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('@cert-authority *.lab.local ');
    expect(r.body).toContain(hostCa.opensshPublicKey.trim());
  });

  it('serves a host sshd_config drop-in and the host cert', async () => {
    const cfg = await app.inject({ method: 'GET', url: `/ssh/hosts/${hostId}/sshd-config` });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.body).toContain('HostCertificate');
    expect(cfg.body).toContain('TrustedUserCAKeys');

    const cert = await app.inject({ method: 'GET', url: `/ssh/hosts/${hostId}/cert.pub` });
    expect(cert.statusCode).toBe(200);
    expect(cert.body).toContain('-cert-v01@openssh.com');
  });

  it('returns 404 for an unknown CA / host', async () => {
    expect((await app.inject({ method: 'GET', url: '/ssh/cas/nope/ca.pub' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/ssh/hosts/nope/sshd-config' })).statusCode).toBe(404);
  });

  it('creates an SSH CA over REST identical to the tRPC path', async () => {
    // delete the existing user CA first (one active per type)
    await getSshCaService().revoke({ db, ipAddress: null }, userCa.id);
    const r = await app.inject({ method: 'POST', url: '/api/v1/ssh/cas', payload: { caType: 'user', label: 'Via REST' } });
    expect(r.statusCode).toBe(200);
    const created = r.json();
    expect(created.caType).toBe('user');
    expect(created.opensshPublicKey).toContain('ecdsa-sha2-nistp256');
    const list = await app.inject({ method: 'GET', url: '/api/v1/ssh/cas' });
    expect(list.json().some((c: any) => c.id === created.id)).toBe(true);
  });

  it('rejects an invalid REST body with a 400 {error}', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/ssh/cas', payload: { caType: 'banana' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBeTruthy();
  });
});
