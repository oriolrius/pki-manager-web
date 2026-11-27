/**
 * Dry-run inventory: reads the v3 database (read-only) and, when given, the
 * source Cosmian KMS (read operations only). Writes nothing anywhere.
 *
 * It finds every key and certificate reference, resolves each to one canonical
 * private key (a CA row may hold its certificate id as a fallback), groups
 * shared references (renewals that reuse a key, one SSH CA key imported in two
 * zones), checks that every public view of a key agrees (certificate, KMS
 * public key, OpenSSH fingerprint), and proposes a disposition per key.
 */
import { X509Certificate } from 'node:crypto';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { CosmianSource, KeyAttributes } from './cosmian.ts';
import { all, appliedMigrations, columnsOf, fileSha256, tableExists } from './sqlite.ts';
import { decide, DEFAULT_MOUNTS, type Mounts } from './policy.ts';
import { CLASS_RANK, MANIFEST_FORMAT, type CertificateEntry, type KeyClass, type KeyEntry, type LegacyEntry, type Manifest, type Problem, type Reference, type ReferenceRole } from './types.ts';
import { createPublicKey } from 'node:crypto';
import { isoNow, normalizeSerial, sha256Hex, spkiFingerprint, sshFingerprintOfP256, transitTypeOf } from './util.ts';

const ROLE_CLASS: Partial<Record<ReferenceRole, KeyClass>> = {
  'x509-ca-key': 'x509-ca', 'x509-leaf-key': 'x509-leaf', 'ssh-ca-key': 'ssh-ca', 'scep-ra-key': 'scep-ra', 'scep-ra-openbao-key': 'scep-ra',
  'scep-ra-cert-alias': 'scep-ra',
};

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function collectReferences(db: DatabaseSync, problems: Problem[]): Reference[] {
  const refs: Reference[] = [];
  const add = (r: Reference) => refs.push(r);
  if (tableExists(db, 'certificate_authorities')) {
    for (const r of all(db, 'SELECT id, kms_key_id, status FROM certificate_authorities ORDER BY id')) {
      const id = String(r.id);
      if (r.kms_key_id) add({ table: 'certificate_authorities', column: 'kms_key_id', rowId: id, role: 'x509-ca-key', sourceId: String(r.kms_key_id), rowStatus: str(r.status) ?? undefined });
      else problems.push({ severity: 'blocker', code: 'CA_WITHOUT_KEY', message: 'CA row has no key reference', subject: `certificate_authorities:${id}` });
    }
  }
  if (tableExists(db, 'certificates')) {
    for (const r of all(db, 'SELECT id, kms_key_id, status FROM certificates WHERE kms_key_id IS NOT NULL ORDER BY id')) {
      add({ table: 'certificates', column: 'kms_key_id', rowId: String(r.id), role: 'x509-leaf-key', sourceId: String(r.kms_key_id), rowStatus: str(r.status) ?? undefined });
    }
  }
  if (tableExists(db, 'ssh_cas')) {
    for (const r of all(db, 'SELECT id, kms_key_id, kms_public_key_id, status FROM ssh_cas ORDER BY id')) {
      const id = String(r.id);
      add({ table: 'ssh_cas', column: 'kms_key_id', rowId: id, role: 'ssh-ca-key', sourceId: String(r.kms_key_id), rowStatus: str(r.status) ?? undefined });
      add({ table: 'ssh_cas', column: 'kms_public_key_id', rowId: id, role: 'ssh-ca-public-key', sourceId: String(r.kms_public_key_id), rowStatus: str(r.status) ?? undefined });
    }
  }
  if (tableExists(db, 'ssh_certificates')) {
    for (const r of all(db, 'SELECT id, kms_signing_key_id, status FROM ssh_certificates ORDER BY id')) {
      add({ table: 'ssh_certificates', column: 'kms_signing_key_id', rowId: String(r.id), role: 'ssh-cert-signer', sourceId: String(r.kms_signing_key_id), rowStatus: str(r.status) ?? undefined });
    }
  }
  if (tableExists(db, 'integration_ras')) {
    const cols = columnsOf(db, 'integration_ras');
    const provider = cols.has('key_provider') ? 'key_provider' : "'cosmian'";
    for (const r of all(db, `SELECT integration_id, key_id, public_key_id, ${provider} AS provider FROM integration_ras ORDER BY integration_id`)) {
      const id = String(r.integration_id);
      if (!r.key_id) { problems.push({ severity: 'warning', code: 'RA_NOT_PROVISIONED', message: 'RA binding has no key (provisioning never finished); nothing to migrate', subject: `integration_ras:${id}` }); continue; }
      if (r.provider === 'openbao') { add({ table: 'integration_ras', column: 'key_id', rowId: id, role: 'scep-ra-openbao-key', sourceId: `openbao:${r.key_id}` }); continue; }
      add({ table: 'integration_ras', column: 'key_id', rowId: id, role: 'scep-ra-key', sourceId: String(r.key_id) });
      if (r.public_key_id) add({ table: 'integration_ras', column: 'public_key_id', rowId: id, role: 'scep-ra-public-key', sourceId: String(r.public_key_id) });
    }
  }
  return refs;
}

