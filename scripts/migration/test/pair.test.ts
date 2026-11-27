/**
 * The database-side pair check (lib/pair.ts) applies the v4 runtime key policy
 * (lib/key-policy.ts) to every key the database owns, not only to the keys of
 * the manifest:
 *
 * - a policy change after the cutover with the SAME key material (soft delete,
 *   minimum versions, deletion allowed, export flag, session-key opt-out, an
 *   imported RA key without its certificate) fails for X.509, SSH and RA keys;
 * - legitimate keys pass: generated and imported keys, exportable leaf keys,
 *   revoked keys (policy findings are warnings), destroyed and pending rows;
 * - keys on non-default mounts pass when the profile names those mounts, and a
 *   reference to a mount the runtime does not use fails, as in the v4 clients.
 *
 * Run: cd scripts/migration && npm test   (Node >= 22.18)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkPair } from '../lib/pair.ts';
import { openReadOnly } from '../lib/sqlite.ts';
import { DEFAULT_PROFILE, sshKeyRef, type TargetProfile } from '../lib/target-db.ts';
import { FakeTransit, makeCert, migrateToV4, sshLine, tempDir, v3Database } from './helpers.ts';

const CUSTOM: TargetProfile = { mounts: { x509: 'bao/x509', ssh: 'bao/ssh', ra: 'bao/ra' } };
const spki = (k: KeyObject) => k.export({ format: 'pem', type: 'spki' }) as string;

interface Fixture {
  path: string; store: FakeTransit; raStore: FakeTransit;
  names: { leaf: string; ca: string; revoked: string; ssh: string; raCert: string; raNew: string };
  /** The OpenBao key of each object, by `<mount>/<name>`. */
  key: (purpose: 'leaf' | 'ca' | 'revoked' | 'ssh' | 'raCert' | 'raNew') => string;
}

/**
 * A v4 database with the keys v4 writes after the cutover, in the mounts of
 * `profile`, and the OpenBao keys that match them (X.509/SSH in `store`, RA in
 * `raStore`). Every key is one v4 accepts.
 */
