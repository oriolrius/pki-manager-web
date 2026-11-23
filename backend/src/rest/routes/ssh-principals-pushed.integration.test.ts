/**
 * TASK-246 — fleet automation acknowledges a principal-file push:
 * POST /api/v1/external/ssh/hosts/:fqdn/principals-pushed { sha256 }.
 * The GET auth-principals response carries the same sha256 so a client can echo
 * it. No KMS: rows are seeded directly, tokens are minted with no CA (the
 * get-principals op needs none).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { db } from '../../db/client.js';
import { sshHosts, sshPrincipals, sshHostPrincipalMaps, sshFleetTokens, auditLog, zones } from '../../db/schema.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';
import { getSshFleetTokenService } from '../../services/ssh-fleet-token.service.js';

const ctx = { db, ipAddress: null };
const FQDN = 'ack.lab.local';
const BASE = '/api/v1/external/ssh/hosts';

async function wipe() {
  await db.delete(sshHostPrincipalMaps);
  await db.delete(sshPrincipals);
  await db.delete(sshFleetTokens);
  await db.delete(sshHosts).where(eq(sshHosts.fqdn, FQDN));
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.principal.mark_pushed'));
}

describe('TASK-246 — POST /external/ssh/hosts/:fqdn/principals-pushed', () => {
  let app: FastifyInstance;
  let hostId: string;
  let token: string;
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = Fastify();
    registerSshExternalRoutes(app);
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await wipe();
  });

  beforeEach(async () => {
    await wipe();
    hostId = randomUUID();
    await db.insert(sshHosts).values({ id: hostId, fqdn: FQDN, status: 'active' } as any);
    const p = await getSshPrincipalService().createPrincipal(ctx, { name: 'ops' });
    await getSshPrincipalService().mapToHost(ctx, { hostId, principalId: p.id, localAccount: 'root' });
    token = (await getSshFleetTokenService().mint(ctx, { name: 'ack', opSet: ['get-principals'] })).token;
  });

  it('GET auth-principals returns the canonical sha256 of the served files', async () => {
    const res = await app.inject({ method: 'GET', url: `${BASE}/${FQDN}/auth-principals`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sha256).toBe((await getSshPrincipalService().render(ctx, hostId)).sha256);
    expect(body.stale).toBe(true);
  });

  it('echoing the GET sha256 clears Stale and is audited', async () => {
    const { sha256 } = (await app.inject({ method: 'GET', url: `${BASE}/${FQDN}/auth-principals`, headers: auth() })).json();
    const res = await app.inject({ method: 'POST', url: `${BASE}/${FQDN}/principals-pushed`, headers: auth(), payload: { sha256 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hostId, fqdn: FQDN, sha256 });
    expect((await getSshPrincipalService().render(ctx, hostId)).stale).toBe(false);

    const rows = await db.select().from(auditLog).where(and(eq(auditLog.operation, 'ssh.principal.mark_pushed'), eq(auditLog.entityId, hostId)));
    expect(rows.map((r: any) => r.status)).toEqual(['success']);
  });

  it('a stale hash (files changed after the GET) is refused with 409 + the current hash', async () => {
    const { sha256: old } = (await app.inject({ method: 'GET', url: `${BASE}/${FQDN}/auth-principals`, headers: auth() })).json();
    const p2 = await getSshPrincipalService().createPrincipal(ctx, { name: 'web' });
    await getSshPrincipalService().mapToHost(ctx, { hostId, principalId: p2.id, localAccount: 'deploy' });

    const res = await app.inject({ method: 'POST', url: `${BASE}/${FQDN}/principals-pushed`, headers: auth(), payload: { sha256: old } });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('SHA256_MISMATCH');
    expect(body.currentSha256).toBe((await getSshPrincipalService().render(ctx, hostId)).sha256);
    expect((await getSshPrincipalService().render(ctx, hostId)).stale).toBe(true);

    const rows = await db.select().from(auditLog).where(and(eq(auditLog.operation, 'ssh.principal.mark_pushed'), eq(auditLog.entityId, hostId)));
    expect(rows.map((r: any) => r.status)).toEqual(['failure']);
  });

  it('needs a token (401) and a 64-hex sha256 (400)', async () => {
    const res400 = await app.inject({ method: 'POST', url: `${BASE}/${FQDN}/principals-pushed`, headers: auth(), payload: { sha256: 'abc' } });
    expect(res400.statusCode).toBe(400);
    const res401 = await app.inject({ method: 'POST', url: `${BASE}/${FQDN}/principals-pushed`, payload: { sha256: '0'.repeat(64) } });
    expect(res401.statusCode).toBe(401);
  });

  it('a token without get-principals gets 403', async () => {
    // Insert a token row directly with an op that needs no CA lookups at verify time.
    const t = await getSshFleetTokenService().mint(ctx, { name: 'ro', opSet: ['get-principals'] });
    await db.update(sshFleetTokens).set({ opSet: JSON.stringify(['register-host-pubkey']) }).where(eq(sshFleetTokens.id, t.record.id));
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/${FQDN}/principals-pushed`,
      headers: { authorization: `Bearer ${t.token}` },
      payload: { sha256: '0'.repeat(64) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a host outside the token zone is 404 and audited as a failure', async () => {
    const zoneId = randomUUID();
    await db.insert(zones).values({ id: zoneId, name: `z-${zoneId.slice(0, 8)}`, displayName: 'Other' } as any);
    try {
      await db.update(sshHosts).set({ zoneId } as any).where(eq(sshHosts.id, hostId));
      await db.delete(sshHostPrincipalMaps).where(eq(sshHostPrincipalMaps.hostId, hostId));
      const res = await app.inject({ method: 'POST', url: `${BASE}/${FQDN}/principals-pushed`, headers: auth(), payload: { sha256: '0'.repeat(64) } });
      expect(res.statusCode).toBe(404);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.operation, 'ssh.principal.mark_pushed'), eq(auditLog.entityId, FQDN)));
      expect(rows.map((r: any) => r.status)).toEqual(['failure']);
    } finally {
      await db.delete(sshHosts).where(eq(sshHosts.id, hostId));
      await db.delete(zones).where(eq(zones.id, zoneId));
    }
  });
});
