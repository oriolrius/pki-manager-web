/**
 * Per-run checkpoints (run-dir/journal.db). The journal records progress only;
 * OpenBao and the target database stay the source of truth: on restart every
 * object is re-read and re-checked, so a crash at any point resumes safely.
 */
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationError, isoNow } from './util.ts';

export type ObjectState = 'pending' | 'imported' | 'verified' | 'mapped';

export class Journal {
  readonly db: DatabaseSync;
  private readonly lockPath: string;

  private constructor(db: DatabaseSync, lockPath: string) {
    this.db = db;
    this.lockPath = lockPath;
  }

  /** Opens (or creates) the journal and takes the run lock. */
  static open(runDir: string): Journal {
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const lockPath = join(runDir, 'run.lock');
    takeLock(lockPath);
    const db = new DatabaseSync(join(runDir, 'journal.db'));
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS objects (
        source_key_id TEXT PRIMARY KEY, class TEXT NOT NULL, mount TEXT NOT NULL, name TEXT NOT NULL,
        spki_sha256 TEXT NOT NULL, state TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, subject TEXT, event TEXT NOT NULL, detail TEXT);
    `);
    return new Journal(db, lockPath);
  }

  meta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }

  setMeta(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  state(id: string): ObjectState | null {
    const r = this.db.prepare('SELECT state FROM objects WHERE source_key_id = ?').get(id) as { state: ObjectState } | undefined;
    return r ? r.state : null;
  }

  setState(o: { id: string; cls: string; mount: string; name: string; spki: string; state: ObjectState; adopted?: boolean }): void {
    this.db.prepare(`INSERT INTO objects (source_key_id, class, mount, name, spki_sha256, state, adopted, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key_id) DO UPDATE SET state = excluded.state, adopted = MAX(objects.adopted, excluded.adopted), updated_at = excluded.updated_at`)
      .run(o.id, o.cls, o.mount, o.name, o.spki, o.state, o.adopted ? 1 : 0, isoNow());
  }

  event(event: string, subject: string | null, detail?: unknown): void {
    this.db.prepare('INSERT INTO events (at, subject, event, detail) VALUES (?, ?, ?, ?)').run(isoNow(), subject, event, detail === undefined ? null : JSON.stringify(detail));
  }

  close(): void {
    this.db.close();
    rmSync(this.lockPath, { force: true });
  }
}

function takeLock(lockPath: string): void {
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, 'utf8').trim());
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
    if (alive) throw new MigrationError('RUN_LOCKED', `another run (pid ${pid}) holds ${lockPath}`);
    rmSync(lockPath, { force: true }); // stale lock of a crashed run
  }
  const fd = openSync(lockPath, 'wx', 0o600);
  writeSync(fd, String(process.pid));
  closeSync(fd);
}
