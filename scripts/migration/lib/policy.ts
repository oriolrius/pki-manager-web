/**
 * Source export policy, target key policy and admin approval.
 *
 * Source policy (Cosmian attributes, never bypassed):
 * - Extractable=false, NeverExtractable=true, a missing key, or a state other
 *   than Active/PreActive: the key is NOT transferable. The tool does not try
 *   another export method. Actions: rotate (or drop-key where allowed).
 * - Sensitive=true: the key leaves Cosmian only wrapped to the OpenBao wrapping
 *   key, and only when the approval acknowledges it for that key.
 * - Sensitive=false: same wrapped transfer (the tool never handles clear keys).
 *
 * Target policy: imported keys get allow_plaintext_backup=false and
 * allow_rotation=false. Exportable only when the source key was exportable
 * (Sensitive=false) and the class allows it (X.509 CA and leaf keys, to keep
 * today's authorized PKCS#12/JKS/PEM exports). An approval may tighten that to
 * non-exportable; it can never make a Sensitive source key exportable.
 * SSH CA and SCEP RA keys are always non-exportable. The RA key is rsa-3072 and
 * opted in to the fork's PKCS#1 v1.5 session-key operation.
 */
import type { Action, Approval, KeyClass, KeyEntry, Manifest, ObjectApproval, Problem, TargetSpec } from './types.ts';
import { APPROVAL_FORMAT } from './types.ts';
import { MigrationError, documentDigest, uuidForSourceId, type TransitKeyType } from './util.ts';

export interface Mounts { x509: string; ssh: string; ra: string }
/** Backend defaults: OPENBAO_TRANSIT_MOUNT, OPENBAO_SSH_MOUNT, OPENBAO_RA_MOUNT. */
export const DEFAULT_MOUNTS: Mounts = { x509: 'pki-manager', ssh: 'pki-manager-ssh', ra: 'pki-manager-ra' };

const TRANSFERABLE_STATES = new Set(['Active', 'PreActive']);

/**
 * Deterministic target name: the same source key always gets the same name.
 * X.509 names follow the backend (`x509-ca-<privateKeyId>`, `x509-leaf-<privateKeyId>`):
 * the v3 private key id is kept as the key store object id.
 */
export function targetName(cls: KeyClass, sourceKeyId: string): string {
  const id = uuidForSourceId(sourceKeyId);
  switch (cls) {
    case 'x509-ca': return `x509-ca-${id}`;
    case 'x509-leaf': return `x509-leaf-${id}`;
    case 'ssh-ca': return `ssh-ca-${id}`;
    case 'scep-ra': return `scep-ra-${id}`; // backend RA name pattern (ra-transit.ts)
  }
}

export function mountFor(cls: KeyClass, mounts: Mounts): string {
  return cls === 'scep-ra' ? mounts.ra : cls === 'ssh-ca' ? mounts.ssh : mounts.x509;
}

export function targetSpec(key: Pick<KeyEntry, 'class' | 'sourceKeyId' | 'attributes'>, type: TransitKeyType, mounts: Mounts): TargetSpec {
  const sourceExportable = key.attributes?.sensitive === false;
  const classAllowsExport = key.class === 'x509-ca' || key.class === 'x509-leaf';
  return {
    mount: mountFor(key.class, mounts),
    name: targetName(key.class, key.sourceKeyId),
    type,
    exportable: classAllowsExport && sourceExportable,
    allowPkcs1v15SessionKey: key.class === 'scep-ra',
  };
}

/** Row statuses for which a key may be dropped instead of moved (no longer used to sign). */
function keyNoLongerNeeded(key: KeyEntry): boolean {
  const rows = key.references.filter(r => r.role !== 'ssh-cert-signer' && r.role !== 'ssh-ca-public-key' && r.role !== 'scep-ra-public-key' && r.role !== 'scep-ra-cert-alias');
  if (key.class === 'x509-leaf') return true; // a leaf certificate stays valid without our copy of its key
  if (key.class === 'x509-ca') return rows.every(r => r.rowStatus === 'revoked' || r.rowStatus === 'expired');
  if (key.class === 'ssh-ca') return rows.every(r => r.rowStatus === 'retired');
  return false; // an RA key is always in use while its binding exists
}

