---
id: TASK-115
title: 'Tests: CRL signing, serving, and revocation end-to-end'
status: Done
assignee: []
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:46'
labels:
  - crl
  - testing
milestone: CRL Signing & Distribution
dependencies:
  - TASK-112
  - TASK-113
  - TASK-114
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cover the CRL feature with unit + integration tests (KMS integration auto-skips when KMS is unavailable, per existing pattern).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Unit tests cover CRL building and signature verification
- [x] #2 Integration test: revoke a cert, then assert it appears in the served CRL and the CRL signature verifies against the issuing CA
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Unit: src/crypto/crl.test.ts (RSA+ECDSA build, verify positive/tamper/wrong-key, parse round-trip of crlNumber/serials/reasons/nextUpdate, AKI, openssl). Integration: src/trpc/procedures/crl-revocation.test.ts (revoke -> served CRL contains serial, signature verifies vs CA, crlNumber monotonic) + crl-cdp.test.ts. KMS-gated via kms-helper. Full backend suite: 380 pass / 1 skip.
<!-- SECTION:NOTES:END -->
