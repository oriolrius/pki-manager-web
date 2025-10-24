---
id: task-064
title: 'Download Certificates, including private key'
status: To Do
assignee: []
created_date: '2025-10-24 07:27'
updated_date: '2025-10-24 08:31'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement certificate download functionality that allows users to download certificates along with their private keys in various formats. Supported formats: PEM (ASCII with BEGIN/END markers), CRT (.crt extension), DER (binary), CER (DER with .cer for Windows), PKCS#7/P7B (cert + chain, no key), PKCS#12/PFX/P12 (cert + chain + key, password protected), and Java KeyStore/JKS (Java keystore, password protected).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Users can download a certificate with its private key from the certificate details page
- [ ] #2 Download supports multiple formats (PEM, PKCS12/PFX)
- [ ] #3 Downloaded files are properly formatted and can be used by standard tools (openssl, keytool, etc.)
- [ ] #4 Private key download requires appropriate security confirmation/warning
<!-- AC:END -->
