/**
 * Test doubles with real cryptography:
 * - FakeCosmian keeps key pairs and certificates and returns a private key ONLY
 *   wrapped (RSA-OAEP-SHA256 + AES-KWP) to a registered wrapping key, and
 *   refuses Extractable=false keys, like Cosmian 5.28.
 * - FakeTransit unwraps an import with its own RSA-4096 wrapping key and signs
 *   with the imported key, like OpenBao Transit.
 * - v3Database() builds the schema from backend/src/db/migrations (0000-0016).
 * Fixtures are generated per run; no production material.
 */
import { constants, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, randomUUID, sign as nodeSign, type KeyObject } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { CosmianSource, KeyAttributes } from '../lib/cosmian.ts';
import type { TargetStore, TransitKey } from '../lib/openbao.ts';
import { MigrationError, spkiDer, transitTypeOf } from '../lib/util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = join(HERE, '../../../backend/src/db/migrations');

export function tempDir(prefix = 'pkimig-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Applies backend/src/db/migrations in order, from `from` (inclusive) to `to` (inclusive). */
function migrate(db: DatabaseSync, from: number, to: number): void {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).sort()) {
    const n = Number(f.slice(0, 4));
    if (n < from || n > to) continue;
    for (const stmt of readFileSync(join(MIGRATIONS, f), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) db.exec(stmt);
  }
  db.exec('PRAGMA foreign_keys = ON');
}

/** The v3.19.1 schema: migrations 0000-0015 (0016 and 0017 are v4). */
export function v3Database(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  migrate(db, 0, 15);
  return db;
}

/** Brings a copy to the v4 schema with the real v4 migrations (0016 RA provider, 0017 keystore_objects). */
export function migrateToV4(path: string): void {
  const db = new DatabaseSync(path);
  try { migrate(db, 16, 9999); } finally { db.close(); }
}

const pem = (k: KeyObject, type: 'spki' | 'pkcs8') => k.export({ format: 'pem', type }) as string;

/** A certificate made with the openssl CLI (self-signed when no issuer). */
export function makeCert(o: { cn: string; key: KeyObject; issuerKey?: KeyObject; issuerCert?: string; serial: string; ca?: boolean }): string {
  const dir = tempDir('pkimig-cert-');
  const keyFile = join(dir, 'key.pem');
  writeFileSync(keyFile, pem(o.key, 'pkcs8'));
  const subj = `/CN=${o.cn}/O=Rehearsal/C=ES`;
  const ext = join(dir, 'ext.cnf');
  writeFileSync(ext, o.ca ? 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' : 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\n');
  if (!o.issuerKey) {
    // OpenSSL 3.0 `req -x509` has -addext, not -extfile.
    const addext = readFileSync(ext, 'utf8').trim().split('\n').flatMap(l => ['-addext', l]);
    execFileSync('openssl', ['req', '-x509', '-new', '-key', keyFile, '-subj', subj, '-days', '30', '-set_serial', `0x${o.serial}`, ...addext, '-out', join(dir, 'c.pem')], { stdio: 'pipe' });
  } else {
    const ik = join(dir, 'ik.pem'); writeFileSync(ik, pem(o.issuerKey, 'pkcs8'));
    const ic = join(dir, 'ic.pem'); writeFileSync(ic, o.issuerCert!);
    execFileSync('openssl', ['req', '-new', '-key', keyFile, '-subj', subj, '-out', join(dir, 'r.csr')], { stdio: 'pipe' });
    execFileSync('openssl', ['x509', '-req', '-in', join(dir, 'r.csr'), '-CA', ic, '-CAkey', ik, '-set_serial', `0x${o.serial}`, '-days', '30', '-extfile', ext, '-out', join(dir, 'c.pem')], { stdio: 'pipe' });
  }
  return readFileSync(join(dir, 'c.pem'), 'utf8');
}

