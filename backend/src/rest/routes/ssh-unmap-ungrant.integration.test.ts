/**
 * TASK-245 — remove a host mapping and an identity grant (service + REST).
 * Before this there was no unmap and no ungrant: a mapping could only go away
 * with a full host offboard, and a grant never. No KMS: rows are seeded.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { sshHosts, sshIdentities, sshPrincipals, sshHostPrincipalMaps, sshUserPrincipals, auditLog } from '../../db/schema.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';

const ctx = { db, ipAddress: null };
const svc = getSshPrincipalService();
const P = (p: string) => `/api/v1/ssh${p}`;
const FQDN = 'unmap.lab.local';
const SUBJECT = 'unmap-user@lab';

async function wipe() {
  await db.delete(sshHostPrincipalMaps);
  await db.delete(sshUserPrincipals);
  await db.delete(sshPrincipals);
  await db.delete(sshHosts).where(eq(sshHosts.fqdn, FQDN));
  await db.delete(sshIdentities).where(eq(sshIdentities.subject, SUBJECT));
  await db.delete(auditLog).where(inArray(auditLog.operation, ['ssh.principal.unmap', 'ssh.principal.revoke_grant']));
}

const audits = (op: string, entityId: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.operation, op), eq(auditLog.entityId, entityId)));

describe('TASK-245 — unmap and revoke grant', () => {
  let app: FastifyInstance;
  let hostId: string;
  let identityId: string;
  let ops: string;
  let web: string;

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
    identityId = randomUUID();
    await db.insert(sshHosts).values({ id: hostId, fqdn: FQDN, status: 'active' } as any);
    await db.insert(sshIdentities).values({ id: identityId, subject: SUBJECT, status: 'active' } as any);
    ops = (await svc.createPrincipal(ctx, { name: 'ops' })).id;
    web = (await svc.createPrincipal(ctx, { name: 'web' })).id;
    await svc.mapToHost(ctx, { hostId, principalId: ops, localAccount: 'root' });
    await svc.mapToHost(ctx, { hostId, principalId: web, localAccount: 'deploy' });
    await svc.markPushed(ctx, hostId);
    await svc.grantToIdentity(ctx, { identityId, principalId: ops });
    await svc.grantToIdentity(ctx, { identityId, principalId: web });
  });

  it('lists host mapping rows', async () => {
    const res = await app.inject({ method: 'GET', url: P(`/hosts/${hostId}/principal-maps`) });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((m: any) => `${m.name}->${m.localAccount}`)).toEqual(['web->deploy', 'ops->root']);
  });

  it('POST /principals/unmap removes one mapping, makes the host Stale, and is audited', async () => {
    expect((await svc.render(ctx, hostId)).stale).toBe(false);
    const res = await app.inject({
      method: 'POST',
      url: P('/principals/unmap'),
      payload: { hostId, principalId: ops, localAccount: 'root' },
    });
    expect(res.statusCode).toBe(200);

    const r = await svc.render(ctx, hostId);
    expect(Object.keys(r.files)).toEqual(['deploy']);
    expect(r.stale).toBe(true);
    expect((await audits('ssh.principal.unmap', hostId)).map((a: any) => a.status)).toEqual(['success']);
  });

  it('unmapping a row that does not exist is a 404 with a failure audit (no silent no-op)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: P('/principals/unmap'),
      payload: { hostId, principalId: ops, localAccount: 'nobody' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toMatch(/not found/i);
    expect((await svc.render(ctx, hostId)).stale).toBe(false);
    expect((await audits('ssh.principal.unmap', hostId)).map((a: any) => a.status)).toEqual(['failure']);
  });

  it('a principal becomes deletable once its mappings and grants are removed', async () => {
    await svc.unmapFromHost(ctx, { hostId, principalId: web, localAccount: 'deploy' });
    await svc.revokeGrant(ctx, { identityId, principalId: web });
    await expect(svc.deletePrincipal(ctx, web)).resolves.toBeUndefined();
  });

  it('GET grants + POST /principals/revoke-grant removes one grant and is audited', async () => {
    const list = await app.inject({ method: 'GET', url: P(`/identities/${identityId}/grants`) });
    expect(list.json().map((g: any) => g.name)).toEqual(['ops', 'web']);

    const res = await app.inject({ method: 'POST', url: P('/principals/revoke-grant'), payload: { identityId, principalId: ops } });
    expect(res.statusCode).toBe(200);
    expect((await svc.listGrants(ctx, identityId)).map((g) => g.name)).toEqual(['web']);
    expect((await audits('ssh.principal.revoke_grant', identityId)).map((a: any) => a.status)).toEqual(['success']);
  });

  it('revoking a grant that does not exist is a 404 with a failure audit', async () => {
    await svc.revokeGrant(ctx, { identityId, principalId: ops });
    const res = await app.inject({ method: 'POST', url: P('/principals/revoke-grant'), payload: { identityId, principalId: ops } });
    expect(res.statusCode).toBe(404);
    const rows = await audits('ssh.principal.revoke_grant', identityId);
    expect(rows.map((a: any) => a.status)).toEqual(['success', 'failure']);
  });

  it('listing grants of an unknown identity is a 404', async () => {
    const res = await app.inject({ method: 'GET', url: P(`/identities/${randomUUID()}/grants`) });
    expect(res.statusCode).toBe(404);
  });
});
