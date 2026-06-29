/**
 * OpenSSH certificate encoder (SSH-01) — PROTOCOL.certkeys wire layout for
 * ssh-ed25519 and ecdsa-sha2-nistp256 subject keys.
 *
 * Splits cleanly into:
 *   buildSshCertTbs(params)  -> the to-be-signed bytes (type string … signature key)
 *   assembleSshCert(tbs, sig) -> the final base64 one-line certificate
 * so the raw signature (KMIP Sign, SSH-03) is produced in between by a caller.
 *
 * Security guards (SSH-01 AC): an empty principals list is rejected by default
 * (empty == "valid for all" — a host cert matching any name / a user cert for any
 * login); key_id is constrained to printable, control-character-free text (sshd
 * logs it verbatim — it is the audit anchor).
 */
import { randomBytes } from "node:crypto";
import type { ParsedSshPublicKey } from "./pubkey.js";
import { SshWriter, encodeStringList, encodeOptions } from "./wire.js";

export type SshCertType = "user" | "host";

/** uint64 sentinel meaning "no expiry". */
export const SSH_CERT_NO_EXPIRY = (1n << 64n) - 1n;

/** The five default user-certificate extensions (ssh-keygen's default set). */
export const DEFAULT_USER_EXTENSIONS = [
  "permit-X11-forwarding",
  "permit-agent-forwarding",
  "permit-port-forwarding",
  "permit-pty",
  "permit-user-rc",
] as const;

export interface SshCertParams {
  /** Parsed subject public key (the key being certified). */
  subjectKey: ParsedSshPublicKey;
  /** The CA's OpenSSH public-key blob (embedded as the cert's "signature key"). */
  caPublicKeyBlob: Buffer;
  serial: bigint;
  type: SshCertType;
  /** Free-form identifier logged by sshd on every auth (audit anchor). */
  keyId: string;
  /** Unix usernames/roles (user cert) or hostnames/IPs (host cert). */
  principals: string[];
  /** Unix seconds. */
  validAfter: bigint;
  /** Unix seconds, or SSH_CERT_NO_EXPIRY. */
  validBefore: bigint;
  /** Critical options (enforced unconditionally by sshd). */
  criticalOptions?: { forceCommand?: string; sourceAddress?: string };
  /** Flag extensions (permit-pty, …). Absent == capability denied. */
  extensions?: string[];
  /** Deterministic nonce for tests; defaults to 32 random bytes (a security control). */
  nonce?: Buffer;
  /** Explicitly allow an empty principals list ("valid for all" — dangerous). */
  allowEmptyPrincipals?: boolean;
}

export class SshCertEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshCertEncodeError";
  }
}

const KEY_ID_RE = /^[\x20-\x7e]{1,255}$/; // printable ASCII, no control chars, 1..255

/** Map a subject key to its certificate type string. */
export function certTypeString(subjectKey: ParsedSshPublicKey): string {
  return subjectKey.algo === "ssh-ed25519"
    ? "ssh-ed25519-cert-v01@openssh.com"
    : "ecdsa-sha2-nistp256-cert-v01@openssh.com";
}

function validateGuards(params: SshCertParams): void {
  if (!KEY_ID_RE.test(params.keyId)) {
    throw new SshCertEncodeError("key_id must be 1–255 printable, control-character-free ASCII chars");
  }
  if (params.principals.length === 0 && !params.allowEmptyPrincipals) {
    throw new SshCertEncodeError(
      "empty principals list means 'valid for all' — pass allowEmptyPrincipals to opt in explicitly"
    );
  }
  for (const p of params.principals) {
    if (p.length === 0 || /[\x00-\x1f\x7f]/.test(p)) {
      throw new SshCertEncodeError(`invalid principal '${p}' (empty or contains control characters)`);
    }
  }
  if (params.validBefore <= params.validAfter && params.validBefore !== SSH_CERT_NO_EXPIRY) {
    throw new SshCertEncodeError("validBefore must be greater than validAfter");
  }
}

function criticalOptionsArray(opts?: SshCertParams["criticalOptions"]): Array<{ name: string; value?: string }> {
  const out: Array<{ name: string; value?: string }> = [];
  if (opts?.forceCommand) out.push({ name: "force-command", value: opts.forceCommand });
  if (opts?.sourceAddress) out.push({ name: "source-address", value: opts.sourceAddress });
  return out; // encodeOptions sorts by name
}

/**
 * Build the to-be-signed bytes of an OpenSSH certificate: every field from the
 * type string through the embedded "signature key" (CA public key), excluding
 * only the trailing signature. This is exactly what the CA signs.
 */
export function buildSshCertTbs(params: SshCertParams): { tbs: Buffer; certType: string; nonce: Buffer } {
  validateGuards(params);
  const certType = certTypeString(params.subjectKey);
  const nonce = params.nonce ?? randomBytes(32);
  const typeNum = params.type === "user" ? 1 : 2;

  const w = new SshWriter();
  w.string(certType);
  w.string(nonce);

  // Subject public-key fields (algorithm-specific).
  if (params.subjectKey.algo === "ssh-ed25519") {
    if (!params.subjectKey.ed25519) throw new SshCertEncodeError("subject key missing ed25519 material");
    w.string(params.subjectKey.ed25519.pk);
  } else {
    if (!params.subjectKey.ecdsa) throw new SshCertEncodeError("subject key missing ecdsa material");
    w.string(params.subjectKey.ecdsa.curve);
    w.string(params.subjectKey.ecdsa.q);
  }

  w.uint64(params.serial);
  w.uint32(typeNum);
  w.string(params.keyId);
  w.string(encodeStringList(params.principals));
  w.uint64(params.validAfter);
  w.uint64(params.validBefore);
  w.string(encodeOptions(criticalOptionsArray(params.criticalOptions)));
  w.string(encodeOptions((params.extensions ?? []).map((name) => ({ name }))));
  w.string(Buffer.alloc(0)); // reserved
  w.string(params.caPublicKeyBlob); // signature key

  return { tbs: w.build(), certType, nonce };
}

/**
 * Assemble the final certificate from the TBS and the OpenSSH signature blob
 * (`string sig-algo + string raw-signature`, produced by SSH-03). Returns the raw
 * blob and the one-line `<cert-type> <base64> [comment]` representation.
 */
export function assembleSshCert(
  tbs: Buffer,
  sshSignatureBlob: Buffer,
  certType: string,
  comment = ""
): { blob: Buffer; line: string } {
  const blob = new SshWriter().bytes(tbs).string(sshSignatureBlob).build();
  const line = `${certType} ${blob.toString("base64")}${comment ? ` ${comment}` : ""}`;
  return { blob, line };
}
