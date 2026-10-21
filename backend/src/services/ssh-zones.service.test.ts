/**
 * ZONE-02..05 multi-zone behaviour (decision-017), against the live KMS.
 * Proves the trust boundary that the single-zone suite cannot: fail-closed zone
 * resolution, per-(zone, ca_type) CA cardinality, the cross-zone invariant
 * guards, and — the security core — that a host's composed KRL never carries a
 * foreign zone's revocations. Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  zones,
  sshCas,
  sshCertificates,
  sshHosts,
  sshIdentities,
  sshPrincipals,
  sshUserPrincipals,
  sshHostPrincipalMaps,
  sshRevocations,
  sshKrls,
  sshHostKrls,
  sshHostBlocks,
} from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { getSshZoneService, SshZoneAmbiguousError } from './ssh-zone.service.js';
import { getSshCaService, SshCaExistsError } from './ssh-ca.service.js';
import { getSshHostService } from './ssh-host.service.js';
import { getSshUserService } from './ssh-user.service.js';
import { getSshPrincipalService, SshCrossZoneError } from './ssh-principal.service.js';
import { getSshBlockService } from './ssh-block.service.js';
import { getSshKrlService } from './ssh-krl.service.js';
import { getSshHostKrlService } from './ssh-host-krl.service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) {
    try {
      await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId);
    } catch {
      /* best effort */
    }
  }
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
  // Drop the zones this suite creates so other integration tests keep seeing a
  // single 'default' zone (their resolveZone stays unambiguous).
  await db.delete(zones).where(ne(zones.name, 'default'));
}

const keygen = (args: string[]) => execFileSync('ssh-keygen', args, { stdio: 'pipe' });

