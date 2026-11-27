/**
 * Per-purpose runtime key policy (release findings 3 and 6):
 * - key-policy.ts refuses every key the v4 backend clients refuse (parity run
 *   against the backend checkers themselves), refuses the keys OpenBao would
 *   refuse to use for the pinned version, and accepts legitimate generated and
 *   imported keys;
 * - apply/verify impose it on read, import, adopt and verify;
 * - an already-target RA key is pinned to its binding, its RA certificate and its
 *   key version, signs with that version, and the cutover gate needs its
 *   session-key operation;
 * - RA mount calls use the RA identity, the others the X.509/SSH identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildManifest } from '../lib/inventory.ts';
import { runtimeKeyProblems, type Purpose } from '../lib/key-policy.ts';
import type { TargetStore } from '../lib/openbao.ts';
import { approvalTemplate, approvedTarget } from '../lib/policy.ts';
import { backupTo, openReadOnly } from '../lib/sqlite.ts';
import { DEFAULT_PROFILE } from '../lib/target-db.ts';
import { apply, liveTarget } from '../lib/transfer.ts';
import type { Approval, Manifest } from '../lib/types.ts';
import { documentDigest } from '../lib/util.ts';
import { verifyMigration, type VerifyReport } from '../lib/verify.ts';
import { FakeCosmian, FakeTransit, migrateToV4, seedV3, tempDir, v3Database, type FakeKey } from './helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_OPENBAO = join(HERE, '../../../backend/src/openbao');
const ADDR = 'https://openbao.test:8200';
const RA_NAME = 'scep-ra-00000000-0000-4000-8000-0000000000bb';

// ───────────── 1. policy parity with the backend clients ─────────────

const pem = (k: KeyObject) => k.export({ format: 'pem', type: 'spki' }) as string;
const rsa3072 = pem(generateKeyPairSync('rsa', { modulusLength: 3072 }).publicKey);
const rsa2048 = pem(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey);
const p256 = pem(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey);
const p384 = pem(generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey);

/** A read response as the fork returns it (path_keys.go formatKeyPolicy). */
function response(type: string, publicKey: string, o: { imported?: boolean; version?: number; exportable?: boolean } = {}): Record<string, unknown> {
  const v = o.version ?? 1;
  return {
    name: 'k', type, derived: false, deletion_allowed: false, min_available_version: 0, min_decryption_version: 1, min_encryption_version: 0,
    latest_version: v, exportable: o.exportable ?? false, allow_plaintext_backup: false, supports_encryption: type.startsWith('rsa-'),
    supports_decryption: type.startsWith('rsa-'), supports_signing: true, supports_derivation: false, auto_rotate_period: 0,
    imported_key: o.imported ?? false, soft_deleted: false,
    ...(type === 'rsa-3072' ? { allow_pkcs1v15_session_key: false } : {}),
    ...(o.imported ? { imported_key_allow_rotation: false } : {}),
    keys: Object.fromEntries(Array.from({ length: v }, (_, i) => [String(i + 1), { public_key: publicKey, name: type }])),
  };
}

interface Case { label: string; purpose: Purpose; name: string; version: number; allowImported: boolean; data: unknown; legit?: boolean }

