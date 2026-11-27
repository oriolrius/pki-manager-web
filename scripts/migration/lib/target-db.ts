/**
 * Writes the migration result into the TARGET database copy, already migrated
 * to the v4 schema (migration 0017 `keystore_objects` and 0016 RA provider
 * columns). One transaction; compare-and-set on every row, so a second run
 * changes nothing and any conflicting value stops the run (ROLLBACK).
 *
 * v4 contract (backend/src/keystore/x509-store.ts, services/ssh-ca-key.ts,
 * services/ra.service.ts):
 *
 * X.509   The v3 ids in certificate_authorities.kms_* and certificates.kms_*
 *         keep their values: each id becomes a `keystore_objects` row.
 *         private key id -> private_key row (mount, key_name, key_version=1,
 *         key_algorithm, exportable, purpose, public_key_pem, public_key_id)
 *         public key id  -> public_key row (same Transit key, private_key_id)
 *         certificate id -> certificate row (certificate_pem, issuer link,
 *         private/public key links). certificates.certificate_pem is backfilled.
 *         A dropped key (approved drop-key) gets rows in state `destroyed`.
 * SSH     ssh_cas.kms_key_id and kms_public_key_id both become the versioned
 *         reference `openbao-transit:<mount>:<name>:1`. ssh_certificates keep
 *         their historical kms_signing_key_id.
 * SCEP    integration_ras: key_provider='openbao', key_id=<Transit name>,
 *         key_version=1, public_key_id=NULL. RA certificate rows that hold the
 *         RA key id (v3.19 alias) get kms_key_id=NULL, as v4 writes them.
 */
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { columnsOf, tableExists } from './sqlite.ts';
import { DEFAULT_MOUNTS, approvedTarget, type Mounts } from './policy.ts';
import type { Approval, CertificateEntry, KeyEntry, Manifest } from './types.ts';
import { MigrationError, derToPem, sha256Hex, spkiFingerprint } from './util.ts';

export interface TargetProfile { mounts: Mounts }
export const DEFAULT_PROFILE: TargetProfile = { mounts: DEFAULT_MOUNTS };

const MOUNT = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,3}$/;

/** Optional JSON file `{ "mounts": { "x509": ..., "ssh": ..., "ra": ... } }` (backend OPENBAO_*_MOUNT values). */
export function loadProfile(file?: string): TargetProfile {
  if (!file) return DEFAULT_PROFILE;
  const p = JSON.parse(readFileSync(file, 'utf8')) as Partial<TargetProfile>;
  const mounts = { ...DEFAULT_MOUNTS, ...(p.mounts ?? {}) };
  for (const m of Object.values(mounts)) if (!MOUNT.test(m)) throw new MigrationError('PROFILE', `invalid mount ${m}`);
  if (new Set(Object.values(mounts)).size !== 3) throw new MigrationError('PROFILE', 'X.509, SSH and RA mounts must be distinct');
  return { mounts };
}

export const SSH_KEY_REF_PREFIX = 'openbao-transit:';
export const sshKeyRef = (mount: string, name: string, version = 1) => `${SSH_KEY_REF_PREFIX}${mount}:${name}:${version}`;

const KEYSTORE_COLUMNS = ['id', 'object_type', 'provider', 'state', 'mount', 'key_name', 'key_version', 'key_algorithm', 'exportable', 'purpose',
  'public_key_pem', 'certificate_pem', 'issuer_certificate_id', 'private_key_id', 'public_key_id', 'tags', 'created_at', 'updated_at', 'destroyed_at'];

/** v4 schema elements the writer needs and the target DB lacks (empty = ready). */
export function missingColumns(db: DatabaseSync): string[] {
  const missing: string[] = [];
  if (!tableExists(db, 'keystore_objects')) missing.push('table keystore_objects (migration 0017)');
  else { const have = columnsOf(db, 'keystore_objects'); for (const c of KEYSTORE_COLUMNS) if (!have.has(c)) missing.push(`keystore_objects.${c}`); }
  const ra = columnsOf(db, 'integration_ras');
  if (tableExists(db, 'integration_ras')) for (const c of ['key_provider', 'key_id', 'public_key_id', 'key_version']) if (!ra.has(c)) missing.push(`integration_ras.${c}`);
  for (const c of ['kms_key_id', 'kms_public_key_id']) if (tableExists(db, 'ssh_cas') && !columnsOf(db, 'ssh_cas').has(c)) missing.push(`ssh_cas.${c}`);
  return missing;
}

