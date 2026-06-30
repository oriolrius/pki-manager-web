---
id: TASK-110
title: Investigate KMS-native CRL signing approach (KMIP Sign vs key export)
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:23'
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
- [x] #1 Chosen approach documented in docs/ with threat-model rationale (default: CA key stays in the KMS via KMIP Sign, consistent with TASK-109.22)
- [x] #2 A spike produces a valid CRL signature for a KMS-held CA via the chosen approach (verifiable with openssl)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Spike KMIP Sign against live Cosmian KMS for RSA+EC keys
2. Decide approach based on empirical result
3. Document decision + threat model in backlog/decisions
4. Demonstrate a valid CRL signature via the chosen approach (openssl-verified)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Spike (backend/src/kms/spike-crl-sign.ts) against live Cosmian KMS 5.24.0: Sign/SignatureVerify are advertised by QueryOperations but reject both RSA-2048 and ECDSA-P256 keys with 422 'no valid key for id' (Cosmian Sign is post-quantum/Covercrypt only). Chosen approach (b): export CA key via kmsService.getPrivateKey + node crypto signing (already the established pattern in ca/bulk/certificate routes). Decision recorded in backlog/decisions/decision-010. Spike builds a real v2 CRL for a KMS-held CA and 'openssl crl -CAfile' returns verify OK.
<!-- SECTION:NOTES:END -->
