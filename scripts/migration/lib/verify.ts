/**
 * Verification of a migrated pair (target database + OpenBao), with no access
 * to Cosmian. Used after apply, after a restore from backup, and as the
 * cutover gate.
 *
 * - every transferred key: same public key (SPKI SHA-256), expected flags,
 *   fresh challenge signature verified locally with the source public key;
 * - X.509: keystore_objects rows for every key and certificate id the CA and
 *   certificate rows hold, with the right links, PEMs and Transit key;
 * - SSH: ssh_cas references are versioned OpenBao references, the OpenSSH
 *   fingerprint is unchanged; SCEP: bindings use OpenBao (optional unwrap test);
 * - the frozen source copy is the one the manifest binds (file and content
 *   digests, no pending WAL commits), and every row of every table of it is
 *   in the target, unchanged except for the writes of the migration
 *   (lib/reconcile.ts);
 * - the pair, from the database side: every key the target database owns is
 *   in OpenBao with the same public key (lib/pair.ts);
 * - cutover gate: reconciled with the frozen source, no key left to rotate,
 *   no id that only Cosmian can resolve.
 *
 * verifyRestore checks a restore of a backup pair: the pair evidence (the
 * database and the OpenBao state are the two halves of ONE backup directory,
 * lib/backup.ts), the pair and the gate from the database side, and the audit
 * history of the source.
 */
import { X509Certificate } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TargetStore } from './openbao.ts';
import { checkPairEvidence } from './backup.ts';
import { approvedTarget } from './policy.ts';
import { checkPair } from './pair.ts';
import { reconcile } from './reconcile.ts';
import { checkBinding } from './source.ts';
import { all, columnsOf, tableExists } from './sqlite.ts';
import { sshKeyRef, SSH_KEY_REF_PREFIX, type TargetProfile } from './target-db.ts';
import { challenge, checkAlreadyTargetRa, checkTargetKey, raBindingRow, raSessionCheck } from './transfer.ts';
import type { Approval, Manifest } from './types.ts';
import { normalizeSerial, sha256Hex, spkiDer, spkiFingerprint, sshFingerprintOfP256 } from './util.ts';

export interface Check { name: string; ok: boolean; detail?: string }
export interface VerifyReport {
  mode: 'migration' | 'restore';
  ok: boolean;
  /** Always false in restore mode: a later restore is not a cutover. */
  cutoverReady: boolean;
  cosmianRequired: boolean;
  /** Frozen source given, bound to the manifest and reconciled (migration mode). */
  reconciled: boolean;
  /** Restore mode: the database and OpenBao are proven to be the halves of one backup. */
  pairBound?: boolean;
  checks: Check[];
  counts: Record<string, number>;
  /** Findings that do not fail the check (pending rows, keys left after a delete). */
  warnings: string[];
}

type Ks = { id: string; object_type: string; state: string; mount: string | null; key_name: string | null; key_version: number | null; exportable: number | null; public_key_pem: string | null; certificate_pem: string | null; private_key_id: string | null; public_key_id: string | null; issuer_certificate_id: string | null };