/** Fills allowed / proposed / reasons / target of a key entry (pure). */
export function decide(key: KeyEntry, mounts: Mounts, kmsRead: boolean): KeyEntry {
  const reasons: string[] = [];
  const onlyHistory = key.references.every(r => r.role === 'ssh-cert-signer');
  if (onlyHistory) return { ...key, allowed: ['history-only'], proposed: 'history-only', reasons: ['referenced only by issued SSH certificates (history)'], target: null };

  if (key.references.some(r => r.role === 'scep-ra-openbao-key')) {
    return { ...key, allowed: ['already-target'], proposed: 'already-target', reasons: ['RA key already in OpenBao'], target: null };
  }

  const dropOk = keyNoLongerNeeded(key);
  const fallback: Action[] = dropOk ? ['rotate', 'drop-key'] : ['rotate'];
  let transferable = true;
  if (!kmsRead) { transferable = false; reasons.push('KMS not read: attributes unknown (inventory without --kms-url)'); }
  else if (key.missing) { transferable = false; reasons.push('key not found in the KMS'); }
  else {
    const a = key.attributes;
    if (!a) { transferable = false; reasons.push('no KMS attributes'); }
    else {
      if (a.objectType !== 'PrivateKey') { transferable = false; reasons.push(`object is ${a.objectType ?? 'unknown'}, not a PrivateKey`); }
      if (a.extractable !== true || a.neverExtractable === true) { transferable = false; reasons.push('source policy: Extractable=false (non-transferable; never bypassed)'); }
      if (!a.state || !TRANSFERABLE_STATES.has(a.state)) { transferable = false; reasons.push(`source state ${a.state ?? 'unknown'} is not Active/PreActive`); }
      if (a.sensitive === true) reasons.push('Sensitive=true: wrapped transfer only, needs acknowledgeSensitive in the approval');
    }
  }
  if (!key.spkiSha256) { transferable = false; reasons.push('public key unknown'); }
  if (!key.transitType) { transferable = false; reasons.push('key type not supported by Transit import here'); }
  if (key.class === 'scep-ra' && key.transitType && key.transitType !== 'rsa-3072') { transferable = false; reasons.push('RA key must be rsa-3072'); }
  if (key.class === 'ssh-ca' && key.transitType && key.transitType !== 'ecdsa-p256') { transferable = false; reasons.push('SSH CA key must be ecdsa-p256'); }

  const target = key.transitType ? targetSpec(key, key.transitType, mounts) : null;
  if (transferable) return { ...key, allowed: ['transfer', ...fallback], proposed: 'transfer', reasons, target };
  return { ...key, allowed: fallback, proposed: 'rotate', reasons, target };
}

/** An approval template: proposed actions, empty approver (the admin must fill it in). */
export function approvalTemplate(manifest: Manifest, target: { addr: string; wrappingKeys: Record<string, string> }): Approval {
  const keys: Record<string, ObjectApproval> = {};
  for (const k of manifest.keys) {
    keys[k.sourceKeyId] = { action: k.proposed, spkiSha256: k.spkiSha256 };
    if (k.proposed === 'transfer' && k.attributes?.sensitive === true) keys[k.sourceKeyId].acknowledgeSensitive = false;
  }
  return {
    format: APPROVAL_FORMAT,
    manifestSha256: documentDigest(manifest),
    approvedBy: '',
    approvedAt: '',
    target,
    caKeyExport: 'preserve',
    allowSourceWrappingKeyRegistration: false,
    keys,
    acceptMissingPem: [],
  };
}

export interface ApprovalCheck { ok: boolean; problems: Problem[] }

/**
 * Validates an approval against a manifest and (optionally) the live target.
 * Every key of the manifest needs an entry; unknown entries are refused.
 */
