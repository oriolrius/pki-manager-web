/**
 * Offline migration tests: synthetic v3.19.1 data (schema from the backend's own
 * migrations), fake Cosmian and Transit with real cryptography, and the target
 * copy brought to v4 with the real 0016/0017 migrations.
 * Run: cd scripts/migration && npm test   (Node >= 22.18)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildManifest } from '../lib/inventory.ts';
import { approvalTemplate, validateApproval, DEFAULT_MOUNTS } from '../lib/policy.ts';
import { backupTo, openReadOnly } from '../lib/sqlite.ts';
import { DEFAULT_PROFILE, sshKeyRef } from '../lib/target-db.ts';
import { apply, checkAlreadyTargetRa, liveTarget, preflight } from '../lib/transfer.ts';
import { verifyMigration } from '../lib/verify.ts';
import { backupPair, checkBackup } from '../lib/backup.ts';
import { rotationPlan } from '../lib/rotation.ts';
import type { Approval, Manifest } from '../lib/types.ts';
import { derToPem, documentDigest, MigrationError, sha256Hex, spkiFingerprint } from '../lib/util.ts';
import { exportCertificateBundle } from '../lib/certificates.ts';
import { FakeCosmian, FakeTransit, makeCert, migrateToV4, seedV3, tempDir, v3Database } from './helpers.ts';

const ADDR = 'https://openbao.test:8200';

async function setup(opts: { seed?: (db: DatabaseSync, kms: FakeCosmian, ids: Record<string, string>) => void; v4Source?: boolean } = {}) {
  const dir = tempDir();
  const sourcePath = join(dir, 'v3.db');
  const kms = new FakeCosmian();
  const db = v3Database(sourcePath);
  const ids = seedV3(db, kms);
  if (opts.v4Source) { db.close(); migrateToV4(sourcePath); }
  const w = opts.v4Source ? new DatabaseSync(sourcePath) : db;
  opts.seed?.(w, kms, ids);
  w.close();
  const targetPath = join(dir, 'v4.db');
  await backupTo(sourcePath, targetPath);
  if (!opts.v4Source) migrateToV4(targetPath);
  const source = openReadOnly(sourcePath);
  const manifest = await buildManifest({ sourcePath, db: source, kms });
  source.close();
  const store = new FakeTransit();
  return { dir, sourcePath, targetPath, kms, store, manifest, ids };
}

async function approve(manifest: Manifest, store: FakeTransit, edit?: (a: Approval) => void): Promise<Approval> {
  const a = approvalTemplate(manifest, await liveTarget(store, ADDR, manifest));
  a.approvedBy = 'rehearsal-admin';
  a.approvedAt = new Date().toISOString();
  a.allowSourceWrappingKeyRegistration = true;
  for (const k of Object.values(a.keys)) if (k.acknowledgeSensitive === false) k.acknowledgeSensitive = true;
  edit?.(a);
  return a;
}

const run = (s: Awaited<ReturnType<typeof setup>>, approval: Approval, extra: Partial<Parameters<typeof apply>[0]> = {}) => apply({
  manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, runDir: join(s.dir, 'run'),
  store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, confirm: documentDigest(s.manifest).slice(0, 16), actor: 'test', ...extra,
});

const key = (m: Manifest, id: string) => m.keys.find(k => k.sourceKeyId === id)!;

test('inventory classifies keys, resolves aliases and proposes dispositions', async () => {
  const s = await setup();
  const m = s.manifest;
  assert.equal(key(m, s.ids.caKey).class, 'x509-ca');
  assert.ok(m.problems.some(p => p.code === 'KEY_REF_IS_CERTIFICATE'), 'CA row holding the certificate id is resolved to its PrivateKeyLink');
  const leaf = key(m, s.ids.leafKey);
  assert.equal(leaf.class, 'x509-leaf');
  assert.equal(leaf.shared, true, 'renewal that reuses the key is one shared key');
  assert.equal(leaf.references.filter(r => r.role === 'x509-leaf-key').length, 2);
  const ra = key(m, s.ids.raKey);
  assert.equal(ra.class, 'scep-ra');
  assert.ok(ra.references.some(r => r.role === 'scep-ra-cert-alias' && r.rowId === 'ra-cert-1'), 'RA certificate row is an alias of the RA key');
  assert.ok(!m.problems.some(p => p.code === 'SHARED_ACROSS_CLASSES'), 'the RA alias is not a class conflict');
  assert.equal(ra.proposed, 'transfer');
  assert.equal(ra.target?.mount, 'pki-manager-ra');
  assert.match(ra.target!.name, /^scep-ra-[0-9a-f-]{36}$/);
  assert.equal(key(m, s.ids.caKey).target?.mount, 'pki-manager');
  assert.match(key(m, s.ids.caKey).target!.name, /^x509-ca-/);
  assert.match(leaf.target!.name, /^x509-leaf-/);
  const ssh = key(m, s.ids.sshKey);
  assert.equal(ssh.proposed, 'transfer');
  assert.equal(ssh.target?.exportable, false);
  const host = key(m, s.ids.sshHostKey);
  assert.deepEqual(host.allowed, ['rotate'], 'non-extractable SSH CA key: rotate only');
  assert.ok(host.reasons.some(r => r.includes('Extractable=false')));
  assert.equal(m.legacy.length, 1);
  assert.equal(m.certificates.find(c => c.rowId === 'cert-1')?.pemSource, 'kms');
  assert.equal(m.certificates.find(c => c.rowId === 'cert-ext')?.keyLink, 'none');
  assert.equal(m.certificates.find(c => c.rowId === 'ra-cert-1')?.keyLink, 'ra-alias');
  assert.equal(m.problems.filter(p => p.severity === 'blocker').length, 0, JSON.stringify(m.problems));
  // The inventory never asks for private key material.
  assert.ok(!s.kms.calls.some(c => c.startsWith('WrappedGet') || c.startsWith('RegisterWrapping')));
});

test('RA alias mismatch is a blocker', async () => {
  const s = await setup({ seed: (db, kms, ids) => {
    const k = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const caKey = kms.objects.get(ids.caKey)!.privateKey!;
    const caPem = Buffer.from(kms.objects.get([...kms.objects.values()].find(o => o.kind === 'Certificate' && o.links.PrivateKeyLink === ids.caKey)!.id)!.certDer!).toString('base64');
    const caCert = `-----BEGIN CERTIFICATE-----\n${caPem.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    const pem = makeCert({ cn: 'not-the-ra', key: k.privateKey, issuerKey: caKey, issuerCert: caCert, serial: '4001' });
    db.prepare("INSERT INTO certificates (id, ca_id, kms_certificate_id, kms_key_id, subject_dn, serial_number, certificate_type, not_before, not_after, status, certificate_pem) VALUES ('bad-alias', 'ca-1', ?, ?, 'CN=not-the-ra', '4001', 'server', 0, 1, 'active', ?)")
      .run(kms.addCertificate(pem), ids.raKey, pem);
  } });
  const blockers = s.manifest.problems.filter(p => p.severity === 'blocker').map(p => p.code);
  assert.ok(blockers.includes('RA_ALIAS_MISMATCH'), blockers.join(','));
  assert.ok(!key(s.manifest, s.ids.raKey).allowed.includes('transfer'), 'no transfer while the public views disagree');
  const forced = await approve(s.manifest, s.store, x => { x.keys[s.ids.raKey].action = 'transfer'; });
  const codes = validateApproval(s.manifest, forced).problems.map(p => p.code);
  assert.ok(codes.includes('APPROVAL_ACTION') && codes.includes('RA_ALIAS_MISMATCH'), codes.join(','));
});

test('one SSH CA key in two zones is a blocker (v4 binds one key to one CA)', async () => {
  const s = await setup({ seed: (db, _kms, ids) => {
    const row = db.prepare("SELECT kms_public_key_id, openssh_public_key, fingerprint_sha256 FROM ssh_cas WHERE id = 'sshca-a'").get() as Record<string, string>;
    db.exec("INSERT INTO zones (id, name, display_name) VALUES ('zone-c', 'lab', 'Lab')");
    db.prepare("INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status) VALUES ('sshca-c', 'zone-c', 'user', ?, ?, ?, ?, 'active')")
      .run(ids.sshKey, row.kms_public_key_id, row.openssh_public_key, row.fingerprint_sha256);
  } });
  assert.ok(s.manifest.problems.some(p => p.code === 'SHARED_SSH_CA_KEY' && p.severity === 'blocker'));
});

test('approval: stale, unsigned, unacknowledged Sensitive key, export escalation, wrong wrapping key', async () => {
  const s = await setup();
  const live = await liveTarget(s.store, ADDR, s.manifest);
  const codes = (a: Approval) => validateApproval(s.manifest, a, live, { online: true }).problems.map(p => p.code);
  assert.equal(validateApproval(s.manifest, await approve(s.manifest, s.store, a => { a.keys[s.ids.sshHostKey].action = 'rotate'; }), live, { online: true }).ok, true);
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.manifestSha256 = '0'.repeat(64); })).includes('APPROVAL_STALE'));
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.approvedBy = ''; })).includes('APPROVAL_UNSIGNED'));
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey].acknowledgeSensitive = false; })).includes('APPROVAL_SENSITIVE'));
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.keys[s.ids.sshKey].exportable = true; })).includes('APPROVAL_EXPORT_ESCALATION'));
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.keys[s.ids.sshHostKey].action = 'transfer'; })).includes('APPROVAL_ACTION'), 'cannot transfer a non-extractable key');
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.allowSourceWrappingKeyRegistration = false; })).includes('APPROVAL_NO_SOURCE_WRITE'));
  assert.ok(codes(await approve(s.manifest, s.store, a => { a.target.wrappingKeys['pki-manager'] = 'f'.repeat(64); })).includes('APPROVAL_WRAPPING_KEY'));
});

test('apply writes the v4 target; a second run is a verified no-op', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  const first = await run(s, approval);
  assert.equal(first.imported, 4, 'CA, leaf, SSH user CA, RA');
  assert.equal(first.skipped.rotate, 1, 'non-extractable SSH host CA left for rotation');
  assert.ok(first.db.keystoreRows >= 4 + 5, 'key rows + certificate rows');
  assert.equal(first.db.pemBackfilled, 1, 'cert-1 PEM came from the KMS');
  // Every wrapping key registered in Cosmian is removed at the end.
  assert.equal(s.kms.wrappingKeys.size, 0);
  // Only wrapped exports, never a clear key.
  assert.ok(s.kms.calls.filter(c => c.startsWith('WrappedGet')).length === 4);

  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  const ks = (id: string) => t.prepare('SELECT * FROM keystore_objects WHERE id = ?').get(id) as Record<string, unknown>;
  const ca = t.prepare("SELECT kms_key_id, kms_certificate_id FROM certificate_authorities WHERE id = 'ca-1'").get() as Record<string, string>;
  assert.equal(ca.kms_key_id, s.ids.caKey, 'the certificate-id fallback is repaired to the private key id');
  const caCert = ks(ca.kms_certificate_id);
  assert.equal(caCert.object_type, 'certificate');
  assert.equal(caCert.private_key_id, s.ids.caKey, 'certificate links to the canonical private key');
  assert.equal(caCert.issuer_certificate_id, ca.kms_certificate_id, 'self-signed root');
  const caKey = ks(s.ids.caKey);
  assert.equal(caKey.mount, 'pki-manager');
  assert.equal(caKey.purpose, 'ca');
  assert.equal(caKey.exportable, 1, 'v3 CA key was exportable: export capability preserved (still gated by ALLOW_CA_KEY_EXPORT)');
  assert.equal(ks(String(caKey.public_key_id)).object_type, 'public_key');
  const leafKey = ks(s.ids.leafKey);
  assert.equal(leafKey.purpose, 'certificate');
  const cert1 = t.prepare("SELECT kms_certificate_id, kms_key_id, certificate_pem FROM certificates WHERE id = 'cert-1'").get() as Record<string, string>;
  assert.equal(cert1.kms_key_id, s.ids.leafKey);
  assert.ok(cert1.certificate_pem, 'PEM backfilled');
  assert.equal(ks(cert1.kms_certificate_id).issuer_certificate_id, ca.kms_certificate_id);
  const ext = t.prepare("SELECT kms_certificate_id FROM certificates WHERE id = 'cert-ext'").get() as Record<string, string>;
  assert.equal(ks(ext.kms_certificate_id).private_key_id, null, 'external CSR certificate has no key');
  const sshA = t.prepare("SELECT kms_key_id, kms_public_key_id FROM ssh_cas WHERE id = 'sshca-a'").get() as Record<string, string>;
  const sshSpec = key(s.manifest, s.ids.sshKey).target!;
  assert.equal(sshA.kms_key_id, sshKeyRef('pki-manager-ssh', sshSpec.name, 1));
  assert.equal(sshA.kms_public_key_id, sshA.kms_key_id);
  const sshB = t.prepare("SELECT kms_key_id FROM ssh_cas WHERE id = 'sshca-b'").get() as Record<string, string>;
  assert.equal(sshB.kms_key_id, s.ids.sshHostKey, 'a rotate decision changes nothing');
  const ra = t.prepare("SELECT key_provider, key_id, key_version, public_key_id FROM integration_ras WHERE integration_id = 'int-1'").get() as Record<string, unknown>;
  assert.deepEqual({ ...ra }, { key_provider: 'openbao', key_id: key(s.manifest, s.ids.raKey).target!.name, key_version: 1, public_key_id: null });
  const raCert = t.prepare("SELECT kms_key_id, kms_certificate_id FROM certificates WHERE id = 'ra-cert-1'").get() as Record<string, string | null>;
  assert.equal(raCert.kms_key_id, null, 'RA alias cleared, as v4 writes RA certificate rows');
  assert.equal(ks(String(raCert.kms_certificate_id)).private_key_id, null);
  const audits = Number((t.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE operation LIKE 'migration.%'").get() as { n: number }).n);
  assert.equal(audits, first.db.auditRows);
  t.close();

  // Target keys carry the source policy: SSH and RA non-exportable, RA opted in.
  const raT = key(s.manifest, s.ids.raKey).target!;
  assert.equal(s.store.keys.get(`${raT.mount}/${raT.name}`)?.exportable, false);
  assert.equal(s.store.keys.get(`${raT.mount}/${raT.name}`)?.allowPkcs1v15SessionKey, true);
  assert.equal(s.store.keys.get(`${sshSpec.mount}/${sshSpec.name}`)?.exportable, false);

  const second = await run(s, approval);
  assert.equal(second.noOp, true);
  assert.equal(second.imported, 0);
  assert.equal(second.alreadyVerified, 4);
  assert.equal(second.db.auditRows, 0);

  const target = openReadOnly(s.targetPath);
  const source = openReadOnly(s.sourcePath);
  const v = await verifyMigration({ manifest: s.manifest, approval, target, store: s.store, profile: DEFAULT_PROFILE, source });
  target.close(); source.close();
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter(c => !c.ok)));
  assert.equal(v.cutoverReady, false, 'the SSH host CA still needs its rotation');
  assert.equal(v.cosmianRequired, true);
  assert.ok(rotationPlan(s.manifest, approval).includes('ssh-ca'));
});

test('cutover gate passes when every key is resolved (rotated CA removed before the final inventory)', async () => {
  const s = await setup({ seed: db => { db.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'"); } });
  const approval = await approve(s.manifest, s.store);
  await run(s, approval);
  const target = openReadOnly(s.targetPath);
  const source = openReadOnly(s.sourcePath);
  const v = await verifyMigration({ manifest: s.manifest, approval, target, store: s.store, profile: DEFAULT_PROFILE, source, raSessionCheck: true });
  target.close(); source.close();
  assert.equal(v.cutoverReady, true, JSON.stringify(v.checks.filter(c => !c.ok)));
  assert.equal(v.cosmianRequired, false);
});

test('crash after an import: the rerun adopts the key and ends in the same state', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  class Crash extends Error {}
  await assert.rejects(run(s, approval, { fault: p => { if (p === 'after-import:2') throw new Crash('simulated crash'); } }), Crash);
  assert.equal(s.store.imports, 2);
  const t1 = new DatabaseSync(s.targetPath, { readOnly: true });
  assert.equal(Number((t1.prepare('SELECT COUNT(*) AS n FROM keystore_objects').get() as { n: number }).n), 0, 'no DB change before every key is verified');
  t1.close();
  const resumed = await run(s, approval);
  assert.equal(resumed.adopted, 1, 'the key imported just before the crash is adopted, not imported twice');
  assert.equal(resumed.imported + resumed.adopted + resumed.alreadyVerified, 4);
  assert.equal(s.store.imports, 4);
  assert.equal(s.kms.wrappingKeys.size, 0, 'wrapping keys of the crashed run are removed too');
});

test('a failure inside the DB transaction rolls back everything; the retry succeeds', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  await assert.rejects(run(s, approval, { fault: p => { if (p === 'db-mid-transaction') throw new MigrationError('FAULT', 'simulated'); } }), /simulated/);
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  assert.equal(Number((t.prepare('SELECT COUNT(*) AS n FROM keystore_objects').get() as { n: number }).n), 0);
  assert.equal((t.prepare("SELECT key_provider FROM integration_ras").get() as { key_provider: string }).key_provider, 'cosmian');
  t.close();
  const r = await run(s, approval);
  assert.ok(r.db.keystoreRows > 0);
});

test('an existing different key at the target name stops the run; nothing is overwritten', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  const spec = key(s.manifest, s.ids.leafKey).target!;
  s.store.plant(spec.mount, spec.name, spec.type, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);
  await assert.rejects(run(s, approval), (e: MigrationError) => e.code === 'TARGET_CONFLICT');
  assert.equal(s.store.keys.get(`${spec.mount}/${spec.name}`)?.imported, false, 'the planted key is untouched');
});

test('a target row with another value is a conflict (compare-and-set)', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  const t = new DatabaseSync(s.targetPath);
  t.exec("UPDATE integration_ras SET key_provider = 'openbao', key_id = 'scep-ra-00000000-0000-4000-8000-000000000000', key_version = 1");
  t.close();
  await assert.rejects(run(s, approval), (e: MigrationError) => e.code === 'TARGET_ROW_CONFLICT');
});

test('the source policy is re-checked at transfer time', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  s.kms.objects.get(s.ids.leafKey)!.extractable = false;
  await assert.rejects(run(s, approval), (e: MigrationError) => e.code === 'SOURCE_POLICY');
});

test('preflight: v3 schema target, changed source, root token', async () => {
  const s = await setup();
  const approval = await approve(s.manifest, s.store);
  const v3copy = join(s.dir, 'still-v3.db');
  await backupTo(s.sourcePath, v3copy);
  const p1 = await preflight({ manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: v3copy, store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, online: true });
  assert.ok(p1.checks.some(c => !c.ok && c.name.includes('v4 schema')));
  s.store.policies = ['root'];
  const p2 = await preflight({ manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, online: true });
  assert.ok(p2.checks.some(c => !c.ok && c.name.includes('root')));
  s.store.policies = ['pki-migration'];
  const w = new DatabaseSync(s.sourcePath); w.exec("UPDATE certificates SET status = 'revoked' WHERE id = 'cert-2'"); w.close();
  const p3 = await preflight({ manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, online: true });
  assert.ok(p3.checks.some(c => !c.ok && c.name.includes('unchanged since inventory')));
  await assert.rejects(run(s, approval), (e: MigrationError) => e.code === 'PREFLIGHT');
});

test('caKeyExport=deny imports CA keys non-exportable; drop-key keeps the certificates', async () => {
  // drop-key needs every certificate of the key revoked or expired.
  const s = await setup({ seed: db => { db.exec("UPDATE certificates SET status = 'revoked' WHERE id = 'cert-2'"); } });
  const approval = await approve(s.manifest, s.store, a => { a.caKeyExport = 'deny'; a.keys[s.ids.leafKey].action = 'drop-key'; });
  const r = await run(s, approval);
  assert.equal(r.imported, 3);
  const caSpec = key(s.manifest, s.ids.caKey).target!;
  assert.equal(s.store.keys.get(`${caSpec.mount}/${caSpec.name}`)?.exportable, false);
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  assert.equal((t.prepare('SELECT exportable FROM keystore_objects WHERE id = ?').get(s.ids.caKey) as { exportable: number }).exportable, 0);
  assert.equal((t.prepare('SELECT state FROM keystore_objects WHERE id = ?').get(s.ids.leafKey) as { state: string }).state, 'destroyed');
  assert.equal(Number((t.prepare("SELECT COUNT(*) AS n FROM certificates WHERE id IN ('cert-1','cert-2')").get() as { n: number }).n), 2);
  t.close();
});

test('offline backup pair: digests, integrity, tamper detection', async () => {
  const s = await setup();
  const out = join(s.dir, 'backup-1');
  const rec = await backupPair({ dbPath: s.targetPath, outDir: out, label: 'test', store: s.store, quiesced: true });
  assert.ok(rec.files['pki.db'] && rec.files['openbao.snap']);
  assert.equal(checkBackup(out).ok, true);
  writeFileSync(join(out, 'openbao.snap'), 'tampered');
  assert.equal(checkBackup(out).ok, false);
  await assert.rejects(backupPair({ dbPath: s.targetPath, outDir: out, label: 'again' }), /refusing/);
  assert.ok(existsSync(join(out, 'backup.json')) && JSON.parse(readFileSync(join(out, 'backup.json'), 'utf8')).format);
});

test('a refused snapshot leaves no half backup', async () => {
  const s = await setup();
  s.store.raftSnapshot = async () => { throw new MigrationError('OPENBAO_ERROR', 'HTTP 403'); };
  const out = join(s.dir, 'backup-denied');
  await assert.rejects(backupPair({ dbPath: s.targetPath, outDir: out, label: 'denied', store: s.store, quiesced: true }), /403/);
  assert.equal(existsSync(out), false);
});

const verifyNow = async (s: Awaited<ReturnType<typeof setup>>, approval: Approval) => {
  const target = openReadOnly(s.targetPath);
  const source = openReadOnly(s.sourcePath);
  // The cutover gate needs the RA session-key operation for every RA key (the fake implements it).
  try { return await verifyMigration({ manifest: s.manifest, approval, target, store: s.store, profile: DEFAULT_PROFILE, source, raSessionCheck: true }); }
  finally { target.close(); source.close(); }
};
const failedChecks = (v: { checks: { ok: boolean; name: string; detail?: string }[] }) => JSON.stringify(v.checks.filter(c => !c.ok));

test('no drop-key for keys in use: an active leaf and a retired (trusted) SSH CA', async () => {
  const s = await setup({ seed: (db, kms, ids) => {
    kms.objects.get(ids.leafKey)!.extractable = false;
    db.exec("UPDATE ssh_cas SET status = 'retired' WHERE id = 'sshca-b'");
  } });
  assert.deepEqual(key(s.manifest, s.ids.leafKey).allowed, ['rotate'], 'cert-2 is active: renew with a new key');
  assert.deepEqual(key(s.manifest, s.ids.sshHostKey).allowed, ['rotate'], 'a retired SSH CA still signs its KRL');
});

test('a revoked SSH CA with a non-extractable key: drop-key, verify and cutover', async () => {
  const s = await setup({ seed: db => { db.exec("UPDATE ssh_cas SET status = 'retired', revocation_date = unixepoch() WHERE id = 'sshca-b'"); } });
  const host = key(s.manifest, s.ids.sshHostKey);
  assert.deepEqual(host.allowed, ['rotate', 'drop-key']);
  const approval = await approve(s.manifest, s.store, a => { a.keys[s.ids.sshHostKey].action = 'drop-key'; });
  const first = await run(s, approval);
  assert.equal(first.imported, 4);
  const v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  assert.equal(Number((t.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE operation = 'migration.key.drop' AND entity_id = 'sshca-b'").get() as { n: number }).n), 1);
  t.close();
  const second = await run(s, approval);
  assert.equal(second.noOp, true);
  assert.equal(second.db.auditRows, 0, 'the drop decision is recorded once');
});

test('an SSH CA key shared by a retired row and an active row maps both rows to one Transit key', async () => {
  const s = await setup({ seed: (db, _kms, ids) => {
    const row = db.prepare("SELECT kms_public_key_id, openssh_public_key, fingerprint_sha256 FROM ssh_cas WHERE id = 'sshca-a'").get() as Record<string, string>;
    db.exec("INSERT INTO zones (id, name, display_name) VALUES ('zone-c', 'lab', 'Lab'); DELETE FROM ssh_cas WHERE id = 'sshca-b'");
    db.prepare("INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status) VALUES ('sshca-c', 'zone-c', 'user', ?, ?, ?, ?, 'retired')")
      .run(ids.sshKey, row.kms_public_key_id, row.openssh_public_key, row.fingerprint_sha256);
  } });
  assert.ok(s.manifest.problems.some(p => p.code === 'SHARED_SSH_CA_KEY_RETIRED' && p.severity === 'warning'));
  assert.ok(!s.manifest.problems.some(p => p.code === 'SHARED_SSH_CA_KEY'));
  const approval = await approve(s.manifest, s.store);
  await run(s, approval);
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  const refs = t.prepare("SELECT kms_key_id FROM ssh_cas WHERE id IN ('sshca-a', 'sshca-c')").all() as { kms_key_id: string }[];
  t.close();
  assert.equal(new Set(refs.map(r => r.kms_key_id)).size, 1);
  const v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
});

/** The CA key and certificate of the seed (to make RA certificates as v3 and v4 do). */
function seedCa(kms: FakeCosmian, ids: Record<string, string>, db: DatabaseSync) {
  const caCertId = String((db.prepare("SELECT kms_certificate_id AS c FROM certificate_authorities WHERE id = 'ca-1'").get() as { c: string }).c);
  return { caKey: kms.objects.get(ids.caKey)!.privateKey!, caPem: derToPem(kms.objects.get(caCertId)!.certDer!, 'CERTIFICATE') };
}

