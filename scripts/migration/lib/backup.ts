/**
 * Offline backup of a database + OpenBao pair, and its check.
 *
 * The pair is one unit: an SQLite online backup (consistent, includes WAL)
 * and an OpenBao Raft snapshot taken with writers stopped. Restoring only one
 * half loses state (keys without rows, or rows without keys). The snapshot is
 * encrypted by OpenBao's barrier: it is useless without the unseal keys of the
 * cluster it came from, which are NOT part of this backup.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TargetStore } from './openbao.ts';
import { backupTo, fileSha256, integrityOk, openReadOnly } from './sqlite.ts';
import { MigrationError, isoNow } from './util.ts';

export interface BackupRecord {
  format: 'pki-manager-migration-backup/1';
  createdAt: string;
  label: string;
  files: Record<string, string>; // name -> sha256
  openbao?: { version: string };
}

export async function backupPair(o: { dbPath: string; outDir: string; label: string; store?: TargetStore }): Promise<BackupRecord> {
  if (existsSync(o.outDir)) throw new MigrationError('BACKUP_EXISTS', `refusing to write into existing ${o.outDir}`);
  mkdirSync(o.outDir, { recursive: true, mode: 0o700 });
  const files: Record<string, string> = {};
  let openbao: BackupRecord['openbao'];
  try {
    files['pki.db'] = await backupTo(o.dbPath, join(o.outDir, 'pki.db'));
    if (o.store) {
      const h = await o.store.health();
      if (!h.initialized || h.sealed) throw new MigrationError('OPENBAO_SEALED', 'OpenBao must be unsealed to take a snapshot');
      await o.store.raftSnapshot(join(o.outDir, 'openbao.snap'));
      files['openbao.snap'] = fileSha256(join(o.outDir, 'openbao.snap'));
      openbao = { version: h.version };
    }
  } catch (error) {
    // Half a pair is not a backup: remove the directory this call created.
    rmSync(o.outDir, { recursive: true, force: true });
    throw error;
  }
  const record: BackupRecord = { format: 'pki-manager-migration-backup/1', createdAt: isoNow(), label: o.label, files, openbao };
  writeFileSync(join(o.outDir, 'backup.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

/** Re-computes the digests and the SQLite integrity of a backup directory. */
export function checkBackup(dir: string): { ok: boolean; problems: string[]; record: BackupRecord } {
  const record = JSON.parse(readFileSync(join(dir, 'backup.json'), 'utf8')) as BackupRecord;
  const problems: string[] = [];
  for (const [name, sha] of Object.entries(record.files)) {
    const path = join(dir, name);
    if (!existsSync(path)) { problems.push(`${name} missing`); continue; }
    if (fileSha256(path) !== sha) problems.push(`${name} digest differs`);
  }
  if (existsSync(join(dir, 'pki.db'))) {
    const db = openReadOnly(join(dir, 'pki.db'));
    try { if (!integrityOk(db)) problems.push('pki.db integrity or foreign-key check failed'); } finally { db.close(); }
  }
  return { ok: problems.length === 0, problems, record };
}
