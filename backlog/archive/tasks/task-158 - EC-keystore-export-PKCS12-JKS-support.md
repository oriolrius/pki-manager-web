---
id: TASK-158
title: EC keystore export (PKCS#12/JKS) support
status: Done
assignee: []
created_date: '2026-06-29 17:33'
updated_date: '2026-06-29 18:23'
labels:
  - certificates
  - backend
  - ecdsa
  - export
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PKCS#12 and JKS exports use node-forge (forge.pkcs12.toPkcs12Asn1) which cannot encode ECDSA keys, so exporting an EC leaf certificate as P12/JKS fails. Implement EC-capable keystore export (e.g. openssl pkcs12 shell-out, consistent with the existing keytool JKS subprocess) or add a clear 'not supported for EC' guard. PEM/CRT/DER/chain downloads already work for EC.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Exporting an ECDSA leaf as PKCS#12 produces a valid keystore (or a clear, non-crashing error)
- [x] #2 JKS export works for ECDSA leaves or errors clearly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented EC-capable keystore + key export via openssl shell-out (consistent with the existing keytool JKS subprocess). New helpers in crypto/pkcs12.ts: createPkcs12Bundle (openssl pkcs12 -export with legacy PBE-SHA1-3DES/-legacy so node-forge + keytool can still read it) and encryptPrivateKeyPem (openssl pkcs8 -topk8 -v2 aes-256-cbc). Replaced ALL node-forge PKCS#12 / private-key-encryption sites for leaf certs: jks.service, REST single + bulk download (certificate.routes, bulk.routes), tRPC single + bulk download + bulk JKS. DER conversion -> convertCertificateFormat (Node X509Certificate, EC-safe). Cert details (getById + service) made EC-tolerant (Node fingerprints + best-effort forge extensions). EC certs now download as PEM/CRT/DER/CER/pem-chain/pem-key (encrypted+unencrypted)/PKCS#12/PFX/JKS, single and bulk. Verified RSA+EC P12 round-trips through node-forge and imports via keytool. Tests: certificate-ecdsa.test.ts asserts EC DER/P12/JKS/encrypted-pem-key downloads. Suite 435 pass, frontend typecheck clean. REMAINING LIMITATION: PKCS#7 (p7b) export stays node-forge-only (cert-bundle, no key) and now returns a clear BAD_REQUEST error for EC certs instead of crashing.
<!-- SECTION:NOTES:END -->
