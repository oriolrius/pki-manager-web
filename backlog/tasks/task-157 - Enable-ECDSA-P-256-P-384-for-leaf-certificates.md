---
id: TASK-157
title: Enable ECDSA (P-256/P-384) for leaf certificates
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 17:09'
updated_date: '2026-06-29 17:33'
labels:
  - certificates
  - backend
  - frontend
  - ecdsa
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spike confirmed Cosmian KMS issues EC leaf certs under an RSA CA, but the API keyAlgorithmSchema (RSA-only) blocks them while the leaf-cert form offers them. Enable EC for leaf issuance/renewal/bulk (CA creation stays RSA-only: Cosmian cannot self-sign EC). Restore the EC options in the frontend leaf form.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Leaf certificate issuance accepts ECDSA-P256/P384 and produces a valid EC cert under an RSA CA
- [x] #2 CA creation remains restricted to RSA-2048/RSA-4096
- [x] #3 Renewal of an EC leaf preserves the EC key algorithm
- [x] #4 Frontend leaf form offers RSA + ECDSA options
- [x] #5 Integration test covers EC leaf issuance end-to-end
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Enabled EC leaf certs end-to-end. Changes: (1) schemas: new leafKeyAlgorithmSchema (RSA-2048/4096 + ECDSA-P256/P384) for createCertificateSchema; CA stays keyAlgorithmSchema (RSA-only). REST cert schema enum widened. (2) KMS client.createKeyPair: for ECDSA send CryptographicDomainParameters/RecommendedCurve (P256/P384) and omit the RSA KeyFormatType -- previously it minted an x25519 key. (3) service.issue/renew + tRPC/REST bulk renew: pass keyAlgorithm to createKeyPair + signCertificate (issuance honors the requested algorithm; renewal preserves the original algorithm -- also fixes a pre-existing RSA-4096->RSA-2048 downgrade on renewal). (4) parseCertificate: Node X509Certificate fallback when node-forge cannot read EC ("OID is not RSA"). (5) getCertificateDetails + convertCertificateFormat: EC-tolerant via Node crypto (fingerprints over DER, DER<->PEM via X509Certificate). (6) frontend: restored ECDSA-P256/P384 options in the leaf form. Tests: certificate-ecdsa.test.ts (issue P-256/P-384 + chain-verify + openssl, renew preserves EC, CA rejects EC). Full suite 434 pass; frontend typecheck clean. KNOWN LIMITATION (tracked separately): PKCS#12 + JKS keystore EXPORT still use node-forge (forge.pkcs12) which cannot encode EC keys -> exporting an EC leaf as P12/JKS fails. PEM/CRT/DER/chain downloads work for EC.
<!-- SECTION:NOTES:END -->
