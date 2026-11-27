/**
 * Regression tests for the frozen source, the reconciliation and the
 * database-side pair check (independent review findings 1, 4 and 8):
 *
 * - a source with commits only in its WAL is refused, and a change that only
 *   the WAL holds is found (the old file digest did not see it);
 * - `--cutover` is never green without the frozen source;
 * - every table of the source is reconciled (audit history, revocations,
 *   CRLs, KRLs and their sequence, SSH blocks, principals, ownership, ...),
 *   with the migration's own writes and v4 schema growth accepted;
 * - a restore of an older Raft snapshot next to a later database fails, a
 *   matching pair with post-cutover writes and deleted keys passes.
 *
 * Run: cd scripts/migration && npm test   (Node >= 22.18)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, generateKeyPairSync, privateDecrypt, randomUUID } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildManifest } from '../lib/inventory.ts';
import { approvalTemplate } from '../lib/policy.ts';
import { reconcile } from '../lib/reconcile.ts';
import { checkBinding, contentDigest } from '../lib/source.ts';
import { backupTo, fileSha256, openReadOnly } from '../lib/sqlite.ts';
import { DEFAULT_PROFILE, sshKeyRef } from '../lib/target-db.ts';
import { apply, liveTarget, preflight } from '../lib/transfer.ts';
import { verifyMigration, verifyRestore, type Check } from '../lib/verify.ts';
import type { Approval } from '../lib/types.ts';
import { documentDigest, MigrationError } from '../lib/util.ts';
import { FakeCosmian, FakeTransit, makeCert, migrateToV4, seedV3, sshLine, tempDir, v3Database } from './helpers.ts';

const ADDR = 'https://openbao.test:8200';

/**
 * A FakeTransit with the RA session-key operation (PKCS#1 v1.5 unwrap). Node 22
 * refuses RSA_PKCS1_PADDING for private decryption, so the padding is checked
 * here on a raw RSA operation. Set on the instance: it replaces any fake one.
 */
type SessionTransit = FakeTransit;
function sessionTransit(): SessionTransit {
  const store = new FakeTransit();
  const sessionKey = async (mount: string, name: string, ciphertext: Buffer, length: 16 | 24 | 32): Promise<Buffer> => {
    const k = store.keys.get(`${mount}/${name}`);
    if (!k || !k.allowPkcs1v15SessionKey) throw new MigrationError('OPENBAO_ERROR', 'session-key transport not allowed');
    const em = privateDecrypt({ key: k.priv, padding: constants.RSA_NO_PADDING }, ciphertext);
    const sep = em.indexOf(0, 2);
    if (em[0] !== 0 || em[1] !== 2 || sep < 10) throw new MigrationError('OPENBAO_ERROR', 'bad padding');
    const key = em.subarray(sep + 1);
    if (key.length !== length) throw new MigrationError('OPENBAO_ERROR', 'bad length');
    return Buffer.from(key);
  };
  (store as unknown as { sessionKey: typeof sessionKey }).sessionKey = sessionKey;
  return store;
}
const CLI = join(dirname(fileURLToPath(import.meta.url)), '../pki-migrate.ts');
const now = Math.floor(Date.now() / 1000);

