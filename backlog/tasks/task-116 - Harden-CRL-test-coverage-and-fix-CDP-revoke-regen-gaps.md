---
id: TASK-116
title: Harden CRL test coverage and fix CDP/revoke-regen gaps
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 15:13'
updated_date: '2026-06-29 16:56'
labels:
  - crl
  - testing
  - backend
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adversarial coverage audit of the CRL milestone (TASK-110..115) found 2 impl bugs + broad test gaps. Fix: (a) tRPC bulk-renew omits CDP; (b) bulkRevoke/renewal-revokeOriginal paths don't regenerate the CRL. Harden tests: real HTTP /crl route (currently a stale copy), CI-safe service/lib/kms unit suites, and missing revoke/CDP/ECDSA path coverage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All issuance paths (incl. tRPC/REST/bulk renewal) embed the CDP when configured
- [x] #2 All revoke paths (incl. bulkRevoke and renewal revokeOriginal) regenerate the CA CRL
- [x] #3 Public /crl route is tested against the real handler (content-type, DER, lazy-regen)
- [x] #4 CI-safe unit tests cover crl-url, mapRevocationReason, resolveSignatureAlgorithm, getCertificatePrivateKeyId, and crypto CRL helpers
- [x] #5 Integration tests cover REST/external revoke, bulk+external CDP, and an ECDSA CA end-to-end
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
FOLLOW-UP (resolved after initial Done): (1) Fixed the previously-flagged pre-existing bug: tRPC bulkRenew omitted issuerCertificateId/issuerName in signCertificate (certificate.ts:2133) -> Cosmian failed with v2i_AUTHORITY_KEYID. Now passes issuerCertificateId+issuerName like every other path; bulkRenew succeeds. Regression test added in crl-cdp.test.ts (bulk renew succeeds + embeds CDP). (REST bulkRenew already had issuerCertificateId.) (2) ECDSA ground truth via spike: Cosmian CANNOT self-sign EC keys (operation not supported for this keytype) so EC CAs are genuinely unsupported (CA form correctly RSA-only). EC LEAF certs DO work under an RSA CA, but per user decision we keep RSA-only in the UI: removed the ECDSA-P256/P384 <option>s and narrowed the keyAlgorithm type in frontend/src/routes/certificates.new.tsx (backend keyAlgorithmSchema was already RSA-only). Backend crypto-layer EC support is retained as dormant internal capability (unit-tested) but not user-exposed. Suite 430 pass; frontend typecheck clean.
<!-- SECTION:NOTES:END -->
