/**
 * Reconciliation of the target copy with the frozen source, row by row.
 *
 * Every table of the source is compared with the same table of the target,
 * on every column the source has, by primary key (or as a multiset of rows
 * when the table has none). Nothing is left out by name: audit history,
 * revocations, CRLs, KRLs and their sequence, SSH blocks, principals,
 * grants, ownership, tokens, zones, all of it.
 *
 * The only differences accepted are the writes of the migration itself,
 * derived from the manifest and the approval (each one with its exact value):
 *
 *   certificates.certificate_pem         NULL -> the inventoried PEM (backfill)
 *   certificates.kms_key_id              RA alias -> NULL; certificate id -> private key id (link repair)
 *   certificate_authorities.kms_key_id   certificate id -> private key id (link repair)
 *   ssh_cas.kms_key_id/kms_public_key_id Cosmian ids -> openbao-transit:<mount>:<name>:1
 *   integration_ras key columns          transfer, drop-key or reprovision of the RA key
 *   audit_log                            new rows of operation migration.* written by this approval
 *   keystore_objects                     new rows written by the migration (when the source has the table)
 *
 * Schema evolution: columns and tables that only the target has (v4
 * migrations such as 0016, 0017 and later ones) are not compared; a source
 * column that the target lacks fails, unless RETIRED_COLUMNS lists it.
 */
import { X509Certificate } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { approvedTarget } from './policy.ts';
import { tableExists } from './sqlite.ts';
import { canonicalRows, canonicalValue, orderedColumns } from './source.ts';
import { sshKeyRef } from './target-db.ts';
import type { Approval, Manifest } from './types.ts';
import { sha256Hex } from './util.ts';

type Add = (name: string, ok: boolean, detail?: string) => void;
type Row = Record<string, SQLOutputValue>;
/** Accepts the target value of one column, given the source and target rows. */
type Accept = (target: SQLOutputValue, sourceRow: Row, targetRow: Row) => boolean;

/** Tables that hold no authoritative state. */
export const NOT_RECONCILED: Record<string, string> = {
  __drizzle_migrations: 'migration journal: the target has the v4 migrations on top',
  ssh_idempotency: 'request replay cache with an expiry (migration 0015 drops its rows)',
};

/**
 * Source columns that a v4 migration removes or renames: table -> column -> reason.
 * Empty: no v4 migration (0016-0017) removes a v3 column. A later migration that
 * does must add its columns here, with the reason.
 */