/** v3 rows in every authoritative table the old reconciliation skipped. */
function seedHistory(db: DatabaseSync): void {
  db.exec(`
    UPDATE certificates SET revocation_reason = 'keyCompromise', revocation_date = ${now} WHERE id = 'cert-1';
    UPDATE certificates SET source_type = 'k8s', k8s_namespace = 'prod', k8s_resource = 'web-tls', integration_id = 'int-1' WHERE id = 'cert-2';
    UPDATE ssh_cas SET next_serial = 42 WHERE id = 'sshca-a';
    INSERT INTO audit_log (id, timestamp, operation, entity_type, entity_id, status, details) VALUES ('audit-v3-1', ${now}, 'certificate.revoke', 'certificate', 'cert-1', 'success', '{"reason":"keyCompromise"}');
    INSERT INTO crls (id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count) VALUES ('crl-1', 'ca-1', 7, ${now}, ${now + 86400}, '-----BEGIN X509 CRL-----\nAAAA\n-----END X509 CRL-----', 1);
    INSERT INTO ssh_identities (id, zone_id, subject, status) VALUES ('ident-1', 'default', 'alex', 'active');
    INSERT INTO ssh_principals (id, zone_id, name) VALUES ('princ-1', 'default', 'ops');
    INSERT INTO ssh_user_principals (id, identity_id, principal_id) VALUES ('up-1', 'ident-1', 'princ-1');
    INSERT INTO ssh_host_principal_maps (id, host_id, principal_id, local_account) VALUES ('hpm-1', 'host-1', 'princ-1', 'ops');
    INSERT INTO ssh_host_blocks (id, host_id, identity_id, reason, status) VALUES ('blk-1', 'host-1', 'ident-1', 'offboarded', 'active');
    INSERT INTO ssh_revocations (id, ca_id, target_type, cert_id, serial, reason, revoked_at) VALUES ('rev-1', 'sshca-a', 'certificate', 'sshcert-1', '1', 'compromised', ${now});
    INSERT INTO ssh_krls (id, ca_id, krl_number, version_hash, krl_blob, this_update, next_update, revoked_count) VALUES ('krl-1', 'sshca-a', 3, 'vh3', x'00010203', ${now}, ${now + 3600}, 1);
    UPDATE ssh_krl_seq SET value = 3 WHERE id = 1;
    INSERT INTO ssh_fleet_tokens (id, zone_id, name, token_hash, token_prefix, op_set) VALUES ('ft-1', 'default', 'fleet', 'th', 'pkissh_x', '["sign"]');
  `);
}

