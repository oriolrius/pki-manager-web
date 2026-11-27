/**
 * Controlled rotation plan for keys that cannot migrate (or that the admin
 * chose not to migrate). The tool never rotates by itself: each step is an
 * operator action in v3 (before the final inventory) or in v4 (after cutover),
 * recorded in the audit log by the product. The full procedure is in
 * docs/operations/openbao-migration.md ("Controlled rotation").
 */
import type { Approval, KeyEntry, Manifest } from './types.ts';

const STEPS: Record<KeyEntry['class'], { rotate: string[]; drop?: string[] }> = {
  'x509-ca': {
    rotate: [
      'Create a replacement CA (same subject with a generation suffix) in v3, or in v4 after cutover.',
      'Publish the new CA certificate to every relying party next to the old one.',
      'Re-issue each active leaf certificate of the old CA from the new CA; keep the old CA active until the last leaf expires or is replaced.',
      'Revoke the old CA (CRL and status) only when nothing depends on it; then run a new inventory.',
    ],
    drop: ['The CA is revoked or expired: its key is no longer needed to sign. Its certificate rows and CRLs stay; no new CRL can be signed for it.'],
  },
  'x509-leaf': {
    rotate: ['Renew the certificate with generateNewKey=true before the final inventory (the old certificate stays in history).'],
    drop: ['Keep the certificate rows; the private key is not migrated, so PKCS#12/JKS/PEM key export and renewal with key reuse are no longer possible for it.'],
  },
  'ssh-ca': {
    rotate: [
      'Start an SSH CA rotation (POST /api/v1/ssh/cas/:caId/rotate) in the same zone: the new CA is created in the target key store after cutover, or in v3 before it.',
      'Distribute both trust anchors (TrustedUserCAKeys / @cert-authority) and re-issue host and user certificates from the new CA.',
      'Retire the old CA after the overlap window (POST /api/v1/ssh/cas/:caId/retire); its issued certificates stay in history and KRLs.',
    ],
    drop: ['The SSH CA is retired: no new signatures are needed. Its certificates stay in history.'],
  },
  'scep-ra': {
    rotate: [
      'Provision a new RA key in OpenBao for the SCEP integration (v3.19+ with SCEP_RA_KEY_PROVIDER=openbao for a new binding, or v4).',
      'SCEP clients fetch the new RA certificate with GetCACert; keep the previous RA certificate in the overlap list until clients have renewed.',
      'Restart the SCEP gateway and run a test enrollment before the final inventory.',
    ],
  },
};

export function rotationPlan(manifest: Manifest, approval?: Approval): string {
  const lines: string[] = ['# Controlled rotation plan', ''];
  let n = 0;
  for (const k of manifest.keys) {
    const action = approval?.keys[k.sourceKeyId]?.action ?? k.proposed;
    if (action !== 'rotate' && action !== 'drop-key') continue;
    n++;
    const rows = k.references.filter(r => !r.role.endsWith('public-key') && r.role !== 'ssh-cert-signer').map(r => `${r.table}:${r.rowId}${r.rowStatus ? ` (${r.rowStatus})` : ''}`);
    lines.push(`## ${n}. ${k.class} ${k.sourceKeyId} -> ${action}`);
    lines.push(`Rows: ${rows.join(', ') || 'none'}`);
    if (k.reasons.length) lines.push(`Why: ${k.reasons.join('; ')}`);
    const steps = action === 'drop-key' ? STEPS[k.class].drop ?? [] : STEPS[k.class].rotate;
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  if (n === 0) lines.push('No key needs rotation or a drop decision.');
  return lines.join('\n');
}
