---
id: TASK-110
title: Investigate KMS-native CRL signing approach (KMIP Sign vs key export)
status: To Do
assignee: []
created_date: '2026-06-29 14:03'
labels:
  - crl
  - kms
  - backend
  - design
milestone: CRL Signing & Distribution
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CRL signing is unimplemented: crl.service stores crl_pem = '' (placeholder), the KMS client has no Sign op, and GET /crl/:caId.crl returns 503. The CA private key lives in the KMS (TASK-109.22), so signing a CRL faces the same fork as cert signing:
(a) KMIP Sign over the CRL TBSCertList — CA key stays in the KMS (preferred); requires a Sign wrapper in the KMS client.
(b) Export the CA key via getPrivateKey and sign offline with node-forge — simpler but takes the CA key out of the KMS (weaker; contradicts 109.22).
Spike both against Cosmian KMS 5.21 and decide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Chosen approach documented in docs/ with threat-model rationale (default: CA key stays in the KMS via KMIP Sign, consistent with TASK-109.22)
- [ ] #2 A spike produces a valid CRL signature for a KMS-held CA via the chosen approach (verifiable with openssl)
<!-- AC:END -->
