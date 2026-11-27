/**
 * Apply: transfer approved keys to OpenBao, verify them, then write the target
 * database. Idempotent and restartable:
 *
 *   for each approved key (fixed order)
 *     target exists?  -> check type, flags and public key; adopt (crash after
 *                        import) or STOP on any difference (never overwrite)
 *     else            -> wrapped export (online) or approved material file,
 *                        Transit import, re-read and check
 *     challenge       -> fresh random data signed by OpenBao, verified locally
 *                        with the source public key (same SPKI fingerprint)
 *   one DB transaction: mappings, PEM backfill, audit rows (compare-and-set)
 *
 * Nothing here writes the source database. The only source-KMS write is the
 * registration (and removal) of the OpenBao wrapping public key, when approved.
 */
import { createPublicKey, randomBytes, verify as nodeVerify } from 'node:crypto';
import { readFileSync, realpathSync as realpath, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { CosmianSource } from './cosmian.ts';
import { Journal } from './journal.ts';
import type { TargetStore, TransitKey } from './openbao.ts';
import { kmsOnlyCertificates, loadCertificateBundle } from './certificates.ts';
import { approvedTarget, validateApproval } from './policy.ts';
import { openReadOnly, openWritable } from './sqlite.ts';
import { checkBinding } from './source.ts';
import { applyToTargetDb, missingColumns, type DbResult, type TargetProfile } from './target-db.ts';
import type { Approval, KeyEntry, Manifest, TargetSpec } from './types.ts';
import { MigrationError, derToPem, documentDigest, isoNow, log, sha256Hex, spkiFingerprint } from './util.ts';

export interface LiveTarget { addr: string; wrappingKeys: Record<string, string> }

/** Fingerprints of the wrapping keys of the mounts the manifest uses. */
export async function liveTarget(store: TargetStore, addr: string, manifest: Manifest): Promise<LiveTarget> {
  const mounts = [...new Set(manifest.keys.filter(k => k.target && k.proposed === 'transfer').map(k => k.target!.mount))].sort();
  const wrappingKeys: Record<string, string> = {};
  for (const m of mounts) wrappingKeys[m] = spkiFingerprint(await store.wrappingKeyPem(m));
  return { addr, wrappingKeys };
}

export interface PreflightResult { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }

export async function preflight(o: {
  manifest: Manifest; approval: Approval; sourceDbPath: string; targetDbPath: string; store: TargetStore; addr: string;
  kms?: CosmianSource; profile: TargetProfile; online: boolean; materialDir?: string; certificatesFile?: string;
}): Promise<PreflightResult & { live?: LiveTarget; certificates?: Map<string, Buffer> }> {
  const checks: PreflightResult['checks'] = [];
  const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); return ok; };
  {
    // The frozen source: no pending WAL commits, same file and same content (read through SQLite).
    let bad: string[];
    try { const db = openReadOnly(o.sourceDbPath); try { bad = checkBinding(o.manifest.source, o.sourceDbPath, db); } finally { db.close(); } }
    catch (error) { bad = [(error as Error).message]; }
    check('source database unchanged since inventory (frozen copy, file and content digests)', bad.length === 0, bad.length ? bad.join('; ') : 'the source copy must be frozen: writers stopped, no new rows');
  }
  let distinct = false;
  try { distinct = realpath(o.sourceDbPath) !== realpath(o.targetDbPath); } catch { distinct = false; }
  check('target database is a separate copy', distinct, o.targetDbPath);
  check('manifest read the KMS', o.manifest.source.kmsRead, 'run inventory with --kms-url');
  const m = o.manifest.profile.mounts, p = o.profile.mounts;
  check('mounts match the inventory', m.x509 === p.x509 && m.ssh === p.ssh && m.ra === p.ra, `inventory ${JSON.stringify(m)}, now ${JSON.stringify(p)}`);
  let live: LiveTarget | undefined;
  try {
    const h = await o.store.health();
    check('OpenBao initialized and unsealed', h.initialized && !h.sealed, `version ${h.version}`);
    const t = await o.store.tokenInfo();
    check('migration identity is not a root token', !t.policies.includes('root'), `policies ${t.policies.join(',')}`);
    for (const m of [...new Set(o.manifest.keys.filter(k => k.target).map(k => k.target!.mount))]) {
      const type = await o.store.mountType(m);
      check(`mount ${m} is a Transit engine`, type === 'transit', String(type));
    }
    live = await liveTarget(o.store, o.addr, o.manifest);
  } catch (error) {
    check('OpenBao reachable with the migration identity', false, (error as Error).message);
  }
  // Apply writes every certificate PEM into the target. v3 keeps CA certificates (and a leaf PEM
  // when its row has none) only in Cosmian: they come from the certificate bundle, else from the
  // source KMS. Checked here, before any import, also with offline key material.
  let certificates: Map<string, Buffer> | undefined;
  if (o.certificatesFile) {
    try {
      certificates = loadCertificateBundle(o.certificatesFile);
      const known = new Set(o.manifest.certificates.map(c => c.pemSha256).filter(Boolean));
      const unknown = [...certificates.keys()].filter(h => !known.has(h)).length;
      check('certificate bundle holds only inventoried certificates', unknown === 0, unknown ? `${unknown} certificate(s) match no inventoried DER (changed or foreign)` : `${certificates.size} certificate(s)`);
    } catch (error) {
      check('certificate bundle readable', false, (error as Error).message);
    }
  }
  const needKms = kmsOnlyCertificates(o.manifest).filter(c => !(c.pemSha256 && certificates?.has(c.pemSha256)));
  if (o.online || needKms.length > 0) {
    if (!o.kms) {
      if (o.online) check('source KMS configured for online transfer', false, 'use --kms-url, or approved offline material');
      else check('certificate PEMs available without the source KMS', false, `${needKms.length} certificate(s) have their PEM only in the source KMS and are not in --certificates (${needKms.slice(0, 3).map(c => `${c.table}:${c.rowId}`).join(', ')}${needKms.length > 3 ? ', ...' : ''}): pass the bundle of inventory --certificates-out, or --kms-url (read only)`);
    } else {
      try { await o.kms.query(); check('source KMS reachable', true); } catch (error) { check('source KMS reachable', false, (error as Error).message); }
    }
  } else if (certificates) check('certificate PEMs available without the source KMS', true, `${kmsOnlyCertificates(o.manifest).length} KMS-only certificate(s) in the bundle`);
  // Offline material: every file is read and checked here, so a missing or wrong file stops
  // the run before the first import (not in the middle of it).
  if (o.approval.material) {
    const bad: string[] = [];
    let n = 0;
    for (const key of o.manifest.keys) {
      if (o.approval.keys[key.sourceKeyId]?.action !== 'transfer' || !o.approval.material[key.sourceKeyId]) continue;
      try { readMaterial(o.approval, o.materialDir, key).fill(0); n++; } catch (error) { bad.push((error as Error).message); }
    }
    check('offline material files present and match the approved digests', bad.length === 0, bad.length ? bad.slice(0, 5).join('; ') : `${n} file(s)`);
  }
  const a = validateApproval(o.manifest, o.approval, live, { online: o.online && !o.approval.material });
  for (const p of a.problems) check(`approval: ${p.code}`, false, `${p.subject ?? ''} ${p.message}`.trim());
  if (a.ok) check('approval valid', true, `approvedBy ${o.approval.approvedBy}`);
  try {
    const db = openWritable(o.targetDbPath);
    try {
      const missing = missingColumns(db);
      check('target database has the v4 schema (keystore_objects, RA provider columns)', missing.length === 0, missing.length ? `missing: ${missing.join(', ')} (run the v4 migrations on the copy first)` : '');
    } finally { db.close(); }
  } catch (error) {
    check('target database opens', false, (error as Error).message);
  }
  return { ok: checks.every(c => c.ok), checks, live, certificates };
}