describe.skipIf(!KMS)('SSH zones — multi-zone trust boundary (ZONE-02..05)', () => {
  let work: string;
  let prod: any;
  let staging: any;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-zones-'));
    await wipe();
    prod = await getSshZoneService().create(ctx, { name: 'prod', displayName: 'Production' });
    staging = await getSshZoneService().create(ctx, { name: 'staging', displayName: 'Staging' });
  }, 60_000);

  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('ZONE-02: zone resolution is fail-closed once several zones exist', async () => {
    // default + prod + staging → ambiguous; omitting the zone must throw, never
    // silently pick one (would sign with the wrong trust domain's CA).
    await expect(getSshCaService().create(ctx, { caType: 'user' })).rejects.toThrow(SshZoneAmbiguousError);
  });

  it('ZONE-03: each zone holds its own active User+Host CA; a second per (zone,type) is rejected', async () => {
    const pUser = await getSshCaService().create(ctx, { caType: 'user', zone: 'prod' });
    const pHost = await getSshCaService().create(ctx, { caType: 'host', zone: 'prod' });
    const sUser = await getSshCaService().create(ctx, { caType: 'user', zone: 'staging' });
    await getSshCaService().create(ctx, { caType: 'host', zone: 'staging' });
    expect(pUser.zoneId).toBe(prod.id);
    expect(sUser.zoneId).toBe(staging.id);
    // 4 active CAs across 2 zones is fine; a 2nd active user CA IN prod is not.
    await expect(getSshCaService().create(ctx, { caType: 'user', zone: 'prod' })).rejects.toThrow(SshCaExistsError);
    // Trust anchors are per-zone: prod sees exactly its own one user + one host key.
    const anchors = await getSshCaService().getTrustAnchors(ctx, 'prod');
    expect(anchors.userCaKeys).toHaveLength(1);
    expect(anchors.hostCaKeys).toHaveLength(1);
    void pHost;
  });

  it('ZONE-04: cross-zone grants, host maps and blocks are refused', async () => {
    const idProd = await getSshUserService().createIdentity(ctx, { subject: 'alice', zone: 'prod' });
    const prinStaging = await getSshPrincipalService().createPrincipal(ctx, { name: 'admin', zone: 'staging' });
    keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h1'), '-N', '', '-q']);
    const hostProd = await getSshHostService().register(ctx, {
      fqdn: 'web1.prod.local',
      addresses: [],
      opensshHostPubkey: readFileSync(join(work, 'h1.pub'), 'utf8'),
      zone: 'prod',
    });

    await expect(
      getSshPrincipalService().grantToIdentity(ctx, { identityId: idProd.id, principalId: prinStaging.id })
    ).rejects.toThrow(SshCrossZoneError);
    await expect(
      getSshPrincipalService().mapToHost(ctx, { hostId: hostProd.id, principalId: prinStaging.id, localAccount: 'ops' })
    ).rejects.toThrow(SshCrossZoneError);
    const idStaging = await getSshUserService().createIdentity(ctx, { subject: 'alice', zone: 'staging' });
    await expect(
      getSshBlockService().block(ctx, { hostId: hostProd.id, identityId: idStaging.id })
    ).rejects.toThrow(/different zones/i);
  });

  it("ZONE-05: a host's composed KRL excludes a foreign zone's revocation", async () => {
    // A prod host with a cert.
    keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h2'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, {
      fqdn: 'web2.prod.local',
      addresses: [],
      opensshHostPubkey: readFileSync(join(work, 'h2.pub'), 'utf8'),
      zone: 'prod',
    });
    await getSshHostService().issue(ctx, { hostId: host.id });

    // A STAGING user cert, then revoked. This must NOT reach the prod host.
    keygen(['-t', 'ed25519', '-f', join(work, 'us'), '-N', '', '-q']);
    const idS = await getSshUserService().createIdentity(ctx, { subject: 'bob', zone: 'staging' });
    const sCert = await getSshUserService().issue(ctx, {
      identityId: idS.id,
      sshPublicKey: readFileSync(join(work, 'us.pub'), 'utf8'),
      principals: ['deploy'],
    });
    await getSshKrlService().revokeByCert(ctx, sCert.cert.id, 'staging revocation');

    const krlAfterForeign = await getSshHostKrlService().generate(ctx, host.id);
    expect(krlAfterForeign.revokedCount).toBe(0); // foreign-zone revocation invisible

    // A PROD user cert revoked DOES reach the prod host — proving the KRL works,
    // it is only the zone boundary that filters staging out.
    keygen(['-t', 'ed25519', '-f', join(work, 'up'), '-N', '', '-q']);
    const idP = await getSshUserService().createIdentity(ctx, { subject: 'bob', zone: 'prod' });
    const pCert = await getSshUserService().issue(ctx, {
      identityId: idP.id,
      sshPublicKey: readFileSync(join(work, 'up.pub'), 'utf8'),
      principals: ['deploy'],
    });
    await getSshKrlService().revokeByCert(ctx, pCert.cert.id, 'prod revocation');
    const krlAfterProd = await getSshHostKrlService().generate(ctx, host.id);
    expect(krlAfterProd.revokedCount).toBeGreaterThan(0); // same-zone revocation reaches it

    // AC#1 — decode the ACTUAL composed KRL bytes with ssh-keygen -Q. The prod
    // host's KRL must mark the prod cert REVOKED and the staging cert NOT revoked,
    // proving the trust boundary at the wire level, not just via a count.
    const row = await getSshHostKrlService().getLatestRow(ctx, host.id);
    const krlPath = join(work, 'composed.krl');
    writeFileSync(krlPath, row.krlBlob as Buffer);
    const stagingCertPath = join(work, 'staging-cert.pub');
    const prodCertPath = join(work, 'prod-cert.pub');
    writeFileSync(stagingCertPath, sCert.cert.certOpenssh);
    writeFileSync(prodCertPath, pCert.cert.certOpenssh);
    const query = (certPath: string) => {
      try {
        return execFileSync('ssh-keygen', ['-Q', '-f', krlPath, certPath], { encoding: 'utf8' });
      } catch (e: any) {
        // ssh-keygen exits non-zero when a key is revoked; the status is on stdout.
        return String(e.stdout ?? '');
      }
    };
    expect(query(prodCertPath)).toMatch(/REVOKED/i);
    expect(query(stagingCertPath)).not.toMatch(/REVOKED/i);
  });
});
