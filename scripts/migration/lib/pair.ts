/**
 * The database and OpenBao as a pair, enumerated from the DATABASE (not from
 * the manifest): every key the database owns must exist in OpenBao at the
 * version the row names, with the public key the row (or its certificate)
 * holds, and that version must pass the v4 runtime key policy of its purpose
 * (key-policy.ts `runtimeKeyProblems`, the same check as the migration). This
 * finds a restore that puts an older Raft snapshot next to a later database
 * (keys made after the snapshot are missing), and a key whose policy changed
 * after the cutover while its key material stayed the same (soft-deleted,
 * `min_encryption_version` above the pinned version, deletion allowed, ...).
 *
 *   keystore_objects  private_key rows in state active need their Transit key in
 *                     the X.509 mount of the profile (the backend token can use
 *                     no other mount), the runtime X.509 policy for key_version,
 *                     the type of key_algorithm, and the row's `exportable` flag
 *                     (downloads export only when the row allows it, and the
 *                     fork exports only when the key allows it). Revoked rows
 *                     need the key with the same public key; the runtime only
 *                     reads them (no sign, no export), so policy findings are
 *                     warnings. Destroyed rows (deleted keys) need none; pending
 *                     rows (an unfinished creation) are a warning. public_key and
 *                     certificate rows must agree with their key.
 *   ssh_cas           every openbao-transit:<mount>:<name>:<version> reference:
 *                     the SSH mount of the profile (ssh-transit refuses others),
 *                     kms_public_key_id equal to kms_key_id, the runtime SSH CA
 *                     policy (imported keys allowed), and the public key of the
 *                     row (fingerprint and the pinned openssh_public_key line).
 *   integration_ras   every OpenBao binding in the RA mount of the profile, with
 *                     the runtime RA policy (imported keys only with an RA
 *                     certificate, as ra.service.ts) and the RA certificate's key.
 *
 * Read-only on both sides.
 */
import { createHash, X509Certificate } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runtimeKeyProblems, type Purpose } from './key-policy.ts';
import type { TargetStore, TransitKey } from './openbao.ts';
import { all, columnsOf, tableExists } from './sqlite.ts';
import { SSH_KEY_REF_PREFIX, type TargetProfile } from './target-db.ts';
import { spkiDer, spkiFingerprint, sshFingerprintOfP256 } from './util.ts';

type Add = (name: string, ok: boolean, detail?: string) => void;

/** `openbao-transit:<mount>:<name>:<version>` (the mount may hold `/`, never `:`). */
export function parseSshKeyRef(ref: string): { mount: string; name: string; version: number } | null {
  if (!ref.startsWith(SSH_KEY_REF_PREFIX)) return null;
  const parts = ref.slice(SSH_KEY_REF_PREFIX.length).split(':');
  if (parts.length !== 3 || !/^[1-9][0-9]*$/.test(parts[2])) return null;
  return { mount: parts[0], name: parts[1], version: Number(parts[2]) };
}

/** keystore_objects.key_algorithm -> Transit key type (backend keystore/openbao.ts TRANSIT_TYPE). */
const TRANSIT_TYPE: Record<string, string> = {
  'RSA-2048': 'rsa-2048', 'RSA-3072': 'rsa-3072', 'RSA-4096': 'rsa-4096', 'ECDSA-P256': 'ecdsa-p256', 'ECDSA-P384': 'ecdsa-p384',
};

/** SHA256 fingerprint of an OpenSSH public key line (the base64 blob), as `ssh-keygen -l`. */
function opensshLineFingerprint(line: string): string | null {
  const b64 = line.trim().split(/\s+/)[1];
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return `SHA256:${createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '')}`;
}

