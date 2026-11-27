/**
 * SSH-IMPORT race (v4): one OpenBao key (any version) or one public key is one
 * trust anchor in one zone. The import checks run before slow key-store calls,
 * so concurrent imports must be rechecked atomically with the insert. These
 * tests send normal REST import requests at the same time, into two disposable
 * zones, against the live OpenBao SSH mount. Gated on OpenBao.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { auditLog, sshCas, zones } from '../../db/schema.js';
import { isOpenBaoSshAvailable } from '../../test/openbao-ssh.js';
import { formatSshKeyRef, getOpenBaoSshTransit } from '../../openbao/ssh-transit.js';
import { OpenBaoHttp, loadOpenBaoConnection } from '../../openbao/http.js';
import { getSshZoneService } from '../../services/ssh-zone.service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { signWithSshCa } from '../../services/ssh-ca-key.js';

const OPENBAO = await isOpenBaoSshAvailable();
const ctx = { db, ipAddress: null };

// The disposable test instance keeps a root token next to the backend token
// (scripts/openbao-test.sh). Only the multi-version case needs it, to rotate.
const ROOT_TOKEN_FILE = process.env.OPENBAO_TOKEN_FILE ? join(dirname(process.env.OPENBAO_TOKEN_FILE), 'dev-root-token') : '';
const CAN_ROTATE = OPENBAO && !!ROOT_TOKEN_FILE && existsSync(ROOT_TOKEN_FILE);

async function wipeCas() {
  await db.delete(sshCas);
}

/** A new generated Transit key in the SSH mount; returns its version-1 reference. */
async function newKey(): Promise<{ name: string; ref: string }> {
  const name = `ssh-ca-import-race-${randomUUID()}`;
  const { ref } = await getOpenBaoSshTransit().createKey(name);
  return { name, ref: formatSshKeyRef(ref) };
}

/** Rotates a Transit key with the root token (the backend policy denies rotate). */
async function rotateKey(name: string): Promise<void> {
  const conn = { ...loadOpenBaoConnection(), tokenFile: ROOT_TOKEN_FILE };
  await new OpenBaoHttp(conn, getOpenBaoSshTransit().mount).call('POST', `keys/${name}/rotate`, {});
}

