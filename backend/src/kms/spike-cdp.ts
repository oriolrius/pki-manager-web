/**
 * TASK-114 spike — does Cosmian KMS honor a crlDistributionPoints (CDP) extension passed
 * via the x509-extension vendor attribute, for both certify modes we use?
 *
 *   A) publicKeyId certify (manual/bulk issuance) with CDP in x509Extensions.
 *   B) CSR certify with preserveCsrKey (external /sign) + CDP in x509Extensions.
 *
 * Verifies with `openssl x509 -ext crlDistributionPoints`.
 *
 * Usage: cd backend && KMS_URL=http://localhost:42998 pnpm exec tsx src/kms/spike-cdp.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { KMSClient } from "./client.js";

const CDP_URL = "http://crl.example.com/crl/test-ca.crl";

function leafCsr(): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([{ name: "commonName", value: "cdp-leaf.example.com" }]);
  csr.setAttributes([
    { name: "extensionRequest", extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "cdp-leaf.example.com" }] }] },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificationRequestToPem(csr);
}

function showCdp(label: string, certPem: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "spike-cdp-"));
  const p = join(dir, "c.pem");
  writeFileSync(p, certPem);
  let out = "";
  try {
    out = execFileSync("openssl", ["x509", "-in", p, "-noout", "-ext", "crlDistributionPoints"], { encoding: "utf-8" });
  } catch (e: any) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  const ok = out.includes(CDP_URL);
  console.log(`   ${label}: ${ok ? "✅ CDP present" : "❌ CDP missing"}\n     ${out.trim().replace(/\n/g, "\n     ")}`);
  return ok;
}

async function run() {
  const client = new KMSClient({ url: process.env.KMS_URL || "http://localhost:42998" });
  if (!(await client.testConnection())) {
    console.error("❌ KMS not reachable");
    process.exit(2);
  }

  const ca = await client.createKeyPair({ keyAlgorithm: "RSA-2048", tags: ["spike-cdp"] });
  const caCert = await client.certify({
    publicKeyId: ca.publicKeyId,
    subjectName: "CN=CDP Spike CA,O=Spike,C=US",
    daysValid: 3650,
    keyAlgorithm: "RSA-2048",
    x509Extensions: "[ v3_ca ]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n",
    tags: ["spike-cdp"],
  });

  let ok = true;
  try {
    // A) publicKeyId certify (manual/bulk)
    console.log("A) publicKeyId certify with CDP:");
    const leafKeys = await client.createKeyPair({ keyAlgorithm: "RSA-2048", tags: ["spike-cdp-leaf"] });
    const aCert = await client.certify({
      publicKeyId: leafKeys.publicKeyId,
      issuerCertificateId: caCert.certificateId,
      issuerName: "CN=CDP Spike CA,O=Spike,C=US",
      subjectName: "CN=cdp-leaf-a.example.com,O=Spike,C=US",
      daysValid: 90,
      keyAlgorithm: "RSA-2048",
      x509Extensions: `[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\ncrlDistributionPoints=URI:${CDP_URL}\n`,
      tags: ["spike-cdp-leaf"],
    });
    ok = showCdp("publicKeyId mode", await client.getCertificate(aCert.certificateId)) && ok;
    await client.destroyKeyPair(leafKeys.privateKeyId, leafKeys.publicKeyId).catch(() => {});

    // B) CSR certify + preserveCsrKey (external /sign)
    console.log("B) CSR certify (preserveCsrKey) with CDP:");
    const bCert = await client.certify({
      csr: leafCsr(),
      issuerCertificateId: caCert.certificateId,
      daysValid: 90,
      preserveCsrKey: true,
      x509Extensions: `[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\ncrlDistributionPoints=URI:${CDP_URL}\n`,
      tags: ["spike-cdp-csr"],
    });
    ok = showCdp("CSR mode", await client.getCertificate(bCert.certificateId)) && ok;
  } finally {
    await client.destroyKeyPair(ca.privateKeyId, ca.publicKeyId).catch(() => {});
  }

  console.log(ok ? "🎉 Cosmian honors crlDistributionPoints in both modes." : "⚠️  CDP not honored in at least one mode.");
  process.exit(ok ? 0 : 1);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
