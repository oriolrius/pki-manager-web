import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { parseSshPublicKey, sshFingerprint, spkiToOpenSshEcdsa, SshPublicKeyError } from "./pubkey.js";

let work: string;
const keygen = (args: string[]) => execFileSync("ssh-keygen", args, { stdio: "pipe" });
const fingerprintOf = (pubPath: string) =>
  execFileSync("ssh-keygen", ["-lf", pubPath], { encoding: "utf8" }).split(/\s+/)[1];

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "ssh-pubkey-test-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("parseSshPublicKey", () => {
  it("parses an ed25519 key and matches ssh-keygen's fingerprint", () => {
    const path = join(work, "ed");
    keygen(["-t", "ed25519", "-f", path, "-N", "", "-C", "alice@host", "-q"]);
    const line = readFileSync(`${path}.pub`, "utf8");
    const parsed = parseSshPublicKey(line);
    expect(parsed.algo).toBe("ssh-ed25519");
    expect(parsed.ed25519?.pk.length).toBe(32);
    expect(parsed.comment).toBe("alice@host");
    expect(parsed.fingerprintSha256).toBe(fingerprintOf(`${path}.pub`));
  });

  it("parses an ecdsa-nistp256 key and matches ssh-keygen's fingerprint", () => {
    const path = join(work, "ec");
    keygen(["-t", "ecdsa", "-b", "256", "-f", path, "-N", "", "-q"]);
    const parsed = parseSshPublicKey(readFileSync(`${path}.pub`, "utf8"));
    expect(parsed.algo).toBe("ecdsa-sha2-nistp256");
    expect(parsed.ecdsa?.curve).toBe("nistp256");
    expect(parsed.ecdsa?.q.length).toBe(65);
    expect(parsed.ecdsa?.q[0]).toBe(0x04);
    expect(parsed.fingerprintSha256).toBe(fingerprintOf(`${path}.pub`));
  });

  it("rejects garbage, a pasted private key, and ssh-rsa with clear errors (no crash)", () => {
    expect(() => parseSshPublicKey("not a key")).toThrow(SshPublicKeyError);
    expect(() => parseSshPublicKey("ssh-ed25519 @@@notbase64@@@")).toThrow(SshPublicKeyError);

    const rsaPath = join(work, "rsa");
    keygen(["-t", "rsa", "-b", "2048", "-f", rsaPath, "-N", "", "-q"]);
    expect(() => parseSshPublicKey(readFileSync(`${rsaPath}.pub`, "utf8"))).toThrow(/rekey/i);

    const priv = readFileSync(join(work, "ed"), "utf8");
    expect(() => parseSshPublicKey(priv)).toThrow(/PRIVATE key/i);
  });

  it("rejects a blob whose declared algo disagrees with its contents", () => {
    const ec = parseSshPublicKey(readFileSync(join(work, "ec.pub"), "utf8"));
    const b64 = ec.blob.toString("base64");
    expect(() => parseSshPublicKey(`ssh-ed25519 ${b64}`)).toThrow(/does not match/i);
  });
});

describe("spkiToOpenSshEcdsa", () => {
  it("converts a KMS-style SPKI EC P-256 public key into an OpenSSH line ssh-keygen accepts", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spkiPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const line = spkiToOpenSshEcdsa(spkiPem, "kms-ca");
    expect(line.startsWith("ecdsa-sha2-nistp256 ")).toBe(true);

    // ssh-keygen must accept it and report a fingerprint equal to ours.
    const p = join(work, "spki.pub");
    writeFileSync(p, line);
    const fp = fingerprintOf(p);
    expect(sshFingerprint(parseSshPublicKey(line).blob)).toBe(fp);
  });

  it("rejects a non-EC SPKI key", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const spki = publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(() => spkiToOpenSshEcdsa(spki)).toThrow(SshPublicKeyError);
  });
});