export async function verifyMigration(o: {
  manifest: Manifest; approval: Approval; target: DatabaseSync; store: TargetStore; profile: TargetProfile;
  /** The frozen source copy (and its path, for the WAL and file checks). Required for cutoverReady. */
  source?: DatabaseSync; sourcePath?: string; raSessionCheck?: boolean;
  /** Identity for the RA mount when it differs from `store` (v4 runtime: the pki-manager-ra token). */
  raStore?: TargetStore;
}): Promise<VerifyReport> {
  const storeFor = (cls: string) => (cls === 'scep-ra' && o.raStore ? o.raStore : o.store);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const counts: Record<string, number> = { keysVerified: 0, keystoreRowsVerified: 0, rowsVerified: 0, pemVerified: 0, raUnwrapped: 0 };
  const ks = (id: string) => (tableExists(o.target, 'keystore_objects') ? o.target.prepare('SELECT * FROM keystore_objects WHERE id = ?').get(id) as Ks | undefined : undefined);
  let rotateOpen = 0;
  // SCEP needs two RA operations: sign (checked above for every RA key) and the fork's
  // session-key transport. The cutover gate needs proof of both for every RA key it keeps.
  const needsRaSession = (name: string) => add(`cutover: RA session-key transport tested for ${name}`, false, 'run verify with --ra-session-check and the RA token (--openbao-ra-token-file)');

  for (const key of o.manifest.keys) {
    const a = o.approval.keys[key.sourceKeyId];
    if (!a) { add(`approval for ${key.sourceKeyId}`, false); continue; }
    if (a.action === 'rotate') { rotateOpen++; add(`${key.class} ${key.sourceKeyId} resolved before cutover`, false, 'approved action is rotate: run the rotation procedure, then a new inventory'); continue; }
    if (a.action === 'history-only') continue;
    if (a.action === 'already-target') {
      // Pinned binding + inventoried RA certificate, v4 RA policy of the pinned version, the
      // certified public key, a signature with that version (and the session key, when asked).
      const r = await checkAlreadyTargetRa({ store: storeFor('scep-ra'), mount: o.profile.mounts.ra, key, approval: a, manifest: o.manifest, binding: id => raBindingRow(o.target, id), sessionCheck: o.raSessionCheck });
      for (const c of r.checks) add(c.name, c.ok, c.detail);
      if (r.checks.every(c => c.ok)) { counts.keysVerified++; counts.rowsVerified++; }
      if (r.unwrapped) counts.raUnwrapped++;
      if (!o.raSessionCheck) needsRaSession(r.name);
      continue;
    }
    if (a.action === 'drop-key') {
      if (key.class === 'x509-ca' || key.class === 'x509-leaf') {
        const r = ks(key.sourceKeyId);
        add(`dropped key ${key.sourceKeyId} recorded as destroyed`, r?.state === 'destroyed' && r.object_type === 'private_key');
      } else if (key.class === 'ssh-ca') {
        for (const r of key.references.filter(x => x.role === 'ssh-ca-key')) {
          const row = o.target.prepare('SELECT status, revocation_date AS d FROM ssh_cas WHERE id = ?').get(r.rowId) as { status: string; d: number | null } | undefined;
          add(`ssh_cas:${r.rowId} dropped key belongs to a revoked SSH CA`, !!row && row.status === 'retired' && row.d !== null);
        }
      } else if (key.class === 'scep-ra') {
        for (const r of key.references.filter(x => x.role === 'scep-ra-key')) {
          const row = o.target.prepare('SELECT b.key_id, i.revoked_at FROM integration_ras b JOIN integrations i ON i.id = b.integration_id WHERE b.integration_id = ?').get(r.rowId) as { key_id: string | null; revoked_at: number | null } | undefined;
          add(`integration_ras:${r.rowId} dropped RA key of a revoked integration`, !!row && row.key_id === null && row.revoked_at !== null);
        }
      }
      continue;
    }
    if (a.action === 'reprovision') {
      const pemSha = o.manifest.certificates.find(c => c.table === 'integration_ras' && key.references.some(r => r.role === 'scep-ra-key' && r.rowId === c.rowId))?.pemSha256;
      for (const r of key.references.filter(x => x.role === 'scep-ra-key')) {
        const row = o.target.prepare('SELECT key_provider, key_id, public_key_id, certificate_pem, previous FROM integration_ras WHERE integration_id = ?').get(r.rowId) as { key_provider: string; key_id: string | null; public_key_id: string | null; certificate_pem: string | null; previous: string } | undefined;
        // Before v4 runs: reset, the old RA certificate in the overlap list. After v4 provisioned:
        // a NEW OpenBao key whose certificate differs from the old one, the old one still listed.
        const prev = row ? (JSON.parse(row.previous || '[]') as { certificatePem: string }[]) : [];
        const listed = !!pemSha && prev.some(p => sha256Hex(new X509Certificate(p.certificatePem).raw) === pemSha);
        const reset = !!row && row.key_provider === 'openbao' && row.key_id === null && row.public_key_id === null && row.certificate_pem === null;
        const provisioned = !!row && row.key_provider === 'openbao' && !!row.key_id && !!row.certificate_pem && sha256Hex(new X509Certificate(row.certificate_pem).raw) !== pemSha;
        add(`integration_ras:${r.rowId} reprovisioned (new RA key; old RA certificate kept in the overlap list)`, (reset || provisioned) && listed, row ? `${row.key_provider}:${row.key_id}` : 'row missing');
        if (reset || provisioned) counts.rowsVerified++;
      }
      for (const r of key.references.filter(x => x.role === 'scep-ra-cert-alias')) {
        const row = o.target.prepare('SELECT kms_key_id FROM certificates WHERE id = ?').get(r.rowId) as { kms_key_id: string | null } | undefined;
        add(`certificates:${r.rowId} RA alias cleared`, !!row && row.kms_key_id === null);
      }
      continue;
    }
    // transfer
    const spec = approvedTarget(key, a, o.approval);
    const st = storeFor(key.class);
    const k = await st.readKey(spec.mount, spec.name);
    const bad = k ? checkTargetKey(k, spec, key.spkiSha256!, key.class) : ['missing in OpenBao'];
    add(`${key.class} key ${spec.mount}/${spec.name}`, bad.length === 0, bad.join('; '));
    if (!k || bad.length) continue;
    try { await challenge(st, spec, k.publicKeyPem!); counts.keysVerified++; add(`challenge ${spec.name}`, true); }
    catch (error) { add(`challenge ${spec.name}`, false, (error as Error).message); }

    if (key.class === 'x509-ca' || key.class === 'x509-leaf') {
      const priv = ks(key.sourceKeyId);
      const pub = key.sourcePublicKeyId ? ks(key.sourcePublicKeyId) : undefined;
      const rowOk = (r: Ks | undefined, type: string) => !!r && r.object_type === type && r.state === 'active' && r.mount === spec.mount && r.key_name === spec.name
        && Number(r.key_version) === 1 && Number(r.exportable) === (spec.exportable ? 1 : 0) && !!r.public_key_pem && spkiFingerprint(r.public_key_pem) === key.spkiSha256;
      const okPriv = rowOk(priv, 'private_key') && priv!.public_key_id === key.sourcePublicKeyId;
      const okPub = rowOk(pub, 'public_key') && pub!.private_key_id === key.sourceKeyId;
      add(`keystore private key ${key.sourceKeyId}`, okPriv);
      add(`keystore public key ${key.sourcePublicKeyId}`, okPub);
      for (const r of key.references.filter(x => x.role === 'x509-ca-key' || x.role === 'x509-leaf-key')) {
        const row = o.target.prepare(`SELECT kms_key_id FROM ${r.table} WHERE id = ?`).get(r.rowId) as { kms_key_id: string | null } | undefined;
        add(`${r.table}:${r.rowId} key id is the private key row`, row?.kms_key_id === key.sourceKeyId, row?.kms_key_id ?? 'row missing');
      }
      if (okPriv && okPub) counts.keystoreRowsVerified += 2;
    } else if (key.class === 'ssh-ca') {
      const ref = sshKeyRef(spec.mount, spec.name);
      const fp = sshFingerprintOfP256(spkiDer(k.publicKeyPem!));
      for (const r of key.references.filter(x => x.role === 'ssh-ca-key')) {
        const row = o.target.prepare('SELECT kms_key_id, kms_public_key_id, fingerprint_sha256 FROM ssh_cas WHERE id = ?').get(r.rowId) as { kms_key_id: string; kms_public_key_id: string; fingerprint_sha256: string } | undefined;
        const ok = !!row && row.kms_key_id === ref && row.kms_public_key_id === ref && row.fingerprint_sha256 === fp;
        add(`ssh_cas:${r.rowId} versioned reference and fingerprint`, ok, row ? `${row.kms_key_id} ${row.fingerprint_sha256}` : 'row missing');
        if (ok) counts.rowsVerified++;
      }
    } else if (key.class === 'scep-ra') {
      for (const r of key.references.filter(x => x.role === 'scep-ra-key')) {
        const row = o.target.prepare('SELECT key_provider, key_id, key_version, public_key_id, certificate_pem FROM integration_ras WHERE integration_id = ?').get(r.rowId) as { key_provider: string; key_id: string; key_version: number; public_key_id: string | null; certificate_pem: string | null } | undefined;
        const certFp = row?.certificate_pem ? spkiFingerprint(new X509Certificate(row.certificate_pem)) : null;
        const ok = !!row && row.key_provider === 'openbao' && row.key_id === spec.name && Number(row.key_version) === 1 && row.public_key_id === null && certFp === key.spkiSha256;
        add(`integration_ras:${r.rowId} OpenBao binding pinned to its RA certificate`, ok, row ? `${row.key_provider}:${row.key_id}#${row.key_version}` : 'row missing');
        if (ok) counts.rowsVerified++;
      }
      for (const r of key.references.filter(x => x.role === 'scep-ra-cert-alias')) {
        const row = o.target.prepare('SELECT kms_key_id FROM certificates WHERE id = ?').get(r.rowId) as { kms_key_id: string | null } | undefined;
        add(`certificates:${r.rowId} RA alias cleared`, !!row && row.kms_key_id === null);
      }
      if (o.raSessionCheck) { if (await raSessionCheck(st, spec.mount, spec.name, k.publicKeyPem!, 1, add)) counts.raUnwrapped++; }
      else needsRaSession(spec.name);
    }
  }

  // Certificates: the store row and the cached PEM.
  const accepted = new Set(o.approval.acceptMissingPem ?? []);
  const keyOf = new Map(o.manifest.keys.map(k => [k.sourceKeyId, k]));
  const reprovisioned = new Set(o.manifest.keys.filter(k => o.approval.keys[k.sourceKeyId]?.action === 'reprovision').flatMap(k => k.references.filter(r => r.role === 'scep-ra-key').map(r => r.rowId)));
  for (const c of o.manifest.certificates) {
    const id = `${c.table}:${c.rowId}`;
    if (c.table === 'integration_ras' && reprovisioned.has(c.rowId)) continue; // checked in the overlap list above
    let pem: string | null = null;
    if (c.table === 'integration_ras') pem = (o.target.prepare('SELECT certificate_pem AS pem FROM integration_ras WHERE integration_id = ?').get(c.rowId) as { pem: string | null } | undefined)?.pem ?? null;
    else if (c.kmsCertificateId) {
      const row = ks(c.kmsCertificateId);
      const key = c.sourceKeyId ? keyOf.get(c.sourceKeyId) : undefined;
      if (key && o.approval.keys[key.sourceKeyId]?.action === 'rotate' && c.keyLink === 'x509') continue; // reported above
      if (!row) { add(`${id} certificate store row`, accepted.has(id), 'no keystore_objects row'); continue; }
      pem = row.certificate_pem;
      const linked = c.keyLink === 'x509';
      const linkOk = row.object_type === 'certificate' && row.state === 'active'
        && row.private_key_id === (linked ? c.sourceKeyId : null)
        && row.public_key_id === (linked ? key?.sourcePublicKeyId ?? null : null)
        && row.issuer_certificate_id === (c.issuerKmsCertificateId ?? c.kmsCertificateId);
      add(`${id} certificate store links`, linkOk, `private ${row.private_key_id} public ${row.public_key_id} issuer ${row.issuer_certificate_id}`);
      if (c.table === 'certificates') {
        const cached = (o.target.prepare('SELECT certificate_pem AS pem FROM certificates WHERE id = ?').get(c.rowId) as { pem: string | null } | undefined)?.pem;
        add(`${id} certificate_pem cache`, !!cached && sha256Hex(new X509Certificate(cached).raw) === c.pemSha256);
      }
    }
    if (!pem) { add(`${id} certificate PEM`, accepted.has(id), 'no PEM'); continue; }
    let cert: X509Certificate | null = null;
    try { cert = new X509Certificate(pem); } catch { /* reported below */ }
    const ok = !!cert && sha256Hex(cert.raw) === c.pemSha256 && normalizeSerial(cert.serialNumber) === normalizeSerial(c.serial) && spkiFingerprint(cert) === c.spkiSha256;
    add(`${id} certificate PEM`, ok, ok ? '' : 'digest, serial or public key differs');
    if (ok) counts.pemVerified++;
  }

  // The frozen source: bound to the manifest, then reconciled row by row. The gate needs it.
  let reconciled = false;
  if (o.source) {
    const bad = checkBinding(o.manifest.source, o.sourcePath, o.source);
    add('frozen source is the copy the manifest binds (no WAL commits, file and content digests)', bad.length === 0, bad.join('; '));
    const r = reconcile({ source: o.source, target: o.target, manifest: o.manifest, approval: o.approval, add, mode: 'full' });
    counts.rowsReconciled = r.rows;
    reconciled = bad.length === 0 && r.ok;
  } else {
    add('cutover: reconciliation with the frozen source', false, 'no source database: pass --source-db with the frozen v3 copy the manifest was made from');
  }

  // The pair from the database side: keys the manifest does not know (made after the cutover).
  const warnings: string[] = [];
  await checkPair({ target: o.target, store: o.store, raStore: o.raStore, profile: o.profile, add, counts, warnings });

  const unresolved = cosmianGate(o.target, accepted, add, o);
  const ok = checks.every(c => c.ok || c.name.endsWith('resolved before cutover') || c.name.startsWith('resolves without Cosmian') || c.name.startsWith('cutover: '));
  const cutoverReady = checks.every(c => c.ok) && reconciled && rotateOpen === 0 && unresolved === 0 && o.manifest.source.kmsRead;
  return { mode: 'migration', ok, cutoverReady, cosmianRequired: unresolved > 0 || rotateOpen > 0, reconciled, checks, counts, warnings };
}

