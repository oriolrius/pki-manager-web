/**
 * TASK-216 — REST/tRPC parity guard for the SSH surface.
 *
 * The SSH service layer is meant to be reachable from BOTH APIs. It drifted:
 * 22 of 52 tRPC procedures had no REST twin, so a REST-only client (scripts,
 * pki-manager-cli, Ansible) could not drive a full SSH CA lifecycle.
 *
 * This test is the regression guard. It enumerates the live tRPC router rather
 * than a hand-written list, so ADDING A tRPC PROCEDURE WITHOUT A REST TWIN
 * FAILS HERE — the author must either add the route or record a deliberate
 * exemption below.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenAPI } from '../openapi.js';
import { sshRoutes } from './ssh.routes.js';
import { sshRouter } from '../../trpc/procedures/ssh.js';

/**
 * tRPC procedure -> the REST operation that performs the same thing.
 * Values are "<METHOD> <path>" as they appear in the generated OpenAPI.
 */
const REST_TWIN: Record<string, string> = {
  // CA lifecycle
  'ca.list': 'GET /ssh/cas',
  'ca.get': 'GET /ssh/cas/{caId}',
  'ca.trustAnchors': 'GET /ssh/trust-anchors',
  'ca.create': 'POST /ssh/cas',
  'ca.import': 'POST /ssh/cas/import',
  'ca.revoke': 'POST /ssh/cas/{caId}/revoke',
  'ca.rotate': 'POST /ssh/cas/{caId}/rotate',
  'ca.retire': 'POST /ssh/cas/{caId}/retire',
  // Hosts
  'host.list': 'GET /ssh/hosts',
  'host.get': 'GET /ssh/hosts/{id}',
  'host.access': 'GET /ssh/hosts/{id}/access',
  'host.register': 'POST /ssh/hosts',
  'host.deployBundle': 'GET /ssh/hosts/{id}/deploy-bundle',
  'host.issue': 'POST /ssh/hosts/issue',
  'host.revoke': 'POST /ssh/hosts/{id}/revoke',
  'host.registerEciesKey': 'POST /ssh/hosts/{id}/ecies-key',
  'host.offboard': 'POST /ssh/hosts/{id}/offboard',
  // Identities & user certs
  'user.listIdentities': 'GET /ssh/identities',
  'user.createIdentity': 'POST /ssh/identities',
  'user.disableIdentity': 'POST /ssh/identities/{id}/disable',
  'user.offboard': 'POST /ssh/identities/{id}/offboard',
  'user.issue': 'POST /ssh/users/issue',
  'user.listCertificates': 'GET /ssh/users/certificates',
  // revokeByCert is a superset of userService.revoke (status flip + revocation
  // row + host-lineage invalidation + KRL rebuild), so one route serves both.
  'user.revoke': 'POST /ssh/certs/{id}/revoke',
  // Principals
  'principal.list': 'GET /ssh/principals',
  'principal.mappingsByPrincipal': 'GET /ssh/principals/mappings',
  'principal.create': 'POST /ssh/principals',
  'principal.delete': 'DELETE /ssh/principals/{id}',
  'principal.grant': 'POST /ssh/principals/grant',
  'principal.map': 'POST /ssh/principals/map',
  'principal.render': 'GET /ssh/hosts/{id}/auth-principals',
  'principal.staleHosts': 'GET /ssh/principals/stale-hosts',
  'principal.markPushed': 'POST /ssh/hosts/{id}/auth-principals/pushed',
  // Fleet tokens
  'token.list': 'GET /ssh/tokens',
  'token.mint': 'POST /ssh/tokens',
  'token.revoke': 'POST /ssh/tokens/{id}/revoke',
  // Bulk
  'bulk.expiring': 'GET /ssh/bulk/expiring',
  'bulk.renew': 'POST /ssh/bulk/renew',
  'bulk.revoke': 'POST /ssh/bulk/revoke',
  // KRL / revocation
  'krl.getLatest': 'GET /ssh/cas/{caId}/krl.bin',
  'krl.listRevocations': 'GET /ssh/cas/{caId}/revocations',
  'krl.generate': 'POST /ssh/cas/{caId}/krl',
  'krl.revokeCert': 'POST /ssh/certs/{id}/revoke',
  'krl.revokeSerial': 'POST /ssh/cas/{caId}/revoke-serial',
  'krl.revokeKey': 'POST /ssh/cas/{caId}/revoke-key',
  // Per-host access blocks
  'block.block': 'POST /ssh/blocks',
  'block.unblock': 'POST /ssh/blocks/unblock',
  'block.listForHost': 'GET /ssh/hosts/{id}/blocks',
  'block.listForIdentity': 'GET /ssh/identities/{id}/blocks',
  'block.collisions': 'GET /ssh/identities/{id}/collisions',
  'block.fleetDistribution': 'GET /ssh/blocks/fleet',
  // Monitoring
  'mon.metrics': 'GET /ssh/metrics',
};

/**
 * Procedures deliberately NOT exposed over REST. Empty on purpose: today the
 * surface is at full parity. Adding an entry here is a conscious decision that
 * must carry a reason.
 */
const REST_EXEMPT: Record<string, string> = {};

describe('TASK-216 — every SSH tRPC procedure has a REST twin', () => {
  let app: FastifyInstance;
  let restOps: Set<string>;

  beforeAll(async () => {
    app = Fastify();
    await registerOpenAPI(app);
    await app.register(sshRoutes, { prefix: '/ssh' });
    await app.ready();
    const spec = app.swagger() as any;
    restOps = new Set(
      Object.entries<any>(spec.paths).flatMap(([path, item]) =>
        Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`)
      )
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  const procedures = Object.keys((sshRouter as any)._def.procedures).sort();

  it('the tRPC router still exposes the procedures this map was built against', () => {
    expect(procedures.length).toBeGreaterThan(0);
  });

  it.each(procedures)('%s is reachable over REST', (proc) => {
    if (proc in REST_EXEMPT) return;
    const twin = REST_TWIN[proc];
    expect(
      twin,
      `tRPC procedure "${proc}" has no REST twin. Add a route in ssh.routes.ts and map it in REST_TWIN, ` +
        'or record a deliberate exemption in REST_EXEMPT with a reason.'
    ).toBeDefined();
    expect(restOps.has(twin!), `REST_TWIN maps ${proc} -> "${twin}", which is not a registered route`).toBe(true);
  });

  it('REST_TWIN has no stale entries (every mapping names a live procedure)', () => {
    const live = new Set(procedures);
    const stale = Object.keys(REST_TWIN).filter((p) => !live.has(p));
    expect(stale, `REST_TWIN references procedures that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('the whole SSH surface is at parity (no exemptions)', () => {
    expect(Object.keys(REST_EXEMPT)).toEqual([]);
    expect(Object.keys(REST_TWIN).sort()).toEqual(procedures);
  });
});