/** Checks a Transit key against the approved spec and the source fingerprint. */
export function checkTargetKey(k: TransitKey, spec: TargetSpec, spkiSha256: string): string[] {
  const bad: string[] = [];
  if (k.type !== spec.type) bad.push(`type ${k.type} != ${spec.type}`);
  if (!k.importedKey) bad.push('not an imported key (a generated key cannot hold the source identity)');
  if (k.latestVersion !== 1) bad.push(`latest_version ${k.latestVersion} != 1`);
  if (k.exportable !== spec.exportable) bad.push(`exportable ${k.exportable} != ${spec.exportable}`);
  if (k.allowPlaintextBackup) bad.push('allow_plaintext_backup is true');
  if (spec.allowPkcs1v15SessionKey && !k.allowPkcs1v15SessionKey) bad.push('RA key not opted in to PKCS#1 v1.5 session-key transport');
  if (!spec.allowPkcs1v15SessionKey && k.allowPkcs1v15SessionKey) bad.push('unexpected PKCS#1 v1.5 session-key opt-in');
  if (!k.publicKeyPem) bad.push('no public key for version 1');
  else if (spkiFingerprint(k.publicKeyPem) !== spkiSha256) bad.push('public key differs from the source key');
  return bad;
}

/** Signs fresh random data in OpenBao and verifies it locally with the key's public key. */
export async function challenge(store: TargetStore, spec: TargetSpec, publicKeyPem: string): Promise<void> {
  const data = randomBytes(48);
  const rsa = spec.type.startsWith('rsa-');
  const hash = spec.type === 'ecdsa-p384' ? 'sha2-384' : 'sha2-256';
  const sig = await store.sign(spec.mount, spec.name, data, { hash, rsa });
  const ok = nodeVerify(hash === 'sha2-384' ? 'sha384' : 'sha256', data, { key: createPublicKey(publicKeyPem), dsaEncoding: 'der' }, sig);
  if (!ok) throw new MigrationError('CHALLENGE_FAILED', `challenge signature of ${spec.mount}/${spec.name} does not verify with the source public key`);
}