/** v3.19.1 after one RA renewal: an earlier, unexpired certificate of the SAME RA key in the overlap list. */
function earlierSameKeyRaCert(db: DatabaseSync, kms: FakeCosmian, ids: Record<string, string>) {
  const { caKey, caPem } = seedCa(kms, ids, db);
  const now = Math.floor(Date.now() / 1000);
  const pem = makeCert({ cn: 'SCEP Registration Authority', key: kms.objects.get(ids.raKey)!.privateKey!, issuerKey: caKey, issuerCert: caPem, serial: '3000' });
  db.prepare("INSERT INTO certificates (id, ca_id, kms_certificate_id, kms_key_id, subject_dn, serial_number, certificate_type, not_before, not_after, status, certificate_pem) VALUES ('ra-cert-0', 'ca-1', ?, ?, 'CN=SCEP Registration Authority', '3000', 'client', ?, ?, 'active', ?)")
    .run(kms.addCertificate(pem, ids.raKey), ids.raKey, now - 3600, now + 86400, pem);
  db.prepare("UPDATE integration_ras SET previous = ? WHERE integration_id = 'int-1'").run(JSON.stringify([{ id: 'ra-cert-0', certificatePem: pem }]));
  return pem;
}

/** What v4 `ra/provision` (and later `ra/renew`, same key) write: a NEW key, its certificate, same-key overlap only. */
function v4Provisions(targetPath: string, kms: FakeCosmian, ids: Record<string, string>, renewals = 0) {
  const t = new DatabaseSync(targetPath);
  const { caKey, caPem } = seedCa(kms, ids, t);
  const newKey = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const certs = Array.from({ length: renewals + 1 }, (_, i) => makeCert({ cn: 'SCEP Registration Authority', key: newKey.privateKey, issuerKey: caKey, issuerCert: caPem, serial: `40${i}0` }));
  const current = certs[certs.length - 1];
  const previous = certs.slice(0, -1).reverse().map((pem, i) => ({ id: `v4-ra-${i}`, certificatePem: pem }));
  t.prepare("UPDATE integration_ras SET key_id = 'scep-ra-00000000-0000-4000-8000-00000000c0de', key_version = 1, certificate_id = 'v4-ra-cur', certificate_pem = ?, previous = ? WHERE integration_id = 'int-1'").run(current, JSON.stringify(previous));
  t.close();
  return { current, previous };
}