/**
 * A restore of one backup pair, possibly after v4 accepted writes (new keys,
 * revocations, deleted keys). Nothing is compared with the manifest's key list;
 * every check starts from the database. Without `evidence` (the backup
 * directory and an operator identity to read the pair marker) the result is
 * never ok: the database side alone cannot tell which backup a Raft snapshot
 * comes from when only rows changed between two backups.
 * With `source`, the audit history of the frozen v3 copy must still be there.
 */
export async function verifyRestore(o: {
  target: DatabaseSync; store: TargetStore; raStore?: TargetStore; profile: TargetProfile;
  source?: DatabaseSync;
  /** Optional: the decisions of the migration (accepted missing PEMs, dropped keys). */
  manifest?: Manifest; approval?: Approval;
  /** The backup directory that was restored, and the identity that reads its marker. */
  evidence?: { dir: string; operator: TargetStore };
}): Promise<VerifyReport> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  let pairBound = false;
  if (o.evidence) {
    const e = await checkPairEvidence({ dir: o.evidence.dir, target: o.target, operator: o.evidence.operator });
    pairBound = e.problems.length === 0;
    add('restore: the database and OpenBao are the two halves of one backup (pair marker + content digest)', pairBound, pairBound ? `backup ${e.backupId}` : e.problems.join('; '));
  } else {
    add('restore: the database and OpenBao are the two halves of one backup (pair marker + content digest)', false, 'no pair evidence: pass --backup-dir (the restored backup directory) and --openbao-operator-token-file; the keys alone cannot prove the pair');
  }
  await checkPair({ target: o.target, store: o.store, raStore: o.raStore, profile: o.profile, add, counts, warnings });
  const unresolved = cosmianGate(o.target, new Set(o.approval?.acceptMissingPem ?? []), add, o);
  if (o.source) counts.rowsReconciled = reconcile({ source: o.source, target: o.target, add, mode: 'history' }).rows;
  return { mode: 'restore', ok: checks.every(c => c.ok), cutoverReady: false, cosmianRequired: unresolved > 0, reconciled: false, pairBound, checks, counts, warnings };
}