export interface ApplyReport {
  startedAt: string; finishedAt: string; manifestSha256: string;
  imported: number; adopted: number; alreadyVerified: number; skipped: Record<string, number>;
  db: Omit<DbResult, 'mappings'>; noOp: boolean;
}

export async function apply(o: {
  manifest: Manifest; approval: Approval; sourceDbPath: string; targetDbPath: string; runDir: string;
  store: TargetStore; addr: string; kms?: CosmianSource; profile: TargetProfile; materialDir?: string; certificatesFile?: string;
  confirm: string; actor: string; fault?: (point: string) => void;
}): Promise<ApplyReport> {
  const digest = documentDigest(o.manifest);
  if (!o.confirm || !digest.startsWith(o.confirm) || o.confirm.length < 12) throw new MigrationError('CONFIRM', `pass --confirm with at least the first 12 characters of the manifest digest (${digest.slice(0, 12)})`);
  const online = !o.approval.material;
  const pre = await preflight({ ...o, online });
  if (!pre.ok) {
    for (const c of pre.checks.filter(x => !x.ok)) log(`preflight FAILED: ${c.name} ${c.detail}`);
    throw new MigrationError('PREFLIGHT', 'preflight failed; nothing was changed');
  }
  const startedAt = isoNow();
  const journal = Journal.open(o.runDir);
  const report: ApplyReport = { startedAt, finishedAt: '', manifestSha256: digest, imported: 0, adopted: 0, alreadyVerified: 0, skipped: {}, db: { rowsChanged: 0, keystoreRows: 0, pemBackfilled: 0, auditRows: 0 }, noOp: false };
  let importsThisRun = 0;
  const wrappingIds = new Map<string, string>();
  try {
    const prior = journal.meta('manifest');
    if (prior && prior !== digest) throw new MigrationError('JOURNAL_OTHER_MANIFEST', 'this run directory belongs to another manifest; use a new --run-dir');
    journal.setMeta('manifest', digest);
    journal.event('run.start', null, { approvedBy: o.approval.approvedBy, online });

    const ready = new Set<string>();
    const publicKeys = new Map<string, string>();
    const ordered = [...o.manifest.keys].sort((a, b) => a.sourceKeyId.localeCompare(b.sourceKeyId));
    for (const key of ordered) {
      const a = o.approval.keys[key.sourceKeyId];
      if (a.action === 'already-target') { ready.add(key.sourceKeyId); continue; }
      if (a.action !== 'transfer') { report.skipped[a.action] = (report.skipped[a.action] ?? 0) + 1; continue; }
      const spec = approvedTarget(key, a, o.approval);
      const spki = key.spkiSha256!;
      const wasState = journal.state(key.sourceKeyId);
      let existing = await o.store.readKey(spec.mount, spec.name);
      let adoptedNow = false;
      if (existing) {
        const bad = checkTargetKey(existing, spec, spki);
        if (bad.length) throw new MigrationError('TARGET_CONFLICT', `${spec.mount}/${spec.name} exists and does not match: ${bad.join('; ')}. Nothing is overwritten; investigate before any retry.`);
        if (wasState === 'verified' || wasState === 'mapped') report.alreadyVerified++;
        else { report.adopted++; adoptedNow = true; journal.event('key.adopted', key.sourceKeyId, { mount: spec.mount, name: spec.name }); }
      } else {
        const blob = online ? await wrappedFromSource(o.kms!, o.store, o.approval, key, spec.mount, wrappingIds, journal) : readMaterial(o.approval, o.materialDir, key);
        try {
          await o.store.importKey(spec.mount, spec.name, {
            ciphertext: blob.toString('base64'), hash_function: 'SHA256', type: spec.type,
            exportable: spec.exportable, allow_plaintext_backup: false, allow_rotation: false,
            ...(spec.allowPkcs1v15SessionKey ? { allow_pkcs1v15_session_key: true } : {}),
          });
        } finally { blob.fill(0); }
        importsThisRun++;
        o.fault?.(`after-import:${importsThisRun}`);
        existing = await o.store.readKey(spec.mount, spec.name);
        const bad = existing ? checkTargetKey(existing, spec, spki) : ['not readable after import'];
        if (bad.length) throw new MigrationError('IMPORT_MISMATCH', `${spec.mount}/${spec.name} after import: ${bad.join('; ')}`);
        report.imported++;
        journal.event('key.imported', key.sourceKeyId, { mount: spec.mount, name: spec.name, type: spec.type, exportable: spec.exportable });
      }
      journal.setState({ id: key.sourceKeyId, cls: key.class, mount: spec.mount, name: spec.name, spki, state: 'imported', adopted: adoptedNow });
      await challenge(o.store, spec, existing!.publicKeyPem!);
      journal.setState({ id: key.sourceKeyId, cls: key.class, mount: spec.mount, name: spec.name, spki, state: 'verified' });
      ready.add(key.sourceKeyId);
      publicKeys.set(key.sourceKeyId, existing!.publicKeyPem!);
    }

    const db: DatabaseSync = openWritable(o.targetDbPath);
    let dbResult: DbResult;
    try {
      dbResult = await applyToTargetDb({
        db, manifest: o.manifest, approval: o.approval, profile: o.profile, ready, publicKeys, actor: o.actor, fault: o.fault,
        pemFor: async c => {
          const bundled = c.pemSha256 ? pre.certificates?.get(c.pemSha256) : undefined;
          if (bundled) return derToPem(bundled, 'CERTIFICATE');
          if (!o.kms || !c.kmsCertificateId) return null;
          const der = await o.kms.getCertificateDer(c.kmsCertificateId);
          return der ? derToPem(der, 'CERTIFICATE') : null;
        },
      });
    } finally { db.close(); }
    for (const key of ordered) {
      if (ready.has(key.sourceKeyId) && key.target && o.approval.keys[key.sourceKeyId].action === 'transfer') {
        const spec = approvedTarget(key, o.approval.keys[key.sourceKeyId], o.approval);
        journal.setState({ id: key.sourceKeyId, cls: key.class, mount: spec.mount, name: spec.name, spki: key.spkiSha256!, state: 'mapped' });
      }
    }
    const { mappings, ...dbSummary } = dbResult;
    report.db = dbSummary;
    writeFileSync(join(o.runDir, 'mappings.json'), JSON.stringify({ manifestSha256: digest, createdAt: isoNow(), mappings }, null, 2), { mode: 0o600 });
    report.noOp = report.imported === 0 && report.adopted === 0 && dbSummary.rowsChanged === 0 && dbSummary.keystoreRows === 0 && dbSummary.pemBackfilled === 0;
    report.finishedAt = isoNow();
    journal.event('run.finish', null, report);
    writeFileSync(join(o.runDir, `apply-report-${report.finishedAt.replace(/[:.]/g, '')}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  } catch (error) {
    journal.event('run.error', null, { code: (error as MigrationError).code, message: (error as Error).message });
    throw error;
  } finally {
    // Remove the wrapping keys registered in Cosmian by this or a crashed run.
    if (o.kms) {
      for (const row of journal.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'wrapping:%'").all() as { key: string; value: string }[]) {
        try { await o.kms.removeWrappingKey(row.value); journal.setMeta(row.key, null); journal.event('source.wrapping_key.removed', row.value); }
        catch (error) { log(`warning: could not remove wrapping key ${row.value} from Cosmian: ${(error as Error).message}`); }
      }
    }
    journal.close();
  }
}

async function wrappedFromSource(kms: CosmianSource, store: TargetStore, approval: Approval, key: KeyEntry, mount: string, ids: Map<string, string>, journal: Journal): Promise<Buffer> {
  // Re-check the source policy at transfer time (it may have changed since inventory).
  const a = await kms.getAttributes(key.sourceKeyId);
  if (!a || a.extractable !== true || a.neverExtractable === true) throw new MigrationError('SOURCE_POLICY', `source key ${key.sourceKeyId} is not extractable now; stopping`);
  if (a.sensitive !== key.attributes?.sensitive) throw new MigrationError('SOURCE_POLICY_CHANGED', `source key ${key.sourceKeyId} changed Sensitive since inventory; re-run inventory`);
  return kms.wrappedGet(key.sourceKeyId, await wrappingKeyId(kms, store, approval, mount, ids, journal));
}

/**
 * The Cosmian id of the OpenBao wrapping public key of `mount`: registered once
 * (the only source-KMS write), reused after a crash, removed when the run ends.
 * The key must be the one the admin approved (SPKI fingerprint).
 */
async function wrappingKeyId(kms: CosmianSource, store: TargetStore, approval: Approval, mount: string, ids: Map<string, string>, journal: Journal): Promise<string> {
  const cached = ids.get(mount);
  if (cached) return cached;
  const pem = await store.wrappingKeyPem(mount);
  const fp = spkiFingerprint(pem);
  if (fp !== approval.target.wrappingKeys[mount]) throw new MigrationError('APPROVAL_WRAPPING_KEY', `wrapping key of ${mount} differs from the approved one`);
  const recorded = journal.meta(`wrapping:${mount}`);
  if (recorded) {
    const a = await kms.getAttributes(recorded);
    if (a && a.state === 'Active') { ids.set(mount, recorded); return recorded; }
  }
  const der = createPublicKey(pem).export({ format: 'der', type: 'spki' }) as Buffer;
  const id = await kms.registerWrappingKey(der, `openbao-wrapping-${mount}`);
  journal.setMeta(`wrapping:${mount}`, id);
  journal.event('source.wrapping_key.registered', id, { mount, spkiSha256: fp });
  ids.set(mount, id);
  return id;
}

function readMaterial(approval: Approval, dir: string | undefined, key: KeyEntry): Buffer {
  const m = approval.material?.[key.sourceKeyId];
  if (!m) throw new MigrationError('MATERIAL_MISSING', `no approved material for ${key.sourceKeyId}`);
  if (!dir) throw new MigrationError('MATERIAL_DIR', '--material-dir is required for offline material');
  const inside = (p: string, root: string) => p.startsWith(root + '/');
  if (!inside(resolve(dir, m.file), resolve(dir))) throw new MigrationError('MATERIAL_PATH', 'material file must be inside --material-dir');
  // Also after symbolic links: a link inside the directory must not point outside it.
  let path: string;
  try { path = realpath(resolve(dir, m.file)); } catch { throw new MigrationError('MATERIAL_FILE', `material file of ${key.sourceKeyId} is not readable`); }
  if (!inside(path, realpath(dir))) throw new MigrationError('MATERIAL_PATH', 'material file must be inside --material-dir');
  const blob = readFileSync(path);
  if (sha256Hex(blob) !== m.sha256) { blob.fill(0); throw new MigrationError('MATERIAL_DIGEST', `material for ${key.sourceKeyId} does not match the approved digest`); }
  return blob;
}