function cases(): Case[] {
  const out: Case[] = [];
  const base: { purpose: Purpose; name: string; type: string; pem: string; allowImported: boolean[] }[] = [
    { purpose: 'x509', name: 'x509-ca-00000000-0000-4000-8000-000000000001', type: 'rsa-3072', pem: rsa3072, allowImported: [true] },
    { purpose: 'x509', name: 'x509-leaf-00000000-0000-4000-8000-000000000002', type: 'ecdsa-p384', pem: p384, allowImported: [true] },
    { purpose: 'ssh-ca', name: 'ssh-ca-00000000-0000-4000-8000-000000000003', type: 'ecdsa-p256', pem: p256, allowImported: [true] },
    { purpose: 'scep-ra', name: RA_NAME, type: 'rsa-3072', pem: rsa3072, allowImported: [true, false] },
  ];
  for (const b of base) {
    for (const imported of [true, false]) {
      for (const allowImported of b.allowImported) {
        for (const version of b.purpose === 'scep-ra' && !imported ? [1, 2] : [1]) {
          const ok = (patch: Record<string, unknown> = {}) => {
            const d = response(b.type, b.pem, { imported, version, exportable: b.purpose === 'x509' && !imported });
            if (b.purpose === 'scep-ra') d.allow_pkcs1v15_session_key = true;
            return { ...d, ...patch };
          };
          const at = `${b.purpose} ${imported ? 'imported' : 'generated'} v${version}${allowImported ? '' : ' (generated required)'}`;
          const add = (label: string, data: unknown) => out.push({ label: `${at}: ${label}`, purpose: b.purpose, name: b.name, version, allowImported, data });
          out.push({ label: `${at}: legitimate`, purpose: b.purpose, name: b.name, version, allowImported, data: ok(), legit: !(imported && !allowImported) });
          const without = (f: string) => { const d = ok(); delete d[f]; return d; };
          for (const [f, bad] of [['derived', true], ['deletion_allowed', true], ['soft_deleted', true], ['allow_plaintext_backup', true], ['supports_signing', false], ['exportable', 'yes'], ['auto_rotate_period', 3600]] as const) {
            add(`${f}=${String(bad)}`, ok({ [f]: bad }));
            if (f !== 'auto_rotate_period') add(`${f} absent`, without(f));
          }
          if (b.purpose !== 'x509') add('exportable=true', ok({ exportable: true }));
          if (imported) { add('imported_key_allow_rotation=true', ok({ imported_key_allow_rotation: true })); add('imported_key_allow_rotation absent', without('imported_key_allow_rotation')); }
          add('imported_key absent', without('imported_key'));
          add('wrong type', ok({ type: b.type === 'rsa-3072' ? 'rsa-4096' : 'ed25519' }));
          add('public key of another type', ok({ keys: { [String(version)]: { public_key: b.type.startsWith('rsa') ? (b.type === 'rsa-3072' ? rsa2048 : rsa3072) : (b.type === 'ecdsa-p256' ? p384 : p256) } } }));
          add('no public key for the version', ok({ keys: {} }));
          add('latest_version below the pinned version', ok({ latest_version: version - 1 }));
          for (const f of ['min_available_version', 'min_encryption_version', 'min_decryption_version']) {
            add(`${f} above the pinned version`, ok({ [f]: version + 1 }));
            add(`${f} absent`, without(f));
          }
          add('latest_version absent', without('latest_version'));
          if (b.purpose === 'scep-ra') { add('session key not opted in', ok({ allow_pkcs1v15_session_key: false })); add('session key opt-in absent', without('allow_pkcs1v15_session_key')); }
          else if (b.type === 'rsa-3072') add('unexpected session-key opt-in', ok({ allow_pkcs1v15_session_key: true }));
          add('no data', null);
          add('bad name', ok());
          out[out.length - 1].name = b.purpose === 'scep-ra' ? 'scep-ra-not-a-uuid' : b.purpose === 'ssh-ca' ? 'x509-ca-wrong-prefix' : 'Upper_Case';
        }
      }
    }
  }
  return out;
}

test('key-policy refuses every key the v4 backend clients refuse and accepts legitimate keys', () => {
  const all = cases();
  const backend = JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', join(HERE, 'backend-policy.mjs'), BACKEND_OPENBAO], { input: JSON.stringify(all) }).toString()) as { ok: boolean; error?: string }[];
  assert.equal(backend.length, all.length);
  const stricter: string[] = [];
  all.forEach((c, i) => {
    const ours = runtimeKeyProblems(c.purpose, c.name, c.data, c.version, { allowImported: c.allowImported });
    if (!backend[i].ok) assert.ok(ours.problems.length > 0, `backend refuses "${c.label}" (${backend[i].error}) but the migrator accepts it`);
    if (c.legit) {
      assert.equal(backend[i].ok, true, `backend refuses the legitimate case "${c.label}": ${backend[i].error}`);
      assert.deepEqual(ours.problems, [], `migrator refuses the legitimate case "${c.label}"`);
    }
    if (backend[i].ok && ours.problems.length) stricter.push(c.label);
  });
  // The migrator is stricter only where OpenBao itself would refuse the runtime operation
  // or where the fork always sends the field (absent = not the fork).
  for (const label of stricter) {
    assert.match(label, /absent|latest_version below|deletion_allowed|soft_deleted|supports_signing|min_encryption_version above|min_decryption_version above|min_available_version above|auto_rotate_period|imported_key_allow_rotation|unexpected session-key|allow_plaintext_backup=true|derived=true|exportable=yes/, `unexpected extra refusal: ${label}`);
  }
  console.log(`${all.length} cases; backend refuses ${backend.filter(b => !b.ok).length}; migrator stricter on ${stricter.length} (OpenBao would refuse the operation, or a field the fork always sends is missing)`);
});