export interface PemSource { (entry: CertificateEntry): Promise<string | null> }

export interface DbResult { rowsChanged: number; keystoreRows: number; pemBackfilled: number; auditRows: number; mappings: Mapping[] }

export interface Mapping {
  source: { provider: 'cosmian'; keyId: string; publicKeyId: string | null };
  target: { provider: 'openbao'; mount: string; name: string; version: number; reference: string } | null;
  action: string;
  class: string;
  spkiSha256: string | null;
  rows: { table: string; rowId: string; column: string }[];
}

/** Public key PEM of each ready transfer, read back from OpenBao by the caller. */
export type PublicKeys = Map<string, string>;

type KsRow = {
  id: string; object_type: 'private_key' | 'public_key' | 'certificate'; state: 'active' | 'destroyed';
  mount: string | null; key_name: string | null; key_version: number | null; key_algorithm: string | null; exportable: number | null;
  purpose: 'ca' | 'certificate' | null; public_key_pem: string | null; certificate_pem: string | null; issuer_certificate_id: string | null;
  private_key_id: string | null; public_key_id: string | null; tags: string;
};

const KEY_ALG: Record<string, string> = { 'rsa-2048': 'RSA-2048', 'rsa-3072': 'RSA-3072', 'rsa-4096': 'RSA-4096', 'ecdsa-p256': 'ECDSA-P256', 'ecdsa-p384': 'ECDSA-P384' };

/**
 * Applies the approved decisions of verified keys (`ready`), drop-key
 * decisions and the certificate store. Throws on any conflict (rolled back).
 */
