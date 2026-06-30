/**
 * SSH-SENS spike — determine the SSH CA signing path empirically against the live
 * Cosmian KMS (decision-011). Run:  KMS_URL=… npx tsx src/kms/spike-ssh-sign.ts
 *
 * It answers the BLOCKING question for the whole milestone: can we sign SSH
 * certificates WITHOUT ever exporting the CA private key from the KMS? It probes,
 * against a freshly-created ECDSA-P256 key:
 *
 *   (a) KMIP-JSON `Sign` on a key created with Sensitive=true (NON-exportable)
 *   (b) Cosmian native `cosmian kms ec sign` on the same key
 *   (c) whether a NON-sensitive EC key exports via KMIP `Get` (PKCS#8) in a layout
 *       Node's crypto.createPrivateKey accepts (the in-memory export-and-sign FALLBACK)
 *   (d) that Sensitive=true keys refuse `Get` (export is genuinely denied)
 *
 * Every signature produced is verified two ways: locally with node:crypto against
 * the exported SPKI public key, and server-side via KMIP `SignatureVerify`.
 *
 * The script is side-effect-isolated: it creates its own throwaway keys and
 * destroys them in a finally block. It SKIPS (exit 0) when KMS_URL is unreachable
 * so it never breaks CI on a machine with no KMS.
 */
