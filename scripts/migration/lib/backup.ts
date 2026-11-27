/**
 * Offline backup of a database + OpenBao pair, its check, and the proof that a
 * restored database and a restored OpenBao come from ONE backup.
 *
 * The pair is one unit: an SQLite online backup (consistent, includes WAL)
 * and an OpenBao Raft snapshot taken with writers stopped. Restoring only one
 * half, or halves of two backups, loses state: keys without rows, rows without
 * keys, or (an older database next to a newer snapshot, or the reverse) the
 * revocations and other rows of the other backup. Two backups can hold the
 * same keys (only database rows changed between them), so the keys cannot tell
 * the halves apart. A marker binds them:
 *
 *   1. writers stopped (the operator says so with `quiesced`); SQLite online
 *      backup to `pki.db`; logical content digest of that copy (source.ts);
 *   2. marker `{backupId, sqliteContentSha256, state: snapshot}` written to the
 *      KV v1 entry pki-manager-backup/pair-marker, read back;
 *   3. Raft snapshot: the marker is INSIDE it, under the OpenBao barrier;
 *   4. marker set to `released`: a later snapshot of the live cluster (or of
 *      another tool) never holds a `snapshot` marker;
 *   5. the live database content is compared with the copy: a writer that ran
 *      during the backup fails it;
 *   6. `backup.json` (written last, atomically) records the same backupId and
 *      digest next to the file digests.
 *
 * `checkPairEvidence` (verify --restore) then requires: the backup directory is
 * intact; the restored OpenBao holds a `snapshot` marker with the backupId and
 * digest of that backup.json; the restored database has that content digest.
 * A database or a snapshot of another backup fails, also when no key differs.
 *
 * The snapshot is encrypted by OpenBao's barrier: it is useless without the
 * unseal keys of the cluster it came from, which are NOT part of this backup.
 * Only an operator token (policy pki-manager-operator) can write or read the
 * marker; the runtime and migration identities cannot.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { OpenBaoHttpError, type TargetStore } from './openbao.ts';
import { contentDigest } from './source.ts';
import { backupTo, fileSha256, integrityOk, openReadOnly } from './sqlite.ts';
import { MigrationError, isoNow } from './util.ts';

export const BACKUP_FORMAT = 'pki-manager-migration-backup/2';
export const MARKER_FORMAT = 'pki-manager-pair-marker/1';
/** KV v1 mount and entry of the marker (bootstrap.sh configure enables the mount). */
export const MARKER_MOUNT = 'pki-manager-backup';
export const MARKER_PATH = 'pair-marker';

export interface PairMarker {
  format: typeof MARKER_FORMAT;
  backupId: string;
  /** `snapshot` while the Raft snapshot is taken; `released` after; `aborted` when the backup failed. */
  state: 'snapshot' | 'released' | 'aborted';
  sqliteContentSha256: string;
  label: string;
  createdAt: string;
}

export interface BackupRecord {
  /** `/1`: file digests only (no pair evidence). `/2`: content digest, and the pair marker for a pair. */
  format: 'pki-manager-migration-backup/1' | typeof BACKUP_FORMAT;
  createdAt: string;
  label: string;
  files: Record<string, string>; // name -> sha256
  openbao?: { version: string };
  /** `/2`: logical content digest of `pki.db` (source.ts contentDigest). */
  sqliteContentSha256?: string;
  /** `/2` pair backups: the marker the Raft snapshot holds. */
  pair?: { backupId: string; markerMount: string; markerPath: string; quiesced: true };
}

const markerFields = (m: PairMarker): Record<string, string> => ({ ...m });

function markerOf(d: Record<string, string> | null): PairMarker | null {
  if (!d || d.format !== MARKER_FORMAT) return null;
  if (d.state !== 'snapshot' && d.state !== 'released' && d.state !== 'aborted') return null;
  return { format: MARKER_FORMAT, backupId: d.backupId ?? '', state: d.state, sqliteContentSha256: d.sqliteContentSha256 ?? '', label: d.label ?? '', createdAt: d.createdAt ?? '' };
}

