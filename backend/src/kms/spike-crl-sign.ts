/**
 * TASK-110 spike — can Cosmian KMS sign arbitrary bytes (a CRL TBSCertList)?
 *
 * The CA private key lives in the KMS (TASK-109.22). To sign a CRL without exporting
 * the key, the KMS must support the KMIP `Sign` operation over the DER-encoded
 * TBSCertList. This spike probes a live Cosmian KMS for that capability and, if
 * present, verifies the resulting signature with node-forge against the CA public key.
 *
 * Usage:  cd backend && KMS_URL=http://localhost:42998 pnpm exec tsx src/kms/spike-crl-sign.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { KMSClient } from "./client.js";
import { generateCRL } from "../crypto/crl.js";
import { parseCertificate } from "../crypto/x509.js";
import { CRLReason } from "../crypto/types.js";

const KMS_URL = (process.env.KMS_URL || "http://localhost:42998").replace(/\/$/, "");

async function rawKmip(request: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${KMS_URL}/kmip/2_1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  let body: any;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function findTag(elements: any[], tag: string): any {
  if (!Array.isArray(elements)) return undefined;
  return elements.find((e) => e?.tag === tag);
}

async function run() {
  const client = new KMSClient({ url: KMS_URL });
  console.log("🔌 KMS connection…");
  if (!(await client.testConnection())) {
    console.error("❌ KMS not reachable (cd kms && docker compose up -d)");
    process.exit(2);
  }
  console.log(`✅ Connected to ${KMS_URL}\n`);

  const created: { priv?: string; pub?: string } = {};
  try {
    console.log("1️⃣  Creating an RSA-2048 CA key pair in the KMS…");
    const keys = await client.createKeyPair({ keyAlgorithm: "RSA-2048", tags: ["spike-crl-sign"] });
    created.priv = keys.privateKeyId;
    created.pub = keys.publicKeyId;
    console.log(`   privateKeyId=${keys.privateKeyId}`);
    console.log(`   publicKeyId =${keys.publicKeyId}\n`);

    // The bytes we want signed: a stand-in for a DER TBSCertList.
    const tbs = Buffer.from("TASK-110 CRL TBSCertList probe payload", "utf-8");
    const tbsHex = tbs.toString("hex");

    // Pre-compute the SHA-256 digest too (some KMS Sign impls want a pre-hashed digest).
    const md = forge.md.sha256.create();
    md.update(tbs.toString("binary"));
    const digestHex = forge.util.bytesToHex(md.digest().getBytes());

    // Probe several Sign request shapes; Cosmian's exact TTLV expectations are unknown.
    const probes: Array<{ name: string; req: any }> = [
      {
        name: "Sign(Data, RSA+SHA256)",
        req: {
          tag: "Sign",
          value: [
            { tag: "UniqueIdentifier", type: "TextString", value: keys.privateKeyId },
            {
              tag: "CryptographicParameters",
              value: [
                { tag: "CryptographicAlgorithm", type: "Enumeration", value: "RSA" },
                { tag: "HashingAlgorithm", type: "Enumeration", value: "SHA256" },
                { tag: "PaddingMethod", type: "Enumeration", value: "PKCS1v15" },
              ],
            },
            { tag: "Data", type: "ByteString", value: tbsHex },
          ],
        },
      },
      {
        name: "Sign(DigestedData, RSA+SHA256)",
        req: {
          tag: "Sign",
          value: [
            { tag: "UniqueIdentifier", type: "TextString", value: keys.privateKeyId },
            {
              tag: "CryptographicParameters",
              value: [
                { tag: "CryptographicAlgorithm", type: "Enumeration", value: "RSA" },
                { tag: "HashingAlgorithm", type: "Enumeration", value: "SHA256" },
                { tag: "PaddingMethod", type: "Enumeration", value: "PKCS1v15" },
              ],
            },
            { tag: "DigestedData", type: "ByteString", value: digestHex },
          ],
        },
      },
      {
        name: "Sign(Data, no CryptographicParameters)",
        req: {
          tag: "Sign",
          value: [
            { tag: "UniqueIdentifier", type: "TextString", value: keys.privateKeyId },
            { tag: "Data", type: "ByteString", value: tbsHex },
          ],
        },
      },
    ];

    let workingSignatureHex: string | null = null;
    let workingProbe: string | null = null;

    for (const probe of probes) {
      console.log(`2️⃣  Probe: ${probe.name}`);
      const { ok, status, body } = await rawKmip(probe.req);
      if (!ok) {
        const msg = typeof body === "string" ? body : JSON.stringify(body);
        console.log(`   ❌ HTTP ${status}: ${msg.slice(0, 200)}\n`);
        continue;
      }
      // Try to find a SignatureData element in the response.
      const sigEl = findTag(body?.value, "SignatureData");
      if (sigEl && typeof sigEl.value === "string") {
        console.log(`   ✅ HTTP ${status}: got SignatureData (${sigEl.value.length / 2} bytes)\n`);
        workingSignatureHex = sigEl.value;
        workingProbe = probe.name;
        break;
      }
      console.log(`   ⚠️  HTTP ${status} but no SignatureData. Response: ${JSON.stringify(body).slice(0, 300)}\n`);
    }

    if (!workingSignatureHex) {
      console.log("📌 FINDING: Cosmian KMS does NOT expose a usable KMIP Sign operation for RSA.");
      console.log("   → CRL signing uses approach (b): export CA key via getPrivateKey + node crypto.\n");
    }

    // ---------------------------------------------------------------------------
    // Approach (b) end-to-end: KMS-held CA → export key → generateCRL → openssl verify.
    // (Satisfies TASK-110 AC#2 regardless of whether KMIP Sign is available.)
    // ---------------------------------------------------------------------------
    console.log("4️⃣  Approach (b): build a real CRL for a KMS-held CA and verify with openssl…");
    const caKeys = await client.createKeyPair({ keyAlgorithm: "RSA-2048", tags: ["spike-crl-ca"] });
    const caCertInfo = await client.certify({
      publicKeyId: caKeys.publicKeyId,
      subjectName: "CN=Spike CRL Root CA,O=Spike,C=US",
      daysValid: 3650,
      keyAlgorithm: "RSA-2048",
      x509Extensions: "[ v3_ca ]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\nsubjectKeyIdentifier=hash\n",
      tags: ["spike-crl-ca"],
    });
    const caCertPem = await client.getCertificate(caCertInfo.certificateId);
    const caPrivPem = await client.getPrivateKey(caKeys.privateKeyId);
    const subject = parseCertificate(caCertPem, "PEM").subject;

    const crl = generateCRL({
      issuer: subject,
      crlNumber: 7,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedCertificates: [
        { serialNumber: "0a1b2c3d4e5f", revocationDate: new Date(), reason: CRLReason.KEY_COMPROMISE },
        { serialNumber: "ff00ff00", revocationDate: new Date(), reason: CRLReason.SUPERSEDED },
      ],
      signingKey: caPrivPem,
      signatureAlgorithm: "SHA256-RSA",
      issuerCertificate: caCertPem,
    });

    const dir = mkdtempSync(join(tmpdir(), "spike-crl-"));
    const crlPath = join(dir, "ca.crl");
    const caPath = join(dir, "ca.pem");
    writeFileSync(crlPath, crl.pem);
    writeFileSync(caPath, caCertPem);

    console.log("   openssl crl -noout -text:");
    const text = execFileSync("openssl", ["crl", "-in", crlPath, "-noout", "-text"], { encoding: "utf-8" });
    for (const line of text.split("\n").filter((l) => /CRL Number|Update|Serial|Reason|Signature Algorithm|Issuer|Authority Key/i.test(l)).slice(0, 14)) {
      console.log("     " + line.trim());
    }
    // `openssl crl -CAfile` exits 0 iff the CRL signature verifies against the CA; it prints
    // "verify OK" to stderr. Treat a clean exit as success.
    let opensslVerify = false;
    try {
      const out = execFileSync("openssl", ["crl", "-in", crlPath, "-CAfile", caPath, "-noout"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      opensslVerify = true;
      void out;
    } catch (e: any) {
      opensslVerify = false;
      console.log("   openssl verify error:", `${e.stdout || ""}${e.stderr || ""}`.trim());
    }
    console.log(`   openssl signature verify against CA ? ${opensslVerify ? "✅ verify OK" : "❌ FAILED"}\n`);

    await client.destroyKeyPair(caKeys.privateKeyId, caKeys.publicKeyId).catch(() => {});

    if (!workingSignatureHex) {
      console.log(
        opensslVerify
          ? "📌 RESULT: approach (b) produces an openssl-verifiable CRL for a KMS-held CA. ✅"
          : "📌 RESULT: approach (b) CRL did NOT verify — investigate. ❌",
      );
      process.exitCode = opensslVerify ? 0 : 4;
      return;
    }

    // Verify the signature with node-forge against the exported public key.
    console.log(`3️⃣  Verifying signature from "${workingProbe}" with node-forge…`);
    const pubPem = await client.getPublicKey(keys.publicKeyId);
    const pub = forge.pki.publicKeyFromPem(pubPem) as forge.pki.rsa.PublicKey;
    const sigBytes = Buffer.from(workingSignatureHex, "hex").toString("binary");
    const verifyMd = forge.md.sha256.create();
    verifyMd.update(tbs.toString("binary"));
    let valid = false;
    try {
      valid = pub.verify(verifyMd.digest().getBytes(), sigBytes);
    } catch (e) {
      console.log(`   verify threw: ${(e as Error).message}`);
    }
    console.log(`   signature valid ? ${valid ? "✅ YES" : "❌ NO"}\n`);
    console.log(
      valid
        ? "📌 RESULT: KMIP Sign works AND verifies → use approach (a), CA key stays in the KMS."
        : "📌 RESULT: KMIP Sign returned data but it does not verify with SHA256/PKCS1 — needs more probing.",
    );
    process.exitCode = valid ? 0 : 4;
  } finally {
    if (created.priv && created.pub) {
      console.log("\n🧹 Cleaning up spike key pair…");
      await client.destroyKeyPair(created.priv, created.pub).catch((e) => console.warn(`   warn: ${(e as Error).message}`));
    }
  }
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
