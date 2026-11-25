/**
 * TASK-248 — the host Access list shows who can REALLY reach the host: grants
 * AND live user certificates whose principals match a mapping here (bare `P`
 * or `P@<fqdn>`), each row tagged with its source. Before this, only grants
 * counted — and grants had no UI, so the list was empty in normal use.
 * No KMS: CA / cert rows are seeded directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  sshCas,
  sshCertificates,
  sshHosts,
  sshIdentities,
  sshPrincipals,
  sshHostPrincipalMaps,
  sshUserPrincipals,
  sshRevocations,
  sshHostBlocks,
  zones,
} from '../db/schema.js';
import { getSshBlockService } from './ssh-block.service.js';

const ctx = { db, ipAddress: null };
const FQDN = 'access-src.lab.local';
const ids = {
  zone: randomUUID(),
  ca: randomUUID(),
  otherCa: randomUUID(),
  host: randomUUID(),
  ops: randomUUID(),
  web: randomUUID(),
  otherOps: randomUUID(),
};
const identities: Record<string, string> = {};
const certIds: string[] = [];
let serial = 1;

async function identity(subject: string, zoneId = 'default', status: (typeof sshIdentities.$inferSelect)['status'] = 'active') {
  const id = randomUUID();
  identities[subject] = id;
  await db.insert(sshIdentities).values({ id, subject, zoneId, status });
  return id;
}

async function cert(identityId: string, principals: string[], over: Partial<typeof sshCertificates.$inferInsert> = {}) {
  const id = randomUUID();
  certIds.push(id);
  await db.insert(sshCertificates).values({
    id,
    caId: ids.ca,
    certType: 'user',
    identityId,
    serial: String(serial++),
    keyId: `kid-${id.slice(0, 6)}`,
    principals: JSON.stringify(principals),
    validAfter: new Date(Date.now() - 3600_000),
    validBefore: new Date(Date.now() + 3600_000),
    certOpenssh: 'x',
    subjectPubkeyFingerprint: `SHA256:${id}`,
    kmsSigningKeyId: 'k',
    status: 'active',
    ...over,
  });
  return id;
}

beforeAll(async () => {
  await db.insert(zones).values({ id: ids.zone, name: `acc-${ids.zone.slice(0, 6)}`, displayName: 'Other' });
  const ca = (id: string, zoneId: string): typeof sshCas.$inferInsert => ({
    id,
    zoneId,
    caType: 'user',
    kmsKeyId: 'k',
    kmsPublicKeyId: 'kp',
    opensshPublicKey: 'ecdsa-sha2-nistp256 AAAA',
    fingerprintSha256: `SHA256:${id}`,
    status: 'retired',
  });
  await db.insert(sshCas).values([ca(ids.ca, 'default'), ca(ids.otherCa, ids.zone)]);
  await db.insert(sshHosts).values({ id: ids.host, fqdn: FQDN, status: 'active' });
  await db.insert(sshPrincipals).values([
    { id: ids.ops, name: 'acc-ops' },
    { id: ids.web, name: 'acc-web' },
    { id: ids.otherOps, name: 'acc-ops', zoneId: ids.zone },
  ]);
  await db.insert(sshHostPrincipalMaps).values([
    { id: randomUUID(), hostId: ids.host, principalId: ids.ops, localAccount: 'root' },
    { id: randomUUID(), hostId: ids.host, principalId: ids.web, localAccount: 'deploy' },
  ]);

  // alice: certificate only (bare principal).
  await cert(await identity('acc-alice@lab'), ['acc-ops']);
  // bob: host-scoped principal for THIS host + a grant on web -> both.
  const bob = await identity('acc-bob@lab');
  await cert(bob, [`acc-web@${FQDN}`]);
  await db.insert(sshUserPrincipals).values({ id: randomUUID(), identityId: bob, principalId: ids.ops });
  // carol: grant only.
  const carol = await identity('acc-carol@lab');
  await db.insert(sshUserPrincipals).values({ id: randomUUID(), identityId: carol, principalId: ids.web });
  // Must NOT appear:
  await cert(await identity('acc-expired@lab'), ['acc-ops'], { validBefore: new Date(Date.now() - 1000) });
  await cert(await identity('acc-revoked@lab'), ['acc-ops'], { status: 'revoked' });
  const bySerial = await identity('acc-serial@lab');
  await cert(bySerial, ['acc-ops'], { serial: '9999' });
  await db.insert(sshRevocations).values({ id: randomUUID(), caId: ids.ca, targetType: 'serial', serial: '9999' });
  await cert(await identity('acc-otherhost@lab'), ['acc-ops@elsewhere.lab.local']);
  await cert(await identity('acc-unmapped@lab'), ['acc-db']);
  // Same principal name, other zone (identity + CA in that zone).
  await cert(await identity('acc-foreign@lab', ids.zone), ['acc-ops'], { caId: ids.otherCa });
});

afterAll(async () => {
  await db.delete(sshRevocations).where(eq(sshRevocations.caId, ids.ca));
  await db.delete(sshCertificates).where(inArray(sshCertificates.id, certIds));
  await db.delete(sshUserPrincipals).where(inArray(sshUserPrincipals.identityId, Object.values(identities)));
  await db.delete(sshHostPrincipalMaps).where(eq(sshHostPrincipalMaps.hostId, ids.host));
  await db.delete(sshIdentities).where(inArray(sshIdentities.id, Object.values(identities)));
  await db.delete(sshPrincipals).where(inArray(sshPrincipals.id, [ids.ops, ids.web, ids.otherOps]));
  await db.delete(sshHosts).where(eq(sshHosts.id, ids.host));
  await db.delete(sshCas).where(inArray(sshCas.id, [ids.ca, ids.otherCa]));
  await db.delete(zones).where(eq(zones.id, ids.zone));
});

describe('TASK-248 — host access sources', () => {
  it('lists certificate holders and grantees with source, roles and accounts', async () => {
    const access = await getSshBlockService().hostAccess(ctx, ids.host);
    const rows = Object.fromEntries(
      access.entries.map((e) => [e.subject, { source: e.source, via: e.viaRoles, as: e.localAccounts }])
    );
    expect(rows).toEqual({
      'acc-alice@lab': { source: 'certificate', via: ['acc-ops'], as: ['root'] },
      'acc-bob@lab': { source: 'both', via: ['acc-ops', 'acc-web'], as: ['deploy', 'root'] },
      'acc-carol@lab': { source: 'grant', via: ['acc-web'], as: ['deploy'] },
    });
    expect(access.zoneId).toBe('default');
  });

  it('blocks are unchanged: a blocked certificate holder stays listed and is marked blocked', async () => {
    await db.insert(sshHostBlocks).values({
      id: randomUUID(),
      hostId: ids.host,
      identityId: identities['acc-alice@lab'],
      status: 'active',
      reason: 'test',
    });
    try {
      const access = await getSshBlockService().hostAccess(ctx, ids.host);
      const alice = access.entries.find((e) => e.subject === 'acc-alice@lab')!;
      expect(alice.blocked).toBe(true);
      expect(alice.source).toBe('certificate');
    } finally {
      await db.delete(sshHostBlocks).where(eq(sshHostBlocks.hostId, ids.host));
    }
  });
});