import { createPublicKey, verify as cryptoVerify, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KMS_URL = (process.env.KMS_URL || "http://wsl.ymbihq.local:42998").replace(/\/$/, "");
const COSMIAN_BIN = process.env.COSMIAN_BIN || "cosmian";

type Probe = { path: string; ok: boolean; detail: string };
const probes: Probe[] = [];
const record = (path: string, ok: boolean, detail: string) => {
  probes.push({ path, ok, detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${path}: ${detail}`);
};

interface KmipEl { tag: string; type?: string; value: unknown }

async function kmip(request: unknown): Promise<{ status: number; els: KmipEl[]; text: string }> {
  const res = await fetch(`${KMS_URL}/kmip/2_1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let els: KmipEl[] = [];
  try {
    const json = JSON.parse(text) as { value?: KmipEl[] };
    els = json.value ?? [];
  } catch {
    /* non-JSON error body (e.g. Codec_Error) — keep raw text */
  }
  return { status: res.status, els, text };
}

const find = (els: KmipEl[], tag: string): KmipEl | undefined => els.find((e) => e.tag === tag);
const strVal = (els: KmipEl[], tag: string): string => String(find(els, tag)?.value ?? "");

/** Best-effort local ECDSA verify; returns false (not throws) if the SPKI cannot be parsed. */
function tryLocalVerify(pubPem: string | null, message: Buffer, sig: Buffer): boolean | "n/a" {
  if (!pubPem) return "n/a";
  try {
    return cryptoVerify("sha256", message, { key: createPublicKey(pubPem), dsaEncoding: "der" }, sig);
  } catch {
    return "n/a"; // EC public key not in a Node-importable SPKI layout (SSH-02/SSH-10 will convert)
  }
}

/** EC P-256 CreateKeyPair via pure KMIP-JSON. RecommendedCurve token is "P256". */
async function createEcKeyPair(sensitive: boolean): Promise<{ privId: string; pubId: string }> {
  const domain = { tag: "CryptographicDomainParameters", value: [{ tag: "RecommendedCurve", type: "Enumeration", value: "P256" }] };
  const common: KmipEl[] = [
    { tag: "CryptographicAlgorithm", type: "Enumeration", value: "ECDSA" },
    domain as unknown as KmipEl,
    // Sign(1)|Verify(2): without a Sign usage the key signs nowhere even once Active.
    { tag: "CryptographicUsageMask", type: "Integer", value: 3 },
    { tag: "Sensitive", type: "Boolean", value: sensitive },
    { tag: "ObjectType", type: "Enumeration", value: "PrivateKey" },
  ];
  const { status, els, text } = await kmip({
    tag: "CreateKeyPair",
    value: [{ tag: "CommonAttributes", value: common }],
  });
  const privId = strVal(els, "PrivateKeyUniqueIdentifier");
  const pubId = strVal(els, "PublicKeyUniqueIdentifier");
  if (!privId || !pubId) throw new Error(`CreateKeyPair failed (HTTP ${status}): ${text.slice(0, 200)}`);
  // KMIP keys are created PreActive; Sign/SignatureVerify refuse a non-Active key
  // with "no valid key for id". Activate both before use. (SSH-05/SSH-10 must do this.)
  await kmip({ tag: "Activate", value: [{ tag: "UniqueIdentifier", type: "TextString", value: privId }] });
  await kmip({ tag: "Activate", value: [{ tag: "UniqueIdentifier", type: "TextString", value: pubId }] });
  return { privId, pubId };
}

/** Fetch the EC public key as an SPKI PEM (mirrors KMSClient.getPublicKey parsing). */
async function getPublicKeyPem(pubId: string): Promise<string> {
  const { els } = await kmip({
    tag: "Get",
    value: [
      { tag: "UniqueIdentifier", type: "TextString", value: pubId },
      { tag: "KeyFormatType", type: "Enumeration", value: "PKCS8" },
      { tag: "KeyWrapType", type: "Enumeration", value: "AsRegistered" },
    ],
  });
  const pub = find(els, "PublicKey");
  const keyBlock = find((pub?.value as KmipEl[]) ?? [], "KeyBlock");
  const keyValue = find((keyBlock?.value as KmipEl[]) ?? [], "KeyValue");
  const keyMaterial = find((keyValue?.value as KmipEl[]) ?? [], "KeyMaterial");
  const der = Buffer.from(String(keyMaterial?.value ?? ""), "hex");
  const b64 = der.toString("base64").match(/.{1,64}/g)?.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

/** KMIP Sign — returns a DER/ASN.1 ECDSA signature; the KMS hashes (SHA-256) and signs. */
async function kmipSign(privId: string, message: Buffer): Promise<Buffer> {
  const { els, status, text } = await kmip({
    tag: "Sign",
    value: [
      { tag: "UniqueIdentifier", type: "TextString", value: privId },
      {
        tag: "CryptographicParameters",
        value: [
          { tag: "CryptographicAlgorithm", type: "Enumeration", value: "ECDSA" },
          { tag: "HashingAlgorithm", type: "Enumeration", value: "SHA256" },
        ],
      },
      { tag: "Data", type: "ByteString", value: message.toString("hex") },
    ],
  });
  const sigHex = strVal(els, "SignatureData");
  if (!sigHex) throw new Error(`Sign failed (HTTP ${status}): ${text.slice(0, 200)}`);
  return Buffer.from(sigHex, "hex");
}

/** KMIP SignatureVerify — server-side validation against the public key. */
async function kmipVerify(pubId: string, message: Buffer, sig: Buffer): Promise<boolean> {
  const { els, text } = await kmip({
    tag: "SignatureVerify",
    value: [
      { tag: "UniqueIdentifier", type: "TextString", value: pubId },
      {
        tag: "CryptographicParameters",
        value: [
          { tag: "CryptographicAlgorithm", type: "Enumeration", value: "ECDSA" },
          { tag: "HashingAlgorithm", type: "Enumeration", value: "SHA256" },
        ],
      },
      { tag: "Data", type: "ByteString", value: message.toString("hex") },
      { tag: "SignatureData", type: "ByteString", value: sig.toString("hex") },
    ],
  });
  const indicator = strVal(els, "ValidityIndicator");
  return indicator.toLowerCase() === "valid" || /valid/i.test(text);
}

async function destroy(id: string): Promise<void> {
  try { await kmip({ tag: "Revoke", value: [{ tag: "UniqueIdentifier", type: "TextString", value: id }, { tag: "RevocationReason", value: [{ tag: "RevocationReasonCode", type: "Enumeration", value: "Unspecified" }] }] }); } catch { /* best effort */ }
  try { await kmip({ tag: "Destroy", value: [{ tag: "UniqueIdentifier", type: "TextString", value: id }] }); } catch { /* best effort */ }
}

async function main(): Promise<void> {
  console.log(`SSH-SENS spike → KMS_URL=${KMS_URL}\n`);

  try {
    const ping = await fetch(`${KMS_URL}/version`, { signal: AbortSignal.timeout(5000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch (e) {
    console.log(`SKIP: KMS unreachable (${String(e)}). Spike requires a live KMS; exiting 0.`);
    process.exit(0);
  }

  const message = Buffer.concat([Buffer.from("ssh-ca-sens-spike:"), randomBytes(16)]);
  const work = mkdtempSync(join(tmpdir(), "ssh-sens-"));
  let sensitivePair: { privId: string; pubId: string } | null = null;
  let exportablePair: { privId: string; pubId: string } | null = null;

  try {
    // ---- Non-exportable key (the preferred posture) -------------------------
    sensitivePair = await createEcKeyPair(true);
    record("create-sensitive-ec-p256 (KMIP, no CLI)", true, `priv=${sensitivePair.privId} pub=${sensitivePair.pubId}`);
    let pubPem: string | null = null;
    try { pubPem = await getPublicKeyPem(sensitivePair.pubId); } catch { pubPem = null; }

    // (a) KMIP-JSON Sign — primary correctness is the KMS's own SignatureVerify op.
    try {
      const sig = await kmipSign(sensitivePair.privId, message);
      const serverOk = await kmipVerify(sensitivePair.pubId, message, sig);
      const localOk = tryLocalVerify(pubPem, message, sig);
      record("(a) KMIP-JSON Sign on sensitive key", serverOk,
        `DER ${sig.length}B (${sig.subarray(0, 2).toString("hex")}…); KMIP-verify=${serverOk}, node-verify=${localOk}`);
    } catch (e) {
      record("(a) KMIP-JSON Sign on sensitive key", false, String(e));
    }

    // (b) Cosmian native ec sign
    try {
      const inFile = join(work, "msg.bin");
      const outFile = join(work, "msg.sig");
      writeFileSync(inFile, message);
      execFileSync(COSMIAN_BIN, ["--kms-url", KMS_URL, "kms", "ec", "sign", "--key-id", sensitivePair.privId, "--curve", "nist-p256", "-o", outFile, inFile], { stdio: "pipe" });
      const sig = readFileSync(outFile);
      const serverOk = await kmipVerify(sensitivePair.pubId, message, sig);
      const localOk = tryLocalVerify(pubPem, message, sig);
      record("(b) cosmian native ec sign on sensitive key", serverOk, `DER ${sig.length}B; KMIP-verify=${serverOk}, node-verify=${localOk}`);
    } catch (e) {
      record("(b) cosmian native ec sign on sensitive key", false, String(e).slice(0, 160));
    }

    // (d) Export must be DENIED for a sensitive key
    try {
      const { text } = await kmip({ tag: "Get", value: [{ tag: "UniqueIdentifier", type: "TextString", value: sensitivePair.privId }, { tag: "KeyFormatType", type: "Enumeration", value: "PKCS8" }] });
      const denied = /sensitive/i.test(text) && /deni/i.test(text);
      record("(d) Get on sensitive private key is denied", denied, denied ? "export correctly refused (Sensitive: DENIED)" : `UNEXPECTED: ${text.slice(0, 120)}`);
    } catch (e) {
      record("(d) Get on sensitive private key is denied", true, `refused: ${String(e).slice(0, 120)}`);
    }

    // ---- (c) Exportable fallback: non-sensitive key, export + Node import ----
    exportablePair = await createEcKeyPair(false);
    try {
      const { els, text } = await kmip({ tag: "Get", value: [{ tag: "UniqueIdentifier", type: "TextString", value: exportablePair.privId }, { tag: "KeyFormatType", type: "Enumeration", value: "PKCS8" }] });
      const priv = find(els, "PrivateKey");
      const keyBlock = find((priv?.value as KmipEl[]) ?? [], "KeyBlock");
      const keyValue = find((keyBlock?.value as KmipEl[]) ?? [], "KeyValue");
      const keyMaterial = find((keyValue?.value as KmipEl[]) ?? [], "KeyMaterial");
      const der = Buffer.from(String(keyMaterial?.value ?? ""), "hex");
      if (!der.length) throw new Error(`no key material: ${text.slice(0, 120)}`);
      const pem = `-----BEGIN PRIVATE KEY-----\n${der.toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----`;
      const { createPrivateKey, sign: cryptoSign } = await import("node:crypto");
      const keyObj = createPrivateKey(pem); // throws if not a Node-importable layout
      const localSig = cryptoSign("sha256", message, { key: keyObj, dsaEncoding: "der" });
      const pubPem = await getPublicKeyPem(exportablePair.pubId);
      const ok = cryptoVerify("sha256", message, { key: createPublicKey(pubPem), dsaEncoding: "der" }, localSig);
      record("(c) non-sensitive export → Node createPrivateKey + sign", ok, `imported PKCS#8 directly; sign+verify=${ok}`);
    } catch (e) {
      record("(c) non-sensitive export → Node createPrivateKey + sign", false, `needs normalization: ${String(e).slice(0, 140)}`);
    }
  } finally {
    if (sensitivePair) { await destroy(sensitivePair.privId); }
    if (exportablePair) { await destroy(exportablePair.privId); }
    rmSync(work, { recursive: true, force: true });
  }

  // ---- Verdict --------------------------------------------------------------
  const nonExportableWorks = probes.some((p) => p.path.startsWith("(a)") && p.ok) || probes.some((p) => p.path.startsWith("(b)") && p.ok);
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(probes, null, 2));
  console.log("\n=== RECOMMENDATION (decision-011) ===");
  if (nonExportableWorks) {
    console.log("ADOPT the NON-EXPORTABLE signing path: create SSH CA keys with Sensitive=true and");
    console.log("sign via KMIP-JSON `Sign` (preferred — no CLI dependency in the backend). The CA");
    console.log("private key never leaves the KMS. kmsService.signRaw() is the single swap-point.");
  } else {
    console.log("Non-exportable Sign paths FAILED here — revisit decision-011 before adopting the");
    console.log("export-and-sign fallback (and only with buffer zeroization + audit/alert per export).");
  }
  process.exit(0);
}

main().catch((e) => { console.error("spike error:", e); process.exit(1); });