const raRow = (path: string) => {
  const t = new DatabaseSync(path, { readOnly: true });
  try { return t.prepare("SELECT key_provider, key_id, public_key_id, key_version, certificate_id, certificate_pem, previous FROM integration_ras WHERE integration_id = 'int-1'").get() as Record<string, string | null>; }
  finally { t.close(); }
};

test('a non-extractable RA key: reprovision (explicit), binding reset, no old-key certificate left in the overlap list', async () => {
  let earlier = '';
  const s = await setup({ seed: (db, kms, ids) => { kms.objects.get(ids.raKey)!.extractable = false; earlier = earlierSameKeyRaCert(db, kms, ids); db.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'"); } });
  const ra = key(s.manifest, s.ids.raKey);
  assert.equal(ra.proposed, 'reprovision');
  assert.ok(!ra.allowed.includes('transfer'));
  const unacked = await approve(s.manifest, s.store);
  assert.ok(validateApproval(s.manifest, unacked).problems.some(p => p.code === 'APPROVAL_NEW_KEY'), 'a new RA key needs acknowledgeNewKey');
  const approval = await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey].acknowledgeNewKey = true; });
  // An interrupted run (failure inside the DB transaction) leaves the binding as it was.
  await assert.rejects(run(s, approval, { fault: p => { if (p === 'db-mid-transaction') throw new MigrationError('FAULT', 'simulated'); } }));
  assert.equal(raRow(s.targetPath).key_provider, 'cosmian', 'rolled back');
  const r = await run(s, approval);
  assert.equal(r.imported + r.adopted + r.alreadyVerified, 3, 'the RA key is not transferred (the interrupted run imported the others)');
  assert.ok(!s.kms.calls.includes(`WrappedGet:${s.ids.raKey}`), 'no export attempt of the non-extractable key');
  const b = raRow(s.targetPath);
  // The state v4 `ra/provision` turns into a new OpenBao key (unassigned, not legacy), with an
  // EMPTY overlap list: the gateway refuses an overlap certificate of another key.
  assert.deepEqual({ p: b.key_provider, k: b.key_id, pub: b.public_key_id, v: b.key_version, c: b.certificate_id, pem: b.certificate_pem, prev: JSON.parse(String(b.previous)) },
    { p: 'openbao', k: null, pub: null, v: null, c: null, pem: null, prev: [] });
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  for (const id of ['ra-cert-0', 'ra-cert-1']) {
    const c = t.prepare('SELECT kms_key_id, status, certificate_pem FROM certificates WHERE id = ?').get(id) as { kms_key_id: string | null; status: string; certificate_pem: string };
    assert.equal(c.kms_key_id, null, `${id}: RA alias cleared`);
    assert.equal(c.status, 'active', `${id}: history kept`);
  }
  const audit = t.prepare("SELECT details FROM audit_log WHERE operation = 'migration.ra.reprovision' AND entity_id = 'int-1'").all() as { details: string }[];
  t.close();
  assert.equal(audit.length, 1);
  const retired = (JSON.parse(audit[0].details) as { retiredRaCertificates: { id: string; slot: string; sha256: string; certificatePem: string }[] }).retiredRaCertificates;
  assert.deepEqual(retired.map(c => [c.id, c.slot]), [['ra-cert-1', 'current'], ['ra-cert-0', 'previous']], 'both old-key certificates are recorded, with their PEM');
  assert.equal(retired[1].sha256, sha256Hex(new X509Certificate(earlier).raw));
  const v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
  assert.ok(v.checks.some(c => c.ok && c.name === 'integration_ras:int-1 retired RA certificates recorded in the audit log' && /frozen source/.test(c.detail ?? '')));
  const again = await run(s, approval);
  assert.equal(again.noOp, true);
  assert.equal(again.db.auditRows, 0, 'a repeated run writes no second audit row');
  const plan = rotationPlan(s.manifest, approval);
  assert.ok(plan.includes('scep-server provision') && plan.includes('GetCACert') && /overlap list \(`previous`\) is empty/.test(plan), plan);
  assert.ok(!plan.includes('SCEP_RA_KEY_PROVIDER'), 'no setting that v3.19.1 and v4 do not have');
});