export function validateApproval(manifest: Manifest, approval: Approval, live?: { addr: string; wrappingKeys: Record<string, string> }, opts: { online?: boolean } = {}): ApprovalCheck {
  const problems: Problem[] = [];
  const bad = (code: string, message: string, subject?: string) => problems.push({ severity: 'blocker', code, message, subject });
  if (approval.format !== APPROVAL_FORMAT) bad('APPROVAL_FORMAT', 'unknown approval format');
  if (approval.manifestSha256 !== documentDigest(manifest)) bad('APPROVAL_STALE', 'approval was made for another manifest (re-run inventory and approve again)');
  if (!approval.approvedBy || !approval.approvedBy.trim()) bad('APPROVAL_UNSIGNED', 'approvedBy is empty');
  if (!approval.approvedAt || Number.isNaN(Date.parse(approval.approvedAt))) bad('APPROVAL_DATE', 'approvedAt is not a date');
  if (approval.caKeyExport !== 'preserve' && approval.caKeyExport !== 'deny') bad('APPROVAL_CA_EXPORT', "caKeyExport must be 'preserve' or 'deny'");
  if (live) {
    if (new URL(approval.target.addr).origin !== new URL(live.addr).origin) bad('APPROVAL_TARGET', 'approval names another OpenBao address');
    for (const [mount, fp] of Object.entries(live.wrappingKeys)) {
      if (approval.target.wrappingKeys[mount] !== fp) bad('APPROVAL_WRAPPING_KEY', `wrapping key of ${mount} differs from the approved one`, mount);
    }
  }
  const usesTransfer = manifest.keys.some(k => approval.keys[k.sourceKeyId]?.action === 'transfer');
  if (opts.online && usesTransfer && !approval.allowSourceWrappingKeyRegistration) {
    bad('APPROVAL_NO_SOURCE_WRITE', 'online transfer needs allowSourceWrappingKeyRegistration=true (or approved offline material)');
  }
  const known = new Set(manifest.keys.map(k => k.sourceKeyId));
  for (const id of Object.keys(approval.keys)) if (!known.has(id)) bad('APPROVAL_UNKNOWN_KEY', `approval lists a key that is not in the manifest`, id);
  for (const k of manifest.keys) {
    const a = approval.keys[k.sourceKeyId];
    if (!a) { bad('APPROVAL_MISSING_KEY', 'no approved action', k.sourceKeyId); continue; }
    if (!k.allowed.includes(a.action)) bad('APPROVAL_ACTION', `action ${a.action} not allowed (allowed: ${k.allowed.join(', ')})`, k.sourceKeyId);
    if (a.spkiSha256 !== k.spkiSha256) bad('APPROVAL_FINGERPRINT', 'approved fingerprint differs from the manifest', k.sourceKeyId);
    if (a.action === 'transfer') {
      if (k.attributes?.sensitive === true && a.acknowledgeSensitive !== true) bad('APPROVAL_SENSITIVE', 'Sensitive key: transfer needs acknowledgeSensitive=true', k.sourceKeyId);
      if (a.exportable === true && k.target && !k.target.exportable) bad('APPROVAL_EXPORT_ESCALATION', 'approval cannot make this key exportable', k.sourceKeyId);
      const m = approval.material?.[k.sourceKeyId];
      if (m && (!m.file || !/^[0-9a-f]{64}$/.test(m.sha256))) bad('APPROVAL_MATERIAL', 'material entry needs file and sha256', k.sourceKeyId);
    }
  }
  const pemMissing = manifest.certificates.filter(c => c.pemSource === 'missing').map(c => `${c.table}:${c.rowId}`);
  for (const id of pemMissing) if (!(approval.acceptMissingPem ?? []).includes(id)) bad('PEM_MISSING', 'certificate PEM missing in DB and KMS; list it in acceptMissingPem to keep the row without PEM', id);
  for (const p of manifest.problems) if (p.severity === 'blocker' && !p.subject) problems.push(p);
  for (const p of manifest.problems) {
    if (p.severity !== 'blocker' || !p.subject) continue;
    const a = approval.keys[p.subject];
    // A key-level blocker is resolved only by rotate or drop-key, never by transfer.
    if (!a || a.action === 'transfer') problems.push(p);
  }
  return { ok: problems.length === 0, problems };
}

/** Effective target spec of an approved transfer (only tightening is ever applied). */
export function approvedTarget(key: KeyEntry, approval: ObjectApproval, run?: Pick<Approval, 'caKeyExport'>): TargetSpec {
  if (!key.target) throw new MigrationError('NO_TARGET', `no target for ${key.sourceKeyId}`);
  const denyCa = key.class === 'x509-ca' && run?.caKeyExport === 'deny';
  return { ...key.target, exportable: approval.exportable === false || denyCa ? false : key.target.exportable };
}