// ───────────── 2. apply / verify ─────────────

async function setup(o: { seed?: (db: DatabaseSync, kms: FakeCosmian, ids: Record<string, string>) => void; v4Source?: boolean } = {}) {
  const dir = tempDir('keypolicy-');
  const sourcePath = join(dir, 'v3.db');
  const kms = new FakeCosmian();
  const db = v3Database(sourcePath);
  const ids = seedV3(db, kms);
  db.close();
  if (o.v4Source) migrateToV4(sourcePath);
  const w = new DatabaseSync(sourcePath);
  // The non-extractable SSH host CA would keep the gate closed (rotate); it is not under test here.
  w.exec("DELETE FROM ssh_cas WHERE id = 'sshca-b'");
  o.seed?.(w, kms, ids);
  w.close();
  const targetPath = join(dir, 'v4.db');
  await backupTo(sourcePath, targetPath);
  if (!o.v4Source) migrateToV4(targetPath);
  const src = openReadOnly(sourcePath);
  const manifest = await buildManifest({ sourcePath, db: src, kms });
  src.close();
  return { dir, sourcePath, targetPath, kms, ids, manifest, store: new FakeTransit() };
}
type S = Awaited<ReturnType<typeof setup>>;

async function approve(s: S): Promise<Approval> {
  const a = approvalTemplate(s.manifest, await liveTarget(s.store, ADDR, s.manifest));
  a.approvedBy = 'key-policy-test'; a.approvedAt = new Date().toISOString(); a.allowSourceWrappingKeyRegistration = true;
  for (const k of Object.values(a.keys)) if (k.acknowledgeSensitive === false) k.acknowledgeSensitive = true;
  return a;
}

const run = (s: S, approval: Approval, runDir = 'run') => apply({
  manifest: s.manifest, approval, sourceDbPath: s.sourcePath, targetDbPath: s.targetPath, runDir: join(s.dir, runDir),
  store: s.store, addr: ADDR, kms: s.kms, profile: DEFAULT_PROFILE, confirm: documentDigest(s.manifest).slice(0, 16), actor: 'test',
});

async function verify(s: S, approval: Approval, o: { raSessionCheck?: boolean; store?: TargetStore; raStore?: TargetStore } = {}): Promise<VerifyReport> {
  const target = openReadOnly(s.targetPath); const source = openReadOnly(s.sourcePath);
  try { return await verifyMigration({ manifest: s.manifest, approval, target, store: o.store ?? s.store, raStore: o.raStore, profile: DEFAULT_PROFILE, source, sourcePath: s.sourcePath, raSessionCheck: o.raSessionCheck }); }
  finally { target.close(); source.close(); }
}

const failed = (v: VerifyReport) => v.checks.filter(c => !c.ok).map(c => `${c.name} ${c.detail ?? ''}`).join(' | ');
const specOf = (m: Manifest, a: Approval, id: string) => approvedTarget(m.keys.find(k => k.sourceKeyId === id)!, a.keys[id], a);
const set = (st: FakeTransit, mount: string, name: string, patch: Partial<FakeKey>) => { const k = st.keys.get(`${mount}/${name}`)!; st.keys.set(`${mount}/${name}`, { ...k, ...patch }); };