async function setup(seed?: (db: DatabaseSync) => void) {
  const dir = tempDir('pkimig-rec-');
  const sourcePath = join(dir, 'v3.db');
  const kms = new FakeCosmian();
  const db = v3Database(sourcePath);
  const ids = seedV3(db, kms);
  db.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'"); // the non-extractable host CA: rotated before the final inventory
  seedHistory(db);
  seed?.(db);
  db.close();
  const targetPath = join(dir, 'v4.db');
  await backupTo(sourcePath, targetPath);
  migrateToV4(targetPath);
  const src = openReadOnly(sourcePath);
  const manifest = await buildManifest({ sourcePath, db: src, kms });
  src.close();
  return { dir, sourcePath, targetPath, kms, store: sessionTransit(), manifest, ids };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function approve(s: Setup): Promise<Approval> {
  const a = approvalTemplate(s.manifest, await liveTarget(s.store, ADDR, s.manifest));
  a.approvedBy = 'rehearsal-admin'; a.approvedAt = new Date().toISOString(); a.allowSourceWrappingKeyRegistration = true;
  for (const k of Object.values(a.keys)) if (k.acknowledgeSensitive === false) k.acknowledgeSensitive = true;
  return a;
}

async function migrated() {
  const s = await setup();
  const approval = await approve(s);
  await apply({ manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, runDir: join(s.dir, 'run'),
    store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, confirm: documentDigest(s.manifest).slice(0, 16), actor: 'test' });
  return { ...s, approval };
}
type Migrated = Awaited<ReturnType<typeof migrated>>;

async function verifyCutover(s: Migrated, targetPath = s.targetPath, store: SessionTransit = s.store) {
  const target = openReadOnly(targetPath), source = openReadOnly(s.sourcePath);
  try { return await verifyMigration({ manifest: s.manifest, approval: s.approval, target, store, profile: DEFAULT_PROFILE, source, sourcePath: s.sourcePath, raSessionCheck: true }); }
  finally { target.close(); source.close(); }
}

const failed = (checks: Check[]) => checks.filter(c => !c.ok);
const failedNames = (checks: Check[]) => failed(checks).map(c => c.name);

/** A copy of the migrated target with one change. */
let copies = 0;
async function mutated(s: Migrated, sql: string): Promise<string> {
  const p = join(s.dir, `mut-${++copies}.db`);
  await backupTo(s.targetPath, p);
  const w = new DatabaseSync(p); w.exec('PRAGMA foreign_keys = OFF'); w.exec(sql); w.close();
  return p;
}
function reconcileCopy(s: Migrated, path: string): Check[] {
  const checks: Check[] = [];
  const target = openReadOnly(path), source = openReadOnly(s.sourcePath);
  try { reconcile({ source, target, manifest: s.manifest, approval: s.approval, add: (name, ok, detail) => checks.push({ name, ok, detail }), mode: 'full' }); }
  finally { target.close(); source.close(); }
  return checks;
}

// ───────────────────────── finding 1: frozen source ─────────────────────────

test('a source with commits only in its WAL is refused; pki-migrate backup gives a frozen copy', async () => {
  const dir = tempDir('pkimig-wal-');
  const live = join(dir, 'pki.db');
  const db = v3Database(live);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0');
  seedV3(db, new FakeCosmian());
  // The writer stays attached, as a running (or killed) v3 backend: the rows are in pki.db-wal.
  assert.ok(statSync(`${live}-wal`).size > 0);
  const ro = openReadOnly(live);
  await assert.rejects(buildManifest({ sourcePath: live, db: ro, kms: new FakeCosmian() }), (e: MigrationError) => e.code === 'SOURCE_NOT_FROZEN' && e.message.includes('pki-migrate backup'));
  ro.close();
  const frozen = join(dir, 'frozen.db');
  await backupTo(live, frozen); // what `pki-migrate backup` does
  db.close();
  const f = openReadOnly(frozen);
  const m = await buildManifest({ sourcePath: frozen, db: f });
  assert.match(m.source.contentSha256, /^[0-9a-f]{64}$/);
  assert.ok(m.source.counts.certificates >= 4, 'the WAL rows are in the frozen copy');
  f.close();
});

test('a change held only in the WAL keeps the file digest; the content digest finds it (preflight and verify)', async () => {
  const s = await migrated();
  // Make the frozen source a WAL database, then let a writer append a revocation that stays in the WAL.
  const w0 = new DatabaseSync(s.sourcePath); w0.exec('PRAGMA journal_mode = WAL'); w0.close();
  const pre = await preflight({ manifest: s.manifest, approval: s.approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, online: true });
  // journal_mode=WAL rewrites the header: file digest differs, the content does not.
  const ro = openReadOnly(s.sourcePath); const contentBefore = contentDigest(ro); ro.close();
  assert.equal(contentBefore, s.manifest.source.contentSha256, 'same content after the journal mode change');
  assert.ok(pre.checks.some(c => !c.ok && c.name.startsWith('source database unchanged') && c.detail.includes('file sha256')));

  const fileBefore = fileSha256(s.sourcePath);
  const w = new DatabaseSync(s.sourcePath);
  w.exec('PRAGMA wal_autocheckpoint = 0');
  w.exec("UPDATE certificates SET status = 'revoked', revocation_reason = 'keyCompromise' WHERE id = 'cert-2'");
  assert.equal(fileSha256(s.sourcePath), fileBefore, 'the main file did not change: a file digest is blind to this write');
  const reader = openReadOnly(s.sourcePath);
  const bad = checkBinding({ dbSha256: fileBefore, contentSha256: contentBefore }, s.sourcePath, reader);
  reader.close();
  assert.ok(bad.some(b => b.includes('-wal holds')), bad.join('; '));
  assert.ok(bad.some(b => b.includes('content sha256')), bad.join('; '));
  w.close();
});

// ───────────────────────── finding 4: cutover needs the source ─────────────────────────

test('verify --cutover is never green without the frozen source (library and CLI)', async () => {
  const s = await migrated();
  const target = openReadOnly(s.targetPath);
  const v = await verifyMigration({ manifest: s.manifest, approval: s.approval, target, store: s.store, profile: DEFAULT_PROFILE, raSessionCheck: true });
  target.close();
  assert.equal(v.ok, true, JSON.stringify(failed(v.checks)));
  assert.equal(v.reconciled, false);
  assert.equal(v.cutoverReady, false);
  assert.ok(failedNames(v.checks).includes('cutover: reconciliation with the frozen source'));

  const full = await verifyCutover(s);
  assert.equal(full.cutoverReady, true, JSON.stringify([...failed(full.checks), full.counts, full.warnings]));
  assert.equal(full.reconciled, true);
  assert.ok(full.counts.rowsReconciled > 20);

  writeFileSync(join(s.dir, 'manifest.json'), JSON.stringify(s.manifest));
  writeFileSync(join(s.dir, 'approval.json'), JSON.stringify(s.approval));
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'verify', '--manifest', join(s.dir, 'manifest.json'), '--approval', join(s.dir, 'approval.json'),
    '--target-db', s.targetPath, '--openbao-addr', ADDR, '--openbao-token-file', join(s.dir, 'none'), '--cutover'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--cutover needs --source-db/);
  const r2 = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'verify', '--restore', '--cutover', '--target-db', s.targetPath], { encoding: 'utf8' });
  assert.equal(r2.status, 2, r2.stderr);
});

