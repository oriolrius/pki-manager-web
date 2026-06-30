/**
 * OpenSSH KRL encoder (SSH-20) — builds a BARE (unsigned) OpenSSH-wire KRL from
 * revocation directives, reusing the RFC4251 wire primitives. Validated against
 * `ssh-keygen -Q`. v1 supports revoke-by-cert-serial (explicit list),
 * revoke-by-explicit-key, and revoke-by-SHA256-key-hash; serial RANGE/bitmap are
 * out of v1 scope (decision-012) to avoid over-revocation across serial gaps.
 *
 * Format (PROTOCOL.krl):
 *   magic "SSHKRL\n\0" | uint32 format_version=1 | uint64 krl_version |
 *   uint64 generated_date | uint64 flags | string reserved | string comment |
 *   then sections: byte section_type | string section_data
 */
import { createHash } from 'node:crypto';
import { SshWriter } from './wire.js';

const KRL_MAGIC = Buffer.from([0x53, 0x53, 0x48, 0x4b, 0x52, 0x4c, 0x0a, 0x00]); // "SSHKRL\n\0"
const KRL_FORMAT_VERSION = 1;

const SECTION_CERTIFICATES = 1;
const SECTION_EXPLICIT_KEY = 2;
const SECTION_FINGERPRINT_SHA256 = 5;
const CERT_SERIAL_LIST = 0x20;

export interface KrlDirectives {
  /** Revoke certificate serials, grouped by the signing CA's OpenSSH key blob. */
  certSerials?: Array<{ caKeyBlob: Buffer; serials: bigint[] }>;
  /** Revoke by full public-key blob. */
  explicitKeys?: Buffer[];
  /** Revoke by raw SHA-256 (32 bytes) of the public-key blob. */
  keyHashesSha256?: Buffer[];
  /** Monotonic KRL version number embedded in the header. */
  krlVersionNumber?: bigint;
  /** Unix seconds; embedded as generated_date. */
  generatedDate?: bigint;
  comment?: string;
}

export function buildKrl(d: KrlDirectives): Buffer {
  const w = new SshWriter();
  w.bytes(KRL_MAGIC);
  w.uint32(KRL_FORMAT_VERSION);
  w.uint64(d.krlVersionNumber ?? 0n);
  w.uint64(d.generatedDate ?? 0n);
  w.uint64(0n); // flags
  w.string(''); // reserved
  w.string(d.comment ?? '');

  // CERTIFICATES sections (one per CA), each with an explicit serial list.
  for (const grp of d.certSerials ?? []) {
    if (!grp.serials.length) continue;
    const sorted = [...grp.serials].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const serialData = new SshWriter();
    for (const s of sorted) serialData.uint64(s);
    const sectionData = new SshWriter()
      .string(grp.caKeyBlob) // ca_key (empty blob = any CA)
      .string(Buffer.alloc(0)) // reserved
      .byte(CERT_SERIAL_LIST)
      .string(serialData.build())
      .build();
    w.byte(SECTION_CERTIFICATES);
    w.string(sectionData);
  }

  if (d.explicitKeys?.length) {
    const inner = new SshWriter();
    for (const blob of d.explicitKeys) inner.string(blob);
    w.byte(SECTION_EXPLICIT_KEY);
    w.string(inner.build());
  }

  if (d.keyHashesSha256?.length) {
    const inner = new SshWriter();
    for (const h of d.keyHashesSha256) inner.string(h);
    w.byte(SECTION_FINGERPRINT_SHA256);
    w.string(inner.build());
  }

  return w.build();
}

/** Canonical KRL version string used as the ETag. */
export function krlVersion(bytes: Buffer): string {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}
