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
import type Database from 'better-sqlite3';
import { sshKrlSeq } from './schema.js';

/**
 * Defensive re-seed of the allocator row (id=1). The canonical seed lives in
 * migration 0008; without this backstop, any data cleanup that clears the row
 * bricks ALL KRL issuance fail-closed until a manual re-migration. Seeds from
 * the max of BOTH lineages (per-CA ssh_krls + per-host ssh_host_krls) — a
 * lower re-seed would regress the number space and the puller's anti-rollback
 * would reject every subsequent KRL. No-op when the row exists or the table
 * has not been migrated yet.
 */
export function ensureKrlSeqSeeded(sqlite: Database.Database): void {
  const hasTable = sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ssh_krl_seq'`)
    .get();
  if (!hasTable) return;
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO ssh_krl_seq (id, value)
       VALUES (1, COALESCE((
         SELECT MAX(n) FROM (
           SELECT MAX(krl_number) AS n FROM ssh_krls
           UNION ALL
           SELECT MAX(krl_number) AS n FROM ssh_host_krls
         )
       ), 0))`
    )
    .run();
}

export async function allocateKrlNumber(db: any): Promise<number> {
  const rows = await db
    .update(sshKrlSeq)
    .set({ value: sql`${sshKrlSeq.value} + 1` })
    .where(eq(sshKrlSeq.id, 1))
    .returning({ value: sshKrlSeq.value });
  const value = rows[0]?.value;
  if (typeof value !== 'number') {
    throw new Error(
      'ssh_krl_seq allocator row missing — a server restart re-seeds it (ensureKrlSeqSeeded), or run migrations (0008_ssh_host_blocks)'
    );
  }
  return value;
}