export async function checkPair(o: {
  target: DatabaseSync; store: TargetStore; raStore?: TargetStore; profile: TargetProfile;
  add: Add; counts: Record<string, number>; warnings: string[];
}): Promise<{ ok: boolean }> {
  const { target, add, counts, warnings, profile } = o;
  counts.liveKeysVerified = 0;
  let ok = true;
  const fail = (name: string, detail: string) => { ok = false; add(name, false, detail); };
  const cache = new Map<string, Promise<TransitKey | null>>();
  const read = (st: TargetStore, mount: string, name: string) => {
    const k = `${st === o.store ? 'main' : 'ra'}|${mount}/${name}`;
    if (!cache.has(k)) cache.set(k, st.readKey(mount, name));
    return cache.get(k)!;
  };
  /** The key, or why there is none. */
  const keyOf = async (st: TargetStore, mount: string, name: string): Promise<{ key: TransitKey } | { error: string }> => {
    let k: TransitKey | null;
    try { k = await read(st, mount, name); } catch (error) { return { error: (error as Error).message }; }
    return k ? { key: k } : { error: `${mount}/${name} is not in OpenBao` };
  };
  /**
   * The runtime check of one owned version: the problems of the v4 client of
   * `purpose` and the public key of that version (null when it has none).
   */
  const runtime = (purpose: Purpose, name: string, k: TransitKey, version: number, allowImported: boolean) =>
    runtimeKeyProblems(purpose, name, k.data, version, { allowImported });

  if (tableExists(target, 'keystore_objects')) {
    type Ks = { id: string; object_type: string; state: string; mount: string | null; key_name: string | null; key_version: number | null; key_algorithm: string | null; exportable: number | null; public_key_pem: string | null; certificate_pem: string | null; private_key_id: string | null };
    const rows = all(target, 'SELECT id, object_type, state, mount, key_name, key_version, key_algorithm, exportable, public_key_pem, certificate_pem, private_key_id FROM keystore_objects ORDER BY id') as unknown as Ks[];
    const byId = new Map(rows.map(r => [r.id, r]));
    const live = (r: Ks) => r.state === 'active' || r.state === 'revoked';
    for (const r of rows.filter(x => x.object_type === 'private_key')) {
      const where = `keystore_objects:${r.id}`;
      if (r.state === 'pending') { warnings.push(`${where} is pending (a key creation that never finished); the runtime does not use it`); continue; }
      if (!r.mount || !r.key_name || !r.key_version) {
        if (live(r)) fail(`pair: ${where} key reference`, `${r.state} key row without mount, key name or version`);
        continue;
      }
      if (r.state === 'destroyed') {
        // A deleted key needs nothing. If OpenBao still has it, the snapshot predates the delete.
        const v = await keyOf(o.store, r.mount, r.key_name);
        if ('key' in v) warnings.push(`${where} is destroyed but ${r.mount}/${r.key_name} still exists in OpenBao (snapshot older than the delete?): destroy it`);
        continue;
      }
      if (!live(r)) { fail(`pair: ${where} state`, `unknown state ${r.state}`); continue; }
      const ref = `${r.mount}/${r.key_name} version ${r.key_version}`;
      const v = await keyOf(o.store, r.mount, r.key_name);
      if ('error' in v) { fail(`pair: ${where} key in OpenBao`, `${v.error}: the database and the OpenBao snapshot are not one pair`); continue; }
      // Migrated keys are imported, keys v4 made are generated: the X.509 client accepts both.
      const rt = runtime('x509', r.key_name, v.key, r.key_version, true);
      if (!rt.publicKeyPem) { fail(`pair: ${where} key in OpenBao`, `${ref}: ${rt.problems.join('; ')}: the database and the OpenBao snapshot are not one pair`); continue; }
      if (!r.public_key_pem || spkiFingerprint(rt.publicKeyPem) !== spkiFingerprint(r.public_key_pem)) { fail(`pair: ${where} public key`, `${ref} holds another key than the row`); continue; }
      // What the runtime relies on besides the Transit policy: the mount its token can use, the
      // algorithm it signs with (RSA padding, hash), and the export decision of the row.
      const bad = [...rt.problems];
      if (r.mount !== profile.mounts.x509) bad.push(`mount ${r.mount} is not the X.509 mount ${profile.mounts.x509} of the profile (the backend token cannot use it)`);
      const type = r.key_algorithm ? TRANSIT_TYPE[r.key_algorithm] : undefined;
      if (!type) bad.push(`key_algorithm ${String(r.key_algorithm)} is not one the runtime knows`);
      else if (type !== String(v.key.data.type ?? '')) bad.push(`key_algorithm ${r.key_algorithm} but the Transit key is ${String(v.key.data.type)}`);
      if (r.exportable === null || (r.exportable !== 0 && r.exportable !== 1)) bad.push(`exportable ${String(r.exportable)} in the row is not 0 or 1`);
      else if (typeof v.key.data.exportable === 'boolean' && (r.exportable === 1) !== v.key.data.exportable) {
        bad.push(`the row says exportable=${r.exportable === 1} but the Transit key says ${String(v.key.data.exportable)}`);
      }
      if (bad.length) {
        // A revoked key is only read from its row: report, do not fail.
        if (r.state === 'revoked') warnings.push(`${where} (revoked) ${ref}: ${bad.join('; ')}`);
        else { fail(`pair: ${where} v4 runtime policy`, `${ref}: ${bad.join('; ')}`); continue; }
      }
      counts.liveKeysVerified++;
    }
    for (const r of rows.filter(x => x.object_type === 'public_key' && live(x) && x.private_key_id)) {
      const p = byId.get(r.private_key_id!);
      const same = !!p && p.object_type === 'private_key' && p.mount === r.mount && p.key_name === r.key_name && p.key_version === r.key_version
        && !!p.public_key_pem && !!r.public_key_pem && spkiFingerprint(p.public_key_pem) === spkiFingerprint(r.public_key_pem);
      if (!same) fail(`pair: keystore_objects:${r.id} public key row`, `does not match its private key row ${r.private_key_id}`);
    }
    for (const r of rows.filter(x => x.object_type === 'certificate' && x.state === 'active')) {
      let cert: X509Certificate | null = null;
      try { cert = r.certificate_pem ? new X509Certificate(r.certificate_pem) : null; } catch { cert = null; }
      if (!cert) { fail(`pair: keystore_objects:${r.id} certificate`, 'no readable certificate PEM'); continue; }
      if (!r.private_key_id) continue;
      const p = byId.get(r.private_key_id);
      if (!p || p.object_type !== 'private_key') { fail(`pair: keystore_objects:${r.id} certificate key link`, `private key row ${r.private_key_id} is missing`); continue; }
      if (p.public_key_pem && spkiFingerprint(cert) !== spkiFingerprint(p.public_key_pem)) fail(`pair: keystore_objects:${r.id} certificate key link`, `the certificate does not certify the key of ${r.private_key_id}`);
    }
  }

  if (tableExists(target, 'ssh_cas')) {
    for (const r of all(target, 'SELECT id, status, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256 FROM ssh_cas ORDER BY id')) {
      const where = `ssh_cas:${r.id}`;
      const ref = parseSshKeyRef(String(r.kms_key_id));
      if (!ref) {
        if (String(r.kms_key_id).startsWith(SSH_KEY_REF_PREFIX)) fail(`pair: ${where} key reference`, `malformed reference ${String(r.kms_key_id)}`);
        continue; // a Cosmian id: the cutover gate reports it
      }
      const v = await keyOf(o.store, ref.mount, ref.name);
      if ('error' in v) { fail(`pair: ${where} key in OpenBao`, `${v.error} (CA status ${String(r.status)}): the database and the OpenBao snapshot are not one pair`); continue; }
      const rt = runtime('ssh-ca', ref.name, v.key, ref.version, true);
      const at = `${ref.mount}/${ref.name} version ${ref.version}`;
      if (!rt.publicKeyPem) { fail(`pair: ${where} key in OpenBao`, `${at}: ${rt.problems.join('; ')} (CA status ${String(r.status)}): the database and the OpenBao snapshot are not one pair`); continue; }
      let fp: string;
      try { fp = sshFingerprintOfP256(spkiDer(rt.publicKeyPem)); } catch (error) { fail(`pair: ${where} key type`, (error as Error).message); continue; }
      if (fp !== r.fingerprint_sha256) { fail(`pair: ${where} fingerprint`, `OpenBao key ${fp} != row ${String(r.fingerprint_sha256)}`); continue; }
      // signWithSshCa pins the key to openssh_public_key, not to the fingerprint column.
      const lineFp = opensshLineFingerprint(String(r.openssh_public_key ?? ''));
      if (lineFp !== fp) { fail(`pair: ${where} fingerprint`, `OpenBao key ${fp} != openssh_public_key ${String(lineFp)}`); continue; }
      const bad = [...rt.problems];
      if (ref.mount !== profile.mounts.ssh) bad.push(`mount ${ref.mount} is not the SSH mount ${profile.mounts.ssh} of the profile (the runtime refuses the reference)`);
      if (r.kms_public_key_id !== r.kms_key_id) bad.push(`kms_public_key_id ${String(r.kms_public_key_id)} differs from kms_key_id (the runtime refuses the CA)`);
      if (bad.length) { fail(`pair: ${where} v4 runtime policy`, `${at} (CA status ${String(r.status)}): ${bad.join('; ')}`); continue; }
      counts.liveKeysVerified++;
    }
  }

  if (tableExists(target, 'integration_ras') && columnsOf(target, 'integration_ras').has('key_provider')) {
    const st = o.raStore ?? o.store;
    const mount = profile.mounts.ra;
    for (const r of all(target, "SELECT integration_id, key_id, key_version, certificate_pem, previous FROM integration_ras WHERE key_provider = 'openbao' ORDER BY integration_id")) {
      const where = `integration_ras:${r.integration_id}`;
      // The SCEP gateway refuses to start when an unexpired overlap certificate does not certify
      // the active RA key (scep/main.go, renew.go); v4 keeps the unexpired list at provisioning.
      const foreign = overlapProblems(r.previous, r.certificate_pem);
      if (foreign) { fail(`pair: ${where} overlap list`, foreign); continue; }
      if (r.key_id === null) { warnings.push(`${where} has no RA key yet: v4 provisions one at the first SCEP request or ra/provision`); continue; }
      const version = Number(r.key_version);
      if (!Number.isInteger(version) || version < 1) { fail(`pair: ${where} key version`, `key_version ${String(r.key_version)}`); continue; }
      const name = String(r.key_id);
      const v = await keyOf(st, mount, name);
      if ('error' in v) { fail(`pair: ${where} RA key in OpenBao`, `${v.error}: the database and the OpenBao snapshot are not one pair`); continue; }
      let cert: X509Certificate | null = null;
      if (r.certificate_pem) {
        try { cert = new X509Certificate(String(r.certificate_pem)); } catch { fail(`pair: ${where} RA certificate`, 'the RA certificate PEM does not parse'); continue; }
      }
      // ra.service.ts: an imported (migrated) key only with an RA certificate that pins it.
      const rt = runtime('scep-ra', name, v.key, version, cert !== null);
      if (!rt.publicKeyPem) { fail(`pair: ${where} RA key in OpenBao`, `${mount}/${name} version ${version}: ${rt.problems.join('; ')}: the database and the OpenBao snapshot are not one pair`); continue; }
      if (cert && spkiFingerprint(cert) !== spkiFingerprint(rt.publicKeyPem)) { fail(`pair: ${where} RA certificate`, `the RA certificate does not certify ${mount}/${name} version ${version}`); continue; }
      if (rt.problems.length) { fail(`pair: ${where} v4 runtime policy`, `${mount}/${name} version ${version}: ${rt.problems.join('; ')}`); continue; }
      counts.liveKeysVerified++;
    }
  }
  if (ok) add('pair: every key the database owns is in OpenBao with the same public key and the v4 runtime policy', true, `${counts.liveKeysVerified} keys`);
  return { ok };
}

/**
 * Unexpired entries of an RA overlap list (`previous`) that the active RA key cannot use:
 * with no RA certificate yet, any unexpired entry; else an entry that certifies another key.
 * Returns a description, or null when the list is usable.
 */
export function overlapProblems(previous: unknown, currentPem: unknown): string | null {
  let list: unknown;
  try { list = previous === null || previous === undefined || previous === '' ? [] : JSON.parse(String(previous)); } catch { return 'previous is not JSON'; }
  if (!Array.isArray(list)) return 'previous is not a list';
  let current: string | null = null;
  if (typeof currentPem === 'string' && currentPem) { try { current = spkiFingerprint(new X509Certificate(currentPem)); } catch { return 'RA certificate does not parse'; } }
  let bad = 0;
  for (const e of list as { certificatePem?: unknown }[]) {
    let cert: X509Certificate;
    try { cert = new X509Certificate(String(e?.certificatePem)); } catch { return 'an overlap entry does not parse'; }
    if (new Date(cert.validTo) <= new Date()) continue;
    if (current === null || spkiFingerprint(cert) !== current) bad++;
  }
  return bad ? `${bad} unexpired overlap certificate(s) do not certify the active RA key (the SCEP gateway would refuse to start)` : null;
}
