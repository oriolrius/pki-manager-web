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
 * - reconciliation with the frozen source copy: rows, serials, statuses,
 *   revocations, renewal links, SSH serial counters, CRLs, token hashes;
 * - cutover gate: no key left to rotate, no id that only Cosmian can resolve.
 */
import { constants, createPublicKey, publicEncrypt, randomBytes, X509Certificate } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TargetStore } from './openbao.ts';
import { approvedTarget } from './policy.ts';
import { all, columnsOf, tableExists } from './sqlite.ts';
import { sshKeyRef, SSH_KEY_REF_PREFIX, type TargetProfile } from './target-db.ts';
import { challenge, checkTargetKey } from './transfer.ts';
import type { Approval, Manifest } from './types.ts';
import { normalizeSerial, sha256Hex, spkiDer, spkiFingerprint, sshFingerprintOfP256 } from './util.ts';

export interface Check { name: string; ok: boolean; detail?: string }
export interface VerifyReport { ok: boolean; cutoverReady: boolean; cosmianRequired: boolean; checks: Check[]; counts: Record<string, number> }

type Ks = { id: string; object_type: string; state: string; mount: string | null; key_name: string | null; key_version: number | null; exportable: number | null; public_key_pem: string | null; certificate_pem: string | null; private_key_id: string | null; public_key_id: string | null; issuer_certificate_id: string | null };

export async function verifyMigration(o: {
  manifest: Manifest; approval: Approval; target: DatabaseSync; store: TargetStore; profile: TargetProfile;
  source?: DatabaseSync; raSessionCheck?: boolean;
}): Promise<VerifyReport> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const counts: Record<string, number> = { keysVerified: 0, keystoreRowsVerified: 0, rowsVerified: 0, pemVerified: 0, raUnwrapped: 0 };
  const ks = (id: string) => (tableExists(o.target, 'keystore_objects') ? o.target.prepare('SELECT * FROM keystore_objects WHERE id = ?').get(id) as Ks | undefined : undefined);
  let rotateOpen = 0;

  for (const key of o.manifest.keys) {
    const a = o.approval.keys[key.sourceKeyId];
    if (!a) { add(`approval for ${key.sourceKeyId}`, false); continue; }
    if (a.action === 'rotate') { rotateOpen++; add(`${key.class} ${key.sourceKeyId} resolved before cutover`, false, 'approved action is rotate: run the rotation procedure, then a new inventory'); continue; }
    if (a.action === 'history-only') continue;
    if (a.action === 'already-target') {
      const ref = key.references.find(r => r.role === 'scep-ra-openbao-key');
      const name = ref ? ref.sourceId.replace(/^openbao:/, '') : '';
      const k = name ? await o.store.readKey(o.profile.mounts.ra, name) : null;
      add(`RA key already in OpenBao ${name}`, !!k && !!k.publicKeyPem, k ? '' : 'not readable');
      continue;
    }
    if (a.action === 'drop-key') {
      const r = ks(key.sourceKeyId);
      add(`dropped key ${key.sourceKeyId} recorded as destroyed`, r?.state === 'destroyed' && r.object_type === 'private_key');
      continue;
    }
    // transfer
    const spec = approvedTarget(key, a, o.approval);
    const k = await o.store.readKey(spec.mount, spec.name);
    const bad = k ? checkTargetKey(k, spec, key.spkiSha256!) : ['missing in OpenBao'];
    add(`${key.class} key ${spec.mount}/${spec.name}`, bad.length === 0, bad.join('; '));
    if (!k || bad.length) continue;
    try { await challenge(o.store, spec, k.publicKeyPem!); counts.keysVerified++; add(`challenge ${spec.name}`, true); }
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
      if (o.raSessionCheck) {
        try {
          const sessionKey = randomBytes(32);
          const ct = publicEncrypt({ key: createPublicKey(k.publicKeyPem!), padding: constants.RSA_PKCS1_PADDING }, sessionKey);
          const got = await o.store.sessionKey(spec.mount, spec.name, ct, 32);
          add(`RA session-key unwrap ${spec.name}`, got.equals(sessionKey));
          if (got.equals(sessionKey)) counts.raUnwrapped++;
        } catch (error) { add(`RA session-key unwrap ${spec.name}`, false, (error as Error).message); }
      }
    }
  }

  // Certificates: the store row and the cached PEM.
  const accepted = new Set(o.approval.acceptMissingPem ?? []);
  const keyOf = new Map(o.manifest.keys.map(k => [k.sourceKeyId, k]));
  for (const c of o.manifest.certificates) {
    const id = `${c.table}:${c.rowId}`;
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

  if (o.source) reconcile(o.source, o.target, add);

  // Cutover gate: every id the runtime will look up must resolve without Cosmian.
  let unresolved = 0;
  const need = (what: string, ok: boolean) => { if (!ok) { unresolved++; add(`resolves without Cosmian: ${what}`, false); } };
  if (tableExists(o.target, 'certificate_authorities')) {
    for (const r of all(o.target, 'SELECT id, kms_key_id, kms_certificate_id FROM certificate_authorities')) {
      const cert = ks(String(r.kms_certificate_id));
      need(`certificate_authorities:${r.id} certificate`, cert?.object_type === 'certificate');
      const keyId = r.kms_key_id === r.kms_certificate_id ? cert?.private_key_id : String(r.kms_key_id);
      const key = keyId ? ks(keyId) : undefined;
      need(`certificate_authorities:${r.id} key`, key?.object_type === 'private_key' && (key.state === 'active' || key.state === 'destroyed'));
    }
  }
  if (tableExists(o.target, 'certificates')) {
    for (const r of all(o.target, 'SELECT id, kms_key_id, kms_certificate_id FROM certificates')) {
      const id = `certificates:${r.id}`;
      need(`${id} certificate`, ks(String(r.kms_certificate_id))?.object_type === 'certificate' || accepted.has(id));
      if (r.kms_key_id !== null) need(`${id} key`, ks(String(r.kms_key_id))?.object_type === 'private_key');
    }
  }
  if (tableExists(o.target, 'ssh_cas')) {
    for (const r of all(o.target, 'SELECT id, kms_key_id, kms_public_key_id FROM ssh_cas')) {
      need(`ssh_cas:${r.id} key reference`, String(r.kms_key_id).startsWith(SSH_KEY_REF_PREFIX) && r.kms_key_id === r.kms_public_key_id);
    }
  }
  if (tableExists(o.target, 'integration_ras') && columnsOf(o.target, 'integration_ras').has('key_provider')) {
    for (const r of all(o.target, 'SELECT integration_id, key_provider, key_id, public_key_id, certificate_pem FROM integration_ras')) {
      const unassigned = r.key_id === null && r.public_key_id === null && r.certificate_pem === null;
      need(`integration_ras:${r.integration_id} key provider`, r.key_provider === 'openbao' || unassigned);
    }
  }
  if (unresolved === 0) add('every key and certificate id resolves without Cosmian', true);
  const ok = checks.every(c => c.ok || c.name.endsWith('resolved before cutover') || c.name.startsWith('resolves without Cosmian'));
  const cutoverReady = checks.every(c => c.ok) && rotateOpen === 0 && unresolved === 0 && o.manifest.source.kmsRead;
  return { ok, cutoverReady, cosmianRequired: unresolved > 0 || rotateOpen > 0, checks, counts };
}

