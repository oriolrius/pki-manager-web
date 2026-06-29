/**
 * SSH-19 fleet-token external signing — auth, scope, idempotency, automation
 * issuance, validated against the live KMS + ssh-keygen. Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshFleetTokenService } from '../../services/ssh-fleet-token.service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!KMS)('SSH-19 fleet-token external signing', () => {
  let app: FastifyInstance;
  let work: string;
  let userCa: any;
  let hostCa: any;
  let token: string;
  let hostPub: string;
  let userPub: string;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-ext-'));
    await wipe();
    app = Fastify();
    registerSshExternalRoutes(app);
    await app.ready();

    userCa = await getSshCaService().create(ctx, { caType: 'user' });
    hostCa = await getSshCaService().create(ctx, { caType: 'host' });
    const minted = await getSshFleetTokenService().mint(ctx, { name: 'fleet', userCaId: userCa.id, hostCaId: hostCa.id, opSet: ['sign-host', 'sign-user'] });
    token = minted.token;
    expect(token.startsWith('pkimg_')).toBe(true);

    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'h'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u'), '-N', '', '-q']);
    hostPub = readFileSync(join(work, 'h.pub'), 'utf8');
    userPub = readFileSync(join(work, 'u.pub'), 'utf8');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  const sign = (path: string, payload: any, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: `/api/v1/external/ssh/${path}`, headers: { authorization: `Bearer ${token}`, ...headers }, payload });

  it('rejects missing/invalid tokens with 401', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/sign-host', payload: { fqdn: 'x.lab', opensshHostPubkey: hostPub } });
    expect(r1.statusCode).toBe(401);
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/sign-host', headers: { authorization: 'Bearer pkimg_wrong' }, payload: { fqdn: 'x.lab', opensshHostPubkey: hostPub } });
    expect(r2.statusCode).toBe(401);
  });

  it('signs a host cert for an Ansible node and ssh-keygen -L validates it', async () => {
    const r = await sign('sign-host', { fqdn: 'web1.lab.local', addresses: ['10.0.0.11'], opensshHostPubkey: hostPub });
    expect(r.statusCode).toBe(200);
    const out = r.json();
    expect(out.serial).toBeTruthy();
    writeFileSync(join(work, 'hc.pub'), out.certOpenssh);
    const insp = execFileSync('ssh-keygen', ['-L', '-f', join(work, 'hc.pub')], { encoding: 'utf8' });
    expect(insp).toContain('host certificate');
    expect(insp).toContain('web1.lab.local');
    expect(insp).toContain(`Signing CA: ECDSA ${hostCa.fingerprintSha256}`);
  });

  it('signs a user cert with requested principals', async () => {
    const r = await sign('sign-user', { subject: 'ci@pipeline', sshPublicKey: userPub, principals: ['deployer'] });
    expect(r.statusCode).toBe(200);
    writeFileSync(join(work, 'uc.pub'), r.json().certOpenssh);
    const insp = execFileSync('ssh-keygen', ['-L', '-f', join(work, 'uc.pub')], { encoding: 'utf8' });
    expect(insp).toContain('user certificate');
    expect(insp).toContain('deployer');
  });

  it('is idempotent on Idempotency-Key (same serial returned, no new cert)', async () => {
    const headers = { 'idempotency-key': 'abc-123' };
    const r1 = await sign('sign-host', { fqdn: 'idem.lab.local', opensshHostPubkey: hostPub }, headers);
    const r2 = await sign('sign-host', { fqdn: 'idem.lab.local', opensshHostPubkey: hostPub }, headers);
    expect(r1.json().serial).toBe(r2.json().serial);
    expect(r1.json().certOpenssh).toBe(r2.json().certOpenssh);
  });

  it('enforces token scope (a host-only token cannot sign users)', async () => {
    const hostOnly = await getSshFleetTokenService().mint(ctx, { name: 'host-only', hostCaId: hostCa.id, opSet: ['sign-host'] });
    const r = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/sign-user', headers: { authorization: `Bearer ${hostOnly.token}` }, payload: { subject: 'x', sshPublicKey: userPub, principals: ['admin'] } });
    expect(r.statusCode).toBe(403);
  });

  it('refuses a revoked token', async () => {
    const tmp = await getSshFleetTokenService().mint(ctx, { name: 'tmp', hostCaId: hostCa.id, opSet: ['sign-host'] });
    const list = await getSshFleetTokenService().list(ctx);
    const rec = list.find((t) => t.name === 'tmp')!;
    await getSshFleetTokenService().revoke(ctx, rec.id);
    const r = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/sign-host', headers: { authorization: `Bearer ${tmp.token}` }, payload: { fqdn: 'r.lab', opensshHostPubkey: hostPub } });
    expect(r.statusCode).toBe(401);
  });
});
