/**
 * SSH public-key parsing & conversion (SSH-02) — the single chokepoint for
 * accepting host/user public keys into the SSH Certificate Manager.
 *
 * Parses one-line OpenSSH `authorized_keys`-format keys (ssh-ed25519,
 * ecdsa-sha2-nistp256) into a normalized struct, computes the `SHA256:…`
 * fingerprint sshd logs, and converts a KMS-exported SPKI public key into an
 * `ecdsa-sha2-nistp256 AAAA…` OpenSSH line.
 *
 * v1 supports ed25519 + ecdsa-nistp256 SUBJECT keys. ssh-rsa is rejected with an
 * actionable message (rekey to Ed25519/ECDSA). No runtime npm dependency.
 */
import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { SshReader, SshWriter } from "./wire.js";

export type SshKeyAlgo = "ssh-ed25519" | "ecdsa-sha2-nistp256";

export interface ParsedSshPublicKey {
  /** Key algorithm / type string. */
  algo: SshKeyAlgo;
  /** Full base64-decoded OpenSSH key blob (begins with `string algo`). */
  blob: Buffer;
  /** Trailing comment, or "" when absent. */
  comment: string;
  /** `SHA256:<base64-nopad>` fingerprint, exactly as `ssh-keygen -lf` reports. */
  fingerprintSha256: string;
  /** ed25519 subject: the raw 32-byte public key. */
  ed25519?: { pk: Buffer };
  /** ecdsa-nistp256 subject: the curve id and the EC point Q. */
  ecdsa?: { curve: string; q: Buffer };
}

export class SshPublicKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshPublicKeyError";
  }
}

const SUPPORTED: ReadonlySet<string> = new Set(["ssh-ed25519", "ecdsa-sha2-nistp256"]);

/** Compute the OpenSSH `SHA256:…` fingerprint of a key blob. */
export function sshFingerprint(blob: Buffer): string {
  const digest = createHash("sha256").update(blob).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/**
 * Parse a single-line OpenSSH public key (`<algo> <base64> [comment]`).
 * Throws SshPublicKeyError (never crashes) on malformed input, a pasted private
 * key, or an unsupported algorithm.
 */
export function parseSshPublicKey(line: string): ParsedSshPublicKey {
  const trimmed = line.trim();
  if (!trimmed) throw new SshPublicKeyError("empty public key");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed) || /^-----BEGIN OPENSSH PRIVATE KEY-----/.test(trimmed)) {
    throw new SshPublicKeyError("a PRIVATE key was provided — paste only the public key (id_*.pub)");
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) throw new SshPublicKeyError("not an OpenSSH public key (expected '<algo> <base64> [comment]')");
  const [algo, b64, ...rest] = parts;
  const comment = rest.join(" ");

  if (algo === "ssh-rsa" || algo === "rsa-sha2-256" || algo === "rsa-sha2-512") {
    throw new SshPublicKeyError(
      "ssh-rsa keys are not supported as SSH certificate subjects in v1 — rekey the host/user to Ed25519 (recommended) or ECDSA nistp256"
    );
  }
  if (!SUPPORTED.has(algo)) {
    throw new SshPublicKeyError(`unsupported SSH key algorithm '${algo}' — use ssh-ed25519 or ecdsa-sha2-nistp256`);
  }

  let blob: Buffer;
  try {
    blob = Buffer.from(b64, "base64");
    if (blob.length === 0 || blob.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) {
      throw new Error("not valid base64");
    }
  } catch {
    throw new SshPublicKeyError("public key base64 is malformed");
  }

  // The blob must begin with `string algo` that matches the declared algorithm.
  let reader: SshReader;
  let embeddedAlgo: string;
  try {
    reader = new SshReader(blob);
    embeddedAlgo = reader.cstring();
  } catch {
    throw new SshPublicKeyError("public key blob is truncated or corrupt");
  }
  if (embeddedAlgo !== algo) {
    throw new SshPublicKeyError(`public key blob algorithm '${embeddedAlgo}' does not match declared '${algo}'`);
  }

  const result: ParsedSshPublicKey = {
    algo: algo as SshKeyAlgo,
    blob,
    comment,
    fingerprintSha256: sshFingerprint(blob),
  };

  try {
    if (algo === "ssh-ed25519") {
      const pk = reader.string();
      if (pk.length !== 32) throw new Error(`ed25519 public key must be 32 bytes, got ${pk.length}`);
      result.ed25519 = { pk };
    } else {
      // ecdsa-sha2-nistp256: string curve, string Q
      const curve = reader.cstring();
      const q = reader.string();
      if (curve !== "nistp256") throw new Error(`expected curve 'nistp256', got '${curve}'`);
      if (q.length !== 65 || q[0] !== 0x04) throw new Error("ECDSA point must be a 65-byte uncompressed point (0x04…)");
      result.ecdsa = { curve, q };
    }
  } catch (e) {
    throw new SshPublicKeyError(`invalid ${algo} key material: ${(e as Error).message}`);
  }

  return result;
}

