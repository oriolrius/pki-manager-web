/**
 * The database and OpenBao as a pair, enumerated from the DATABASE (not from
 * the manifest): every key the database owns must exist in OpenBao at the
 * version the row names, with the public key the row (or its certificate)
 * holds. This finds a restore that puts an older Raft snapshot next to a
 * later database: keys made after the snapshot (X.509 issue, SSH CA create
 * or rotate, RA provisioning) are missing.
 *
 *   keystore_objects  private_key rows in state active or revoked need their
 *                     Transit key; destroyed rows (deleted keys) need none;
 *                     public_key and certificate rows must agree with their key
 *   ssh_cas           every openbao-transit:<mount>:<name>:<version> reference,
 *                     with the OpenSSH fingerprint of the row
 *   integration_ras   every OpenBao binding, with the RA certificate's key
 *
 * Read-only on both sides. Key policy flags are not checked here (verify.ts
 * checks them for the keys of the manifest).
 */
import { X509Certificate } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
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

export async function checkPair(o: {
  target: DatabaseSync; store: TargetStore; raStore?: TargetStore; profile: TargetProfile;
  add: Add; counts: Record<string, number>; warnings: string[];
}): Promise<{ ok: boolean }> {
  const { target, add, counts, warnings } = o;
  counts.liveKeysVerified = 0;
  let ok = true;
  const fail = (name: string, detail: string) => { ok = false; add(name, false, detail); };
  const cache = new Map<string, Promise<TransitKey | null>>();
  const read = (st: TargetStore, mount: string, name: string) => {
    const k = `${st === o.store ? 'main' : 'ra'}|${mount}/${name}`;
    if (!cache.has(k)) cache.set(k, st.readKey(mount, name));
    return cache.get(k)!;
  };
  /** Public key of one version, or why there is none. */
  const versionKey = async (st: TargetStore, mount: string, name: string, version: number): Promise<{ pem: string } | { error: string }> => {
    let k: TransitKey | null;
    try { k = await read(st, mount, name); } catch (error) { return { error: (error as Error).message }; }
    if (!k) return { error: `${mount}/${name} is not in OpenBao` };
    const pem = k.publicKeys?.[version] ?? (version === 1 ? k.publicKeyPem : null);
    return pem ? { pem } : { error: `${mount}/${name} has no version ${version} (latest ${k.latestVersion})` };
  };

  if (tableExists(target, 'keystore_objects')) {
    type Ks = { id: string; object_type: string; state: string; mount: string | null; key_name: string | null; key_version: number | null; public_key_pem: string | null; certificate_pem: string | null; private_key_id: string | null };
    const rows = all(target, 'SELECT id, object_type, state, mount, key_name, key_version, public_key_pem, certificate_pem, private_key_id FROM keystore_objects ORDER BY id') as unknown as Ks[];
    const byId = new Map(rows.map(r => [r.id, r]));
    const live = (r: Ks) => r.state === 'active' || r.state === 'revoked';
    for (const r of rows.filter(x => x.object_type === 'private_key')) {
      const where = `keystore_objects:${r.id}`;
      if (r.state === 'pending') { warnings.push(`${where} is pending (a key creation that never finished); the runtime does not use it`); continue; }
      if (!r.mount || !r.key_name || !r.key_version) {
        if (live(r)) fail(`pair: ${where} key reference`, 'active key row without mount, key name or version');
        continue;
      }
      if (r.state === 'destroyed') {
        // A deleted key needs nothing. If OpenBao still has it, the snapshot predates the delete.
        const v = await versionKey(o.store, r.mount, r.key_name, r.key_version);
        if ('pem' in v) warnings.push(`${where} is destroyed but ${r.mount}/${r.key_name} still exists in OpenBao (snapshot older than the delete?): destroy it`);
        continue;
      }
      if (!live(r)) { fail(`pair: ${where} state`, `unknown state ${r.state}`); continue; }
      const v = await versionKey(o.store, r.mount, r.key_name, r.key_version);
      if ('error' in v) { fail(`pair: ${where} key in OpenBao`, `${v.error}: the database and the OpenBao snapshot are not one pair`); continue; }
      if (!r.public_key_pem || spkiFingerprint(v.pem) !== spkiFingerprint(r.public_key_pem)) { fail(`pair: ${where} public key`, `${r.mount}/${r.key_name} version ${r.key_version} holds another key than the row`); continue; }
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
    for (const r of all(target, 'SELECT id, status, kms_key_id, fingerprint_sha256 FROM ssh_cas ORDER BY id')) {
      const ref = parseSshKeyRef(String(r.kms_key_id));
      if (!ref) {
        if (String(r.kms_key_id).startsWith(SSH_KEY_REF_PREFIX)) fail(`pair: ssh_cas:${r.id} key reference`, `malformed reference ${String(r.kms_key_id)}`);
        continue; // a Cosmian id: the cutover gate reports it
      }
      const v = await versionKey(o.store, ref.mount, ref.name, ref.version);
      if ('error' in v) { fail(`pair: ssh_cas:${r.id} key in OpenBao`, `${v.error} (CA status ${String(r.status)}): the database and the OpenBao snapshot are not one pair`); continue; }
      let fp: string;
      try { fp = sshFingerprintOfP256(spkiDer(v.pem)); } catch (error) { fail(`pair: ssh_cas:${r.id} key type`, (error as Error).message); continue; }
      if (fp !== r.fingerprint_sha256) { fail(`pair: ssh_cas:${r.id} fingerprint`, `OpenBao key ${fp} != row ${String(r.fingerprint_sha256)}`); continue; }
      counts.liveKeysVerified++;
    }
  }

  if (tableExists(target, 'integration_ras') && columnsOf(target, 'integration_ras').has('key_provider')) {
    const st = o.raStore ?? o.store;
    for (const r of all(target, "SELECT integration_id, key_id, key_version, certificate_pem FROM integration_ras WHERE key_provider = 'openbao' ORDER BY integration_id")) {
      const where = `integration_ras:${r.integration_id}`;
      if (r.key_id === null) { warnings.push(`${where} has no RA key yet: v4 provisions one at the first SCEP request or ra/provision`); continue; }
      const version = Number(r.key_version);
      if (!Number.isInteger(version) || version < 1) { fail(`pair: ${where} key version`, `key_version ${String(r.key_version)}`); continue; }
      const v = await versionKey(st, o.profile.mounts.ra, String(r.key_id), version);
      if ('error' in v) { fail(`pair: ${where} RA key in OpenBao`, `${v.error}: the database and the OpenBao snapshot are not one pair`); continue; }
      if (r.certificate_pem) {
        let certFp: string | null = null;
        try { certFp = spkiFingerprint(new X509Certificate(String(r.certificate_pem))); } catch { certFp = null; }
        if (certFp !== spkiFingerprint(v.pem)) { fail(`pair: ${where} RA certificate`, `the RA certificate does not certify ${o.profile.mounts.ra}/${String(r.key_id)} version ${version}`); continue; }
      }
      counts.liveKeysVerified++;
    }
  }
  if (ok) add('pair: every key the database owns is in OpenBao with the same public key', true, `${counts.liveKeysVerified} keys`);
  return { ok };
}