function collectLegacy(db: DatabaseSync): LegacyEntry[] {
  const out: LegacyEntry[] = [];
  for (const [table, note] of [
    ['ssh_hosts', 'legacy ECIES host key pair in the KMS; v4 has no use for it. Destroy it in Cosmian when the recovery window closes.'],
    ['ssh_identities', 'KMS public key reference without a v3 writer; kept only as history.'],
  ] as const) {
    if (!columnsOf(db, table).has('kms_pubkey_id')) continue;
    for (const r of all(db, `SELECT id, kms_pubkey_id FROM ${table} WHERE kms_pubkey_id IS NOT NULL ORDER BY id`)) {
      out.push({ table, column: 'kms_pubkey_id', rowId: String(r.id), value: String(r.kms_pubkey_id), disposition: 'retire-legacy', note });
    }
  }
  return out;
}

interface CertRow { table: CertificateEntry['table']; rowId: string; serial: string; status: string; pem: string | null; kmsCertificateId: string | null; keyRef: string | null; issuer: string | null }

function collectCertRows(db: DatabaseSync): CertRow[] {
  const rows: CertRow[] = [];
  if (tableExists(db, 'certificate_authorities')) {
    const hasPem = columnsOf(db, 'certificate_authorities').has('certificate_pem');
    for (const r of all(db, `SELECT id, serial_number, status, kms_certificate_id, kms_key_id${hasPem ? ', certificate_pem' : ''} FROM certificate_authorities ORDER BY id`)) {
      // v3 CAs are self-signed roots: the issuer certificate is the CA certificate itself.
      rows.push({ table: 'certificate_authorities', rowId: String(r.id), serial: String(r.serial_number), status: String(r.status), pem: str(r.certificate_pem), kmsCertificateId: str(r.kms_certificate_id), keyRef: str(r.kms_key_id), issuer: str(r.kms_certificate_id) });
    }
  }
  if (tableExists(db, 'certificates')) {
    const caCert = tableExists(db, 'certificate_authorities') ? 'ca.kms_certificate_id' : 'NULL';
    const join = tableExists(db, 'certificate_authorities') ? 'LEFT JOIN certificate_authorities ca ON ca.id = c.ca_id' : '';
    for (const r of all(db, `SELECT c.id, c.serial_number, c.status, c.kms_certificate_id, c.kms_key_id, c.certificate_pem, ${caCert} AS issuer FROM certificates c ${join} ORDER BY c.id`)) {
      rows.push({ table: 'certificates', rowId: String(r.id), serial: String(r.serial_number), status: String(r.status), pem: str(r.certificate_pem), kmsCertificateId: str(r.kms_certificate_id), keyRef: str(r.kms_key_id), issuer: str(r.issuer) });
    }
  }
  return rows;
}