function fixture(profile: TargetProfile = DEFAULT_PROFILE): Fixture {
  const dir = tempDir('pkimig-pair-');
  const path = join(dir, 'v4.db');
  v3Database(path).close();
  migrateToV4(path);
  const store = new FakeTransit(), raStore = new FakeTransit();
  const { x509, ssh, ra } = profile.mounts;
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const ks = db.prepare("INSERT INTO keystore_objects (id, object_type, state, mount, key_name, key_version, key_algorithm, exportable, purpose, public_key_pem, certificate_pem, issuer_certificate_id, private_key_id, public_key_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '[]')");
  const x509Key = (id: string, state: string, type: 'rsa-2048' | 'ecdsa-p256', exportable: boolean, purpose: 'ca' | 'certificate', imported = false) => {
    const pair = type === 'rsa-2048' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const name = `x509-${purpose === 'ca' ? 'ca' : 'leaf'}-${randomUUID()}`;
    store.plant(x509, name, type, pair.privateKey, { exportable, imported });
    const alg = type === 'rsa-2048' ? 'RSA-2048' : 'ECDSA-P256';
    ks.run(`${id}-priv`, 'private_key', state, x509, name, 1, alg, exportable ? 1 : 0, purpose, spki(pair.publicKey), null, null, `${id}-pub`);
    ks.run(`${id}-pub`, 'public_key', state, x509, name, 1, alg, exportable ? 1 : 0, purpose, spki(pair.publicKey), null, `${id}-priv`, null);
    ks.run(`${id}-cert`, 'certificate', 'active', null, null, null, null, null, null, null, makeCert({ cn: id, key: pair.privateKey, serial: String(Math.floor(Math.random() * 1e6) + 1) }), `${id}-priv`, `${id}-pub`);
    return name;
  };
  // X.509: a leaf v4 generated (exportable), a migrated CA key (imported, not exportable), a revoked key.
  const leaf = x509Key('leaf', 'active', 'rsa-2048', true, 'certificate');
  const ca = x509Key('ca', 'active', 'ecdsa-p256', false, 'ca', true);
  const revoked = x509Key('revoked', 'revoked', 'rsa-2048', true, 'certificate');
  // A deleted key (no Transit key) and an unfinished creation: they need nothing.
  ks.run('gone-priv', 'private_key', 'destroyed', x509, `x509-leaf-${randomUUID()}`, 1, 'RSA-2048', 1, 'certificate', null, null, null, null);
  ks.run('half-priv', 'private_key', 'pending', x509, `x509-leaf-${randomUUID()}`, 1, 'RSA-2048', 1, 'certificate', null, null, null, null);
  // SSH: a CA v4 created (generated, ssh-ca-<caId>).
  const sshPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const sshName = 'ssh-ca-sshca-new';
  store.plant(ssh, sshName, 'ecdsa-p256', sshPair.privateKey);
  const line = sshLine(sshPair.publicKey);
  db.prepare("INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status) VALUES ('sshca-new', 'default', 'user', ?, ?, ?, ?, 'active')")
    .run(sshKeyRef(ssh, sshName), sshKeyRef(ssh, sshName), line.line, line.fp);
  // RA: a migrated key (imported, pinned by its RA certificate) and a key v4 provisioned (generated).
  const raPlant = (id: string, imported: boolean, withCert: boolean) => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const name = `scep-ra-${randomUUID()}`;
    raStore.plant(ra, name, 'rsa-3072', pair.privateKey, { allowPkcs1v15SessionKey: true, imported });
    const pem = withCert ? makeCert({ cn: `SCEP RA ${id}`, key: pair.privateKey, serial: String(Math.floor(Math.random() * 1e6) + 1) }) : null;
    db.prepare("INSERT INTO integration_ras (integration_id, ca_id, key_provider, key_id, key_version, certificate_id, certificate_pem) VALUES (?, 'ca-1', 'openbao', ?, 1, NULL, ?)").run(id, name, pem);
    return name;
  };
  const raCert = raPlant('int-migrated', true, true);
  const raNew = raPlant('int-new', false, false);
  db.close();
  const names = { leaf, ca, revoked, ssh: sshName, raCert, raNew };
  const mountOf = { leaf: x509, ca: x509, revoked: x509, ssh, raCert: ra, raNew: ra };
  return { path, store, raStore, names, key: p => `${mountOf[p]}/${names[p]}` };
}

async function pair(f: Fixture, profile: TargetProfile = DEFAULT_PROFILE) {
  const target = openReadOnly(f.path);
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  try {
    const r = await checkPair({ target, store: f.store, raStore: f.raStore, profile, add: (name, ok, detail) => checks.push({ name, ok, detail }), counts, warnings });
    return { ok: r.ok, failed: checks.filter(c => !c.ok), counts, warnings };
  } finally { target.close(); }
}

/** Changes fields of the read response of one key; the key material stays the same. */
function setPolicy(store: FakeTransit, key: string, policy: Record<string, unknown>) {
  const k = store.keys.get(key);
  assert.ok(k, `no key ${key}`);
  k.policy = { ...k.policy, ...policy };
}

function edit(f: Fixture, sql: string, ...args: (string | number | null)[]) {
  const db = new DatabaseSync(f.path, { enableForeignKeyConstraints: false });
  try { db.prepare(sql).run(...args); } finally { db.close(); }
}

test('pair: legitimate post-cutover keys pass the v4 runtime policy (generated, imported, exportable, revoked, destroyed, pending)', async () => {
  const f = fixture();
  const r = await pair(f);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  // leaf, CA, revoked, SSH CA, two RA keys.
  assert.equal(r.counts.liveKeysVerified, 6);
  assert.deepEqual(r.warnings.map(w => w.split(' ')[0]), ['keystore_objects:half-priv']);
});

