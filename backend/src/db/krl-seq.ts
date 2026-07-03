/**
 * Global KRL-number allocator (BLK-02, decision-016 pinned req #4).
 *
 * ONE shared, strictly-monotonic number space for BOTH KRL lineages (per-CA
 * ssh_krls and per-host ssh_host_krls): the puller's anti-rollback compares the
 * CA-signed OpenSSH KRL header number, so a host switched between lineages —
 * in either direction — must always receive a strictly greater number.
 * Allocation is a single atomic UPDATE ... RETURNING on the single-row
 * ssh_krl_seq table; better-sqlite3 is synchronous single-writer, so this
 * cannot race. Gaps from failed generations are harmless (clients only require
 * strictly-newer). Unlike max()+1 over the KRL tables, the allocator survives
 * future pruning of old KRL rows.
 */
import { eq, sql } from 'drizzle-orm';
import { sshKrlSeq } from './schema.js';

export async function allocateKrlNumber(db: any): Promise<number> {
  const rows = await db
    .update(sshKrlSeq)
    .set({ value: sql`${sshKrlSeq.value} + 1` })
    .where(eq(sshKrlSeq.id, 1))
    .returning({ value: sshKrlSeq.value });
  const value = rows[0]?.value;
  if (typeof value !== 'number') {
    throw new Error('ssh_krl_seq allocator row missing — run migrations (0008_ssh_host_blocks seeds it)');
  }
  return value;
}