test('a frozen source other than the manifest one fails the gate', async () => {
  const s = await migrated();
  const other = join(s.dir, 'other.db');
  await backupTo(s.sourcePath, other);
  const w = new DatabaseSync(other); w.exec("DELETE FROM crls WHERE id = 'crl-1'"); w.close();
  const target = openReadOnly(s.targetPath), source = openReadOnly(other);
  const v = await verifyMigration({ manifest: s.manifest, approval: s.approval, target, store: s.store, profile: DEFAULT_PROFILE, source, sourcePath: other });
  target.close(); source.close();
  assert.equal(v.cutoverReady, false);
  assert.ok(failedNames(v.checks).some(n => n.startsWith('frozen source is the copy the manifest binds')));
});

// ───────────────────────── finding 8: reconciliation ─────────────────────────

test('every authoritative table is reconciled: each lost or changed v3 value fails its table', async () => {
  const s = await migrated();
  assert.deepEqual(failed(reconcileCopy(s, s.targetPath)), [], 'the migration writes alone are accepted');
  const cases: [string, string][] = [
    ['audit_log', "DELETE FROM audit_log WHERE id = 'audit-v3-1'"],
    ['audit_log', "UPDATE audit_log SET details = '{}' WHERE id = 'audit-v3-1'"],
    ['audit_log', `INSERT INTO audit_log (id, timestamp, operation, entity_type, status) VALUES ('${randomUUID()}', ${now}, 'certificate.issue', 'certificate', 'success')`],
    ['audit_log', `INSERT INTO audit_log (id, timestamp, operation, entity_type, status, details) VALUES ('${randomUUID()}', ${now}, 'migration.key.map', 'ssh_ca', 'success', '{"tool":"scripts/migration","approval":"0000000000000000"}')`],
    ['certificates', "UPDATE certificates SET status = 'active', revocation_reason = NULL, revocation_date = NULL WHERE id = 'cert-1'"],
    ['certificates', "UPDATE certificates SET k8s_namespace = 'staging' WHERE id = 'cert-2'"],
    ['certificates', "UPDATE certificates SET integration_id = NULL WHERE id = 'cert-2'"],
    ['certificates', "UPDATE certificates SET renewed_from_id = NULL WHERE id = 'cert-2'"],
    ['certificates', `UPDATE certificates SET certificate_pem = (SELECT certificate_pem FROM certificates WHERE id = 'cert-ext') WHERE id = 'cert-1'`],
    ['certificates', `INSERT INTO certificates (id, ca_id, kms_certificate_id, subject_dn, serial_number, certificate_type, not_before, not_after, status) VALUES ('issued-after-freeze', 'ca-1', 'x', 'CN=late', '9999', 'server', ${now}, ${now + 60}, 'active')`],
    ['certificate_authorities', "UPDATE certificate_authorities SET status = 'revoked' WHERE id = 'ca-1'"],
    ['crls', "DELETE FROM crls WHERE id = 'crl-1'"],
    ['crls', "UPDATE crls SET crl_number = 6 WHERE id = 'crl-1'"],
    ['ssh_cas', "UPDATE ssh_cas SET next_serial = 2 WHERE id = 'sshca-a'"],
    ['ssh_certificates', "UPDATE ssh_certificates SET status = 'revoked', revocation_reason = 'x' WHERE id = 'sshcert-1'"],
    ['ssh_revocations', "DELETE FROM ssh_revocations WHERE id = 'rev-1'"],
    ['ssh_krls', "UPDATE ssh_krls SET krl_blob = x'00' WHERE id = 'krl-1'"],
    ['ssh_krl_seq', "UPDATE ssh_krl_seq SET value = 1 WHERE id = 1"],
    ['ssh_host_blocks', "UPDATE ssh_host_blocks SET status = 'lifted' WHERE id = 'blk-1'"],
    ['ssh_user_principals', "DELETE FROM ssh_user_principals WHERE id = 'up-1'"],
    ['ssh_host_principal_maps', "UPDATE ssh_host_principal_maps SET local_account = 'root' WHERE id = 'hpm-1'"],
    ['ssh_fleet_tokens', "UPDATE ssh_fleet_tokens SET revoked = 1 WHERE id = 'ft-1'"],
    ['ssh_hosts', "UPDATE ssh_hosts SET zone_id = 'zone-b' WHERE id = 'host-1'"],
    ['ssh_identities', "DELETE FROM ssh_identities WHERE id = 'ident-1'"],
    ['zones', "UPDATE zones SET status = 'archived' WHERE id = 'zone-b'"],
    ['integrations', "UPDATE integrations SET token_hash = 'other' WHERE id = 'int-1'"],
    ['integration_ras', "UPDATE integration_ras SET key_id = 'some-other-key' WHERE integration_id = 'int-1'"],
    ['ssh_cas', "UPDATE ssh_cas SET kms_key_id = 'openbao-transit:pki-manager-ssh:another:1' WHERE id = 'sshca-a'"],
  ];
  for (const [table, sql] of cases) {
    const names = failedNames(reconcileCopy(s, await mutated(s, sql)));
    assert.deepEqual(names, [`reconcile ${table}`], `${sql} -> ${names.join(', ')}`);
  }
  // The reviewer's counterexample end to end: a lost keyCompromise revocation and a lost CRL.
  const lost = await mutated(s, "UPDATE certificates SET status = 'active', revocation_reason = NULL WHERE id = 'cert-1'; DELETE FROM crls WHERE id = 'crl-1'");
  const v = await verifyCutover(s, lost);
  assert.equal(v.cutoverReady, false);
  assert.deepEqual(failedNames(v.checks), ['reconcile certificates', 'reconcile crls']);
  assert.match(v.checks.find(c => c.name === 'reconcile certificates')!.detail!, /cert-1.*status s"revoked" -> s"active"/);
});