test('adopt: an SSH CA key with deletion_allowed=true (the runtime refuses to sign with it) stops the run', async () => {
  const s = await setup();
  const approval = await approve(s);
  const spec = specOf(s.manifest, approval, s.ids.sshKey);
  const priv = s.kms.objects.get(s.ids.sshKey)!.privateKey!;
  s.store.plant(spec.mount, spec.name, 'ecdsa-p256', priv, { imported: true, policy: { deletion_allowed: true } });
  await assert.rejects(run(s, approval), (e: Error & { code?: string }) => e.code === 'TARGET_CONFLICT' && /deletion_allowed/.test(e.message));
});

test('verify: a policy change after apply (derived, soft-deleted, rotation, min versions) fails the key check', async () => {
  const s = await setup();
  const approval = await approve(s);
  await run(s, approval);
  const green = await verify(s, approval, { raSessionCheck: true });
  assert.equal(green.cutoverReady, true, failed(green));
  assert.ok(green.counts.raUnwrapped >= 1, 'the k5 gate reads counts.raUnwrapped >= 1');
  const ssh = specOf(s.manifest, approval, s.ids.sshKey);
  const ca = specOf(s.manifest, approval, s.ids.caKey);
  const ra = specOf(s.manifest, approval, s.ids.raKey);
  for (const [spec, policy, expect] of [
    [ssh, { derived: true }, /derived/],
    [ssh, { soft_deleted: true }, /soft_deleted/],
    [ca, { min_encryption_version: 2 }, /min_encryption_version/],
    [ca, { imported_key_allow_rotation: true }, /imported_key_allow_rotation/],
    [ra, { min_decryption_version: 2 }, /min_decryption_version/],
    [ra, { min_available_version: 2 }, /min_available_version/],
  ] as const) {
    const before = s.store.keys.get(`${spec.mount}/${spec.name}`)!;
    set(s.store, spec.mount, spec.name, { policy });
    const v = await verify(s, approval, { raSessionCheck: true });
    const c = v.checks.find(x => x.name.endsWith(`key ${spec.mount}/${spec.name}`));
    assert.equal(c?.ok, false, `${JSON.stringify(policy)} on ${spec.name}`);
    assert.match(c!.detail ?? '', expect);
    assert.equal(v.cutoverReady, false);
    s.store.keys.set(`${spec.mount}/${spec.name}`, before);
  }
});

/** A v4 source whose RA binding is already in OpenBao: the key of the RA certificate, generated, at `version`. */
async function alreadyTarget(o: { version?: number; bindingVersion?: number | null; publicKeyId?: string | null; otherKey?: boolean; policy?: Record<string, unknown> } = {}) {
  const v = o.version ?? 2;
  const s = await setup({
    v4Source: true,
    seed: db => {
      db.prepare("UPDATE integration_ras SET key_provider = 'openbao', key_id = ?, public_key_id = ?, key_version = ?").run(RA_NAME, o.publicKeyId ?? null, o.bindingVersion === undefined ? v : o.bindingVersion);
      db.exec("UPDATE certificates SET kms_key_id = NULL WHERE id = 'ra-cert-1'");
    },
  });
  const raPriv = s.kms.objects.get(s.ids.raKey)!.privateKey!;
  const priv = o.otherKey ? generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey : raPriv;
  s.store.plant(DEFAULT_PROFILE.mounts.ra, RA_NAME, 'rsa-3072', priv, { allowPkcs1v15SessionKey: true, version: v, policy: o.policy });
  return s;
}

