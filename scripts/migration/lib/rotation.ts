/**
 * Controlled rotation plan for keys that cannot migrate (or that the admin
 * chose not to migrate). The tool never rotates by itself: each step is an
 * operator action in v3 (before the final inventory) or in v4 (after cutover),
 * recorded in the audit log by the product. The full procedure is in
 * docs/operations/openbao-migration.md ("Controlled rotation").
 */
import type { Approval, KeyEntry, Manifest } from './types.ts';

const STEPS: Record<KeyEntry['class'], { rotate: string[]; drop?: string[]; reprovision?: string[] }> = {
  'x509-ca': {
    rotate: [
      'Create a replacement CA (same subject with a generation suffix) in v3, or in v4 after cutover.',
      'Publish the new CA certificate to every relying party next to the old one.',
      'Re-issue each active leaf certificate of the old CA from the new CA; keep the old CA active until the last leaf expires or is replaced.',
      'Revoke the old CA (CRL and status) when nothing depends on it; then run a new inventory: its key can then be dropped.',
    ],
    drop: ['The CA is revoked or expired: its key is no longer needed to sign. Its certificate rows and CRLs stay; no new CRL can be signed for it.'],
  },
  'x509-leaf': {
    rotate: ['Renew the certificate with generateNewKey=true before the final inventory (the old certificate stays in history).'],
    drop: ['Every certificate of the key is revoked or expired: keep the rows; the key is not migrated, so its PKCS#12/JKS/PEM key export and renewal with key reuse are no longer possible.'],
  },
  'ssh-ca': {
    rotate: [
      'In v3, before the final inventory: POST /api/v1/ssh/cas/:caId/rotate in the same zone (the new CA key is transferable).',
      'Distribute both trust anchors (TrustedUserCAKeys / @cert-authority) and re-issue the host and user certificates from the new CA.',
      'A retired CA keeps signing its own KRL, so it still needs its key. When no certificate of the old CA must stay valid, revoke it: POST /api/v1/ssh/cas/:caId/revoke.',
      'Run a new inventory: the revoked CA\'s key is then `drop-key`, the new CA\'s key `transfer`.',
    ],
    drop: ['The SSH CA is revoked: nothing signs with it any more. Its rows, certificates and KRL history stay; its KRL gets no new detached signature.'],
  },
  'scep-ra': {
    reprovision: [
      'In the approval: action `reprovision` and `acknowledgeNewKey: true`. The old RA private key does not reach v4 (it cannot, or the admin chose not to move it), so nothing can decrypt or sign for the old RA certificates any more.',
      'The migration resets the binding: no key, no current RA certificate, and the overlap list (`previous`) is empty: a certificate of the old key cannot stay live (the v4 gateway refuses to start when an unexpired overlap certificate does not certify the active RA key). The certificate rows stay as history, and the audit row `migration.ra.reprovision` lists every retired RA certificate (id, serial, SHA-256, PEM). verify checks both.',
      'After cutover, run the gateway once with `scep-server provision` (or start it with `SCEP_AUTO_PROVISION=true`): v4 generates a new RA key in OpenBao (a generated key; provisioning never adopts an imported one) and issues a new RA certificate. The gateway state file (SCEP_STATE_FILE) then holds the new certificate; later renewals keep that key and its same-key overlap list.',
      'Devices: every SCEP client must fetch the CA/RA certificates again (GetCACert) before its next request. A request encrypted to the old RA certificate fails (the gateway answers a CertRep FAILURE: the old key is not there), and a client that verifies CertRep with a cached old RA certificate rejects the reply of the new RA. Requests sent around the cutover must start again from GetCACert (the gateway keeps no pending requests). For Intune or another MDM, update the SCEP profile when it pins the RA certificate. Run a test enrollment.',
      'Revoke the retired RA certificates (POST /api/v1/certificates/:id/revoke, ids in the audit row) when the clients have moved: their key is gone.',
    ],
    rotate: [
      'In v3.19.1, before the final inventory: register a new SCEP integration on the same CA (UI, or tRPC integration.register with kind "scep") and provision its RA with `scep-server provision` and the new token.',
      'Switch the gateway to the new token, run a test enrollment, then revoke the old integration.',
      'Run a new inventory: the new RA key is `transfer`; the RA key of the revoked integration is `drop-key`.',
    ],
    drop: ['The integration is revoked: no RA operation uses the key. The binding keeps its RA certificates as history.'],
  },
};

export function rotationPlan(manifest: Manifest, approval?: Approval): string {
  const lines: string[] = ['# Controlled rotation plan', ''];
  let n = 0;
  for (const k of manifest.keys) {
    const action = approval?.keys[k.sourceKeyId]?.action ?? k.proposed;
    if (action !== 'rotate' && action !== 'drop-key' && action !== 'reprovision') continue;
    n++;
    const rows = k.references.filter(r => !r.role.endsWith('public-key') && r.role !== 'ssh-cert-signer').map(r => `${r.table}:${r.rowId}${r.rowStatus ? ` (${r.rowStatus})` : ''}`);
    lines.push(`## ${n}. ${k.class} ${k.sourceKeyId} -> ${action}`);
    lines.push(`Rows: ${rows.join(', ') || 'none'}`);
    if (k.reasons.length) lines.push(`Why: ${k.reasons.join('; ')}`);
    const steps = (action === 'drop-key' ? STEPS[k.class].drop : action === 'reprovision' ? STEPS[k.class].reprovision : STEPS[k.class].rotate) ?? [];
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  if (n === 0) lines.push('No key needs rotation, a new RA key or a drop decision.');
  return lines.join('\n');
}