test('schema evolution: target-only columns and tables pass, a source column lost in the target fails', async () => {
  const s = await migrated();
  // A hypothetical v4 migration 0018: new column with a default, new table, new index.
  const grown = await mutated(s, "ALTER TABLE ssh_cas ADD COLUMN key_policy text DEFAULT 'v4' NOT NULL; CREATE TABLE ssh_ca_rotations (id text PRIMARY KEY, ca_id text); CREATE INDEX idx_x ON certificates (status)");
  assert.deepEqual(failed(reconcileCopy(s, grown)), []);
  assert.equal((await verifyCutover(s, grown)).cutoverReady, true);
  const dropped = await mutated(s, 'DROP INDEX IF EXISTS idx_certificates_k8s_cluster; ALTER TABLE certificates DROP COLUMN k8s_cluster_id');
  const c = reconcileCopy(s, dropped).find(x => x.name === 'reconcile certificates')!;
  assert.equal(c.ok, false);
  assert.match(c.detail!, /columns missing in the target: k8s_cluster_id/);
});

// ───────────────────────── finding 8: restore pairs ─────────────────────────

/** A Raft snapshot of the fake: the keys as they are now. */
function snapshot(store: SessionTransit): SessionTransit {
  const snap = sessionTransit();
  for (const [k, v] of store.keys) snap.keys.set(k, v);
  return snap;
}