/** Every id the v4 runtime looks up must resolve without Cosmian. Returns the number that do not. */
export function cosmianGate(target: DatabaseSync, accepted: Set<string>, add: (name: string, ok: boolean, detail?: string) => void, o: { manifest?: Manifest; approval?: Approval } = {}): number {
  const ks = (id: string) => (tableExists(target, 'keystore_objects') ? target.prepare('SELECT * FROM keystore_objects WHERE id = ?').get(id) as Ks | undefined : undefined);
  let unresolved = 0;
  const need = (what: string, ok: boolean) => { if (!ok) { unresolved++; add(`resolves without Cosmian: ${what}`, false); } };
  if (tableExists(target, 'certificate_authorities')) {
    for (const r of all(target, 'SELECT id, kms_key_id, kms_certificate_id FROM certificate_authorities')) {
      const cert = ks(String(r.kms_certificate_id));
      need(`certificate_authorities:${r.id} certificate`, cert?.object_type === 'certificate');
      const keyId = r.kms_key_id === r.kms_certificate_id ? cert?.private_key_id : String(r.kms_key_id);
      const key = keyId ? ks(keyId) : undefined;
      need(`certificate_authorities:${r.id} key`, key?.object_type === 'private_key' && (key.state === 'active' || key.state === 'destroyed'));
    }
  }
  if (tableExists(target, 'certificates')) {
    for (const r of all(target, 'SELECT id, kms_key_id, kms_certificate_id FROM certificates')) {
      const id = `certificates:${r.id}`;
      need(`${id} certificate`, ks(String(r.kms_certificate_id))?.object_type === 'certificate' || accepted.has(id));
      if (r.kms_key_id !== null) need(`${id} key`, ks(String(r.kms_key_id))?.object_type === 'private_key');
    }
  }
  if (tableExists(target, 'ssh_cas')) {
    const droppedSsh = new Set((o.manifest?.keys ?? []).filter(k => k.class === 'ssh-ca' && o.approval?.keys[k.sourceKeyId]?.action === 'drop-key').flatMap(k => k.references.filter(r => r.role === 'ssh-ca-key').map(r => r.rowId)));
    for (const r of all(target, 'SELECT id, kms_key_id, kms_public_key_id, revocation_date FROM ssh_cas')) {
      const dropped = droppedSsh.has(String(r.id)) && r.revocation_date !== null;
      need(`ssh_cas:${r.id} key reference`, dropped || (String(r.kms_key_id).startsWith(SSH_KEY_REF_PREFIX) && r.kms_key_id === r.kms_public_key_id));
    }
  }
  if (tableExists(target, 'integration_ras') && columnsOf(target, 'integration_ras').has('key_provider')) {
    for (const r of all(target, 'SELECT b.integration_id, b.key_provider, b.key_id, b.public_key_id, b.certificate_pem, i.revoked_at FROM integration_ras b LEFT JOIN integrations i ON i.id = b.integration_id')) {
      const unassigned = r.key_id === null && r.public_key_id === null && r.certificate_pem === null;
      const droppedRevoked = r.key_id === null && r.public_key_id === null && r.revoked_at !== null && r.revoked_at !== undefined;
      need(`integration_ras:${r.integration_id} key provider`, r.key_provider === 'openbao' || unassigned || droppedRevoked);
    }
  }
  if (unresolved === 0) add('every key and certificate id resolves without Cosmian', true);
  return unresolved;
}