function reconcile(source: DatabaseSync, target: DatabaseSync, add: (name: string, ok: boolean, detail?: string) => void): void {
  const digest = (db: DatabaseSync, sql: string) => sha256Hex(JSON.stringify(all(db, sql)));
  const has = (t: string) => tableExists(source, t);
  const queries: [string, string][] = [];
  if (has('certificate_authorities')) queries.push(['CAs (ids, serial, status, revocation)', 'SELECT id, kms_certificate_id, kms_key_id, serial_number, status, revocation_date, revocation_reason, not_after FROM certificate_authorities ORDER BY id']);
  if (has('certificates')) queries.push(['certificates (ca, serial, status, revocation, renewal links, owner)', 'SELECT id, ca_id, kms_certificate_id, serial_number, status, revocation_date, revocation_reason, renewed_from_id, integration_id, source_type FROM certificates ORDER BY id']);
  if (has('crls')) queries.push(['CRLs (number, content)', 'SELECT id, ca_id, crl_number, crl_pem FROM crls ORDER BY id']);
  if (has('ssh_cas')) queries.push(['SSH CAs (zone, type, status, serial counter, public key)', 'SELECT id, zone_id, ca_type, status, next_serial, openssh_public_key, fingerprint_sha256, predecessor_ca_id FROM ssh_cas ORDER BY id']);
  if (has('ssh_certificates')) queries.push(['SSH certificates (serial, status, revocation, blob, signer)', 'SELECT id, ca_id, serial, status, revocation_date, cert_openssh, kms_signing_key_id FROM ssh_certificates ORDER BY id']);
  if (has('integrations')) queries.push(['integrations (token hashes, CA bindings, revocation)', 'SELECT id, ca_id, kind, token_hash, revoked_at FROM integrations ORDER BY id']);
  if (has('integration_ras')) queries.push(['RA bindings (certificates, previous)', 'SELECT integration_id, ca_id, certificate_id, certificate_pem, previous FROM integration_ras ORDER BY integration_id']);
  for (const [name, sql] of queries) add(`reconcile ${name}`, digest(source, sql) === digest(target, sql));
  for (const t of ['zones', 'ssh_hosts', 'ssh_identities', 'ssh_principals', 'ssh_user_principals', 'ssh_fleet_tokens']) {
    if (!has(t)) continue;
    const n = (db: DatabaseSync) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    add(`reconcile ${t} row count`, n(source) === n(target), `${n(source)} vs ${n(target)}`);
  }
}
