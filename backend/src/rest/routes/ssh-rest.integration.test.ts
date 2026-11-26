/**
 * SSH-18 REST integration — public download endpoints + authenticated /api/v1/ssh
 * CRUD via a standalone Fastify instance (server.ts auto-starts, so we build our
 * own). Gated on KMS_AVAILABLE.
 */
import type { SshCaDto } from '../../services/ssh-ca.service.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSshPublicRoutes } from './ssh-public.routes.js';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshIdentities, sshPrincipals } from '../../db/schema.js';
import { isOpenBaoSshAvailable } from '../../test/openbao-ssh.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Live SSH CA key store: the OpenBao fork's SSH Transit mount (decision-018).
const OPENBAO = await isOpenBaoSshAvailable();

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!OPENBAO)('SSH-18 REST + public downloads', () => {
  let app: FastifyInstance;
  let work: string;
  let userCa: SshCaDto;
  let hostCa: SshCaDto;
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
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h'), '-N', '', '-q']);
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
    expect(list.json<{ id: string; revoked?: boolean }[]>().some((c) => c.id === created.id)).toBe(true);
  });

  it('manages principals over REST: create, list, map to a host account, render', async () => {
    const cp = await app.inject({ method: 'POST', url: '/api/v1/ssh/principals', payload: { name: 'admins', description: 'Admins' } });
    expect(cp.statusCode).toBe(200);
    const principal = cp.json();
    expect(principal.name).toBe('admins');

    const list = await app.inject({ method: 'GET', url: '/api/v1/ssh/principals' });
    expect(list.json<{ id: string; revoked?: boolean }[]>().some((p) => p.id === principal.id)).toBe(true);

    const m = await app.inject({ method: 'POST', url: '/api/v1/ssh/principals/map', payload: { hostId, principalId: principal.id, localAccount: 'deploy' } });
    expect(m.statusCode).toBe(200);
    expect(m.json().ok).toBe(true);

    const r = await app.inject({ method: 'GET', url: `/api/v1/ssh/hosts/${hostId}/auth-principals` });
    expect(r.statusCode).toBe(200);
    const rendered = r.json();
    // BLK-13: render() pre-provisions dual-form lines (P + P@<fqdn>).
    expect(rendered.files.deploy.trim().split('\n')).toEqual(['admins', 'admins@rest.lab.local']);
    expect(rendered.directive).toContain('AuthorizedPrincipalsFile');
  });

  it('mints/lists/revokes a fleet token over REST (POST/GET /tokens)', async () => {
    const mint = await app.inject({ method: 'POST', url: '/api/v1/ssh/tokens', payload: { name: 'rest-fleet', hostCaId: hostCa.id, opSet: ['sign-host', 'get-principals'] } });
    expect(mint.statusCode).toBe(200);
    const body = mint.json();
    expect(body.token).toMatch(/^pkimg_/);
    expect(body.record.opSet).toEqual(['sign-host', 'get-principals']);

    const list = await app.inject({ method: 'GET', url: '/api/v1/ssh/tokens' });
    expect(list.json<{ id: string; revoked?: boolean }[]>().some((t) => t.id === body.record.id)).toBe(true);

    const rev = await app.inject({ method: 'POST', url: `/api/v1/ssh/tokens/${body.record.id}/revoke` });
    expect(rev.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ssh/tokens' })).json<{ id: string; revoked?: boolean }[]>().find((t) => t.id === body.record.id)!.revoked).toBe(true);
  });

  it('lists hosts and looks one up by fqdn (GET /hosts?fqdn=)', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/v1/ssh/hosts' });
    expect(all.statusCode).toBe(200);
    expect(all.json<{ id: string; revoked?: boolean }[]>().some((h) => h.id === hostId)).toBe(true);

    const one = await app.inject({ method: 'GET', url: '/api/v1/ssh/hosts?fqdn=rest.lab.local' });
    expect(one.json().length).toBe(1);
    expect(one.json()[0].id).toBe(hostId);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ssh/hosts?fqdn=nope.lab' })).json()).toEqual([]);
  });

  it('grants an identity a principal entitlement over REST (POST /principals/grant)', async () => {
    const ident = (await app.inject({ method: 'POST', url: '/api/v1/ssh/identities', payload: { subject: 'grant@rest' } })).json();
    const princ = (await app.inject({ method: 'POST', url: '/api/v1/ssh/principals', payload: { name: 'granters' } })).json();
    const g = await app.inject({ method: 'POST', url: '/api/v1/ssh/principals/grant', payload: { identityId: ident.id, principalId: princ.id } });
    expect(g.statusCode).toBe(200);
    expect(g.json().ok).toBe(true);
  });

  it('revokes a user cert over REST, lists it, and serves a KRL that sshd accepts', async () => {
    // resolve the active user CA
    const cas = (await app.inject({ method: 'GET', url: '/api/v1/ssh/cas' })).json();
    const uca = cas.find((c: SshCaDto) => c.caType === 'user' && c.status === 'active');
    expect(uca).toBeTruthy();

    // issue a user cert we can revoke
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u'), '-N', '', '-q']);
    const ident = (await app.inject({ method: 'POST', url: '/api/v1/ssh/identities', payload: { subject: 'revoke-me' } })).json();
    const issued = (await app.inject({
      method: 'POST',
      url: '/api/v1/ssh/users/issue',
      payload: { identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u.pub'), 'utf8'), principals: ['admins'] },
    })).json();

    // revoke it -> rebuilds the CA KRL
    const rev = await app.inject({ method: 'POST', url: `/api/v1/ssh/certs/${issued.cert.id}/revoke`, payload: { reason: 'test' } });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().revokedCount).toBeGreaterThanOrEqual(1);

    // it shows up in the revocation list
    const revs = (await app.inject({ method: 'GET', url: `/api/v1/ssh/cas/${uca.id}/revocations` })).json();
    expect(revs.some((r: { serial: string }) => r.serial === issued.cert.serial)).toBe(true);

    // the bare KRL bytes parse and mark this cert REVOKED (what sshd would do)
    const krl = await app.inject({ method: 'GET', url: `/api/v1/ssh/cas/${uca.id}/krl.bin` });
    expect(krl.statusCode).toBe(200);
    expect(krl.headers['content-type']).toContain('application/octet-stream');
    expect(krl.rawPayload.length).toBeGreaterThan(0);

    writeFileSync(join(work, 'revoked_keys'), krl.rawPayload);
    writeFileSync(join(work, 'u-cert.pub'), issued.cert.certOpenssh.trim() + '\n');
    // ssh-keygen -Q exits non-zero when a key IS revoked, printing "...: REVOKED" to stdout.
    let q = '';
    try {
      q = execFileSync('ssh-keygen', ['-Qf', join(work, 'revoked_keys'), join(work, 'u-cert.pub')], { encoding: 'utf8' });
    } catch (e) {
      q = String(e instanceof Error && 'stdout' in e ? e.stdout : '');
    }
    expect(q).toContain('REVOKED');
  });

  it('rejects an invalid REST body with a 400 {error}', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/ssh/cas', payload: { caType: 'banana' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBeTruthy();
  });
});