function markerError(error: unknown): unknown {
  if (error instanceof OpenBaoHttpError && (error.status === 403 || error.status === 404 || error.status === 405)) {
    return new MigrationError('PAIR_MARKER', `${error.message}. The backup token needs the pki-manager-operator policy and the KV mount ${MARKER_MOUNT}: run "bootstrap.sh configure" again (it enables the mount and rewrites the operator policy)`);
  }
  return error;
}

export async function backupPair(o: { dbPath: string; outDir: string; label: string; store?: TargetStore; quiesced?: boolean }): Promise<BackupRecord> {
  if (o.store && o.quiesced !== true) {
    throw new MigrationError('NOT_QUIESCED', 'a database + OpenBao backup needs every writer stopped (the v4 backend, its OpenBao Agents, any script with a runtime token); stop them, then pass --quiesced');
  }
  if (existsSync(o.outDir)) throw new MigrationError('BACKUP_EXISTS', `refusing to write into existing ${o.outDir}`);
  mkdirSync(o.outDir, { recursive: true, mode: 0o700 });
  const files: Record<string, string> = {};
  let openbao: BackupRecord['openbao'];
  let pair: BackupRecord['pair'];
  let marker: PairMarker | undefined;
  let released = false;
  let sqliteContentSha256: string;
  try {
    files['pki.db'] = await backupTo(o.dbPath, join(o.outDir, 'pki.db'));
    const copy = openReadOnly(join(o.outDir, 'pki.db'));
    try { sqliteContentSha256 = contentDigest(copy); } finally { copy.close(); }
    if (o.store) {
      const h = await o.store.health();
      if (!h.initialized || h.sealed) throw new MigrationError('OPENBAO_SEALED', 'OpenBao must be unsealed to take a snapshot');
      marker = { format: MARKER_FORMAT, backupId: randomUUID(), state: 'snapshot', sqliteContentSha256, label: o.label, createdAt: isoNow() };
      try {
        await o.store.kvWrite(MARKER_MOUNT, MARKER_PATH, markerFields(marker));
        const back = markerOf(await o.store.kvRead(MARKER_MOUNT, MARKER_PATH));
        if (!back || back.backupId !== marker.backupId || back.state !== 'snapshot' || back.sqliteContentSha256 !== sqliteContentSha256) throw new MigrationError('PAIR_MARKER', 'the pair marker read back differs from the one written (another backup running?)');
      } catch (error) { throw markerError(error); }
      await o.store.raftSnapshot(join(o.outDir, 'openbao.snap'));
      files['openbao.snap'] = fileSha256(join(o.outDir, 'openbao.snap'));
      try { await o.store.kvWrite(MARKER_MOUNT, MARKER_PATH, markerFields({ ...marker, state: 'released' })); } catch (error) { throw markerError(error); }
      released = true;
      openbao = { version: h.version };
      pair = { backupId: marker.backupId, markerMount: MARKER_MOUNT, markerPath: MARKER_PATH, quiesced: true };
      // Writers stopped: the live database must still hold the content of the copy.
      const live = openReadOnly(o.dbPath);
      let now: string;
      try { now = contentDigest(live); } finally { live.close(); }
      if (now !== sqliteContentSha256) throw new MigrationError('NOT_QUIESCED', `${o.dbPath} changed during the backup: a writer is running. Stop it and take the backup again`);
    }
    const record: BackupRecord = { format: BACKUP_FORMAT, createdAt: isoNow(), label: o.label, files, openbao, sqliteContentSha256, pair };
    // Written last and atomically: a directory without backup.json is an incomplete backup.
    const tmp = join(o.outDir, 'backup.json.partial');
    writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
    renameSync(tmp, join(o.outDir, 'backup.json'));
    return record;
  } catch (error) {
    // Half a pair is not a backup: remove the directory this call created, and
    // never leave a `snapshot` marker behind (a later snapshot would hold it).
    rmSync(o.outDir, { recursive: true, force: true });
    if (o.store && marker && !released) {
      try { await o.store.kvWrite(MARKER_MOUNT, MARKER_PATH, markerFields({ ...marker, state: 'aborted' })); } catch { /* reported by the original error */ }
    }
    throw error;
  }
}