test('after reprovision: v4 provisioning and same-key renewals verify; an old-key certificate in the overlap list does not', async () => {
  const s = await setup({ seed: (db, kms, ids) => { kms.objects.get(ids.raKey)!.extractable = false; earlierSameKeyRaCert(db, kms, ids); db.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'"); } });
  const approval = await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey].acknowledgeNewKey = true; });
  await run(s, approval);
  const named = (v: Awaited<ReturnType<typeof verifyNow>>, suffix: string) => v.checks.find(c => c.name === `integration_ras:int-1 ${suffix}`);
  // v4 provisioned a new key and renewed twice (same key): the overlap list holds two certificates of that key.
  v4Provisions(s.targetPath, s.kms, s.ids, 2);
  let v = await verifyNow(s, approval);
  assert.equal(named(v, 'reprovisioned (new RA key; the old key\'s RA certificate is not active)')?.ok, true, failedChecks(v));
  assert.equal(named(v, 'overlap list holds no certificate of the replaced RA key')?.ok, true, failedChecks(v));
  assert.match(named(v, 'overlap list holds no certificate of the replaced RA key')!.detail!, /2 same-key entries/);
  // The representation the earlier tool wrote: the old RA certificate in the overlap list.
  const t = new DatabaseSync(s.targetPath);
  const src = new DatabaseSync(s.sourcePath, { readOnly: true });
  const old = src.prepare("SELECT certificate_id AS id, certificate_pem AS pem FROM integration_ras WHERE integration_id = 'int-1'").get() as { id: string; pem: string };
  src.close();
  const cur = JSON.parse(String(raRow(s.targetPath).previous)) as unknown[];
  t.prepare("UPDATE integration_ras SET previous = ? WHERE integration_id = 'int-1'").run(JSON.stringify([...cur, { id: old.id, certificatePem: old.pem }]));
  t.close();
  v = await verifyNow(s, approval);
  assert.equal(named(v, 'overlap list holds no certificate of the replaced RA key')?.ok, false);
  const pair = v.checks.find(c => c.name === 'pair: integration_ras:int-1 overlap list');
  assert.equal(pair?.ok, false, 'the pair check (restore mode too) refuses what the gateway refuses');
  assert.match(pair!.detail!, /gateway would refuse to start/);
});

