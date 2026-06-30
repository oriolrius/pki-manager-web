/**
 * SSH-03 integration test — proves the signRaw seam produces a real, valid
 * OpenSSH certificate signed by a NON-exportable KMS-held CA key. Gated on a live
 * KMS (KMS_AVAILABLE); skips cleanly otherwise. The full "a real sshd accepts it"
 * proof is the e2e harness (SSH-33).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKMSService } from "./service.js";
import { parseSshPublicKey } from "../crypto/ssh/pubkey.js";
import { buildSshCertTbs, assembleSshCert, DEFAULT_USER_EXTENSIONS } from "../crypto/ssh/openssh-cert.js";
import { derToSshEcdsaSignature } from "../crypto/ssh/sign.js";

const KMS = process.env.KMS_AVAILABLE === "true";
const kms = getKMSService();

describe.skipIf(!KMS)("SSH-03 signRaw + SSH cert signing against live KMS", () => {
  let work: string;
  let caPrivId: string;
  let caPubId: string;
  let caBlob: Buffer;
  let caFingerprint: string;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "ssh-kms-sign-"));
    const ids = await kms.createSshCaKeyPair({ tags: ["ssh-test-ca", "ssh-sign-it"], sensitive: true });
    caPrivId = ids.privateKeyId;
    caPubId = ids.publicKeyId;
    const line = await kms.getSshPublicKeyLine(caPubId, "kms-test-ca");
    const parsed = parseSshPublicKey(line);
    caBlob = parsed.blob;
    caFingerprint = parsed.fingerprintSha256;
  }, 60_000);

  afterAll(async () => {
    if (caPrivId && caPubId) {
      try {
        await kms.destroyKeyPair(caPrivId, caPubId);
      } catch {
        /* best effort */
      }
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("publishes the KMS CA public key as a valid OpenSSH ecdsa line", () => {
    expect(caBlob.length).toBeGreaterThan(0);
    expect(caFingerprint.startsWith("SHA256:")).toBe(true);
  });

  it("signs a HOST cert via signRaw that ssh-keygen -L decodes with the KMS CA as Signing CA", async () => {
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", join(work, "host"), "-N", "", "-q"]);
    const subject = parseSshPublicKey(readFileSync(join(work, "host.pub"), "utf8"));
    const { tbs, certType } = buildSshCertTbs({
      subjectKey: subject,
      caPublicKeyBlob: caBlob,
      serial: 1001n,
      type: "host",
      keyId: "server.lab.local-2026",
      principals: ["server.lab.local", "10.0.0.5"],
      validAfter: 1_700_000_000n,
      validBefore: 1_700_000_000n + 604800n,
    });
    const der = await kms.signRaw(caPrivId, tbs);
    const { line } = assembleSshCert(tbs, derToSshEcdsaSignature(der), certType);
    const certPath = join(work, "host-cert.pub");
    writeFileSync(certPath, line);

    const out = execFileSync("ssh-keygen", ["-L", "-f", certPath], { encoding: "utf8" });
    expect(out).toContain("host certificate");
    expect(out).toContain("server.lab.local");
    expect(out).toContain("Serial: 1001");
    expect(out).toContain(`Signing CA: ECDSA ${caFingerprint}`);

    // The KMS must verify its own signature over the exact TBS bytes.
    const verified = await kms.signatureVerify(caPubId, tbs, der);
    expect(verified).toBe(true);
  });

  it("signs a USER cert via signRaw with role principals and default extensions", async () => {
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", join(work, "user"), "-N", "", "-q"]);
    const subject = parseSshPublicKey(readFileSync(join(work, "user.pub"), "utf8"));
    const { tbs, certType } = buildSshCertTbs({
      subjectKey: subject,
      caPublicKeyBlob: caBlob,
      serial: 7n,
      type: "user",
      keyId: "Jane Jolie",
      principals: ["admin", "developer"],
      validAfter: 1_700_000_000n,
      validBefore: 1_700_000_000n + 604800n,
      extensions: [...DEFAULT_USER_EXTENSIONS],
    });
    const der = await kms.signRaw(caPrivId, tbs);
    const { line } = assembleSshCert(tbs, derToSshEcdsaSignature(der), certType);
    const certPath = join(work, "user-cert.pub");
    writeFileSync(certPath, line);
    const out = execFileSync("ssh-keygen", ["-L", "-f", certPath], { encoding: "utf8" });
    expect(out).toContain("user certificate");
    expect(out).toContain("admin");
    expect(out).toContain("permit-pty");
    expect(out).toContain(`Signing CA: ECDSA ${caFingerprint}`);
  });
});
