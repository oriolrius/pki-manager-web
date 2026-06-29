---
id: TASK-112
title: Serve signed CRLs over HTTP (PEM + DER)
status: To Do
assignee: []
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:04'
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
- [ ] #1 GET /crl/:caId.crl returns 200 with the signed CRL (PEM) and an appropriate content-type
- [ ] #2 GET /crl/:caId.der returns the DER-encoded CRL (application/pkix-crl)
- [ ] #3 Endpoint no longer returns 503 once a CRL exists; a revoked cert is present in the served CRL
<!-- AC:END -->