interface FakeObject {
  id: string;
  kind: 'PrivateKey' | 'PublicKey' | 'Certificate';
  privateKey?: KeyObject;
  publicKey?: KeyObject;
  certDer?: Buffer;
  sensitive?: boolean;
  extractable?: boolean;
  state?: string;
  links: Record<string, string>;
}

export class FakeCosmian implements CosmianSource {
  objects = new Map<string, FakeObject>();
  wrappingKeys = new Map<string, KeyObject>();
  calls: string[] = [];

  addKeyPair(o: { id?: string; key: { privateKey: KeyObject; publicKey: KeyObject }; sensitive?: boolean; extractable?: boolean; state?: string }) {
    const id = o.id ?? randomUUID();
    this.objects.set(id, { id, kind: 'PrivateKey', privateKey: o.key.privateKey, sensitive: o.sensitive ?? false, extractable: o.extractable ?? true, state: o.state ?? 'Active', links: { PublicKeyLink: `${id}_pk` } });
    this.objects.set(`${id}_pk`, { id: `${id}_pk`, kind: 'PublicKey', publicKey: o.key.publicKey, links: { PrivateKeyLink: id }, state: 'Active' });
    return { privateKeyId: id, publicKeyId: `${id}_pk` };
  }

  addCertificate(certPem: string, privateKeyId?: string) {
    const id = randomUUID();
    const der = Buffer.from(certPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
    this.objects.set(id, { id, kind: 'Certificate', certDer: der, links: privateKeyId ? { PrivateKeyLink: privateKeyId } : {}, state: 'Active' });
    return id;
  }

  async query() { this.calls.push('Query'); }

  async getAttributes(id: string): Promise<KeyAttributes | null> {
    this.calls.push(`GetAttributes:${id}`);
    const o = this.objects.get(id);
    if (!o) return null;
    return { id, objectType: o.kind, state: o.state ?? 'Active', algorithm: null, length: null, sensitive: o.kind === 'PrivateKey' ? !!o.sensitive : false, extractable: o.kind === 'PrivateKey' ? o.extractable !== false : true, alwaysSensitive: !!o.sensitive, neverExtractable: o.extractable === false, links: o.links };
  }

  async getPublicKeySpki(id: string) {
    this.calls.push(`GetPublic:${id}`);
    const o = this.objects.get(id);
    if (!o?.publicKey) throw new MigrationError('KMS_NO_PUBLIC_KEY', id);
    return spkiDer(o.publicKey);
  }

  async getCertificateDer(id: string) {
    this.calls.push(`GetCertificate:${id}`);
    return this.objects.get(id)?.certDer ?? null;
  }

  async registerWrappingKey(spki: Buffer) {
    const id = `wrap-${randomUUID()}`;
    this.wrappingKeys.set(id, createPublicKey({ key: spki, format: 'der', type: 'spki' }));
    this.calls.push(`RegisterWrapping:${id}`);
    return id;
  }

  async wrappedGet(id: string, wrappingId: string) {
    this.calls.push(`WrappedGet:${id}`);
    const o = this.objects.get(id);
    const wk = this.wrappingKeys.get(wrappingId);
    if (!o?.privateKey) throw new MigrationError('KMS_ERROR', 'not a private key');
    if (!wk) throw new MigrationError('KMS_ERROR', 'unknown wrapping key');
    if (o.extractable === false) throw new MigrationError('KMS_ERROR', 'Not_Extractable: DENIED');
    const pkcs8 = o.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
    const ephemeral = randomBytes(32);
    const head = publicEncrypt({ key: wk, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ephemeral);
    const kwp = createCipheriv('id-aes256-wrap-pad', ephemeral, Buffer.from('A65959A6', 'hex'));
    return Buffer.concat([head, kwp.update(pkcs8), kwp.final()]);
  }

  async removeWrappingKey(id: string) {
    this.calls.push(`RemoveWrapping:${id}`);
    this.wrappingKeys.delete(id);
  }
}

/** A Transit key of the fake. `version` is the latest (and only listed) version; `policy` overrides fields of the read response. */
export interface FakeKey { type: string; priv: KeyObject; exportable: boolean; allowPkcs1v15SessionKey: boolean; imported: boolean; version?: number; policy?: Record<string, unknown> }

let sharedWrapping: { privateKey: KeyObject; publicKey: KeyObject } | undefined;

export class FakeTransit implements TargetStore {
  keys = new Map<string, FakeKey>();
  /** Every sign and session-key call: mount/name and the key version asked for. */
  calls: string[] = [];
  wrapping: { privateKey: KeyObject; publicKey: KeyObject };
  policies = ['pki-migration'];
  imports = 0;
  failImportAfter?: number;

  constructor() {
    sharedWrapping ??= generateKeyPairSync('rsa', { modulusLength: 4096 });
    this.wrapping = sharedWrapping;
  }

  async health() { return { initialized: true, sealed: false, version: 'fake' }; }
  async tokenInfo() { return { policies: this.policies, accessor: 'acc', displayName: 'fake' }; }
  async mountType() { return 'transit'; }
  async wrappingKeyPem() { return this.wrapping.publicKey.export({ format: 'pem', type: 'spki' }) as string; }

  /** The `data` of `GET <mount>/keys/<name>`, with the fields the OpenBao fork returns (path_keys.go formatKeyPolicy). */
  keyData(k: FakeKey): Record<string, unknown> {
    const pem = createPublicKey(k.priv).export({ format: 'pem', type: 'spki' }) as string;
    const latest = k.version ?? 1;
    return {
      name: 'fake', type: k.type, derived: false, deletion_allowed: false,
      min_available_version: 0, min_decryption_version: 1, min_encryption_version: 0, latest_version: latest,
      exportable: k.exportable, allow_plaintext_backup: false,
      supports_encryption: k.type.startsWith('rsa-'), supports_decryption: k.type.startsWith('rsa-'), supports_signing: true, supports_derivation: false,
      auto_rotate_period: 0, imported_key: k.imported, soft_deleted: false,
      ...(k.type === 'rsa-3072' ? { allow_pkcs1v15_session_key: k.allowPkcs1v15SessionKey } : {}),
      ...(k.imported ? { imported_key_allow_rotation: false } : {}),
      keys: { [String(latest)]: { public_key: pem, name: k.type } },
      ...k.policy,
    };
  }

  async readKey(mount: string, name: string): Promise<TransitKey | null> {
    const k = this.keys.get(`${mount}/${name}`);
    if (!k) return null;
    const data = this.keyData(k);
    const keys = (data.keys ?? {}) as Record<string, { public_key?: string }>;
    return {
      type: String(data.type), latestVersion: Number(data.latest_version), exportable: data.exportable === true, allowPlaintextBackup: data.allow_plaintext_backup === true,
      importedKey: data.imported_key === true, deletionAllowed: data.deletion_allowed === true, allowPkcs1v15SessionKey: data.allow_pkcs1v15_session_key === true,
      publicKeyPem: keys['1']?.public_key ?? null,
      publicKeys: Object.fromEntries(Object.entries(keys).flatMap(([v, e]) => (e?.public_key ? [[Number(v), e.public_key]] : []))),
      data,
    };
  }

  async importKey(mount: string, name: string, body: Record<string, unknown>) {
    if (this.keys.has(`${mount}/${name}`)) throw new MigrationError('OPENBAO_ERROR', 'the import path cannot be used with an existing key');
    const blob = Buffer.from(String(body.ciphertext), 'base64');
    const ephemeral = privateDecrypt({ key: this.wrapping.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, blob.subarray(0, 512));
    const d = createDecipheriv('id-aes256-wrap-pad', ephemeral, Buffer.from('A65959A6', 'hex'));
    const pkcs8 = Buffer.concat([d.update(blob.subarray(512)), d.final()]);
    const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const type = transitTypeOf(createPublicKey(priv));
    if (type !== body.type) throw new MigrationError('OPENBAO_ERROR', `type mismatch ${type} vs ${String(body.type)}`);
    if (body.allow_plaintext_backup !== false) throw new Error('test: import must set allow_plaintext_backup=false');
    this.keys.set(`${mount}/${name}`, { type: String(body.type), priv, exportable: body.exportable === true, allowPkcs1v15SessionKey: body.allow_pkcs1v15_session_key === true, imported: true });
    this.imports++;
  }

  /** A generated (not imported) key, to test conflicts. */
  plant(mount: string, name: string, type: string, priv: KeyObject, o: Partial<Omit<FakeKey, 'type' | 'priv'>> = {}) {
    this.keys.set(`${mount}/${name}`, { type, priv, exportable: false, allowPkcs1v15SessionKey: false, imported: false, ...o });
  }

  /** Transit's refusals for an operation on `version` (sdk/helper/keysutil policy.go). */
  private usable(mount: string, name: string, version: number, op: 'sign' | 'decrypt'): FakeKey {
    const k = this.keys.get(`${mount}/${name}`);
    if (!k) throw new MigrationError('OPENBAO_ERROR', 'no key');
    const d = this.keyData(k);
    if (d.soft_deleted === true) throw new MigrationError('OPENBAO_ERROR', 'refusing to use soft-deleted key');
    if (version > Number(d.latest_version) || version < Number(d.min_available_version)) throw new MigrationError('OPENBAO_ERROR', 'invalid key version');
    if (op === 'sign' && Number(d.min_encryption_version) > 0 && version < Number(d.min_encryption_version)) throw new MigrationError('OPENBAO_ERROR', 'requested version for signing is less than the minimum encryption key version');
    if (op === 'decrypt' && version < Number(d.min_decryption_version)) throw new MigrationError('OPENBAO_ERROR', 'requested version for decryption is less than the minimum decryption key version');
    return k;
  }

  async sign(mount: string, name: string, input: Buffer, opts: { hash: 'sha2-256' | 'sha2-384'; rsa: boolean; version?: number }) {
    const version = opts.version ?? 1;
    this.calls.push(`sign:${mount}/${name}:v${version}`);
    const k = this.usable(mount, name, version, 'sign');
    return nodeSign(opts.hash === 'sha2-384' ? 'sha384' : 'sha256', input, { key: k.priv, dsaEncoding: 'der' });
  }

  async sessionKey(mount: string, name: string, ciphertext: Buffer, length: 16 | 24 | 32, version = 1): Promise<Buffer> {
    this.calls.push(`session-key:${mount}/${name}:v${version}`);
    const k = this.usable(mount, name, version, 'decrypt');
    if (!k.allowPkcs1v15SessionKey) throw new MigrationError('OPENBAO_ERROR', 'key is not enabled for PKCS#1 v1.5 session-key transport');
    // Node refuses RSA_PKCS1_PADDING for decryption: undo the EME-PKCS1-v1_5 block by hand (test only).
    const em = privateDecrypt({ key: k.priv, padding: constants.RSA_NO_PADDING }, ciphertext);
    const sep = em.indexOf(0, 2);
    if (em[0] !== 0 || em[1] !== 2 || sep < 10) throw new MigrationError('OPENBAO_ERROR', 'session key decryption failed');
    const key = Buffer.from(em.subarray(sep + 1));
    if (key.length !== length) throw new MigrationError('OPENBAO_ERROR', 'session key length mismatch');
    return key;
  }

  /** KV v1 entries (the backup pair marker), part of the snapshot like Transit keys. */
  kv = new Map<string, Record<string, string>>();
  async kvRead(mount: string, path: string) { const v = this.kv.get(`${mount}/${path}`); return v ? { ...v } : null; }
  async kvWrite(mount: string, path: string, data: Record<string, string>) { this.kv.set(`${mount}/${path}`, { ...data }); }

  /** The whole state (keys and KV), restorable with `FakeTransit.restore`: a Raft snapshot of the fake. */
  async raftSnapshot(dest: string) {
    const keys = [...this.keys].map(([k, v]) => [k, { ...v, priv: v.priv.export({ format: 'pem', type: 'pkcs8' }) }]);
    writeFileSync(dest, JSON.stringify({ fake: 'snapshot', keys, kv: [...this.kv] }), { mode: 0o600 });
  }

  /** Restores a snapshot file of `raftSnapshot` into `into` (replacing its state), like `bao operator raft snapshot restore`. */
  static restore<T extends FakeTransit>(file: string, into: T): T {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { keys: [string, FakeKey & { priv: string }][]; kv: [string, Record<string, string>][] };
    into.keys = new Map(j.keys.map(([k, v]) => [k, { ...v, priv: createPrivateKey(v.priv) }]));
    into.kv = new Map(j.kv);
    return into;
  }
}

/** A populated v3 installation: Cosmian objects + database rows, the way v3 services write them. */
export function seedV3(db: DatabaseSync, kms: FakeCosmian) {
  const rsa = (bits: number) => generateKeyPairSync('rsa', { modulusLength: bits });
  const ec = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ids: Record<string, string> = {};
  const now = Math.floor(Date.now() / 1000);

  // X.509 CA whose row stores the CERTIFICATE id as key (v3 fallback path).
  const caKey = rsa(2048);
  const ca = kms.addKeyPair({ key: caKey });
  const caPem = makeCert({ cn: 'Rehearsal Root', key: caKey.privateKey, serial: '1001', ca: true });
  const caCertId = kms.addCertificate(caPem, ca.privateKeyId);
  ids.caKey = ca.privateKeyId;
  db.prepare("INSERT INTO certificate_authorities (id, kms_certificate_id, kms_key_id, subject_dn, serial_number, key_algorithm, not_before, not_after, status) VALUES (?, ?, ?, 'CN=Rehearsal Root', '1001', 'RSA-2048', ?, ?, 'active')")
    .run('ca-1', caCertId, caCertId, now, now + 86400 * 30);

  // A leaf, and its renewal that reuses the key (shared reference).
  const leafKey = rsa(2048);
  const leaf = kms.addKeyPair({ key: leafKey });
  ids.leafKey = leaf.privateKeyId;
  const insertCert = db.prepare("INSERT INTO certificates (id, ca_id, kms_certificate_id, kms_key_id, subject_dn, serial_number, certificate_type, not_before, not_after, status, certificate_pem, renewed_from_id) VALUES (?, 'ca-1', ?, ?, ?, ?, 'server', ?, ?, ?, ?, ?)");
  const p1 = makeCert({ cn: 'leaf.example', key: leafKey.privateKey, issuerKey: caKey.privateKey, issuerCert: caPem, serial: '2001' });
  insertCert.run('cert-1', kms.addCertificate(p1, leaf.privateKeyId), leaf.privateKeyId, 'CN=leaf.example', '2001', now, now + 86400, 'revoked', null, null);
  const p2 = makeCert({ cn: 'leaf.example', key: leafKey.privateKey, issuerKey: caKey.privateKey, issuerCert: caPem, serial: '2002' });
  insertCert.run('cert-2', kms.addCertificate(p2, leaf.privateKeyId), leaf.privateKeyId, 'CN=leaf.example', '2002', now, now + 86400, 'active', p2, 'cert-1');
  // External CSR: no key in the KMS, PEM in the DB.
  const extKey = ec();
  const p3 = makeCert({ cn: 'external.example', key: extKey.privateKey, issuerKey: caKey.privateKey, issuerCert: caPem, serial: '2003' });
  insertCert.run('cert-ext', kms.addCertificate(p3), null, 'CN=external.example', '2003', now, now + 86400, 'active', p3, null);

  // SSH: a Sensitive user CA, a host CA in another zone whose key is NOT extractable
  // (must be rotated), an issued cert, and a legacy ECIES host key.
  db.exec("INSERT INTO zones (id, name, display_name) VALUES ('zone-b', 'staging', 'Staging')");
  const sshKey = ec();
  const ssh = kms.addKeyPair({ key: sshKey, sensitive: true });
  ids.sshKey = ssh.privateKeyId;
  const jwk = sshKey.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const q = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const s = (b: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const blob = Buffer.concat([s(Buffer.from('ecdsa-sha2-nistp256')), s(Buffer.from('nistp256')), s(q)]);
  const line = `ecdsa-sha2-nistp256 ${blob.toString('base64')} ssh-user-ca`;
  const { createHash } = awaitCrypto();
  const fp = `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
  const insertSsh = db.prepare("INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status) VALUES (?, ?, 'user', ?, ?, ?, ?, 'active')");
  insertSsh.run('sshca-a', 'default', ssh.privateKeyId, ssh.publicKeyId, line, fp);
  const hostKey = ec();
  const host = kms.addKeyPair({ key: hostKey, sensitive: true, extractable: false });
  ids.sshHostKey = host.privateKeyId;
  const hostLine = sshLine(hostKey.publicKey);
  db.prepare("INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status) VALUES ('sshca-b', 'zone-b', 'host', ?, ?, ?, ?, 'active')")
    .run(host.privateKeyId, host.publicKeyId, hostLine.line, hostLine.fp);
  db.prepare("INSERT INTO ssh_certificates (id, ca_id, cert_type, serial, key_id, principals, valid_after, valid_before, cert_openssh, subject_pubkey_fingerprint, kms_signing_key_id) VALUES ('sshcert-1', 'sshca-a', 'user', '1', 'alex', '[\"alex\"]', ?, ?, 'ecdsa-sha2-nistp256-cert-v01@openssh.com AAAA', 'SHA256:x', ?)").run(now, now + 3600, ssh.privateKeyId);
  db.prepare("INSERT INTO ssh_hosts (id, zone_id, fqdn, kms_pubkey_id, status) VALUES ('host-1', 'default', 'h1.example', 'legacy-ecies_pk', 'active')").run();

  // SCEP integration with a Sensitive RSA-3072 RA key in Cosmian.
  const raKey = rsa(3072);
  const ra = kms.addKeyPair({ key: raKey, sensitive: true });
  ids.raKey = ra.privateKeyId;
  const raPem = makeCert({ cn: 'SCEP Registration Authority', key: raKey.privateKey, issuerKey: caKey.privateKey, issuerCert: caPem, serial: '3001' });
  db.prepare("INSERT INTO integrations (id, name, ca_id, kind, token_hash, token_prefix) VALUES ('int-1', 'scep', 'ca-1', 'scep', 'h', 'pkimg_x')").run();
  // v3.19.1 writes the RA key id into the RA certificate row (the alias).
  insertCert.run('ra-cert-1', kms.addCertificate(raPem, ra.privateKeyId), ra.privateKeyId, 'CN=SCEP Registration Authority', '3001', now, now + 86400, 'active', raPem, null);
  db.prepare("INSERT INTO integration_ras (integration_id, ca_id, key_id, public_key_id, certificate_id, certificate_pem) VALUES ('int-1', 'ca-1', ?, ?, 'ra-cert-1', ?)").run(ra.privateKeyId, ra.publicKeyId, raPem);
  return ids;
}

// createHash without a top-level import cycle in the seed helper.
import * as cryptoNs from 'node:crypto';
function awaitCrypto() { return cryptoNs; }

/** OpenSSH line and SHA256 fingerprint of an ECDSA P-256 public key. */
export function sshLine(publicKey: KeyObject): { line: string; fp: string } {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const q = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const s = (b: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const blob = Buffer.concat([s(Buffer.from('ecdsa-sha2-nistp256')), s(Buffer.from('nistp256')), s(q)]);
  return { line: `ecdsa-sha2-nistp256 ${blob.toString('base64')} ssh-ca`, fp: `SHA256:${cryptoNs.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}` };
}