/**
 * Build an `ecdsa-sha2-nistp256 AAAA…` OpenSSH line from a raw uncompressed EC
 * point Q (65 bytes, `0x04 ‖ X ‖ Y`). This is the form the Cosmian KMS returns
 * for an EC public key (KMIP `Get` → KeyMaterial.QString — decision-011 spike).
 */
export function ecPointToOpenSshEcdsa(q: Buffer, comment = ""): string {
  if (q.length !== 65 || q[0] !== 0x04) {
    throw new SshPublicKeyError("expected a 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y)");
  }
  const blob = new SshWriter().string("ecdsa-sha2-nistp256").string("nistp256").string(q).build();
  const line = `ecdsa-sha2-nistp256 ${blob.toString("base64")}`;
  return comment ? `${line} ${comment}` : line;
}

/**
 * Convert an SPKI public key (PEM or DER) for an ECDSA P-256 key into an OpenSSH
 * line. Used when a key arrives in SPKI form rather than as a raw point.
 */
export function spkiToOpenSshEcdsa(spki: string | Buffer, comment = ""): string {
  let keyObj: KeyObject;
  try {
    keyObj = createPublicKey(typeof spki === "string" ? spki : { key: spki, format: "der", type: "spki" });
  } catch (e) {
    throw new SshPublicKeyError(`not a valid SPKI public key: ${(e as Error).message}`);
  }
  const jwk = keyObj.export({ format: "jwk" }) as { kty?: string; crv?: string; x?: string; y?: string };
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new SshPublicKeyError("SPKI key is not an ECDSA P-256 public key");
  }
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const q = Buffer.concat([Buffer.from([0x04]), x, y]); // uncompressed point
  return ecPointToOpenSshEcdsa(q, comment);
}

/** Build the raw OpenSSH key blob for a parsed subject key (used to embed in certs). */
export function openSshKeyBlob(key: ParsedSshPublicKey): Buffer {
  return key.blob;
}

/**
 * Extract the subject public key from an OpenSSH certificate line as a plain
 * `<algo> <base64>` line (used to renew a cert without re-supplying the key).
 */
export function subjectPubkeyFromCert(certLine: string): string {
  const parts = certLine.trim().split(/\s+/);
  const certType = parts[0];
  const blob = Buffer.from(parts[1] ?? '', 'base64');
  const reader = new SshReader(blob);
  const embeddedType = reader.cstring();
  if (embeddedType !== certType) throw new SshPublicKeyError('certificate type mismatch in blob');
  reader.string(); // nonce
  let line: string;
  if (certType === 'ssh-ed25519-cert-v01@openssh.com') {
    const pk = reader.string();
    const w = new SshWriter().string('ssh-ed25519').string(pk).build();
    line = `ssh-ed25519 ${w.toString('base64')}`;
  } else if (certType === 'ecdsa-sha2-nistp256-cert-v01@openssh.com') {
    const curve = reader.cstring();
    const q = reader.string();
    const w = new SshWriter().string('ecdsa-sha2-nistp256').string(curve).string(q).build();
    line = `ecdsa-sha2-nistp256 ${w.toString('base64')}`;
  } else {
    throw new SshPublicKeyError(`unsupported certificate type '${certType}'`);
  }
  return line;
}
