---
id: TASK-109.22
title: Investigate Cosmian KMS CSR-pubkey preservation
status: Done
assignee:
  - '@myself'
created_date: '2026-05-05 17:48'
updated_date: '2026-06-29 11:42'
labels:
  - backend
  - kms
dependencies: []
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cosmian KMS 5.20 .certify() with CSR field set still generates a fresh keypair, ignoring CSR public key. Need either: (a) KMIP Register operation to import CSR pubkey then certify with publicKeyId+Link, or (b) different KMS attribute set that signals 'reuse CSR key', or (c) accept current offline-signing fallback as production strategy. Investigate Cosmian docs / file upstream issue.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document chosen approach in docs/
- [ ] #2 If KMIP Register: implement importPublicKey wrapper
- [ ] #3 If offline: lock down EXTERNAL_ISSUER_CA_KEY_PEM permissions, document threat model
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a CSR-key-preserving mode to KMSClient.certify(): when signing a CSR, omit the CryptographicAlgorithm/CryptographicLength attributes (the KMIP generate-keypair signal that currently forces Cosmian to mint a fresh key). Guard so existing generate-keypair (CA) and certify-by-publicKeyId modes are unchanged.
2. Write a spike integration script (backend/src/kms/spike-csr-certify.ts): create a CA keypair + self-signed CA cert in the KMS, generate an EXTERNAL RSA keypair + CSR (with SAN) via node-forge, certify the CSR in preserve-key mode, then assert issued-cert SPKI == CSR SPKI and that SANs survived.
3. Run against the dev KMS (cd kms && docker compose up -d) and record the result.
4. If Cosmian honors the CSR key -> wire /api/v1/external/sign to KMS certify (CA key stays in KMS), delete the offline node-forge fallback + EXTERNAL_ISSUER_CA_KEY_PEM. If not -> fall back to option (a), the KMIP Register+PublicKeyLink wrapper (TASK-109.21 groundwork).
5. Document the chosen approach + threat model in docs/ (AC #1).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Option (b) spike — findings (KMS 5.21.0)

Groundwork (dormant in prod — no caller passes a CSR to certify; all use publicKeyId mode):
- Added preserveCsrKey flag to KMSClient.certify + KMSService.signCertificate: omits CryptographicAlgorithm/CryptographicLength (the KMIP generate-keypair signal) when signing a CSR.
- Switched certify CSR encoding from raw PEM (CertificateRequestType=PEM) to DER + PKCS10 (matches the Cosmian CLI, which converts PEM->DER).
- Spike harness: backend/src/kms/spike-csr-certify.ts (creates CA, generates external leaf key+CSR, certifies with/without preserveCsrKey, diffs SPKI + checks SAN).

Result: certify-with-CSR FAILS 422 "Certify from Subject: the subject name is not found in the attributes" — for BOTH preserveCsrKey true/false AND both PEM and DER/PKCS10 encodings. Cosmian 5.21 does not recognize our CertificateRequest payload and routes to subject mode. So option (b) cannot be validated on 5.21 until the Certify request STRUCTURE is updated for >=5.21 (Cosmian reorganized Certify into RFC 9881/9909/9935/9608 submodules in 5.21). That structural fix is a prerequisite for (a) AND (b) via the KMS.

Side findings (cosmian quirks): (1) kms/docker-compose.yml is broken against current :latest — "Configuration file found at default path but extra CLI args provided"; ran KMS via a plain default-config container for the spike. (2) 5.21 rejects cRLSign in keyUsage during certify.

Decision needed: (i) pin KMS to the targeted 5.20 and re-run the spike to validate (b) on the intended target, or (ii) fix the certify request structure for 5.21 first, or (iii) keep offline signing (option c) as the production strategy. Codebase targets 5.20; the only available dev image is 5.21.

## ROOT CAUSE FOUND + (b) VALIDATED (KMS 5.21.0)

Root cause: the KMIP Certify CSR field is "CertificateRequestValue" (server reads request.certificate_request_value — see crate/server/src/core/operations/certify/mod.rs:285 @ tag 5.21.0). Our wrapper sent the CSR under tag "CertificateRequest", so the server ignored it and fell back to "Certify from Subject" mode -> 422. NOT the algorithm/length attributes.

Fix (client.ts certify): send the CSR under tag "CertificateRequestValue" (PEM bytes; server does X509Req::from_pem). One-line essence.

Spike result after fix: issued cert public key == CSR public key ✅, and the CSR SAN was preserved ✅. The CSR branch returns Subject::X509Req BEFORE any key generation, so CryptographicAlgorithm/Length are ignored in CSR mode — preserveCsrKey is therefore a no-op on 5.21 (kept as defensive/intent-documenting; harmless).

Conclusion: OPTION (b) is viable. Cosmian signs the CSR's own key with the CA key kept in the KMS; option (a) Register+Link is NOT needed. Next: wire /api/v1/external/sign to KMS certify (preserveCsrKey) using the cluster CA's kmsCertificateId, retire the offline node-forge fallback + EXTERNAL_ISSUER_CA_KEY_PEM, add a regression test, and document (AC#1/#3).

## SHIPPED — option (b), KMS-signed (replaces offline)

/api/v1/external/sign now signs CSRs via the KMS Certify operation using the cluster CA's kmsCertificateId; the CA private key stays in the KMS. Offline node-forge signing + EXTERNAL_ISSUER_CA_CERT_PEM/_KEY_PEM removed.

Changes:
- backend/src/kms/client.ts: CSR sent under correct KMIP tag CertificateRequestValue (PEM); added preserveCsrKey (omits CryptographicAlgorithm/Length in CSR mode).
- backend/src/kms/service.ts: thread preserveCsrKey.
- backend/src/rest/routes/external.routes.ts: /sign rewritten to kms.signCertificate({csr, issuerCertificateId: ca.kmsCertificateId, preserveCsrKey:true, x509Extensions: basicConstraints CA:FALSE}); leaf cert fetched from KMS, kms_key_id NULL, cached pem; idempotent on request_uid.
- backend/src/kms/spike-csr-certify.ts: live-KMS validation harness.
- backend/src/rest/routes/external.routes.test.ts: mocked-KMS route tests (happy path, idempotency, 400/409). 4/4 pass.
- docs/k8s-csr-signing.md: chosen approach + threat model (AC#1).
- backend/CLAUDE.md: updated certify gotcha + env (dropped EXTERNAL_ISSUER_CA_*).

Verification: spike on Cosmian 5.21.0 — issued key == CSR key, SAN/keyUsage/EKU copied, no dup exts, +CA:FALSE. Route tests pass. CA-create + cert-issue KMS integration tests still pass (publicKeyId path unchanged).

AC status: #1 done (docs). #2 N/A (option a Register+Link not needed). #3 N/A (no longer offline; CA key is KMS-only).

Follow-ups (not blocking): (a) k8s/issuer/test/e2e/in-cluster/20-pki-manager.yaml still sets the now-unused EXTERNAL_ISSUER_CA_* env + /ca mount — drop when the kind e2e is next run (TASK-109.17). (b) fix kms/docker-compose.yml for current :latest image (config-at-default-path + entrypoint args conflict).
<!-- SECTION:NOTES:END -->
