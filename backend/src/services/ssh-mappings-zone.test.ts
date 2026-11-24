/**
 * TASK-249 — mappingsByPrincipal must not mix zones. The same principal NAME
 * exists in prod and staging; the Issue form panel must list only the hosts of
 * the selected identity's zone. No KMS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sshHosts, sshPrincipals, sshHostPrincipalMaps, zones } from '../db/schema.js';
import { getSshPrincipalService } from './ssh-principal.service.js';
import { sshRoutes } from '../rest/routes/ssh.routes.js';

const ctx = { db, ipAddress: null };
const svc = getSshPrincipalService();
const SLUG = `stg-${randomUUID().slice(0, 6)}`;
let stagingId: string;
const hostIds: string[] = [];
let app: FastifyInstance;

async function host(fqdn: string, zoneId: string) {
  const id = randomUUID();
  hostIds.push(id);
  await db.insert(sshHosts).values({ id, fqdn, zoneId, status: 'active' } as any);
  return id;
}

beforeAll(async () => {
  stagingId = randomUUID();
  await db.insert(zones).values({ id: stagingId, name: SLUG, displayName: 'Staging' } as any);
  const prodOps = await svc.createPrincipal(ctx, { name: 'zops', zone: 'default' });
  const stgOps = await svc.createPrincipal(ctx, { name: 'zops', zone: stagingId });
  await svc.mapToHost(ctx, { hostId: await host('web.prod.lab', 'default'), principalId: prodOps.id, localAccount: 'root' });
  await svc.mapToHost(ctx, { hostId: await host('web.stg.lab', stagingId), principalId: stgOps.id, localAccount: 'admin' });

  process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
  app = Fastify();
  await app.register(sshRoutes, { prefix: '/api/v1/ssh' });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
  await db.delete(sshHostPrincipalMaps).where(inArray(sshHostPrincipalMaps.hostId, hostIds));
  await db.delete(sshHosts).where(inArray(sshHosts.id, hostIds));
  await db.delete(sshPrincipals).where(eq(sshPrincipals.name, 'zops'));
  await db.delete(zones).where(eq(zones.id, stagingId));
});

describe('TASK-249 — mappingsByPrincipal zone scope', () => {
  it('with a zone (id or slug) returns only that zone mappings', async () => {
    expect((await svc.mappingsByPrincipal(ctx, { zone: 'default' })).zops).toEqual([{ fqdn: 'web.prod.lab', localAccount: 'root' }]);
    expect((await svc.mappingsByPrincipal(ctx, { zone: stagingId })).zops).toEqual([{ fqdn: 'web.stg.lab', localAccount: 'admin' }]);
    expect((await svc.mappingsByPrincipal(ctx, { zone: SLUG })).zops).toEqual([{ fqdn: 'web.stg.lab', localAccount: 'admin' }]);
  });

  it('without a zone keeps the legacy all-zones result', async () => {
    const all = (await svc.mappingsByPrincipal(ctx)).zops.map((m) => m.fqdn).sort();
    expect(all).toEqual(['web.prod.lab', 'web.stg.lab']);
  });

  it('REST ?zone= scopes the same way; an unknown zone is a 404', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/ssh/principals/mappings?zone=${SLUG}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().zops).toEqual([{ fqdn: 'web.stg.lab', localAccount: 'admin' }]);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/ssh/principals/mappings?zone=no-such-zone' });
    expect(missing.statusCode).toBe(404);
  });
});
