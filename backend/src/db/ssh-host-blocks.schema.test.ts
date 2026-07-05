/**
 * BLK-02 (TASK-179) — schema-level guarantees for ssh_host_blocks,
 * ssh_host_krls and the ssh_krl_seq global allocator. These are the tripwires
 * the BLK-03 numbering and BLK-04 lifecycle logic stand on, proven directly
 * against SQLite (no services involved).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sqliteDb } from './client.js';
import { sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrlSeq } from './schema.js';
import { allocateKrlNumber, ensureKrlSeqSeeded } from './krl-seq.js';

async function wipe() {
  await db.delete(sshHostKrls);
  await db.delete(sshHostBlocks);
  await db.delete(sshHosts);
  await db.delete(sshIdentities);
}

describe('BLK-02 schema: ssh_host_blocks / ssh_host_krls / ssh_krl_seq', () => {
  let hostId: string;
  let identityId: string;

  beforeAll(async () => {
    await wipe();
    hostId = randomUUID();
    identityId = randomUUID();
    await db.insert(sshHosts).values({ id: hostId, fqdn: 'blk02.lab.local', status: 'active' } as any);
    await db.insert(sshIdentities).values({ id: identityId, subject: 'blk02@lab.local' } as any);
  });

  afterAll(async () => {
    await wipe();
  });

  it('UNIQUE (host_id, krl_number) rejects a duplicate insert (tripwire behind the allocator)', async () => {
    const mk = (n: number) => ({
      id: randomUUID(),
      hostId,
      krlNumber: n,
      versionHash: `sha256:${n}`,
      krlBlob: Buffer.from('krl'),
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 3600_000),
    });
    await db.insert(sshHostKrls).values(mk(7) as any);
    await expect(db.insert(sshHostKrls).values(mk(7) as any)).rejects.toThrow(/UNIQUE/i);
    // Same number on ANOTHER host is fine (uniqueness is per host lineage).
    const otherHost = randomUUID();
    await db.insert(sshHosts).values({ id: otherHost, fqdn: 'blk02b.lab.local', status: 'active' } as any);
    await db.insert(sshHostKrls).values({ ...mk(7), id: randomUUID(), hostId: otherHost } as any);
  });

  it('partial-unique active pair: second active block rejected; block → lift → re-block keeps history', async () => {
    const first = randomUUID();
    await db.insert(sshHostBlocks).values({ id: first, hostId, identityId, reason: 'incident-1' } as any);
    await expect(
      db.insert(sshHostBlocks).values({ id: randomUUID(), hostId, identityId, reason: 'dup' } as any)
    ).rejects.toThrow(/UNIQUE/i);

    // Lift, then re-block — allowed; the lifted row survives for audit.
    await db
      .update(sshHostBlocks)
      .set({ status: 'lifted', liftedBy: 'test', liftedAt: new Date() })
      .where(eq(sshHostBlocks.id, first));
    const second = randomUUID();
    await db.insert(sshHostBlocks).values({ id: second, hostId, identityId, reason: 'incident-2' } as any);

    const rows = await db.select().from(sshHostBlocks).where(eq(sshHostBlocks.identityId, identityId));
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.id === first)?.status).toBe('lifted');
    expect(rows.find((r: any) => r.id === second)?.status).toBe('active');
  });

  it('FK RESTRICT: hosts/identities cannot be hard-deleted while referenced', async () => {
    await expect(db.delete(sshHosts).where(eq(sshHosts.id, hostId))).rejects.toThrow(/FOREIGN KEY/i);
    await expect(db.delete(sshIdentities).where(eq(sshIdentities.id, identityId))).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('ssh_krl_seq exists (migration-seeded) and allocates strictly monotonic unique numbers under parallel calls', async () => {
    const seed = (await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any;
    expect(seed).toBeDefined();
    expect(typeof seed.value).toBe('number');

    const before = seed.value;
    const numbers = await Promise.all(Array.from({ length: 25 }, () => allocateKrlNumber(db)));
    expect(new Set(numbers).size).toBe(25);
    expect(Math.min(...numbers)).toBe(before + 1);
    expect(Math.max(...numbers)).toBe(before + 25);
    // Allocated numbers are strictly above anything either lineage has used.
    const after = (await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any;
    expect(after.value).toBe(before + 25);
  });
});

describe('ensureKrlSeqSeeded startup backstop', () => {
  let hostId: string;
  let origValue: number;

  beforeAll(async () => {
    hostId = randomUUID();
    origValue = ((await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any).value;
    await db.insert(sshHosts).values({ id: hostId, fqdn: 'seqseed.lab.local', status: 'active' } as any);
    await db.insert(sshHostKrls).values({
      id: randomUUID(),
      hostId,
      krlNumber: origValue + 500,
      versionHash: 'sha256:seqseed',
      krlBlob: Buffer.from('krl'),
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 3600_000),
    } as any);
  });

  afterAll(async () => {
    await db.delete(sshHostKrls).where(eq(sshHostKrls.hostId, hostId));
    await db.delete(sshHosts).where(eq(sshHosts.id, hostId));
    // Never let the allocator end below where this suite found it.
    const cur = ((await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any)?.value ?? 0;
    if (cur < origValue) await db.update(sshKrlSeq).set({ value: origValue }).where(eq(sshKrlSeq.id, 1));
  });

  it('re-creates a cleared allocator row at max(krl_number) over the lineages (no regression)', async () => {
    await db.delete(sshKrlSeq).where(eq(sshKrlSeq.id, 1));
    // Fail-closed while the row is missing.
    await expect(allocateKrlNumber(db)).rejects.toThrow(/allocator row missing/);

    ensureKrlSeqSeeded(sqliteDb);
    const seeded = (await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any;
    expect(seeded.value).toBe(origValue + 500);
    // Next allocation is strictly above every number either lineage has used.
    expect(await allocateKrlNumber(db)).toBe(origValue + 501);
  });

  it('is a no-op when the row already exists', async () => {
    const before = ((await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any).value;
    ensureKrlSeqSeeded(sqliteDb);
    const after = ((await db.select().from(sshKrlSeq).where(eq(sshKrlSeq.id, 1)))[0] as any).value;
    expect(after).toBe(before);
  });
});
