/**
 * TASK-109.22 option (b) spike — wire /sign to KMS certify.
 *
 * Confirms two things against a live Cosmian KMS:
 *   A) certify(CSR, preserveCsrKey) signs the CSR's OWN public key (not a fresh one).
 *   B) With a cert-manager-style CSR (CN-only subject + SAN + keyUsage + EKU in the
 *      extensionRequest), Cosmian copies the CSR's extensions into the issued cert.
 *      We inspect the result for: key match, SAN/keyUsage/EKU presence, basicConstraints,
 *      and DUPLICATE extension OIDs (the failure mode if we ALSO pass our own x509Extensions).
 *
 * Usage:  cd backend && KMS_URL=http://localhost:42998 pnpm exec tsx src/kms/spike-csr-certify.ts
 * Requires a running Cosmian KMS (cd kms && docker compose up -d, or a plain default container).
 */

import forge from "node-forge";
import { KMSClient } from "./client.js";

const CA_SUBJECT = "CN=Spike Root CA,O=Spike,C=US";
// Cosmian 5.21 rejects cRLSign in keyUsage during certify, so keep CA exts minimal.
const CA_EXTENSIONS = `[ v3_ca ]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign
`;

function modHex(pub: forge.pki.rsa.PublicKey): string {
  return pub.n.toString(16);
}

/** A simple CSR: CN+O+C subject, one DNS SAN. */
function simpleCsr(): { keys: forge.pki.rsa.KeyPair; pem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: "commonName", value: "spike-leaf.example.com" },
    { shortName: "O", value: "Spike" },
    { shortName: "C", value: "US" },
  ]);
  csr.setAttributes([
    { name: "extensionRequest", extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "spike-leaf.example.com" }] }] },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, pem: forge.pki.certificationRequestToPem(csr) };
}

/** A cert-manager-style CSR: CN-only subject, SAN (DNS+IP), keyUsage + EKU in extensionRequest. */
function certManagerStyleCsr(): { keys: forge.pki.rsa.KeyPair; pem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([{ name: "commonName", value: "svc.default.svc.cluster.local" }]);
  csr.setAttributes([
    {
      name: "extensionRequest",
      extensions: [
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true, clientAuth: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "svc.default.svc.cluster.local" },
            { type: 7, ip: "10.96.0.10" },
          ],
        },
      ],
    },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, pem: forge.pki.certificationRequestToPem(csr) };
}

function inspect(certPem: string) {
  const cert = forge.pki.certificateFromPem(certPem);
  const names = cert.extensions.map((e: any) => e.name || e.id);
  const dupes = names.filter((n: string, i: number) => names.indexOf(n) !== i);
  const ku = cert.extensions.find((e: any) => e.name === "keyUsage") as any;
  const eku = cert.extensions.find((e: any) => e.name === "extKeyUsage") as any;
  const bc = cert.extensions.find((e: any) => e.name === "basicConstraints") as any;
  const san = cert.extensions.find((e: any) => e.name === "subjectAltName") as any;
  return {
    mod: modHex(cert.publicKey as forge.pki.rsa.PublicKey),
    exts: names,
    dupes,
    keyUsage: ku ? { digitalSignature: !!ku.digitalSignature, keyEncipherment: !!ku.keyEncipherment } : null,
    eku: eku ? { serverAuth: !!eku.serverAuth, clientAuth: !!eku.clientAuth } : null,
    basicConstraints: bc ? { cA: !!bc.cA } : null,
    sans: san?.altNames?.map((a: any) => a.value ?? a.ip) ?? [],
  };
}