/** v4 runtime writes after the cutover: one X.509 issue, one SSH CA, one RA, a revocation, a CRL, a deleted key. */
function postCutoverWrites(s: Migrated): { x509: string; ssh: string; ra: string } {
  const db = new DatabaseSync(s.targetPath);
  const ca = db.prepare("SELECT kms_certificate_id FROM certificate_authorities WHERE id = 'ca-1'").get() as { kms_certificate_id: string };
  const caPem = (db.prepare('SELECT certificate_pem FROM keystore_objects WHERE id = ?').get(ca.kms_certificate_id) as { certificate_pem: string }).certificate_pem;
  const caPriv = s.kms.objects.get(s.ids.caKey)!.privateKey!;
  // X.509: a new leaf key in Transit and its keystore rows, as the v4 x509 store writes them.
  const leaf = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const x509 = `v4-leaf-${randomUUID().slice(0, 8)}`;
  s.store.plant('pki-manager', x509, 'rsa-2048', leaf.privateKey);
  const leafPub = leaf.publicKey.export({ format: 'pem', type: 'spki' }) as string;
  const leafPem = makeCert({ cn: 'after.example', key: leaf.privateKey, issuerKey: caPriv, issuerCert: caPem, serial: '5001' });
  const ks = db.prepare("INSERT INTO keystore_objects (id, object_type, state, mount, key_name, key_version, key_algorithm, exportable, purpose, public_key_pem, certificate_pem, issuer_certificate_id, private_key_id, public_key_id, tags) VALUES (?, ?, 'active', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, '[]')");
  ks.run('v4-priv', 'private_key', 'pki-manager', x509, 1, 'RSA-2048', 'certificate', leafPub, null, null, null, 'v4-pub');
  ks.run('v4-pub', 'public_key', 'pki-manager', x509, 1, 'RSA-2048', 'certificate', leafPub, null, null, 'v4-priv', null);
  ks.run('v4-cert', 'certificate', null, null, null, null, null, null, leafPem, ca.kms_certificate_id, 'v4-priv', 'v4-pub');
  db.prepare("INSERT INTO certificates (id, ca_id, kms_certificate_id, kms_key_id, subject_dn, serial_number, certificate_type, not_before, not_after, status, certificate_pem) VALUES ('cert-v4', 'ca-1', 'v4-cert', 'v4-priv', 'CN=after.example', '5001', 'server', ?, ?, 'active', ?)").run(now, now + 86400, leafPem);
  // SSH: a new user CA in a new zone.
  const sshKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ssh = `v4-ssh-${randomUUID().slice(0, 8)}`;
  s.store.plant('pki-manager-ssh', ssh, 'ecdsa-p256', sshKey.privateKey);
  const line = sshLine(sshKey.publicKey);
  db.exec("INSERT INTO zones (id, name, display_name) VALUES ('zone-v4', 'lab', 'Lab')");
  db.prepare("INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status) VALUES ('sshca-v4', 'zone-v4', 'user', ?, ?, ?, ?, 'active')")
    .run(sshKeyRef('pki-manager-ssh', ssh), sshKeyRef('pki-manager-ssh', ssh), line.line, line.fp);
  // SCEP: a second integration whose RA key v4 provisioned in OpenBao.
  const raKey = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const ra = `scep-ra-${randomUUID()}`;
  s.store.plant('pki-manager-ra', ra, 'rsa-3072', raKey.privateKey);
  const raPem = makeCert({ cn: 'SCEP RA 2', key: raKey.privateKey, issuerKey: caPriv, issuerCert: caPem, serial: '5002' });
  db.exec("INSERT INTO integrations (id, name, ca_id, kind, token_hash, token_prefix) VALUES ('int-v4', 'scep-2', 'ca-1', 'scep', 'h2', 'pkimg_y')");
  db.prepare("INSERT INTO integration_ras (integration_id, ca_id, key_provider, key_id, key_version, certificate_id, certificate_pem) VALUES ('int-v4', 'ca-1', 'openbao', ?, 1, NULL, ?)").run(ra, raPem);
  // Ordinary v4 writes: a revocation, a CRL, an audit row.
  db.exec(`UPDATE certificates SET status = 'revoked', revocation_reason = 'superseded', revocation_date = ${now} WHERE id = 'cert-2'`);
  db.exec(`INSERT INTO crls (id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count) VALUES ('crl-v4', 'ca-1', 8, ${now}, ${now + 86400}, 'x', 2)`);
  db.exec(`INSERT INTO audit_log (id, timestamp, operation, entity_type, entity_id, status) VALUES ('audit-v4-1', ${now}, 'certificate.issue', 'certificate', 'cert-v4', 'success')`);
  // A deleted key: the migrated leaf key of cert-1/cert-2 is destroyed (Transit key deleted, rows marked).
  const leafKey = db.prepare('SELECT mount, key_name FROM keystore_objects WHERE id = ?').get(s.ids.leafKey) as { mount: string; key_name: string };
  s.store.keys.delete(`${leafKey.mount}/${leafKey.key_name}`);
  db.prepare(`UPDATE keystore_objects SET state = 'destroyed', destroyed_at = ${now} WHERE mount = ? AND key_name = ?`).run(leafKey.mount, leafKey.key_name);
  db.close();
  return { x509, ssh, ra };
}