describe.skipIf(!OPENBAO)('SSH CA import: concurrent requests (v4)', () => {
  let app: FastifyInstance;
  let zoneA: string;
  let zoneB: string;
  const prevAllow = process.env.ALLOW_UNAUTHENTICATED_SSH_CA;

  const importCa = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/ssh/cas/import', payload: body });

  beforeAll(async () => {
    process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
    await wipeCas();
    await db.delete(zones).where(ne(zones.name, 'default'));
    const suffix = randomUUID().slice(0, 8);
    zoneA = (await getSshZoneService().create(ctx, { name: `race-a-${suffix}`, displayName: 'Race A' })).name;
    zoneB = (await getSshZoneService().create(ctx, { name: `race-b-${suffix}`, displayName: 'Race B' })).name;
    app = Fastify();
    await app.register(sshRoutes, { prefix: '/api/v1/ssh' });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await wipeCas();
    await db.delete(zones).where(ne(zones.name, 'default'));
    if (prevAllow === undefined) delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
    else process.env.ALLOW_UNAUTHENTICATED_SSH_CA = prevAllow;
  });

  it('two zones import the same key at the same time: one CA, one 409, and the key still signs', async () => {
    await wipeCas();
    const key = await newKey();
    const [a, b] = await Promise.all([
      importCa({ caType: 'user', kmsKeyId: key.ref, kmsPublicKeyId: key.ref, zone: zoneA }),
      importCa({ caType: 'host', kmsKeyId: key.ref, kmsPublicKeyId: key.ref, zone: zoneB }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.message).toMatch(/already used by another SSH CA/);

    const rows = await db.select().from(sshCas).where(eq(sshCas.kmsKeyId, key.ref));
    expect(rows).toHaveLength(1);
    const winner = (a.statusCode === 200 ? a : b).json();
    expect(rows[0].id).toBe(winner.id);

    // The losing request destroyed nothing: the key is in OpenBao and the
    // winning CA still signs with it.
    expect(await getOpenBaoSshTransit().readKey({ mount: getOpenBaoSshTransit().mount, name: key.name, version: 1 })).not.toBeNull();
    const der = await signWithSshCa(rows[0], Buffer.from('after-race'), { purpose: 'probe', ctx });
    expect(der.length).toBeGreaterThan(0);

    // Both outcomes are audited.
    const audits = await db.select().from(auditLog).where(eq(auditLog.operation, 'ssh.ca.import'));
    const statuses = audits.filter((r) => String(r.details ?? '').includes(key.ref)).map((r) => r.status).sort();
    expect(statuses).toEqual(['failure', 'success']);
  });

  it.skipIf(!CAN_ROTATE)('two zones import different versions of one key at the same time: one CA', async () => {
    await wipeCas();
    const key = await newKey();
    await rotateKey(key.name);
    const v2 = key.ref.replace(/:1$/, ':2');
    const [a, b] = await Promise.all([
      importCa({ caType: 'user', kmsKeyId: key.ref, kmsPublicKeyId: key.ref, zone: zoneA }),
      importCa({ caType: 'user', kmsKeyId: v2, kmsPublicKeyId: v2, zone: zoneB }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const rows = await db.select().from(sshCas).where(inArray(sshCas.kmsKeyId, [key.ref, v2]));
    expect(rows).toHaveLength(1);
  });

  it('one zone imports two keys for one CA type at the same time: one CA, the other a domain 409', async () => {
    await wipeCas();
    const [k1, k2] = await Promise.all([newKey(), newKey()]);
    const [a, b] = await Promise.all([
      importCa({ caType: 'user', kmsKeyId: k1.ref, kmsPublicKeyId: k1.ref, zone: zoneA }),
      importCa({ caType: 'user', kmsKeyId: k2.ref, kmsPublicKeyId: k2.ref, zone: zoneA }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    // The SshCaExistsError message, not a raw SQLite UNIQUE constraint error.
    expect(loser.json().error.message).toMatch(/already exists in zone/);
    const zoneRow = (await db.select().from(zones).where(eq(zones.name, zoneA)))[0];
    const active = await db.select().from(sshCas).where(and(eq(sshCas.zoneId, zoneRow.id), eq(sshCas.caType, 'user'), eq(sshCas.status, 'active')));
    expect(active).toHaveLength(1);
  });

  it('positive isolation: different keys import into both zones at the same time', async () => {
    await wipeCas();
    const keys = await Promise.all([newKey(), newKey(), newKey(), newKey()]);
    const res = await Promise.all([
      importCa({ caType: 'user', kmsKeyId: keys[0].ref, kmsPublicKeyId: keys[0].ref, zone: zoneA }),
      importCa({ caType: 'host', kmsKeyId: keys[1].ref, kmsPublicKeyId: keys[1].ref, zone: zoneA }),
      importCa({ caType: 'user', kmsKeyId: keys[2].ref, kmsPublicKeyId: keys[2].ref, zone: zoneB }),
      importCa({ caType: 'host', kmsKeyId: keys[3].ref, kmsPublicKeyId: keys[3].ref, zone: zoneB }),
    ]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(await db.select().from(sshCas)).toHaveLength(4);
    // Trust anchors stay per zone.
    const anchorsA = await getSshCaService().getTrustAnchors(ctx, zoneA);
    const anchorsB = await getSshCaService().getTrustAnchors(ctx, zoneB);
    expect(anchorsA.userCaKeys).toHaveLength(1);
    expect(anchorsB.userCaKeys).toHaveLength(1);
    expect(anchorsA.userCaKeys[0]).not.toBe(anchorsB.userCaKeys[0]);
  });

  it('a sequential re-import of a used key is still refused and changes nothing', async () => {
    await wipeCas();
    const key = await newKey();
    expect((await importCa({ caType: 'user', kmsKeyId: key.ref, kmsPublicKeyId: key.ref, zone: zoneA })).statusCode).toBe(200);
    const again = await importCa({ caType: 'host', kmsKeyId: key.ref, kmsPublicKeyId: key.ref, zone: zoneB });
    expect(again.statusCode).toBe(409);
    expect(await db.select().from(sshCas)).toHaveLength(1);
  });

  it('an archived zone between check and insert refuses the import', async () => {
    await wipeCas();
    const key = await newKey();
    const suffix = randomUUID().slice(0, 8);
    const z = await getSshZoneService().create(ctx, { name: `race-c-${suffix}`, displayName: 'Race C' });
    // Archive the zone while the import waits on OpenBao, after its first
    // zone check: the key read is the first key-store call of an import.
    const transit = getOpenBaoSshTransit();
    const original = transit.readKey.bind(transit);
    const spy = vi.spyOn(transit, 'readKey').mockImplementationOnce(async (ref, opts) => {
      await db.update(zones).set({ status: 'archived' }).where(eq(zones.id, z.id));
      return original(ref, opts);
    });
    const pending = importCa({ caType: 'user', kmsKeyId: key.ref, kmsPublicKeyId: key.ref, zone: z.name });
    const res = await pending;
    spy.mockRestore();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/archived/);
    expect(await db.select().from(sshCas).where(eq(sshCas.kmsKeyId, key.ref))).toHaveLength(0);
  });
});