export const RETIRED_COLUMNS: Record<string, Record<string, string>> = {};

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function primaryKey(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string; pk: number }[])
    .filter(r => Number(r.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(r => String(r.name));
}

const rowKey = (values: string[]) => JSON.stringify(values);
const show = (v: SQLOutputValue) => {
  const t = canonicalValue(v);
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
};

/** The writes of the migration, per table, row (primary key) and column. */
class Allowances {
  private readonly m = new Map<string, Map<string, Map<string, Accept[]>>>();

  /** Row given by its single text primary key. */
  add(table: string, id: string, column: string, accept: Accept): void {
    const key = rowKey([canonicalValue(id)]);
    let t = this.m.get(table); if (!t) this.m.set(table, t = new Map());
    let r = t.get(key); if (!r) t.set(key, r = new Map());
    let c = r.get(column); if (!c) r.set(column, c = []);
    c.push(accept);
  }

  is(table: string, id: string, column: string, value: string | number | null): void {
    this.add(table, id, column, t => canonicalValue(t) === canonicalValue(value));
  }

  accepts(table: string, key: string, column: string, target: SQLOutputValue, s: Row, t: Row): boolean {
    return (this.m.get(table)?.get(key)?.get(column) ?? []).some(f => {
      try { return f(target, s, t); } catch { return false; }
    });
  }
}

const pemDigest = (pem: SQLOutputValue) => (typeof pem === 'string' ? sha256Hex(new X509Certificate(pem).raw) : null);

function migrationAllowances(manifest: Manifest, approval: Approval): Allowances {
  const al = new Allowances();
  for (const key of manifest.keys) {
    const a = approval.keys[key.sourceKeyId];
    if (!a) continue;
    // A string: the actions of the policy grow (reprovision); unknown ones allow nothing.
    const action: string = a.action;
    let spec: ReturnType<typeof approvedTarget> | null = null;
    if (action === 'transfer') { try { spec = approvedTarget(key, a, approval); } catch { spec = null; } }
    const isX509 = key.class === 'x509-ca' || key.class === 'x509-leaf';
    for (const r of key.references) {
      if (isX509 && (r.role === 'x509-ca-key' || r.role === 'x509-leaf-key') && r.sourceId !== key.sourceKeyId && (action === 'transfer' || action === 'drop-key')) {
        al.is(r.table, r.rowId, 'kms_key_id', key.sourceKeyId); // link repair: certificate id -> private key id
      }
      if (key.class === 'ssh-ca' && r.role === 'ssh-ca-key' && spec) {
        const ref = sshKeyRef(spec.mount, spec.name);
        al.is('ssh_cas', r.rowId, 'kms_key_id', ref);
        al.is('ssh_cas', r.rowId, 'kms_public_key_id', ref);
      }
      if (key.class === 'scep-ra' && r.role === 'scep-ra-key') {
        if (spec) {
          al.is('integration_ras', r.rowId, 'key_provider', 'openbao');
          al.is('integration_ras', r.rowId, 'key_id', spec.name);
          al.is('integration_ras', r.rowId, 'public_key_id', null);
          al.is('integration_ras', r.rowId, 'key_version', 1);
        } else if (action === 'drop-key') {
          al.is('integration_ras', r.rowId, 'key_id', null);
          al.is('integration_ras', r.rowId, 'public_key_id', null);
        } else if (action === 'reprovision') {
          al.is('integration_ras', r.rowId, 'key_provider', 'openbao');
          for (const c of ['key_id', 'public_key_id', 'key_version', 'certificate_id', 'certificate_pem', 'lease', 'lease_until']) al.is('integration_ras', r.rowId, c, null);
          // The current RA certificate moves to the front of the overlap list; the rest is kept.
          al.add('integration_ras', r.rowId, 'previous', (t, s) => {
            const prev = JSON.parse(typeof s.previous === 'string' && s.previous ? s.previous : '[]') as unknown[];
            const want = s.certificate_pem && s.certificate_id ? [{ id: s.certificate_id, certificatePem: s.certificate_pem }, ...prev] : prev;
            return typeof t === 'string' && JSON.stringify(JSON.parse(t)) === JSON.stringify(want);
          });
        }
      }
      if (key.class === 'scep-ra' && r.role === 'scep-ra-cert-alias' && (spec || action === 'reprovision' || action === 'drop-key')) {
        al.is('certificates', r.rowId, 'kms_key_id', null);
      }
    }
  }
  for (const c of manifest.certificates) {
    if (c.table !== 'certificates' || !c.pemSha256) continue;
    const want = c.pemSha256;
    al.add('certificates', c.rowId, 'certificate_pem', (t, s) => s.certificate_pem === null && pemDigest(t) === want);
  }
  return al;
}

/** New target rows the migration writes. */
function migrationRow(table: string, row: Row, approval: Approval): boolean {
  if (table === 'audit_log') {
    if (typeof row.operation !== 'string' || !row.operation.startsWith('migration.')) return false;
    try {
      const d = JSON.parse(String(row.details)) as { tool?: string; approval?: string };
      return d.tool === 'scripts/migration' && d.approval === approval.manifestSha256.slice(0, 16);
    } catch { return false; }
  }
  if (table === 'keystore_objects') {
    try { const tags = JSON.parse(String(row.tags)) as string[]; return tags.includes('migrated-from-cosmian') || tags.includes('migration-drop-key'); } catch { return false; }
  }
  return false;
}

export interface ReconcileResult { ok: boolean; tables: number; rows: number }

/**
 * `full`: the target must equal the source except for the writes of the
 * migration (cutover against the frozen v3 copy).
 * `history`: a later restore. v4 has accepted writes since the cutover (new
 * rows, revocations, deletions); only the append-only audit history of the
 * source must still be there, unchanged.
 */
export function reconcile(o: { source: DatabaseSync; target: DatabaseSync; manifest?: Manifest; approval?: Approval; add: Add; mode: 'full' | 'history' }): ReconcileResult {
  const { source, target, add } = o;
  const al = o.manifest && o.approval ? migrationAllowances(o.manifest, o.approval) : new Allowances();
  const tables = (source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map(r => String(r.name)).filter(t => !(t in NOT_RECONCILED)).filter(t => o.mode === 'full' || t === 'audit_log');
  let ok = true, rows = 0;
  for (const table of tables) {
    const r = reconcileTable(source, target, table, al, o.approval, o.mode);
    rows += r.rows;
    if (!r.ok) ok = false;
    add(o.mode === 'full' ? `reconcile ${table}` : `restore: ${table} history of the frozen source preserved`, r.ok, r.detail);
  }
  return { ok, tables: tables.length, rows };
}

function reconcileTable(source: DatabaseSync, target: DatabaseSync, table: string, al: Allowances, approval: Approval | undefined, mode: 'full' | 'history'): { ok: boolean; rows: number; detail: string } {
  if (!tableExists(target, table)) return { ok: false, rows: 0, detail: 'table missing in the target' };
  const srcCols = orderedColumns(source, table);
  const have = new Set(orderedColumns(target, table));
  const retired = RETIRED_COLUMNS[table] ?? {};
  const gone = srcCols.filter(c => !have.has(c) && !(c in retired));
  const cols = srcCols.filter(c => have.has(c));
  const pk = primaryKey(source, table).filter(c => have.has(c));
  const pkIdx = pk.map(c => cols.indexOf(c));
  const keyOf = (text: string[]) => rowKey(pkIdx.length ? pkIdx.map(i => text[i]) : text);
  const label = (text: string[]) => (pkIdx.length ? pkIdx.map(i => text[i]).join(',') : text.join(',')).slice(0, 80);

  // Source rows by key (a multiset when the table has no primary key).
  const src = new Map<string, { values: SQLOutputValue[]; text: string[] }[]>();
  let n = 0;
  for (const r of canonicalRows(source, table, cols)) { n++; const k = keyOf(r.text); src.set(k, [...(src.get(k) ?? []), r]); }
  const missing: string[] = [], changed: string[] = [], unexpected: string[] = [];
  let missingN = 0, changedN = 0, unexpectedN = 0;
  const note = (list: string[], s: string) => { if (list.length < 5) list.push(s); };
  for (const t of canonicalRows(target, table, cols)) {
    const k = keyOf(t.text);
    const candidates = src.get(k);
    if (!candidates?.length) {
      const row = Object.fromEntries(cols.map((c, i) => [c, t.values[i]]));
      if (mode === 'history' || (approval && migrationRow(table, row, approval))) continue;
      unexpectedN++; note(unexpected, label(t.text));
      continue;
    }
    if (!pkIdx.length) { candidates.pop(); if (!candidates.length) src.delete(k); continue; } // multiset: identical row
    const s = candidates[0];
    src.delete(k);
    const diffs: string[] = [];
    const sRow = Object.fromEntries(cols.map((c, i) => [c, s.values[i]]));
    const tRow = Object.fromEntries(cols.map((c, i) => [c, t.values[i]]));
    cols.forEach((c, i) => {
      if (s.text[i] === t.text[i]) return;
      if (mode === 'full' && al.accepts(table, k, c, t.values[i], sRow, tRow)) return;
      diffs.push(`${c} ${show(s.values[i])} -> ${show(t.values[i])}`);
    });
    if (diffs.length) { changedN++; note(changed, `${label(t.text)}: ${diffs.join(', ')}`); }
  }
  for (const [, rest] of src) for (const r of rest) { missingN++; note(missing, label(r.text)); }
  const parts = [`${n} source rows`];
  if (gone.length) parts.push(`columns missing in the target: ${gone.join(', ')}`);
  if (missingN) parts.push(`${missingN} missing in the target [${missing.join('; ')}]`);
  if (changedN) parts.push(`${changedN} changed [${changed.join('; ')}]`);
  if (unexpectedN) parts.push(`${unexpectedN} not in the source [${unexpected.join('; ')}]`);
  return { ok: !gone.length && !missingN && !changedN && !unexpectedN, rows: n, detail: parts.join('; ') };
}