async function restore(s: Migrated, store: SessionTransit) {
  const target = openReadOnly(s.targetPath), source = openReadOnly(s.sourcePath);
  try { return await verifyRestore({ target, store, profile: DEFAULT_PROFILE, source, manifest: s.manifest, approval: s.approval }); }
  finally { target.close(); source?.close(); }
}

test('restore: an older Raft snapshot next to a later database fails for every key beyond the manifest', async () => {
  const s = await migrated();
  assert.equal((await verifyCutover(s)).cutoverReady, true);
  const atCutover = snapshot(s.store); // backup pair #1 (Raft) ...
  const keys = postCutoverWrites(s); // ... then v4 accepts writes; the database backup is later
  const v = await restore(s, atCutover);
  assert.equal(v.ok, false);
  const names = failedNames(v.checks);
  assert.ok(names.includes('pair: keystore_objects:v4-priv key in OpenBao'), names.join(' | '));
  assert.ok(names.includes('pair: ssh_cas:sshca-v4 key in OpenBao'), names.join(' | '));
  assert.ok(names.includes('pair: integration_ras:int-v4 RA key in OpenBao'), names.join(' | '));
  assert.equal(names.length, 3, names.join(' | '));
  assert.match(v.checks.find(c => c.name === 'pair: keystore_objects:v4-priv key in OpenBao')!.detail!, new RegExp(`pki-manager/${keys.x509} is not in OpenBao.*not one pair`));
  // The deleted key is still in the older snapshot: reported, not failed.
  assert.ok(v.warnings.some(w => w.includes(`${s.ids.leafKey} is destroyed but`)), v.warnings.join('\n'));
  // The cutover form finds it too (it used to enumerate only the manifest keys).
  const cut = await verifyCutover(s, s.targetPath, atCutover);
  assert.equal(cut.cutoverReady, false);
  assert.ok(failedNames(cut.checks).includes('pair: ssh_cas:sshca-v4 key in OpenBao'));
});

test('restore: the matching pair passes with post-cutover writes and deleted keys; v3 audit history must stay', async () => {
  const s = await migrated();
  postCutoverWrites(s);
  const v = await restore(s, snapshot(s.store));
  assert.equal(v.ok, true, JSON.stringify(failed(v.checks)));
  assert.equal(v.mode, 'restore');
  assert.equal(v.cutoverReady, false, 'a later restore is not a cutover');
  assert.ok(v.counts.liveKeysVerified >= 6, JSON.stringify(v.counts));
  assert.deepEqual(v.warnings, []);
  // The strict cutover comparison would refuse these legitimate writes: restore mode is the check here.
  assert.equal((await verifyCutover(s)).cutoverReady, false);
  // A key whose public key differs (a snapshot of another cluster) fails.
  const other = snapshot(s.store);
  const ssh = (openReadOnly(s.targetPath).prepare("SELECT kms_key_id FROM ssh_cas WHERE id = 'sshca-v4'").get() as { kms_key_id: string }).kms_key_id.split(':')[2];
  other.plant('pki-manager-ssh', ssh, 'ecdsa-p256', generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey);
  assert.deepEqual(failedNames((await restore(s, other)).checks), ['pair: ssh_cas:sshca-v4 fingerprint']);
  // v3 history lost in the restored database fails.
  const w = new DatabaseSync(s.targetPath); w.exec("DELETE FROM audit_log WHERE id = 'audit-v3-1'"); w.close();
  assert.deepEqual(failedNames((await restore(s, snapshot(s.store))).checks), ['restore: audit_log history of the frozen source preserved']);
});

test('verify --restore needs no manifest; it still needs OpenBao', () => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'verify', '--restore', '--target-db', join(tempDir(), 'none.db')], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--openbao-addr/);
});

test('a fresh v4 target (nothing migrated) is a valid pair', async () => {
  const dir = tempDir('pkimig-fresh-');
  const p = join(dir, 'fresh.db');
  v3Database(p).close();
  migrateToV4(p);
  const target = openReadOnly(p);
  const v = await verifyRestore({ target, store: new FakeTransit(), profile: DEFAULT_PROFILE });
  target.close();
  assert.equal(v.ok, true, JSON.stringify(failed(v.checks)));
});