function parseCert(der: Buffer | string): X509Certificate | null {
  try { return new X509Certificate(der); } catch { return null; }
}

export interface InventoryOptions {
  sourcePath: string;
  db: DatabaseSync;
  kms?: CosmianSource;
  mounts?: Mounts;
}

export async function buildManifest(opts: InventoryOptions): Promise<Manifest> {
  const { db, kms } = opts;
  const mounts = opts.mounts ?? DEFAULT_MOUNTS;
  const problems: Problem[] = [];
  const refs = collectReferences(db, problems);
  const legacy = collectLegacy(db);
  if (kms) await kms.query();

  // 1. Canonical private key id of each reference.
  const attrCache = new Map<string, KeyAttributes | null>();
  const attrs = async (id: string) => {
    if (!kms) return null;
    if (!attrCache.has(id)) attrCache.set(id, await kms.getAttributes(id));
    return attrCache.get(id) ?? null;
  };
  const canonical = new Map<string, string>(); // raw reference id -> canonical private key id
  for (const r of refs) {
    if (canonical.has(r.sourceId) || r.role === 'ssh-ca-public-key' || r.role === 'scep-ra-public-key' || r.role === 'scep-ra-openbao-key') continue;
    let id = r.sourceId;
    const a = await attrs(id);
    if (a?.objectType === 'Certificate') {
      const linked = a.links.PrivateKeyLink;
      if (linked) { id = linked; problems.push({ severity: 'warning', code: 'KEY_REF_IS_CERTIFICATE', message: `${r.table}.${r.column} holds a certificate id; resolved to its PrivateKeyLink`, subject: `${r.table}:${r.rowId}` }); }
      else problems.push({ severity: 'blocker', code: 'KEY_REF_UNRESOLVED', message: 'reference is a certificate without PrivateKeyLink', subject: `${r.table}:${r.rowId}` });
    }
    canonical.set(r.sourceId, id);
  }

  // 1b. RA certificate alias: v3.19 stores the RA key id in certificates.kms_key_id of the RA
  // certificate. Such a row is the RA identity, not an X.509 leaf key; its public key must be
  // the RA key (checked in step 4). Any other sharing stays a conflict.
  const raKeys = new Set(refs.filter(r => r.role === 'scep-ra-key').map(r => canonical.get(r.sourceId) ?? r.sourceId));
  for (const r of refs) if (r.role === 'x509-leaf-key' && raKeys.has(canonical.get(r.sourceId) ?? r.sourceId)) r.role = 'scep-ra-cert-alias';

  // 2. Group references by canonical key (public-key references attach to their private key).
  const groups = new Map<string, Reference[]>();
  const keyOfRow = new Map<string, string>(); // table:rowId -> canonical id of its private key
  for (const r of refs) {
    if (r.role === 'ssh-ca-public-key' || r.role === 'scep-ra-public-key') continue;
    const id = r.role === 'scep-ra-openbao-key' ? r.sourceId : canonical.get(r.sourceId) ?? r.sourceId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
    if (r.role !== 'ssh-cert-signer') keyOfRow.set(`${r.table}:${r.rowId}`, id);
  }
  for (const r of refs) {
    if (r.role !== 'ssh-ca-public-key' && r.role !== 'scep-ra-public-key') continue;
    const id = keyOfRow.get(`${r.table}:${r.rowId}`);
    if (id) groups.get(id)!.push(r);
  }

  // 3. Certificates: PEM source and public key.
  const certificates: CertificateEntry[] = [];
  const certSpkiByRow = new Map<string, string>();
  for (const c of collectCertRows(db)) {
    let pemSource: CertificateEntry['pemSource'] = 'unknown';
    let cert: X509Certificate | null = null;
    if (c.pem) {
      cert = parseCert(c.pem);
      pemSource = 'db';
      if (!cert) problems.push({ severity: 'blocker', code: 'PEM_INVALID', message: 'certificate_pem does not parse', subject: `${c.table}:${c.rowId}` });
    }
    if (!cert && kms && c.kmsCertificateId) {
      const der = await kms.getCertificateDer(c.kmsCertificateId);
      cert = der ? parseCert(der) : null;
      pemSource = cert ? 'kms' : 'missing';
    } else if (!cert && kms) pemSource = 'missing';
    if (cert && kms && c.pem && c.kmsCertificateId) {
      const der = await kms.getCertificateDer(c.kmsCertificateId);
      if (der && !der.equals(cert.raw)) problems.push({ severity: 'warning', code: 'PEM_DIFFERS_FROM_KMS', message: 'DB PEM and KMS certificate differ; the DB PEM is kept (offline-signed or placeholder object)', subject: `${c.table}:${c.rowId}` });
    }
    let spki: string | null = null;
    if (cert) {
      spki = spkiFingerprint(cert);
      if (normalizeSerial(cert.serialNumber) !== normalizeSerial(c.serial)) problems.push({ severity: 'blocker', code: 'SERIAL_MISMATCH', message: `certificate serial ${cert.serialNumber} differs from the row serial`, subject: `${c.table}:${c.rowId}` });
      certSpkiByRow.set(`${c.table}:${c.rowId}`, spki);
    }
    const keyId = c.keyRef ? (canonical.get(c.keyRef) ?? c.keyRef) : null;
    certificates.push({
      table: c.table, rowId: c.rowId, serial: c.serial, status: c.status, pemSource,
      pemSha256: cert ? sha256Hex(cert.raw) : null, spkiSha256: spki, kmsCertificateId: c.kmsCertificateId, sourceKeyId: keyId,
      issuerKmsCertificateId: c.issuer, keyLink: 'none',
    });
  }
  if (tableExists(db, 'integration_ras')) {
    for (const r of all(db, 'SELECT integration_id, certificate_pem FROM integration_ras WHERE certificate_pem IS NOT NULL ORDER BY integration_id')) {
      const cert = parseCert(String(r.certificate_pem));
      const id = String(r.integration_id);
      if (!cert) { problems.push({ severity: 'blocker', code: 'PEM_INVALID', message: 'RA certificate_pem does not parse', subject: `integration_ras:${id}` }); continue; }
      const spki = spkiFingerprint(cert);
      certSpkiByRow.set(`integration_ras:${id}`, spki);
      certificates.push({ table: 'integration_ras', rowId: id, serial: cert.serialNumber, status: 'active', pemSource: 'db', pemSha256: sha256Hex(cert.raw), spkiSha256: spki, kmsCertificateId: null, sourceKeyId: keyOfRow.get(`integration_ras:${id}`) ?? null, issuerKmsCertificateId: null, keyLink: 'none' });
    }
  }

  // 4. Key entries.
  const sshFpByRow = new Map<string, string>();
  if (tableExists(db, 'ssh_cas')) for (const r of all(db, 'SELECT id, fingerprint_sha256 FROM ssh_cas')) sshFpByRow.set(String(r.id), String(r.fingerprint_sha256));

  const keys: KeyEntry[] = [];
  for (const [id, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const roles = new Set(group.map(r => r.role));
    const classes = [...new Set(group.map(r => ROLE_CLASS[r.role]).filter((c): c is KeyClass => !!c))];
    classes.sort((a, b) => CLASS_RANK[b] - CLASS_RANK[a]);
    const cls: KeyClass = classes[0] ?? 'ssh-ca';
    const subjectProblems: Problem[] = [];
    if (classes.length > 1) subjectProblems.push({ severity: 'blocker', code: 'SHARED_ACROSS_CLASSES', message: `one key is referenced as ${classes.join(' and ')}; resolve by rotation`, subject: id });
    const signingRows = group.filter(r => r.role !== 'ssh-cert-signer' && !r.role.endsWith('public-key') && r.role !== 'scep-ra-cert-alias');
    const aliasRows = group.filter(r => r.role === 'scep-ra-cert-alias');
    const shared = signingRows.length > 1;
    // v4 binds one SSH CA key to one CA (SshCaKeyExistsError): a v3 key imported into two
    // zones cannot keep both rows. Rotate one of them first.
    if (shared && cls === 'ssh-ca') subjectProblems.push({ severity: 'blocker', code: 'SHARED_SSH_CA_KEY', message: `one SSH CA key backs ${signingRows.length} CA rows; v4 allows one CA per key: rotate all but one before migration`, subject: id });

    // Public views of the key.
    const fps = new Set<string>();
    let sshFingerprint: string | undefined;
    for (const r of signingRows) { const fp = certSpkiByRow.get(`${r.table}:${r.rowId}`); if (fp) fps.add(fp); }
    const certRowsForKey = certificates.filter(c => c.sourceKeyId === id && c.spkiSha256);
    for (const c of certRowsForKey) fps.add(c.spkiSha256!);
    let transitType = null as KeyEntry['transitType'];
    let sourcePublicKeyId: string | null = null;
    const kmsFps = new Set<string>();
    let attributes: KeyEntry['attributes'] = null;
    let missing = false;
    if (!roles.has('scep-ra-openbao-key') && kms && !(roles.size === 1 && roles.has('ssh-cert-signer'))) {
      const a = await attrs(id);
      if (!a || a.state === 'Destroyed' || a.state === 'Destroyed_Compromised') missing = true;
      if (a) attributes = { objectType: a.objectType, state: a.state, sensitive: a.sensitive, extractable: a.extractable, alwaysSensitive: a.alwaysSensitive, neverExtractable: a.neverExtractable };
      const publicIds = new Set<string>();
      if (a?.links.PublicKeyLink) publicIds.add(a.links.PublicKeyLink);
      for (const r of group) if (r.role === 'ssh-ca-public-key' || r.role === 'scep-ra-public-key') publicIds.add(r.sourceId);
      if (publicIds.size > 1) subjectProblems.push({ severity: 'blocker', code: 'PUBLIC_KEY_LINKS_DIFFER', message: `the key links to ${publicIds.size} public key objects`, subject: id });
      sourcePublicKeyId = [...publicIds][0] ?? null;
      for (const pid of publicIds) {
        try {
          const spki = await kms.getPublicKeySpki(pid);
          fps.add(spkiFingerprint(spki));
          kmsFps.add(spkiFingerprint(spki));
          const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
          transitType = transitTypeOf(key);
          if (cls === 'ssh-ca' && key.asymmetricKeyType === 'ec') sshFingerprint = sshFingerprintOfP256(spki);
        } catch (error) {
          subjectProblems.push({ severity: 'warning', code: 'PUBLIC_KEY_UNREADABLE', message: `public key ${pid}: ${(error as Error).message}`, subject: id });
        }
      }
    }
    if (!transitType) {
      // Without the KMS public key, derive the type from a certificate of the key.
      const pem = certRowsForKey[0];
      if (pem) {
        const row = collectCertRows(db).find(c => c.table === pem.table && c.rowId === pem.rowId);
        const cert = row?.pem ? parseCert(row.pem) : null;
        if (cert) transitType = transitTypeOf(cert.publicKey);
      }
    }
    for (const r of aliasRows) {
      const fp = certSpkiByRow.get(`${r.table}:${r.rowId}`);
      if (fp && kmsFps.size && !kmsFps.has(fp)) subjectProblems.push({ severity: 'blocker', code: 'RA_ALIAS_MISMATCH', message: `${r.table}:${r.rowId} names the RA key but certifies another public key`, subject: id });
    }
    if (aliasRows.length) subjectProblems.push({ severity: 'warning', code: 'RA_CERTIFICATE_ALIAS', message: `${aliasRows.length} RA certificate row(s) hold the RA key id; same identity (fingerprint checked), the id is cleared in the target`, subject: id });
    if (fps.size > 1) subjectProblems.push({ severity: 'blocker', code: 'PUBLIC_KEY_MISMATCH', message: 'the KMS public key and the certificates of this key disagree', subject: id });
    if (cls === 'ssh-ca' && sshFingerprint) {
      for (const r of signingRows) {
        const dbFp = sshFpByRow.get(r.rowId);
        if (dbFp && dbFp !== sshFingerprint) subjectProblems.push({ severity: 'blocker', code: 'SSH_FINGERPRINT_MISMATCH', message: `ssh_cas.fingerprint_sha256 differs from the KMS key (${dbFp} != ${sshFingerprint})`, subject: id });
      }
    }
    problems.push(...subjectProblems);
    const entry: KeyEntry = {
      sourceKeyId: id, sourcePublicKeyId, class: cls, references: group, shared, attributes, missing,
      spkiSha256: fps.size === 1 ? [...fps][0] : null, sshFingerprint, transitType,
      allowed: [], proposed: 'rotate', reasons: [], target: null,
    };
    keys.push(decide(entry, mounts, !!kms));
  }

  // 4b. How each certificate links to its key in the target.
  const classOf = new Map(keys.map(k => [k.sourceKeyId, k.class]));
  for (const c of certificates) {
    if (c.table === 'integration_ras' || !c.sourceKeyId) continue;
    const kc = classOf.get(c.sourceKeyId);
    c.keyLink = kc === 'scep-ra' ? 'ra-alias' : kc === 'x509-ca' || kc === 'x509-leaf' ? 'x509' : 'none';
  }

  // 5. Duplicate key material under different ids.
  const byFp = new Map<string, string[]>();
  for (const k of keys) if (k.spkiSha256) byFp.set(k.spkiSha256, [...(byFp.get(k.spkiSha256) ?? []), k.sourceKeyId]);
  for (const [fp, ids] of byFp) if (ids.length > 1) for (const id of ids) problems.push({ severity: 'blocker', code: 'DUPLICATE_KEY_MATERIAL', message: `${ids.length} KMS objects hold the same key ${fp.slice(0, 16)}...; rotate or merge before migration`, subject: id });

  const counts: Record<string, number> = {};
  for (const t of ['certificate_authorities', 'certificates', 'crls', 'ssh_cas', 'ssh_certificates', 'ssh_hosts', 'ssh_identities', 'integrations', 'integration_ras', 'audit_log']) {
    if (tableExists(db, t)) counts[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
  }
  return {
    format: MANIFEST_FORMAT,
    createdAt: isoNow(),
    source: { dbFile: basename(opts.sourcePath), dbSha256: fileSha256(opts.sourcePath), migrations: appliedMigrations(db), kmsRead: !!kms, counts },
    profile: { mounts },
    keys,
    certificates,
    legacy,
    problems,
  };
}

/** Short human summary for the terminal. */
export function summarize(m: Manifest): string {
  const by = (f: (k: KeyEntry) => string) => m.keys.reduce<Record<string, number>>((acc, k) => { acc[f(k)] = (acc[f(k)] ?? 0) + 1; return acc; }, {});
  const lines = [
    `source ${m.source.dbFile} sha256=${m.source.dbSha256.slice(0, 16)}... migrations=${m.source.migrations.count} kms=${m.source.kmsRead ? 'read' : 'not read'}`,
    `keys: ${m.keys.length} ${JSON.stringify(by(k => k.class))}`,
    `proposed: ${JSON.stringify(by(k => k.proposed))}`,
    `shared keys: ${m.keys.filter(k => k.shared).length}`,
    `certificates: ${m.certificates.length} pem ${JSON.stringify(m.certificates.reduce<Record<string, number>>((a, c) => { a[c.pemSource] = (a[c.pemSource] ?? 0) + 1; return a; }, {}))}`,
    `legacy references: ${m.legacy.length}`,
    `problems: ${m.problems.filter(p => p.severity === 'blocker').length} blocker(s), ${m.problems.filter(p => p.severity === 'warning').length} warning(s)`,
  ];
  for (const p of m.problems) lines.push(`  ${p.severity.toUpperCase()} ${p.code} ${p.subject ?? ''}: ${p.message}`);
  return lines.join('\n');
}