test('pair: a policy change with the same key material fails for X.509, SSH CA and RA keys', async () => {
  const cases: { what: string; key: 'leaf' | 'ca' | 'ssh' | 'raCert' | 'raNew'; policy: Record<string, unknown>; store?: 'ra'; detail: RegExp; check: string }[] = [
    { what: 'X.509 soft-deleted', key: 'leaf', policy: { soft_deleted: true }, detail: /soft_deleted is true/, check: 'pair: keystore_objects:leaf-priv v4 runtime policy' },
    { what: 'X.509 sign refused below min_encryption_version', key: 'ca', policy: { min_encryption_version: 2 }, detail: /min_encryption_version 2 > pinned version 1/, check: 'pair: keystore_objects:ca-priv v4 runtime policy' },
    { what: 'X.509 deletion allowed (interrupted delete)', key: 'leaf', policy: { deletion_allowed: true }, detail: /deletion_allowed is true/, check: 'pair: keystore_objects:leaf-priv v4 runtime policy' },
    { what: 'X.509 export flag changed after the row (CA key made exportable)', key: 'ca', policy: { exportable: true }, detail: /row says exportable=false but the Transit key says true/, check: 'pair: keystore_objects:ca-priv v4 runtime policy' },
    { what: 'X.509 version no longer available', key: 'leaf', policy: { min_available_version: 2 }, detail: /min_available_version 2 > pinned version 1/, check: 'pair: keystore_objects:leaf-priv v4 runtime policy' },
    { what: 'SSH CA soft-deleted', key: 'ssh', policy: { soft_deleted: true }, detail: /soft_deleted is true/, check: 'pair: ssh_cas:sshca-new v4 runtime policy' },
    { what: 'SSH CA made exportable', key: 'ssh', policy: { exportable: true }, detail: /exportable is true/, check: 'pair: ssh_cas:sshca-new v4 runtime policy' },
    { what: 'SSH CA sign refused below min_encryption_version', key: 'ssh', policy: { min_encryption_version: 2 }, detail: /min_encryption_version 2/, check: 'pair: ssh_cas:sshca-new v4 runtime policy' },
    { what: 'RA session-key opt-in removed', key: 'raNew', policy: { allow_pkcs1v15_session_key: false }, detail: /not opted in to PKCS#1 v1.5/, check: 'pair: integration_ras:int-new v4 runtime policy' },
    { what: 'RA session key refused below min_decryption_version', key: 'raCert', policy: { min_decryption_version: 2 }, detail: /min_decryption_version 2 > pinned version 1 \(session key refused\)/, check: 'pair: integration_ras:int-migrated v4 runtime policy' },
    { what: 'RA key allows plaintext backup', key: 'raCert', policy: { allow_plaintext_backup: true }, detail: /allow_plaintext_backup is true/, check: 'pair: integration_ras:int-migrated v4 runtime policy' },
  ];
  for (const c of cases) {
    const f = fixture();
    const store = c.key.startsWith('ra') ? f.raStore : f.store;
    setPolicy(store, f.key(c.key), c.policy);
    const r = await pair(f);
    assert.equal(r.ok, false, c.what);
    assert.deepEqual(r.failed.map(x => x.name), [c.check], `${c.what}: ${JSON.stringify(r.failed)}`);
    assert.match(r.failed[0].detail!, c.detail, c.what);
  }
});

test('pair: the RA runtime accepts an imported key only with the RA certificate that pins it', async () => {
  const f = fixture();
  edit(f, "UPDATE integration_ras SET certificate_pem = NULL WHERE integration_id = 'int-migrated'");
  const r = await pair(f);
  assert.deepEqual(r.failed.map(x => x.name), ['pair: integration_ras:int-migrated v4 runtime policy'], JSON.stringify(r.failed));
  assert.match(r.failed[0].detail!, /imported key is not accepted here/);
});

test('pair: a revoked key is only read: policy findings are warnings, a missing or other key still fails', async () => {
  const f = fixture();
  setPolicy(f.store, f.key('revoked'), { soft_deleted: true, exportable: false });
  const r = await pair(f);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  const w = r.warnings.find(x => x.startsWith('keystore_objects:revoked-priv (revoked)'));
  assert.ok(w && /soft_deleted is true/.test(w) && /row says exportable=true/.test(w), r.warnings.join('\n'));
  f.store.keys.delete(f.key('revoked'));
  assert.deepEqual((await pair(f)).failed.map(x => x.name), ['pair: keystore_objects:revoked-priv key in OpenBao']);
});

test('pair: the row must say what the runtime does with the key (export flag, algorithm)', async () => {
  const f = fixture();
  // The row allows downloads, the key refuses export: every PKCS#12 download fails.
  edit(f, "UPDATE keystore_objects SET exportable = 1 WHERE mount IS NOT NULL AND key_name = ?", f.names.ca);
  let r = await pair(f);
  assert.deepEqual(r.failed.map(x => x.name), ['pair: keystore_objects:ca-priv v4 runtime policy']);
  assert.match(r.failed[0].detail!, /row says exportable=true but the Transit key says false/);
  edit(f, "UPDATE keystore_objects SET exportable = 0 WHERE key_name = ?", f.names.ca);
  // The runtime signs with the algorithm of the row (RSA padding, hash).
  edit(f, "UPDATE keystore_objects SET key_algorithm = 'ECDSA-P384' WHERE key_name = ?", f.names.ca);
  r = await pair(f);
  assert.deepEqual(r.failed.map(x => x.name), ['pair: keystore_objects:ca-priv v4 runtime policy']);
  assert.match(r.failed[0].detail!, /key_algorithm ECDSA-P384 but the Transit key is ecdsa-p256/);
});

test('pair: an SSH CA row must hold the key the runtime pins (one reference, the openssh_public_key line)', async () => {
  const f = fixture();
  edit(f, "UPDATE ssh_cas SET kms_public_key_id = ? WHERE id = 'sshca-new'", sshKeyRef('pki-manager-ssh', f.names.ssh, 2));
  let r = await pair(f);
  assert.deepEqual(r.failed.map(x => x.name), ['pair: ssh_cas:sshca-new v4 runtime policy']);
  assert.match(r.failed[0].detail!, /kms_public_key_id .* differs from kms_key_id/);
  edit(f, "UPDATE ssh_cas SET kms_public_key_id = kms_key_id, openssh_public_key = ? WHERE id = 'sshca-new'", sshLine(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey).line);
  r = await pair(f);
  assert.deepEqual(r.failed.map(x => x.name), ['pair: ssh_cas:sshca-new fingerprint']);
  assert.match(r.failed[0].detail!, /!= openssh_public_key/);
});

test('pair: keys on non-default mounts pass with the profile that names them; other mounts fail as in the v4 clients', async () => {
  const f = fixture(CUSTOM);
  const ok = await pair(f, CUSTOM);
  assert.equal(ok.ok, true, JSON.stringify(ok.failed));
  assert.equal(ok.counts.liveKeysVerified, 6);

  // The same database checked with the default profile: X.509 rows name a mount the backend
  // token cannot use, the SSH reference is outside OPENBAO_SSH_MOUNT, the RA keys are looked
  // up in the default RA mount and are not there.
  const def = await pair(f, DEFAULT_PROFILE);
  assert.deepEqual(def.failed.map(x => x.name).sort(), [
    'pair: integration_ras:int-migrated RA key in OpenBao',
    'pair: integration_ras:int-new RA key in OpenBao',
    'pair: keystore_objects:ca-priv v4 runtime policy',
    'pair: keystore_objects:leaf-priv v4 runtime policy',
    'pair: ssh_cas:sshca-new v4 runtime policy',
  ], JSON.stringify(def.failed));
  assert.match(def.failed.find(x => x.name === 'pair: keystore_objects:leaf-priv v4 runtime policy')!.detail!, /mount bao\/x509 is not the X\.509 mount pki-manager/);
  assert.match(def.failed.find(x => x.name === 'pair: ssh_cas:sshca-new v4 runtime policy')!.detail!, /mount bao\/ssh is not the SSH mount pki-manager-ssh/);
  // The revoked key on the other mount: a warning (the runtime only reads it).
  assert.ok(def.warnings.some(w => w.startsWith('keystore_objects:revoked-priv (revoked)') && /mount bao\/x509/.test(w)), def.warnings.join('\n'));

  // One X.509 row that names another mount than its siblings, with a valid key there: fails.
  const g = fixture(CUSTOM);
  const k = g.store.keys.get(g.key('leaf'))!;
  g.store.keys.set(`pki-manager/${g.names.leaf}`, k);
  edit(g, 'UPDATE keystore_objects SET mount = ? WHERE key_name = ?', 'pki-manager', g.names.leaf);
  const r = await pair(g, CUSTOM);
  assert.deepEqual(r.failed.map(x => x.name), ['pair: keystore_objects:leaf-priv v4 runtime policy'], JSON.stringify(r.failed));
});