test('an RA binding with a key and no certificate (unfinished v3 provisioning) cannot be transferred', async () => {
  const s = await setup({ seed: db => { db.exec("UPDATE integration_ras SET certificate_id = NULL, certificate_pem = NULL WHERE integration_id = 'int-1'; DELETE FROM ssh_cas WHERE id = 'sshca-b'"); } });
  const ra = key(s.manifest, s.ids.raKey);
  assert.equal(ra.proposed, 'reprovision', ra.reasons.join('; '));
  assert.ok(!ra.allowed.includes('transfer'));
  assert.ok(ra.reasons.some(x => /cannot adopt an imported one/.test(x)), ra.reasons.join('; '));
  const forced = await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey] = { action: 'transfer', spkiSha256: ra.spkiSha256 }; });
  assert.ok(validateApproval(s.manifest, forced).problems.some(p => p.code === 'APPROVAL_ACTION' && p.subject === s.ids.raKey));
  const approval = await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey].acknowledgeNewKey = true; });
  await run(s, approval);
  const b = raRow(s.targetPath);
  assert.deepEqual([b.key_provider, b.key_id, b.certificate_pem, JSON.parse(String(b.previous))], ['openbao', null, null, []]);
  const v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
});

test('an RA key shared by two bindings: reprovision checks each binding with its own certificate', async () => {
  const s = await setup({ seed: (db, kms, ids) => {
    kms.objects.get(ids.raKey)!.extractable = false;
    const { caKey, caPem } = seedCa(kms, ids, db);
    const pem = makeCert({ cn: 'SCEP Registration Authority', key: kms.objects.get(ids.raKey)!.privateKey!, issuerKey: caKey, issuerCert: caPem, serial: '3002' });
    const raPub = String((db.prepare("SELECT public_key_id AS p FROM integration_ras WHERE integration_id = 'int-1'").get() as { p: string }).p);
    db.prepare("INSERT INTO integrations (id, name, ca_id, kind, token_hash, token_prefix) VALUES ('int-2', 'scep-2', 'ca-1', 'scep', 'h2', 'pkimg_y')").run();
    db.prepare("INSERT INTO integration_ras (integration_id, ca_id, key_id, public_key_id, certificate_id, certificate_pem) VALUES ('int-2', 'ca-1', ?, ?, NULL, ?)").run(ids.raKey, raPub, pem);
    db.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'");
  } });
  const approval = await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey].acknowledgeNewKey = true; });
  await run(s, approval);
  let v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
  for (const id of ['int-1', 'int-2']) assert.ok(v.checks.some(c => c.ok && c.name === `integration_ras:${id} retired RA certificates recorded in the audit log`), id);
  // The second binding gets an overlap entry of the old key: only that binding fails.
  const src = new DatabaseSync(s.sourcePath, { readOnly: true });
  const pem2 = String((src.prepare("SELECT certificate_pem AS p FROM integration_ras WHERE integration_id = 'int-2'").get() as { p: string }).p);
  src.close();
  const t = new DatabaseSync(s.targetPath);
  t.prepare("UPDATE integration_ras SET previous = ? WHERE integration_id = 'int-2'").run(JSON.stringify([{ id: null, certificatePem: pem2 }]));
  t.close();
  v = await verifyNow(s, approval);
  assert.equal(v.checks.find(c => c.name === 'integration_ras:int-1 overlap list holds no certificate of the replaced RA key')?.ok, true);
  assert.equal(v.checks.find(c => c.name === 'integration_ras:int-2 overlap list holds no certificate of the replaced RA key')?.ok, false);
});

