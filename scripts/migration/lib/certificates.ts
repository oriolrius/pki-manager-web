/**
 * Certificate bundle for an offline apply: the public certificates whose only copy is
 * in Cosmian (v3 keeps CA certificates there, and a leaf PEM when the row has none).
 *
 * `inventory --certificates-out FILE` writes it while Cosmian is still reachable;
 * `preflight|apply --certificates FILE` reads it, so apply needs no source KMS. Each
 * certificate is matched by the SHA-256 of its DER against the manifest, which the
 * approval binds: a missing, changed or unknown certificate stops preflight before any
 * key write. The bundle holds public data only; any other PEM block is refused.
 */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CosmianSource } from './cosmian.ts';
import type { CertificateEntry, Manifest } from './types.ts';
import { MigrationError, derToPem, sha256Hex } from './util.ts';

/** Certificate entries whose PEM apply must read from the source KMS. */
export function kmsOnlyCertificates(manifest: Manifest): CertificateEntry[] {
  return manifest.certificates.filter(c => c.table !== 'integration_ras' && c.pemSource === 'kms');
}

/** PEM bundle of every KMS-only certificate, each checked against its inventoried digest. */
export async function exportCertificateBundle(manifest: Manifest, kms: CosmianSource): Promise<{ pem: string; count: number }> {
  const seen = new Map<string, Buffer>();
  for (const c of kmsOnlyCertificates(manifest)) {
    if (!c.kmsCertificateId || !c.pemSha256 || seen.has(c.pemSha256)) continue;
    const der = await kms.getCertificateDer(c.kmsCertificateId);
    if (!der || sha256Hex(der) !== c.pemSha256) throw new MigrationError('PEM_CHANGED', `certificate ${c.table}:${c.rowId} differs from the inventoried one`);
    seen.set(c.pemSha256, der);
  }
  return { pem: [...seen.values()].map(d => derToPem(d, 'CERTIFICATE').trim()).join('\n') + (seen.size ? '\n' : ''), count: seen.size };
}

/** DER of each certificate of a bundle file, by SHA-256. Refuses anything that is not a certificate. */
export function loadCertificateBundle(path: string): Map<string, Buffer> {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { throw new MigrationError('CERT_BUNDLE', 'certificate bundle is not readable'); }
  const blocks = [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g)];
  const rest = text.replace(/-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g, '').trim();
  if (rest) throw new MigrationError('CERT_BUNDLE', 'certificate bundle holds text outside PEM blocks');
  const out = new Map<string, Buffer>();
  blocks.forEach((b, i) => {
    if (b[1] !== 'CERTIFICATE') throw new MigrationError('CERT_BUNDLE', `certificate bundle block ${i + 1} is ${b[1]}, not CERTIFICATE`);
    let der: Buffer;
    try { der = new X509Certificate(b[0]).raw; } catch { throw new MigrationError('CERT_BUNDLE', `certificate bundle block ${i + 1} does not parse`); }
    out.set(sha256Hex(der), der);
  });
  return out;
}
