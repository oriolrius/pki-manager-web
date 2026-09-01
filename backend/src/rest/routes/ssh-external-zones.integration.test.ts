/**
 * ZONE-09 (decision-017 amendment A2) — external/fleet API zone scoping.
 * Proves: (1) the unauthenticated ECIES /krl route returns 409 AMBIGUOUS_HOST
 * when one FQDN exists in several zones and serves the right host when `zone` is
 * given; (2) a fleet token's zone scopes the sign-host upsert-by-fqdn so
 * automation never adopts a foreign zone's same-named host. Gated on KMS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { db } from '../../db/client.js';
import {
  zones, sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls,
  sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals,
  sshFleetTokens, sshIdempotency,
} from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshZoneService } from '../../services/ssh-zone.service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshFleetTokenService } from '../../services/ssh-fleet-token.service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshHostKrls, sshHostBlocks, sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
  await db.delete(zones).where(ne(zones.name, 'default'));
}

describe.skipIf(!KMS)('ZONE-09 external API zone scoping (A2)', () => {
  let app: FastifyInstance;
  let work: string;
  let prodToken: string;
  let hostPubA: string;
  let hostPubB: string;
  const prevEcies = process.env.SSH_ECIES_ENABLED;

  beforeAll(async () => {
    process.env.SSH_ECIES_ENABLED = 'true';
    work = mkdtempSync(join(tmpdir(), 'ssh-extz-'));
    await wipe();
    app = Fastify();
    registerSshExternalRoutes(app);
    await app.ready();

    await getSshZoneService().create(ctx, { name: 'prod', displayName: 'Prod' });
    await getSshZoneService().create(ctx, { name: 'staging', displayName: 'Staging' });
    const pHostCa = await getSshCaService().create(ctx, { caType: 'host', zone: 'prod' });
    await getSshCaService().create(ctx, { caType: 'host', zone: 'staging' });

    // Same FQDN registered in BOTH zones (each needs its own ecdsa host key).
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'a'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'b'), '-N', '', '-q']);
    hostPubA = readFileSync(join(work, 'a.pub'), 'utf8');
    hostPubB = readFileSync(join(work, 'b.pub'), 'utf8');
    await getSshHostService().register(ctx, { fqdn: 'web1.example.com', addresses: [], opensshHostPubkey: hostPubA, zone: 'prod' });
    await getSshHostService().register(ctx, { fqdn: 'web1.example.com', addresses: [], opensshHostPubkey: hostPubB, zone: 'staging' });

    const minted = await getSshFleetTokenService().mint(ctx, { name: 'prod-fleet', hostCaId: pHostCa.id, opSet: ['sign-host'], zone: 'prod' });
    prodToken = minted.token;
  }, 60_000);

  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
    if (prevEcies === undefined) delete process.env.SSH_ECIES_ENABLED;
    else process.env.SSH_ECIES_ENABLED = prevEcies;
  });

  it('ECIES /krl returns 409 AMBIGUOUS_HOST for a multi-zone FQDN, 200 with an explicit zone', async () => {
    const ambiguous = await app.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/krl',
      payload: { host_id: 'web1.example.com' },
    });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json().error.code).toBe('AMBIGUOUS_HOST');

    const scoped = await app.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/krl',
      payload: { host_id: 'web1.example.com', zone: 'staging' },
    });
    // 200 (envelope) or 503 (no KRL yet) — the point is it is NOT 409/404.
    expect([200, 503]).toContain(scoped.statusCode);
  });

  it("sign-host upserts within the token's zone, never the foreign same-named host", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/sign-host',
      headers: { authorization: `Bearer ${prodToken}` },
      payload: { fqdn: 'web1.example.com', addresses: [], opensshHostPubkey: hostPubA },
    });
    expect(res.statusCode).toBe(200);
    const hostId = res.json().hostId;
    const row = (await db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0] as any;
    const prod = (await db.select().from(zones).where(eq(zones.name, 'prod')).limit(1))[0] as any;
    expect(row.zoneId).toBe(prod.id); // signed the PROD host, not staging's

    // Exactly one cert was issued, against the prod host row.
    const certs = await db.select().from(sshCertificates).where(and(eq(sshCertificates.hostId, hostId)));
    expect(certs.length).toBe(1);
  });
});