test('an OpenBao RA key shared by two bindings is not verified by its first binding: rotate', async () => {
  const name = 'scep-ra-00000000-0000-4000-8000-0000000000bb';
  const s = await setup({ v4Source: true, seed: db => {
    db.exec(`UPDATE integration_ras SET key_provider = 'openbao', key_id = '${name}', public_key_id = NULL, key_version = 1; UPDATE certificates SET kms_key_id = NULL WHERE id = 'ra-cert-1'; DELETE FROM ssh_cas WHERE id = 'sshca-b'`);
    db.prepare("INSERT INTO integrations (id, name, ca_id, kind, token_hash, token_prefix) VALUES ('int-2', 'scep-2', 'ca-1', 'scep', 'h2', 'pkimg_y')").run();
    db.prepare(`INSERT INTO integration_ras (integration_id, ca_id, key_provider, key_id, public_key_id, key_version, certificate_id, certificate_pem) VALUES ('int-2', 'ca-1', 'openbao', '${name}', NULL, 1, NULL, NULL)`).run();
  } });
  const k = s.manifest.keys.find(x => x.sourceKeyId === `openbao:${name}`)!;
  assert.deepEqual([k.proposed, k.allowed], ['rotate', ['rotate']]);
  assert.ok(s.manifest.problems.some(p => p.code === 'SHARED_RA_KEY' && p.severity === 'blocker'));
  const forced = await approve(s.manifest, s.store, a => { a.keys[k.sourceKeyId] = { action: 'already-target', spkiSha256: k.spkiSha256 }; });
  assert.ok(validateApproval(s.manifest, forced).problems.some(p => p.code === 'APPROVAL_ACTION'));
  // Even with a manifest that allowed it, the check refuses a shared key instead of checking its first row.
  const r = await checkAlreadyTargetRa({ store: s.store, mount: 'pki-manager-ra', key: { ...k, allowed: ['already-target'] }, approval: forced.keys[k.sourceKeyId], manifest: s.manifest, binding: () => undefined });
  assert.equal(r.checks.find(c => c.name.endsWith('backs exactly one RA binding'))?.ok, false);
  assert.equal(r.checks.length, 1, 'nothing else is checked');
});