/** Re-computes the digests and the SQLite integrity of a backup directory. */
export function checkBackup(dir: string): { ok: boolean; problems: string[]; record: BackupRecord; pairEvidence: boolean } {
  const problems: string[] = [];
  if (!existsSync(join(dir, 'backup.json'))) {
    const empty: BackupRecord = { format: BACKUP_FORMAT, createdAt: '', label: '', files: {} };
    return { ok: false, problems: [`${join(dir, 'backup.json')} missing: an incomplete backup (the command failed or was killed)`], record: empty, pairEvidence: false };
  }
  const record = JSON.parse(readFileSync(join(dir, 'backup.json'), 'utf8')) as BackupRecord;
  if (record.format !== BACKUP_FORMAT && record.format !== 'pki-manager-migration-backup/1') problems.push(`unknown backup format ${String(record.format)}`);
  for (const [name, sha] of Object.entries(record.files)) {
    const path = join(dir, name);
    if (!existsSync(path)) { problems.push(`${name} missing`); continue; }
    if (fileSha256(path) !== sha) problems.push(`${name} digest differs`);
  }
  if (existsSync(join(dir, 'pki.db'))) {
    const db = openReadOnly(join(dir, 'pki.db'));
    try {
      if (!integrityOk(db)) problems.push('pki.db integrity or foreign-key check failed');
      if (record.sqliteContentSha256 && contentDigest(db) !== record.sqliteContentSha256) problems.push('pki.db content digest differs');
    } finally { db.close(); }
  }
  const pairEvidence = record.format === BACKUP_FORMAT && !!record.pair?.backupId && !!record.sqliteContentSha256 && 'openbao.snap' in record.files;
  return { ok: problems.length === 0, problems, record, pairEvidence };
}

/**
 * Proof that the restored database and the restored OpenBao are the two halves
 * of the backup in `dir`. Returns the problems (empty = proven). `operator`
 * reads the marker (operator token); nothing is written.
 */
export async function checkPairEvidence(o: { dir: string; target: DatabaseSync; operator: TargetStore }): Promise<{ problems: string[]; backupId?: string }> {
  const b = checkBackup(o.dir);
  const problems = b.problems.map(p => `backup directory: ${p}`);
  if (!existsSync(join(o.dir, 'backup.json'))) return { problems };
  if (!b.pairEvidence) {
    problems.push(`${o.dir} has no pair evidence (${b.record.format}${b.record.pair ? '' : ', no pair marker'}${'openbao.snap' in b.record.files ? '' : ', no Raft snapshot'}): a backup made before pair markers, or a SQLite-only backup, cannot prove which OpenBao state belongs to it. Take a new backup pair`);
    return { problems };
  }
  const expected = b.record.pair!.backupId;
  const content = contentDigest(o.target);
  if (content !== b.record.sqliteContentSha256) {
    problems.push(`the restored database is not the database of backup ${expected} (content ${content.slice(0, 16)}... != ${b.record.sqliteContentSha256!.slice(0, 16)}...): it comes from another backup, or it changed after the restore (verify before v4 starts)`);
  }
  let raw: Record<string, string> | null;
  try { raw = await o.operator.kvRead(b.record.pair!.markerMount, b.record.pair!.markerPath); } catch (error) {
    problems.push(`cannot read the pair marker ${b.record.pair!.markerMount}/${b.record.pair!.markerPath} in the restored OpenBao: ${(error as Error).message} (use an operator token: --openbao-operator-token-file)`);
    return { problems, backupId: expected };
  }
  const m = markerOf(raw);
  if (!m) {
    problems.push('the restored OpenBao holds no pair marker: its state does not come from a pki-migrate backup pair snapshot');
  } else if (m.state !== 'snapshot') {
    problems.push(`the restored OpenBao holds a ${m.state} marker of backup ${m.backupId}: its state is a live cluster or a snapshot taken outside pki-migrate backup, not the snapshot of backup ${expected}`);
  } else if (m.backupId !== expected) {
    problems.push(`the restored OpenBao comes from backup ${m.backupId} ("${m.label}", ${m.createdAt}), the database from backup ${expected} ("${b.record.label}", ${b.record.createdAt}): restore both halves of ONE backup directory`);
  } else if (m.sqliteContentSha256 !== b.record.sqliteContentSha256) {
    problems.push(`the marker of backup ${expected} binds another database content than backup.json`);
  }
  return { problems, backupId: expected };
}