export async function applyToTargetDb(opts: {
  db: DatabaseSync; manifest: Manifest; approval: Approval; profile: TargetProfile; ready: Set<string>; publicKeys: PublicKeys;
  pemFor: PemSource; actor: string; fault?: (point: string) => void;
}): Promise<DbResult> {
  const { db, manifest, approval } = opts;
  const keyById = new Map(manifest.keys.map(k => [k.sourceKeyId, k]));

  // Every certificate PEM first (network I/O outside the write lock), checked against the inventory.
  const pems = new Map<string, string>();
  for (const c of manifest.certificates) {
    if (c.table === 'integration_ras' || c.pemSource === 'missing' || c.pemSource === 'unknown') continue;
    let pem: string | null;
    if (c.pemSource === 'db') {
      const col = c.table === 'certificates' ? 'certificate_pem' : null;
      pem = col ? (db.prepare(`SELECT ${col} AS pem FROM certificates WHERE id = ?`).get(c.rowId) as { pem: string | null } | undefined)?.pem ?? null : null;
      if (!pem) pem = await opts.pemFor(c);
    } else pem = await opts.pemFor(c);
    if (!pem) throw new MigrationError('PEM_UNAVAILABLE', `certificate ${c.table}:${c.rowId} is not readable`);
    const der = new X509Certificate(pem).raw;
    if (sha256Hex(der) !== c.pemSha256) throw new MigrationError('PEM_CHANGED', `certificate ${c.table}:${c.rowId} differs from the inventoried one`);
    pems.set(`${c.table}:${c.rowId}`, derToPem(der, 'CERTIFICATE').trim());
  }

  const result: DbResult = { rowsChanged: 0, keystoreRows: 0, pemBackfilled: 0, auditRows: 0, mappings: [] };
  const audit: { op: string; entityType: string; entityId: string; details: Record<string, unknown> }[] = [];
  const tags = JSON.stringify(['migrated-from-cosmian']);
  db.exec('BEGIN IMMEDIATE');
  try {
    // 1. Keys.
    for (const key of manifest.keys) {
      const a = approval.keys[key.sourceKeyId];
      if (!a) continue;
      const rows: Mapping['rows'] = [];
      let target: Mapping['target'] = null;
      const isX509 = key.class === 'x509-ca' || key.class === 'x509-leaf';
      if (a.action === 'transfer' && opts.ready.has(key.sourceKeyId)) {
        const spec = approvedTarget(key, a, approval);
        const ref = key.class === 'ssh-ca' ? sshKeyRef(spec.mount, spec.name) : spec.name;
        target = { provider: 'openbao', mount: spec.mount, name: spec.name, version: 1, reference: ref };
        const publicPem = opts.publicKeys.get(key.sourceKeyId);
        if (!publicPem || spkiFingerprint(publicPem) !== key.spkiSha256) throw new MigrationError('INTERNAL', `no verified public key for ${key.sourceKeyId}`);
        if (isX509) {
          if (!key.sourcePublicKeyId) throw new MigrationError('NO_PUBLIC_KEY_ID', `X.509 key ${key.sourceKeyId} has no linked public key id`);
          const common = { state: 'active' as const, mount: spec.mount, key_name: spec.name, key_version: 1, key_algorithm: KEY_ALG[spec.type], exportable: spec.exportable ? 1 : 0, purpose: key.class === 'x509-ca' ? 'ca' as const : 'certificate' as const, public_key_pem: publicPem.trim(), certificate_pem: null, issuer_certificate_id: null, tags };
          for (const row of [
            { ...common, id: key.sourceKeyId, object_type: 'private_key' as const, private_key_id: null, public_key_id: key.sourcePublicKeyId },
            { ...common, id: key.sourcePublicKeyId, object_type: 'public_key' as const, private_key_id: key.sourceKeyId, public_key_id: null },
          ]) {
            if (putKeystoreRow(db, row)) { result.keystoreRows++; audit.push({ op: 'migration.keystore.insert', entityType: 'keystore_object', entityId: row.id, details: { objectType: row.object_type, sourceKeyId: key.sourceKeyId, target } }); }
            rows.push({ table: 'keystore_objects', rowId: row.id, column: 'id' });
          }
        } else if (key.class === 'ssh-ca') {
          for (const r of key.references.filter(x => x.role === 'ssh-ca-key')) {
            const pub = key.references.find(x => x.role === 'ssh-ca-public-key' && x.rowId === r.rowId)?.sourceId ?? null;
            if (casRow(db, 'ssh_cas', 'id', r.rowId, { kms_key_id: r.sourceId, kms_public_key_id: pub }, { kms_key_id: ref, kms_public_key_id: ref })) {
              result.rowsChanged++; audit.push({ op: 'migration.key.map', entityType: 'ssh_ca', entityId: r.rowId, details: { sourceKeyId: key.sourceKeyId, class: key.class, spkiSha256: key.spkiSha256, target } });
            }
            rows.push({ table: 'ssh_cas', rowId: r.rowId, column: 'kms_key_id' });
          }
        } else if (key.class === 'scep-ra') {
          for (const r of key.references.filter(x => x.role === 'scep-ra-key')) {
            const pub = key.references.find(x => x.role === 'scep-ra-public-key' && x.rowId === r.rowId)?.sourceId ?? null;
            if (casRow(db, 'integration_ras', 'integration_id', r.rowId, { key_provider: 'cosmian', key_id: r.sourceId, public_key_id: pub, key_version: null }, { key_provider: 'openbao', key_id: spec.name, public_key_id: null, key_version: 1 })) {
              result.rowsChanged++; audit.push({ op: 'migration.key.map', entityType: 'integration_ra', entityId: r.rowId, details: { sourceKeyId: key.sourceKeyId, class: key.class, spkiSha256: key.spkiSha256, target } });
            }
            rows.push({ table: 'integration_ras', rowId: r.rowId, column: 'key_id' });
          }
        }
      } else if (a.action === 'drop-key' && isX509) {
        // The certificates stay; the key is gone. Rows in state `destroyed` make the runtime
        // answer "key is destroyed" instead of "run the key migration".
        const ids: { id: string; type: 'private_key' | 'public_key'; priv: string | null; pub: string | null }[] = [{ id: key.sourceKeyId, type: 'private_key', priv: null, pub: key.sourcePublicKeyId }];
        if (key.sourcePublicKeyId) ids.push({ id: key.sourcePublicKeyId, type: 'public_key', priv: key.sourceKeyId, pub: null });
        for (const x of ids) {
          const row: KsRow = { id: x.id, object_type: x.type, state: 'destroyed', mount: null, key_name: null, key_version: null, key_algorithm: key.transitType ? KEY_ALG[key.transitType] : null, exportable: null, purpose: key.class === 'x509-ca' ? 'ca' : 'certificate', public_key_pem: null, certificate_pem: null, issuer_certificate_id: null, private_key_id: x.priv, public_key_id: x.pub, tags: JSON.stringify(['migration-drop-key']) };
          if (putKeystoreRow(db, row)) { result.keystoreRows++; audit.push({ op: 'migration.key.drop', entityType: 'keystore_object', entityId: x.id, details: { sourceKeyId: key.sourceKeyId, class: key.class, approvedBy: approval.approvedBy } }); }
          rows.push({ table: 'keystore_objects', rowId: x.id, column: 'id' });
        }
      } else if (a.action === 'drop-key' && key.class === 'ssh-ca') {
        // Only revoked SSH CAs (policy.ts). The row keeps its v3 ids as provenance; nothing
        // signs with a revoked CA. The decision is recorded per row.
        for (const r of key.references.filter(x => x.role === 'ssh-ca-key')) {
          const row = db.prepare('SELECT revocation_date AS d FROM ssh_cas WHERE id = ?').get(r.rowId) as { d: number | null } | undefined;
          if (!row || row.d === null) throw new MigrationError('TARGET_ROW_CONFLICT', `ssh_cas:${r.rowId} is not revoked; its key cannot be dropped`);
          if (recordOnce(db, 'migration.key.drop', 'ssh_ca', r.rowId)) audit.push({ op: 'migration.key.drop', entityType: 'ssh_ca', entityId: r.rowId, details: { sourceKeyId: key.sourceKeyId, class: key.class } });
          rows.push({ table: 'ssh_cas', rowId: r.rowId, column: 'kms_key_id' });
        }
      } else if (a.action === 'drop-key' && key.class === 'scep-ra') {
        // Only RA keys of revoked integrations: the binding keeps its certificates (history).
        for (const r of key.references.filter(x => x.role === 'scep-ra-key')) {
          const pub = key.references.find(x => x.role === 'scep-ra-public-key' && x.rowId === r.rowId)?.sourceId ?? null;
          if (casRow(db, 'integration_ras', 'integration_id', r.rowId, { key_id: r.sourceId, public_key_id: pub }, { key_id: null, public_key_id: null })) {
            result.rowsChanged++; audit.push({ op: 'migration.key.drop', entityType: 'integration_ra', entityId: r.rowId, details: { sourceKeyId: key.sourceKeyId, class: key.class } });
          }
          rows.push({ table: 'integration_ras', rowId: r.rowId, column: 'key_id' });
        }
      } else if (a.action === 'reprovision' && key.class === 'scep-ra') {
        for (const r of key.references.filter(x => x.role === 'scep-ra-key')) {
          const pub = key.references.find(x => x.role === 'scep-ra-public-key' && x.rowId === r.rowId)?.sourceId ?? null;
          const pemSha = manifest.certificates.find(c => c.table === 'integration_ras' && c.rowId === r.rowId)?.pemSha256 ?? null;
          if (reprovisionBinding(db, r.rowId, r.sourceId, pub, pemSha)) {
            result.rowsChanged++; audit.push({ op: 'migration.ra.reprovision', entityType: 'integration_ra', entityId: r.rowId, details: { sourceKeyId: key.sourceKeyId, previousRaCertificateSha256: pemSha, approvedBy: approval.approvedBy } });
          }
          rows.push({ table: 'integration_ras', rowId: r.rowId, column: 'key_id' });
        }
      }
      // X.509 rows that hold the certificate id as key id (older v3): point them at the
      // private key, but only when the certificate of the row certifies exactly that key.
      if (isX509 && (a.action === 'transfer' ? opts.ready.has(key.sourceKeyId) : a.action === 'drop-key')) {
        for (const r of key.references.filter(x => (x.role === 'x509-ca-key' || x.role === 'x509-leaf-key') && x.sourceId !== key.sourceKeyId)) {
          const cert = manifest.certificates.find(c => c.table === r.table && c.rowId === r.rowId);
          if (!key.spkiSha256 || !cert?.spkiSha256 || cert.spkiSha256 !== key.spkiSha256) {
            throw new MigrationError('KEY_LINK_UNPROVEN', `${r.table}:${r.rowId} holds ${r.sourceId}; its certificate does not prove the key ${key.sourceKeyId}`);
          }
          if (casRow(db, r.table, 'id', r.rowId, { kms_key_id: r.sourceId }, { kms_key_id: key.sourceKeyId })) {
            result.rowsChanged++; audit.push({ op: 'migration.key.link_repair', entityType: r.table === 'certificates' ? 'certificate' : 'ca', entityId: r.rowId, details: { from: r.sourceId, to: key.sourceKeyId, spkiSha256: key.spkiSha256 } });
          }
          rows.push({ table: r.table, rowId: r.rowId, column: 'kms_key_id' });
        }
      }
      // RA certificate alias rows: the v4 RA certificate row has no X.509 key id.
      const raDone = a.action === 'transfer' ? opts.ready.has(key.sourceKeyId) : a.action === 'reprovision' || a.action === 'drop-key';
      if (key.class === 'scep-ra' && raDone) {
        for (const r of key.references.filter(x => x.role === 'scep-ra-cert-alias')) {
          if (casRow(db, 'certificates', 'id', r.rowId, { kms_key_id: r.sourceId }, { kms_key_id: null })) {
            result.rowsChanged++; audit.push({ op: 'migration.ra.certificate_alias', entityType: 'certificate', entityId: r.rowId, details: { sourceKeyId: key.sourceKeyId, spkiSha256: key.spkiSha256 } });
          }
          rows.push({ table: 'certificates', rowId: r.rowId, column: 'kms_key_id' });
        }
      }
      result.mappings.push({ source: { provider: 'cosmian', keyId: key.sourceKeyId, publicKeyId: key.sourcePublicKeyId }, target, action: a.action, class: key.class, spkiSha256: key.spkiSha256, rows });
    }
    opts.fault?.('db-mid-transaction');

    // 2. Certificate store rows, and the certificates.certificate_pem cache.
    const done = new Set<string>();
    for (const c of manifest.certificates) {
      if (c.table === 'integration_ras' || !c.kmsCertificateId) continue;
      const pem = pems.get(`${c.table}:${c.rowId}`);
      if (!pem) continue; // missing everywhere and accepted by the approval
      if (done.has(c.kmsCertificateId)) continue;
      done.add(c.kmsCertificateId);
      const key = c.sourceKeyId ? keyById.get(c.sourceKeyId) : undefined;
      const act = key ? approval.keys[key.sourceKeyId]?.action : undefined;
      const linked = c.keyLink === 'x509' && key && (act === 'transfer' || act === 'drop-key');
      if (c.keyLink === 'x509' && key && act !== 'transfer' && act !== 'drop-key') continue; // rotate: no row until the key is resolved
      const row: KsRow = {
        id: c.kmsCertificateId, object_type: 'certificate', state: 'active', mount: null, key_name: null, key_version: null, key_algorithm: null,
        exportable: null, purpose: null, public_key_pem: null, certificate_pem: pem, issuer_certificate_id: c.issuerKmsCertificateId ?? c.kmsCertificateId,
        private_key_id: linked ? key!.sourceKeyId : null, public_key_id: linked ? key!.sourcePublicKeyId : null, tags,
      };
      if (putKeystoreRow(db, row)) { result.keystoreRows++; audit.push({ op: 'migration.keystore.insert', entityType: 'keystore_object', entityId: row.id, details: { objectType: 'certificate', row: `${c.table}:${c.rowId}`, pemSha256: c.pemSha256, keyLink: c.keyLink } }); }
      if (c.table === 'certificates') {
        const cur = db.prepare('SELECT certificate_pem AS pem FROM certificates WHERE id = ?').get(c.rowId) as { pem: string | null } | undefined;
        if (!cur) throw new MigrationError('ROW_GONE', `certificates:${c.rowId} is not in the target database`);
        if (cur.pem) {
          if (sha256Hex(new X509Certificate(cur.pem).raw) !== c.pemSha256) throw new MigrationError('PEM_CONFLICT', `certificates:${c.rowId} has another certificate_pem in the target`);
        } else {
          db.prepare('UPDATE certificates SET certificate_pem = ? WHERE id = ? AND certificate_pem IS NULL').run(pem, c.rowId);
          result.pemBackfilled++;
          audit.push({ op: 'migration.certificate.pem_backfill', entityType: 'certificate', entityId: c.rowId, details: { pemSha256: c.pemSha256 } });
        }
      }
    }

    // 3. Audit rows (only for changes: a no-op run writes none).
    if (columnsOf(db, 'audit_log').has('operation')) {
      const hasActor = columnsOf(db, 'audit_log').has('actor_type');
      const stmt = hasActor
        ? db.prepare("INSERT INTO audit_log (id, timestamp, operation, entity_type, entity_id, status, details, actor_type, actor_name) VALUES (?, unixepoch(), ?, ?, ?, 'success', ?, 'user', ?)")
        : db.prepare("INSERT INTO audit_log (id, timestamp, operation, entity_type, entity_id, status, details) VALUES (?, unixepoch(), ?, ?, ?, 'success', ?)");
      for (const e of audit) {
        const details = JSON.stringify({ ...e.details, approval: approval.manifestSha256.slice(0, 16), approvedBy: approval.approvedBy, tool: 'scripts/migration' });
        if (hasActor) stmt.run(randomUUID(), e.op, e.entityType, e.entityId, details, opts.actor);
        else stmt.run(randomUUID(), e.op, e.entityType, e.entityId, details);
        result.auditRows++;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return result;
}

const KS_COMPARE: (keyof KsRow)[] = ['object_type', 'state', 'mount', 'key_name', 'key_version', 'key_algorithm', 'exportable', 'purpose', 'issuer_certificate_id', 'private_key_id', 'public_key_id'];

/** Inserts a keystore_objects row, or checks that the existing one is the same object. */
function putKeystoreRow(db: DatabaseSync, row: KsRow): boolean {
  const cur = db.prepare('SELECT * FROM keystore_objects WHERE id = ?').get(row.id) as Record<string, unknown> | undefined;
  if (cur) {
    const diff = KS_COMPARE.filter(k => (cur[k] ?? null) !== (row[k] ?? null));
    if (row.public_key_pem && (!cur.public_key_pem || spkiFingerprint(String(cur.public_key_pem)) !== spkiFingerprint(row.public_key_pem))) diff.push('public_key_pem');
    if (row.certificate_pem && (!cur.certificate_pem || sha256Hex(new X509Certificate(String(cur.certificate_pem)).raw) !== sha256Hex(new X509Certificate(row.certificate_pem).raw))) diff.push('certificate_pem');
    if (diff.length) throw new MigrationError('TARGET_ROW_CONFLICT', `keystore_objects:${row.id} exists with other values (${diff.join(', ')}); refusing to overwrite`);
    return false;
  }
  try {
    db.prepare(`INSERT INTO keystore_objects (id, object_type, provider, state, mount, key_name, key_version, key_algorithm, exportable, purpose, public_key_pem, certificate_pem, issuer_certificate_id, private_key_id, public_key_id, tags, destroyed_at)
      VALUES (?, ?, 'openbao', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${row.state === 'destroyed' ? 'unixepoch()' : 'NULL'})`)
      .run(row.id, row.object_type, row.state, row.mount, row.key_name, row.key_version, row.key_algorithm, row.exportable, row.purpose, row.public_key_pem, row.certificate_pem, row.issuer_certificate_id, row.private_key_id, row.public_key_id, row.tags);
  } catch (error) {
    // idx_keystore_objects_key: the Transit key already belongs to another row.
    throw new MigrationError('TARGET_ROW_CONFLICT', `keystore_objects:${row.id} cannot be inserted: ${(error as Error).message}`);
  }
  return true;
}

/** True when no audit row of this operation exists yet for the entity (idempotent records). */
function recordOnce(db: DatabaseSync, op: string, entityType: string, entityId: string): boolean {
  if (!columnsOf(db, 'audit_log').has('operation')) return true;
  return db.prepare('SELECT 1 FROM audit_log WHERE operation = ? AND entity_type = ? AND entity_id = ? LIMIT 1').get(op, entityType, entityId) === undefined;
}

/**
 * Resets an RA binding for a new key: v4 `ra/provision` then generates the key in OpenBao.
 * The current RA certificate moves to the front of `previous` (GetCACert keeps serving it
 * in the overlap list until it expires); the certificate rows stay as history.
 * Idempotent: a binding already reset with that certificate in `previous` is left alone.
 */
function reprovisionBinding(db: DatabaseSync, id: string, sourceKeyId: string, sourcePub: string | null, pemSha: string | null): boolean {
  const cur = db.prepare('SELECT key_provider, key_id, public_key_id, key_version, certificate_id, certificate_pem, previous FROM integration_ras WHERE integration_id = ?').get(id) as
    { key_provider: string; key_id: string | null; public_key_id: string | null; key_version: number | null; certificate_id: string | null; certificate_pem: string | null; previous: string } | undefined;
  if (!cur) throw new MigrationError('ROW_GONE', `integration_ras:${id} is not in the target database`);
  const prev = JSON.parse(cur.previous || '[]') as { id: string; certificatePem: string }[];
  const hasOld = (list: { certificatePem: string }[]) => !!pemSha && list.some(p => sha256Hex(new X509Certificate(p.certificatePem).raw) === pemSha);
  if (cur.key_provider === 'openbao' && cur.key_id === null && cur.public_key_id === null && cur.certificate_pem === null && hasOld(prev)) return false;
  if (cur.key_provider !== 'cosmian' || cur.key_id !== sourceKeyId || cur.public_key_id !== sourcePub) {
    throw new MigrationError('TARGET_ROW_CONFLICT', `integration_ras:${id} holds ${cur.key_provider}:${cur.key_id}, not the v3 RA key; refusing to reset it`);
  }
  if (cur.certificate_pem && pemSha && sha256Hex(new X509Certificate(cur.certificate_pem).raw) !== pemSha) throw new MigrationError('PEM_CONFLICT', `integration_ras:${id} has another RA certificate than the inventoried one`);
  const next = cur.certificate_pem && cur.certificate_id ? [{ id: cur.certificate_id, certificatePem: cur.certificate_pem }, ...prev] : prev;
  db.prepare("UPDATE integration_ras SET key_provider = 'openbao', key_id = NULL, public_key_id = NULL, key_version = NULL, certificate_id = NULL, certificate_pem = NULL, previous = ?, lease = NULL, lease_until = NULL WHERE integration_id = ?")
    .run(JSON.stringify(next), id);
  return true;
}

/**
 * Compare-and-set on one row: no change when it already holds `to`; update
 * when it holds `from`; anything else is a conflict.
 */
function casRow(db: DatabaseSync, table: string, idCol: string, id: string, from: Record<string, string | number | null>, to: Record<string, string | number | null>): boolean {
  const cols = Object.keys(to);
  const cur = db.prepare(`SELECT ${cols.join(', ')} FROM ${table} WHERE ${idCol} = ?`).get(id) as Record<string, unknown> | undefined;
  if (!cur) throw new MigrationError('ROW_GONE', `${table}:${id} is not in the target database`);
  const norm = (v: unknown) => (v === undefined ? null : typeof v === 'bigint' ? Number(v) : v);
  if (cols.every(c => norm(cur[c]) === to[c])) return false;
  if (!cols.every(c => norm(cur[c]) === (from[c] ?? null))) {
    throw new MigrationError('TARGET_ROW_CONFLICT', `${table}:${id} holds ${JSON.stringify(cur)}, neither the v3 value nor the migration result; refusing to overwrite`);
  }
  db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE ${idCol} = ?`).run(...cols.map(c => to[c]), id);
  return true;
}

export type { KeyEntry };
