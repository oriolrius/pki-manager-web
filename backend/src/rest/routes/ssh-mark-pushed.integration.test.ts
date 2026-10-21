/**
 * TASK-215 — `markPushed` over REST.
 *
 * Before this, clearing a host's Stale principals flag existed only as the tRPC
 * procedure `ssh.principal.markPushed`, so a REST-only onboarding (scripts, the
 * Python CLI, Ansible) had to drop out of /api/v1 for that single step. These
 * tests pin the REST route, the 404 on an unknown host, and the audit trail.
 *
 * No KMS needed: host rows are inserted directly, since marking pushed never
 * touches a key.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { sshHosts, sshPrincipals, sshHostPrincipalMaps, auditLog } from '../../db/schema.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';

const FQDN = 'markpushed.lab.local';
const PUSHED_PATH = (id: string) => `/api/v1/ssh/hosts/${id}/auth-principals/pushed`;

async function wipe() {
  await db.delete(sshHostPrincipalMaps);
  await db.delete(sshPrincipals);
  await db.delete(sshHosts).where(eq(sshHosts.fqdn, FQDN));
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.principal.mark_pushed'));
}

async function markPushedAudits(hostId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.operation, 'ssh.principal.mark_pushed'), eq(auditLog.entityId, hostId)));
}

describe('TASK-215 — POST /api/v1/ssh/hosts/:id/auth-principals/pushed', () => {
  let app: FastifyInstance;
  let hostId: string;

  beforeAll(async () => {
    process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
    app = Fastify();
    await app.register(sshRoutes, { prefix: '/api/v1/ssh' });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await wipe();
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
  });

  beforeEach(async () => {
    await wipe();
    hostId = randomUUID();
    // updatedAt in the future relative to lastPrincipalPushAt (null) => Stale.
    await db.insert(sshHosts).values({ id: hostId, fqdn: FQDN, status: 'active' } as any);
  });

  it('clears the Stale flag using REST alone (no tRPC call)', async () => {
    const before = await getSshPrincipalService().render({ db, ipAddress: null }, hostId);
    expect(before.stale).toBe(true);

    const res = await app.inject({ method: 'POST', url: PUSHED_PATH(hostId) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hostId, fqdn: FQDN });
    expect(typeof res.json().lastPrincipalPushAt).toBe('string');

    const after = await getSshPrincipalService().render({ db, ipAddress: null }, hostId);
    expect(after.stale).toBe(false);
  });

  it('returns 404 (not 500) for an unknown host id', async () => {
    const res = await app.inject({ method: 'POST', url: PUSHED_PATH(randomUUID()) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toMatch(/not found/i);
  });

  it('writes an audit_log row on success and on failure', async () => {
    await app.inject({ method: 'POST', url: PUSHED_PATH(hostId) });
    const ok = await markPushedAudits(hostId);
    expect(ok).toHaveLength(1);
    expect(ok[0].status).toBe('success');

    const missing = randomUUID();
    await app.inject({ method: 'POST', url: PUSHED_PATH(missing) });
    const failed = await markPushedAudits(missing);
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe('failure');
  });

  it('REST and the tRPC-facing service call produce identical results', async () => {
    const viaRest = (await app.inject({ method: 'POST', url: PUSHED_PATH(hostId) })).json();

    // Re-stale the host, then drive the SAME service method tRPC uses.
    await db.update(sshHosts).set({ lastPrincipalPushAt: null } as any).where(eq(sshHosts.id, hostId));
    expect((await getSshPrincipalService().render({ db, ipAddress: null }, hostId)).stale).toBe(true);
    const viaService = await getSshPrincipalService().markPushed({ db, ipAddress: null }, hostId);

    expect(Object.keys(viaService).sort()).toEqual(Object.keys(viaRest).sort());
    expect(viaService.hostId).toBe(viaRest.hostId);
    expect(viaService.fqdn).toBe(viaRest.fqdn);
    // One audit row per call, same operation/entity/status.
    const rows = await markPushedAudits(hostId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r: any) => r.status))).toEqual(new Set(['success']));
    expect(new Set(rows.map((r: any) => r.entityType))).toEqual(new Set(['ssh_host']));
  });
});