async function run() {
  const client = new KMSClient({ url: process.env.KMS_URL || "http://localhost:42998" });
  console.log("🔌 KMS connection…");
  if (!(await client.testConnection())) {
    console.error("❌ KMS not reachable (cd kms && docker compose up -d)");
    process.exit(2);
  }
  console.log("✅ Connected\n");

  const created: { priv?: string; pub?: string } = {};
  let failures = 0;
  try {
    console.log("1️⃣  Creating CA key pair + self-signed CA cert…");
    const caKeys = await client.createKeyPair({ keyAlgorithm: "RSA-2048", tags: ["spike-ca"] });
    created.priv = caKeys.privateKeyId;
    created.pub = caKeys.publicKeyId;
    const caCert = await client.certify({
      publicKeyId: caKeys.publicKeyId,
      subjectName: CA_SUBJECT,
      daysValid: 3650,
      keyAlgorithm: "RSA-2048",
      x509Extensions: CA_EXTENSIONS,
      tags: ["spike-ca"],
    });
    console.log(`   CA cert id: ${caCert.certificateId}\n`);

    // --- A: simple CSR, key preservation ---
    console.log("2️⃣  A) certify(simple CSR, preserveCsrKey)…");
    const a = simpleCsr();
    const aRes = await client.certify({
      csr: a.pem,
      issuerCertificateId: caCert.certificateId,
      daysValid: 90,
      preserveCsrKey: true,
      tags: ["spike-a"],
    });
    const aOut = inspect(await client.getCertificate(aRes.certificateId));
    const aKeyMatch = aOut.mod === modHex(a.keys.publicKey);
    console.log(`   key == CSR key ? ${aKeyMatch ? "✅" : "❌"}   SAN ${JSON.stringify(aOut.sans)}`);
    if (!aKeyMatch) failures++;

    // --- B: cert-manager-style CSR, NO x509Extensions (trust the CSR) ---
    console.log("\n3️⃣  B) certify(cert-manager-style CSR, preserveCsrKey, NO x509Extensions)…");
    const b = certManagerStyleCsr();
    const bRes = await client.certify({
      csr: b.pem,
      issuerCertificateId: caCert.certificateId,
      daysValid: 90,
      preserveCsrKey: true,
      tags: ["spike-b"],
    });
    const bOut = inspect(await client.getCertificate(bRes.certificateId));
    const bKeyMatch = bOut.mod === modHex(b.keys.publicKey);
    console.log(`   key == CSR key ? ${bKeyMatch ? "✅" : "❌"}`);
    console.log(`   extensions     : ${JSON.stringify(bOut.exts)}`);
    console.log(`   duplicate OIDs : ${bOut.dupes.length ? "❌ " + JSON.stringify(bOut.dupes) : "✅ none"}`);
    console.log(`   SAN            : ${JSON.stringify(bOut.sans)}`);
    console.log(`   keyUsage       : ${JSON.stringify(bOut.keyUsage)}`);
    console.log(`   extKeyUsage    : ${JSON.stringify(bOut.eku)}`);
    console.log(`   basicConstraints: ${JSON.stringify(bOut.basicConstraints)}`);
    if (!bKeyMatch || bOut.dupes.length) failures++;

    // --- C: cert-manager-style CSR + the exact extensions /sign uses (CA:FALSE only) ---
    console.log("\n4️⃣  C) certify(cert-manager-style CSR, preserveCsrKey, x509=basicConstraints CA:FALSE)…");
    const c = certManagerStyleCsr();
    const cRes = await client.certify({
      csr: c.pem,
      issuerCertificateId: caCert.certificateId,
      daysValid: 90,
      preserveCsrKey: true,
      x509Extensions: "[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\n",
      tags: ["spike-c"],
    });
    const cOut = inspect(await client.getCertificate(cRes.certificateId));
    const cKeyMatch = cOut.mod === modHex(c.keys.publicKey);
    console.log(`   key == CSR key ? ${cKeyMatch ? "✅" : "❌"}`);
    console.log(`   extensions     : ${JSON.stringify(cOut.exts)}`);
    console.log(`   duplicate OIDs : ${cOut.dupes.length ? "❌ " + JSON.stringify(cOut.dupes) : "✅ none"}`);
    console.log(`   basicConstraints: ${JSON.stringify(cOut.basicConstraints)} (expect cA:false present)`);
    console.log(`   keyUsage/EKU   : ${JSON.stringify(cOut.keyUsage)} / ${JSON.stringify(cOut.eku)}`);
    if (!cKeyMatch || cOut.dupes.length || !cOut.basicConstraints) failures++;

    console.log("\n📌 Wiring implication:");
    console.log("   - If keyUsage/EKU/SAN above are present from the CSR alone, /sign must NOT");
    console.log("     also pass them via x509Extensions (would duplicate). Pass at most");
    console.log("     basicConstraints=CA:FALSE if it's missing.");
  } finally {
    if (created.priv && created.pub) {
      console.log("\n🧹 Cleaning up CA key pair…");
      await client.destroyKeyPair(created.priv, created.pub).catch((e) => console.warn(`   warn: ${(e as Error).message}`));
    }
  }
  console.log(failures === 0 ? "\n🎉 Spike OK." : `\n⚠️  ${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
