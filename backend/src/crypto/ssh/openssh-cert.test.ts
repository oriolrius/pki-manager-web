import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { parseSshPublicKey, spkiToOpenSshEcdsa, type ParsedSshPublicKey } from "./pubkey.js";
import {
  buildSshCertTbs,
  assembleSshCert,
  DEFAULT_USER_EXTENSIONS,
  SSH_CERT_NO_EXPIRY,
  SshCertEncodeError,
} from "./openssh-cert.js";
import { derToSshEcdsaSignature } from "./sign.js";

let work: string;
const keygen = (args: string[]) => execFileSync("ssh-keygen", args, { stdio: "pipe" });

// A local ECDSA P-256 CA, standing in for the KMS-held CA key.
let caPriv: KeyObject;
let caBlob: Buffer;
let caFingerprint: string;
let subjectEd: ParsedSshPublicKey;
let subjectEc: ParsedSshPublicKey;

/** Sign the TBS exactly as SSH-03 will (DER -> OpenSSH ECDSA signature blob). */
function signTbs(tbs: Buffer): Buffer {
  const der = cryptoSign("sha256", tbs, { key: caPriv, dsaEncoding: "der" });
  return derToSshEcdsaSignature(der);
}

function inspect(line: string): string {
  const p = join(work, "cert.pub");
  writeFileSync(p, line);
  return execFileSync("ssh-keygen", ["-L", "-f", p], { encoding: "utf8" });
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "ssh-cert-test-"));

  const ca = generateKeyPairSync("ec", { namedCurve: "P-256" });
  caPriv = ca.privateKey;
  const caLine = spkiToOpenSshEcdsa(ca.publicKey.export({ type: "spki", format: "pem" }) as string, "test-ca");
  const caParsed = parseSshPublicKey(caLine);
  caBlob = caParsed.blob;
  caFingerprint = caParsed.fingerprintSha256;

  keygen(["-t", "ed25519", "-f", join(work, "subj_ed"), "-N", "", "-q"]);
  keygen(["-t", "ecdsa", "-b", "256", "-f", join(work, "subj_ec"), "-N", "", "-q"]);
  subjectEd = parseSshPublicKey(readFileSync(join(work, "subj_ed.pub"), "utf8"));
  subjectEc = parseSshPublicKey(readFileSync(join(work, "subj_ec.pub"), "utf8"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("buildSshCertTbs / assembleSshCert", () => {
  it("emits an ed25519 USER cert that ssh-keygen -L decodes with the right fields", () => {
    const validAfter = 1_700_000_000n;
    const validBefore = validAfter + 604800n; // +1w
    const { tbs, certType } = buildSshCertTbs({
      subjectKey: subjectEd,
      caPublicKeyBlob: caBlob,
      serial: 42n,
      type: "user",
      keyId: "Jane Jolie",
      principals: ["alice", "admin"],
      validAfter,
      validBefore,
      extensions: [...DEFAULT_USER_EXTENSIONS],
    });
    const { line } = assembleSshCert(tbs, signTbs(tbs), certType);
    const out = inspect(line);

    expect(out).toContain("Type: ssh-ed25519-cert-v01@openssh.com user certificate");
    expect(out).toContain('Key ID: "Jane Jolie"');
    expect(out).toContain("Serial: 42");
    expect(out).toContain("alice");
    expect(out).toContain("admin");
    expect(out).toContain("permit-pty");
    expect(out).toContain(`Signing CA: ECDSA ${caFingerprint}`);

    // Signature must verify against the CA public key over the exact TBS bytes.
    const der = cryptoSign("sha256", tbs, { key: caPriv, dsaEncoding: "der" });
    expect(cryptoVerify("sha256", tbs, { key: caPriv, dsaEncoding: "der" }, der)).toBe(true);
  });

  it("emits an ecdsa HOST cert with host principals and no extensions", () => {
    const { tbs, certType } = buildSshCertTbs({
      subjectKey: subjectEc,
      caPublicKeyBlob: caBlob,
      serial: 1001n,
      type: "host",
      keyId: "server.lab.local-2026",
      principals: ["server.lab.local", "10.0.0.5"],
      validAfter: 1_700_000_000n,
      validBefore: SSH_CERT_NO_EXPIRY,
    });
    const out = inspect(assembleSshCert(tbs, signTbs(tbs), certType).line);
    expect(out).toContain("Type: ecdsa-sha2-nistp256-cert-v01@openssh.com host certificate");
    expect(out).toContain("server.lab.local");
    expect(out).toContain("10.0.0.5");
    expect(out).toMatch(/Extensions:\s*\(none\)/);
    expect(out).toContain("Serial: 1001");
  });

  it("round-trips force-command, source-address and a hardened (no permit-pty) extension set", () => {
    const { tbs, certType } = buildSshCertTbs({
      subjectKey: subjectEd,
      caPublicKeyBlob: caBlob,
      serial: 7n,
      type: "user",
      keyId: "restricted",
      principals: ["ops"],
      validAfter: 1_700_000_000n,
      validBefore: 1_700_604_800n,
      criticalOptions: { forceCommand: "/usr/bin/date", sourceAddress: "192.0.2.0/24,10.0.0.0/8" },
      extensions: ["permit-agent-forwarding"], // hardened: no permit-pty
    });
    const out = inspect(assembleSshCert(tbs, signTbs(tbs), certType).line);
    expect(out).toContain("force-command");
    expect(out).toContain("/usr/bin/date");
    expect(out).toContain("source-address");
    expect(out).toContain("192.0.2.0/24");
    expect(out).toContain("permit-agent-forwarding");
    expect(out).not.toContain("permit-pty");
  });

  it("enforces the empty-principal and key_id guards", () => {
    const base = {
      subjectKey: subjectEd,
      caPublicKeyBlob: caBlob,
      serial: 1n,
      type: "user" as const,
      keyId: "ok",
      principals: ["x"],
      validAfter: 1n,
      validBefore: 2n,
    };
    expect(() => buildSshCertTbs({ ...base, principals: [] })).toThrow(SshCertEncodeError);
    expect(() => buildSshCertTbs({ ...base, principals: [], allowEmptyPrincipals: true })).not.toThrow();
    expect(() => buildSshCertTbs({ ...base, keyId: "bad\nid" })).toThrow(SshCertEncodeError);
    expect(() => buildSshCertTbs({ ...base, keyId: "" })).toThrow(SshCertEncodeError);
  });
});
