/**
 * SSH ECDSA signature encoding (SSH-03 / SSH-04 pure helpers).
 *
 * The Cosmian KMS (and Node crypto with dsaEncoding:'der') returns DER/ASN.1
 * ECDSA signatures (decision-011 spike). OpenSSH in-certificate signatures are
 * `string sig-algo + string (mpint r ‖ mpint s)`. These helpers bridge the two.
 *
 * The detached KRL signature (SSH-04) is pinned to **DER** — the same bytes the
 * KMS emits — so the puller verifies with a stock ECDSA verifier and no re-decode.
 */
import { SshWriter } from "./wire.js";

export const SSH_ECDSA_SIG_ALGO = "ecdsa-sha2-nistp256";

/**
 * Parse a DER/ASN.1 ECDSA signature `SEQUENCE { INTEGER r, INTEGER s }` into the
 * raw positive integer bytes for r and s (leading sign/zero bytes stripped).
 */
export function derEcdsaToRS(der: Buffer): { r: Buffer; s: Buffer } {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error("invalid ECDSA DER: expected SEQUENCE (0x30)");
  // SEQUENCE length (short or long form)
  let seqLen = der[o++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) seqLen = (seqLen << 8) | der[o++];
  }
  const readInt = (): Buffer => {
    if (der[o++] !== 0x02) throw new Error("invalid ECDSA DER: expected INTEGER (0x02)");
    let len = der[o++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[o++];
    }
    let v = der.subarray(o, o + len);
    o += len;
    while (v.length > 1 && v[0] === 0x00) v = v.subarray(1); // strip sign padding
    return Buffer.from(v);
  };
  const r = readInt();
  const s = readInt();
  return { r, s };
}

/**
 * Encode r and s (raw positive integer bytes) as an OpenSSH ECDSA signature blob:
 * `string "ecdsa-sha2-nistp256" + string (mpint r ‖ mpint s)`.
 */
export function encodeEcdsaSshSignature(r: Buffer, s: Buffer): Buffer {
  const inner = new SshWriter().mpint(r).mpint(s).build();
  return new SshWriter().string(SSH_ECDSA_SIG_ALGO).string(inner).build();
}

/** Convenience: DER signature -> OpenSSH ECDSA signature blob. */
export function derToSshEcdsaSignature(der: Buffer): Buffer {
  const { r, s } = derEcdsaToRS(der);
  return encodeEcdsaSshSignature(r, s);
}

/** DER signature -> fixed-width IEEE P-1363 `r‖s` (32 bytes each for P-256). */
export function derToP1363(der: Buffer, size = 32): Buffer {
  const { r, s } = derEcdsaToRS(der);
  const pad = (b: Buffer): Buffer =>
    b.length >= size ? b.subarray(b.length - size) : Buffer.concat([Buffer.alloc(size - b.length), b]);
  return Buffer.concat([pad(r), pad(s)]);
}