test('already-target RA (generated key, pinned v2): apply and verify sign with v2, session key with v2, cutover', async () => {
  const s = await alreadyTarget();
  const ra = s.manifest.keys.find(k => k.references.some(r => r.role === 'scep-ra-openbao-key'));
  assert.equal(ra?.proposed, 'already-target');
  const approval = await approve(s);
  await run(s, approval);
  assert.ok(s.store.calls.includes(`sign:pki-manager-ra/${RA_NAME}:v2`), 'apply signed with the pinned version');
  const noSession = await verify(s, approval);
  assert.equal(noSession.ok, true, failed(noSession));
  assert.equal(noSession.cutoverReady, false, 'an active RA without its session-key operation is not cutover-ready');
  assert.ok(noSession.checks.some(c => c.name === `cutover: RA session-key transport tested for ${RA_NAME}` && !c.ok));
  const v = await verify(s, approval, { raSessionCheck: true });
  assert.equal(v.cutoverReady, true, failed(v));
  assert.equal(v.counts.raUnwrapped, 1);
  assert.ok(s.store.calls.includes(`session-key:pki-manager-ra/${RA_NAME}:v2`));
  for (const n of ['binding pinned', 'inventoried and approved', 'passes the v4 RA key policy', 'matches its RA certificate', `challenge ${RA_NAME} v2`, `RA session-key unwrap ${RA_NAME} v2`]) {
    assert.ok(v.checks.some(c => c.ok && c.name.includes(n)), `check "${n}"`);
  }
});

test('already-target RA: another key pair, a bad policy, an unpinned or incomplete binding stop apply and fail verify', async () => {
  for (const [label, o, expect] of [
    ['key of another key pair', { otherKey: true }, /differs from the RA certificate/],
    ['deletion allowed', { policy: { deletion_allowed: true } }, /deletion_allowed/],
    ['session key not opted in', { policy: { allow_pkcs1v15_session_key: false } }, /session-key/],
    ['version 2 no longer usable', { policy: { min_decryption_version: 3 } }, /min_decryption_version/],
    ['binding without a version', { bindingVersion: null }, /binding pinned/],
    ['binding version not in OpenBao', { bindingVersion: 3 }, /latest_version/],
    ['binding still names a Cosmian public key', { publicKeyId: 'legacy-pk' }, /binding pinned/],
  ] as const) {
    const s = await alreadyTarget(o);
    const approval = await approve(s);
    await assert.rejects(run(s, approval), (e: Error & { code?: string }) => e.code === 'TARGET_CONFLICT' && expect.test(e.message), label);
    const v = await verify(s, approval, { raSessionCheck: true });
    assert.equal(v.cutoverReady, false, label);
    assert.ok(v.checks.some(c => !c.ok && expect.test(`${c.name} ${c.detail ?? ''}`)), `${label}: ${failed(v)}`);
  }
});

/** Records the mount of every Transit call. */
function recording(inner: FakeTransit, seen: string[]): TargetStore {
  return new Proxy(inner, {
    get(t, p, r) {
      const f = Reflect.get(t, p, r);
      if (typeof f !== 'function' || !['readKey', 'sign', 'sessionKey', 'importKey', 'wrappingKeyPem'].includes(String(p))) return typeof f === 'function' ? f.bind(t) : f;
      return (...args: unknown[]) => { seen.push(`${String(p)}:${String(args[0])}`); return f.apply(t, args); };
    },
  }) as TargetStore;
}

test('verify routes RA mount calls to the RA identity and the others to the X.509/SSH identity', async () => {
  for (const kind of ['transfer', 'already-target'] as const) {
    const s = kind === 'transfer' ? await setup() : await alreadyTarget();
    const approval = await approve(s);
    await run(s, approval);
    const main: string[] = [], ra: string[] = [];
    const v = await verify(s, approval, { raSessionCheck: true, store: recording(s.store, main), raStore: recording(s.store, ra) });
    assert.equal(v.cutoverReady, true, failed(v));
    assert.ok(ra.some(c => c.startsWith('sessionKey:')) && ra.some(c => c.startsWith('sign:')), `${kind}: RA operations use the RA identity`);
    assert.ok(ra.every(c => c.endsWith(':pki-manager-ra')), `${kind}: RA identity only on the RA mount: ${ra.join(', ')}`);
    assert.ok(main.every(c => !c.endsWith(':pki-manager-ra')), `${kind}: no RA mount call with the X.509/SSH identity: ${main.join(', ')}`);
    assert.ok(main.some(c => c === 'sign:pki-manager') && main.some(c => c === 'sign:pki-manager-ssh'), `${kind}: X.509 and SSH challenges use the X.509/SSH identity`);
  }
});
