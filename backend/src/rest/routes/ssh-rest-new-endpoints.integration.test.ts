/**
 * TASK-216 — behaviour of the SSH REST endpoints added for tRPC parity.
 *
 * Covers the subset that needs no KMS (reads, identity/principal/host state
 * changes) plus the 404-on-unknown-id contract across every new route. The
 * KMS-backed paths (CA rotate/retire/import, host cert issue, bulk renew) are
 * exercised by ssh-rest.integration.test.ts, which is gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { sshHosts, sshIdentities, sshPrincipals, sshHostPrincipalMaps } from '../../db/schema.js';

const P = (p: string) => `/api/v1/ssh${p}`;
const TAG = 't216-';

async function wipe() {
  await db.delete(sshHostPrincipalMaps);
  await db.delete(sshPrincipals).where(like(sshPrincipals.name, `${TAG}%`));
  await db.delete(sshHosts).where(like(sshHosts.fqdn, `${TAG}%`));
  await db.delete(sshIdentities).where(like(sshIdentities.subject, `${TAG}%`));
}

describe('TASK-216 — new SSH REST endpoints', () => {
  let app: FastifyInstance;
  let hostId: string;
  let identityId: string;

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
    await db.insert(sshHosts).values({ id: hostId, fqdn: `${TAG}host.lab.local`, status: 'active' } as any);
    await db.insert(sshIdentities).values({ id: identityId, subject: `${TAG}subject` } as any);
  });

  describe('reads that were tRPC-only', () => {
    it('GET /identities lists identities (so a client can check UNIQUE subject before creating)', async () => {
      const res = await app.inject({ method: 'GET', url: P('/identities') });
      expect(res.statusCode).toBe(200);
      expect(res.json().some((i: any) => i.id === identityId)).toBe(true);
    });

    it('GET /hosts/:id returns one host', async () => {
      const res = await app.inject({ method: 'GET', url: P(`/hosts/${hostId}`) });
      expect(res.statusCode).toBe(200);
      expect(res.json().fqdn).toBe(`${TAG}host.lab.local`);
    });

    it('GET /users/certificates accepts an ?identityId= filter', async () => {
      const all = await app.inject({ method: 'GET', url: P('/users/certificates') });
      expect(all.statusCode).toBe(200);
      expect(Array.isArray(all.json())).toBe(true);
      const filtered = await app.inject({ method: 'GET', url: P(`/users/certificates?identityId=${identityId}`) });
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json()).toEqual([]);
    });

    it('GET /principals/mappings returns the principal -> mappings object', async () => {
      const principal = await app.inject({ method: 'POST', url: P('/principals'), payload: { name: `${TAG}mapped` } });
      await app.inject({
        method: 'POST',
        url: P('/principals/map'),
        payload: { hostId, principalId: principal.json().id, localAccount: 'ubuntu' },
      });

      const res = await app.inject({ method: 'GET', url: P('/principals/mappings') });
      expect(res.statusCode).toBe(200);
      // A Record<principal, {fqdn, localAccount}[]> — NOT an array, which is why
      // this route documents an object response.
      expect(res.json()[`${TAG}mapped`]).toEqual([{ fqdn: `${TAG}host.lab.local`, localAccount: 'ubuntu' }]);
    });

    it('GET /principals/stale-hosts returns an array', async () => {
      const res = await app.inject({ method: 'GET', url: P('/principals/stale-hosts') });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    it('GET /bulk/expiring coerces withinSeconds and rejects a non-positive value', async () => {
      const ok = await app.inject({ method: 'GET', url: P('/bulk/expiring?withinSeconds=86400') });
      expect(ok.statusCode).toBe(200);
      expect(Array.isArray(ok.json())).toBe(true);
      const bad = await app.inject({ method: 'GET', url: P('/bulk/expiring?withinSeconds=0') });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('state changes that were tRPC-only', () => {
    it('POST /identities/:id/disable flips the identity to disabled', async () => {
      const res = await app.inject({ method: 'POST', url: P(`/identities/${identityId}/disable`) });
      expect(res.statusCode).toBe(200);
      const row = (await db.select().from(sshIdentities).where(eq(sshIdentities.id, identityId)))[0] as any;
      expect(row.status).toBe('disabled');
    });

    it('POST /identities/:id/offboard disables the identity and accepts a reason', async () => {
      const res = await app.inject({
        method: 'POST',
        url: P(`/identities/${identityId}/offboard`),
        payload: { reason: 'left the company' },
      });
      expect(res.statusCode).toBe(200);
      const row = (await db.select().from(sshIdentities).where(eq(sshIdentities.id, identityId)))[0] as any;
      expect(row.status).toBe('disabled');
    });

    it('DELETE /principals/:id removes an unused principal', async () => {
      const created = await app.inject({ method: 'POST', url: P('/principals'), payload: { name: `${TAG}role` } });
      expect(created.statusCode).toBe(200);
      const id = created.json().id;

      const del = await app.inject({ method: 'DELETE', url: P(`/principals/${id}`) });
      expect(del.statusCode).toBe(200);
      expect((await db.select().from(sshPrincipals).where(eq(sshPrincipals.id, id)))).toHaveLength(0);
    });

    it('DELETE /principals/:id refuses a principal still mapped to a host', async () => {
      const created = await app.inject({ method: 'POST', url: P('/principals'), payload: { name: `${TAG}inuse` } });
      const id = created.json().id;
      await app.inject({ method: 'POST', url: P('/principals/map'), payload: { hostId, principalId: id, localAccount: 'ubuntu' } });

      const del = await app.inject({ method: 'DELETE', url: P(`/principals/${id}`) });
      expect(del.statusCode).toBe(400);
      expect(del.json().error.message).toMatch(/in use/i);
    });

    it('POST /hosts/:id/revoke separates "no such host" from "host has no live cert"', async () => {
      // Host exists but was never issued a certificate -> 400, not 404.
      const noCert = await app.inject({ method: 'POST', url: P(`/hosts/${hostId}/revoke`) });
      expect(noCert.statusCode).toBe(400);
      expect(noCert.json().error.message).toMatch(/no active certificate/i);
    });

    it('a reason-only body stays optional (bare POST is accepted, no explicit {} needed)', async () => {
      // Fastify rejects an absent body against a declared body schema, so these
      // routes default it — a plain `curl -X POST` must work.
      const res = await app.inject({ method: 'POST', url: P(`/identities/${identityId}/offboard`) });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('404 contract on an unknown id', () => {
    const unknown = randomUUID();
    const cases: Array<[string, string, unknown?]> = [
      ['GET', `/cas/${unknown}`],
      ['POST', `/cas/${unknown}/revoke`, {}],
      ['GET', `/hosts/${unknown}`],
      ['GET', `/hosts/${unknown}/deploy-bundle`],
      ['POST', `/hosts/${unknown}/revoke`, {}],
      ['POST', `/hosts/${unknown}/ecies-key`],
      ['POST', `/hosts/${unknown}/offboard`, {}],
      ['POST', `/identities/${unknown}/disable`],
      ['POST', `/identities/${unknown}/offboard`, {}],
      ['DELETE', `/principals/${unknown}`],
    ];

    it.each(cases)('%s %s returns 404, not 500', async (method, path, payload) => {
      const res = await app.inject({ method: method as any, url: P(path), payload: payload as any });
      expect(res.statusCode, `${method} ${path} -> ${res.body}`).toBe(404);
      expect(res.json().error.message).toMatch(/not found/i);
    });
  });
});