test('the RA key of a revoked integration can be dropped; its certificates stay', async () => {
  const s = await setup({ seed: (db, kms, ids) => {
    kms.objects.get(ids.raKey)!.extractable = false;
    db.exec("UPDATE integrations SET revoked_at = unixepoch() WHERE id = 'int-1'; DELETE FROM ssh_cas WHERE id = 'sshca-b'");
  } });
  assert.ok(key(s.manifest, s.ids.raKey).allowed.includes('drop-key'));
  const approval = await approve(s.manifest, s.store, a => { a.keys[s.ids.raKey] = { action: 'drop-key', spkiSha256: key(s.manifest, s.ids.raKey).spkiSha256 }; });
  await run(s, approval);
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  const b = t.prepare("SELECT key_id, public_key_id, certificate_pem FROM integration_ras WHERE integration_id = 'int-1'").get() as Record<string, string | null>;
  t.close();
  assert.equal(b.key_id, null); assert.equal(b.public_key_id, null); assert.ok(b.certificate_pem);
  const v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
});

test('a CA row that holds its certificate id is repaired to the private key it provably certifies', async () => {
  const s = await setup({ seed: db => { db.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'"); } });
  const approval = await approve(s.manifest, s.store);
  await run(s, approval);
  const t = new DatabaseSync(s.targetPath, { readOnly: true });
  const ca = t.prepare("SELECT kms_key_id, kms_certificate_id FROM certificate_authorities WHERE id = 'ca-1'").get() as Record<string, string>;
  const row = t.prepare('SELECT object_type, exportable FROM keystore_objects WHERE id = ?').get(ca.kms_key_id) as Record<string, unknown>;
  const audit = Number((t.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE operation = 'migration.key.link_repair' AND entity_id = 'ca-1'").get() as { n: number }).n);
  t.close();
  assert.equal(ca.kms_key_id, s.ids.caKey, 'kms_key_id now names the private key (CA keystore export and CRL signing use it)');
  assert.notEqual(ca.kms_key_id, ca.kms_certificate_id);
  assert.equal(row.object_type, 'private_key');
  assert.equal(row.exportable, 1);
  assert.equal(audit, 1);
  const v = await verifyNow(s, approval);
  assert.equal(v.cutoverReady, true, failedChecks(v));
});

test('an already-migrated RA binding whose OpenBao key differs from its certificate fails verify', async () => {
  const name = 'scep-ra-00000000-0000-4000-8000-0000000000aa';
  // A source with the 0016 columns with an OpenBao RA binding (v3.19 opt-in provider).
  const s = await setup({ v4Source: true, seed: db => { db.exec(`UPDATE integration_ras SET key_provider = 'openbao', key_id = '${name}', public_key_id = NULL, key_version = 1; UPDATE certificates SET kms_key_id = NULL WHERE id = 'ra-cert-1'; DELETE FROM ssh_cas WHERE id = 'sshca-b'`); } });
  s.store.plant('pki-manager-ra', name, 'rsa-3072', generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey);
  const approval = await approve(s.manifest, s.store);
  // apply checks an already-target RA key before it writes the database.
  await assert.rejects(run(s, approval), (e: MigrationError) => e.code === 'TARGET_CONFLICT' && /differs from the RA certificate/.test(e.message));
  const v = await verifyNow(s, approval);
  const c = v.checks.find(x => x.name.startsWith('RA key already in OpenBao') && x.name.endsWith('matches its RA certificate'));
  assert.equal(c?.ok, false);
  assert.equal(v.cutoverReady, false);
});

test('default mounts follow the backend', () => {
  assert.deepEqual(DEFAULT_MOUNTS, { x509: 'pki-manager', ssh: 'pki-manager-ssh', ra: 'pki-manager-ra' });
});


/** Offline material as the operator makes it: each transfer key wrapped by Cosmian to the target wrapping key. */
async function offline(s: Awaited<ReturnType<typeof setup>>) {
  const materialDir = join(s.dir, 'material');
  mkdirSync(materialDir);
  const wrapId = await s.kms.registerWrappingKey(createPublicKey(await s.store.wrappingKeyPem()).export({ format: 'der', type: 'spki' }) as Buffer);
  const material: NonNullable<Approval['material']> = {};
  for (const [i, k] of s.manifest.keys.filter(x => x.proposed === 'transfer').entries()) {
    const blob = await s.kms.wrappedGet(k.sourceKeyId, wrapId);
    writeFileSync(join(materialDir, `k${i}.wrapped`), blob);
    material[k.sourceKeyId] = { file: `k${i}.wrapped`, sha256: sha256Hex(blob) };
  }
  await s.kms.removeWrappingKey(wrapId);
  const approval = await approve(s.manifest, s.store, a => { a.allowSourceWrappingKeyRegistration = false; a.material = material; });
  const certificatesFile = join(s.dir, 'certificates.pem');
  writeFileSync(certificatesFile, (await exportCertificateBundle(s.manifest, s.kms)).pem);
  s.kms.calls.length = 0;
  return { materialDir, approval, certificatesFile };
}
const pf = (s: Awaited<ReturnType<typeof setup>>, approval: Approval, extra: Partial<Parameters<typeof preflight>[0]> = {}) =>
  preflight({ manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, store: s.store, addr: ADDR, profile: DEFAULT_PROFILE, online: false, ...extra });
const failed = (p: Awaited<ReturnType<typeof preflight>>) => p.checks.filter(c => !c.ok).map(c => `${c.name} ${c.detail}`).join(' | ');

test('offline material: preflight reads every file, so a bad one stops the run before the first import', async () => {
  const s = await setup();
  const o = await offline(s);
  const ok = await pf(s, o.approval, { materialDir: o.materialDir, certificatesFile: o.certificatesFile });
  assert.equal(ok.ok, true, failed(ok));
  const ids = Object.keys(o.approval.material!).sort();
  const last = ids[ids.length - 1]; // the run order: a late failure used to leave the earlier keys imported
  const variant = (edit: (a: Approval) => void) => { const a = structuredClone(o.approval); edit(a); return a; };
  const cases: [string, Approval, Partial<Parameters<typeof preflight>[0]>, RegExp][] = [
    ['wrong digest', variant(a => { a.material![last].sha256 = '0'.repeat(64); }), { materialDir: o.materialDir }, /does not match the approved digest/],
    ['no --material-dir', o.approval, {}, /--material-dir is required/],
    ['transfer without material', variant(a => { delete a.material![last]; }), { materialDir: o.materialDir }, /APPROVAL_MATERIAL_MISSING/],
    ['material for a key that is not a transfer', variant(a => { a.keys[last].action = 'rotate'; }), { materialDir: o.materialDir }, /APPROVAL_MATERIAL /],
    ['path outside the directory', variant(a => { a.material![last].file = '../certificates.pem'; }), { materialDir: o.materialDir }, /inside --material-dir/],
  ];
  // A symbolic link inside the directory that points outside it (same bytes, right digest).
  const outside = join(s.dir, 'outside.wrapped');
  writeFileSync(outside, readFileSync(join(o.materialDir, o.approval.material![last].file)));
  symlinkSync(outside, join(o.materialDir, 'link.wrapped'));
  cases.push(['link to a file outside the directory', variant(a => { a.material![last].file = 'link.wrapped'; }), { materialDir: o.materialDir }, /inside --material-dir/]);
  for (const [name, approval, extra, re] of cases) {
    const p = await pf(s, approval, { certificatesFile: o.certificatesFile, ...extra });
    assert.equal(p.ok, false, name);
    assert.match(failed(p), re, name);
    await assert.rejects(run(s, approval, { kms: undefined, certificatesFile: o.certificatesFile, ...extra }), (e: MigrationError) => e.code === 'PREFLIGHT', name);
    assert.equal(s.store.imports, 0, `${name}: nothing imported`);
  }
});

test('offline material with Cosmian stopped: the certificate bundle gives the PEMs, identities and DER are kept', async () => {
  const s = await setup();
  const o = await offline(s);
  const kmsPems = s.manifest.certificates.filter(c => c.table !== 'integration_ras' && c.pemSource === 'kms');
  assert.ok(kmsPems.length > 0, 'the seed has certificates whose PEM is only in Cosmian');
  // No KMS and no bundle: refused in preflight (it used to fail after the imports).
  const noPem = await pf(s, o.approval, { materialDir: o.materialDir });
  assert.match(failed(noPem), /certificate PEMs available without the source KMS/);
  await assert.rejects(run(s, o.approval, { kms: undefined, materialDir: o.materialDir }), (e: MigrationError) => e.code === 'PREFLIGHT');
  assert.equal(s.store.imports, 0);
  // Missing, changed and foreign certificates, and a key block in the bundle.
  const pems = readFileSync(o.certificatesFile, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)!;
  const der0 = new X509Certificate(pems[0]).raw;
  const changed = Buffer.from(der0); changed[changed.length - 1] ^= 0xff; // signature byte: still parses
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const foreign = makeCert({ cn: 'Foreign', key: k, serial: '99', ca: true });
  const bundles: [string, string, RegExp][] = [
    ['missing', pems.slice(1).join('\n'), /not in --certificates/],
    ['changed', [derToPem(changed, 'CERTIFICATE'), ...pems.slice(1)].join('\n'), /match no inventoried DER/],
    ['foreign', [...pems, foreign].join('\n'), /match no inventoried DER/],
    ['private key block', [...pems, k.export({ format: 'pem', type: 'pkcs8' }) as string].join('\n'), /PRIVATE KEY, not CERTIFICATE/],
  ];
  for (const [name, text, re] of bundles) {
    const f = join(s.dir, `bundle-${name.replace(/ /g, '-')}.pem`);
    writeFileSync(f, text);
    const p = await pf(s, o.approval, { materialDir: o.materialDir, certificatesFile: f });
    assert.match(failed(p), re, name);
    await assert.rejects(run(s, o.approval, { kms: undefined, materialDir: o.materialDir, certificatesFile: f }), (e: MigrationError) => e.code === 'PREFLIGHT', name);
    assert.equal(s.store.imports, 0, `${name}: nothing imported`);
  }
  // The good run: no source KMS at all.
  const r = await run(s, o.approval, { kms: undefined, materialDir: o.materialDir, certificatesFile: o.certificatesFile });
  assert.equal(r.imported, Object.keys(o.approval.material!).length);
  assert.deepEqual(s.kms.calls, [], 'apply made no call to Cosmian');
  const again = await run(s, o.approval, { kms: undefined, materialDir: o.materialDir, certificatesFile: o.certificatesFile });
  assert.equal(again.noOp, true);
  const target = openReadOnly(s.targetPath);
  for (const c of kmsPems) {
    const row = target.prepare('SELECT certificate_pem FROM keystore_objects WHERE id = ?').get(c.kmsCertificateId!) as { certificate_pem: string } | undefined;
    if (!row) continue; // a certificate of a key to rotate gets no row
    assert.equal(sha256Hex(new X509Certificate(row.certificate_pem).raw), c.pemSha256, `DER of ${c.table}:${c.rowId} kept`);
  }
  const v = await verifyMigration({ manifest: s.manifest, approval: o.approval, target, store: s.store, profile: DEFAULT_PROFILE });
  target.close();
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter(c => !c.ok)));
  for (const key of s.manifest.keys.filter(x => o.approval.material![x.sourceKeyId])) {
    const t = await s.store.readKey(key.target!.mount, key.target!.name);
    assert.equal(spkiFingerprint(t!.publicKeyPem!), key.spkiSha256, `identity of ${key.sourceKeyId}`);
  }
});
