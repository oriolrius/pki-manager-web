---
id: TASK-112
title: Serve signed CRLs over HTTP (PEM + DER)
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:46'
labels:
  - crl
  - backend
  - api
milestone: CRL Signing & Distribution
dependencies:
  - TASK-111
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire GET /crl/:caId.crl (PEM) and /crl/:caId.der (DER) to return the latest signed CRL. Currently returns 503 because crl_pem is empty.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /crl/:caId.crl returns 200 with the signed CRL (PEM) and an appropriate content-type
- [x] #2 GET /crl/:caId.der returns the DER-encoded CRL (application/pkix-crl)
- [x] #3 Endpoint no longer returns 503 once a CRL exists; a revoked cert is present in the served CRL
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Public GET /crl/:caId.crl (application/x-pem-file) and /crl/:caId.der (application/pkix-crl) now serve the signed CRL; 503 path is dead once crl_pem is populated (always, post-111). getLatest also returns correct DER base64. Covered by server.crl-endpoint.test.ts + crl-revocation.test.ts (revoked serial present in served CRL).
<!-- SECTION:NOTES:END -->
