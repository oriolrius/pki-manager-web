---
id: TASK-109.01
title: Design external issuer API contract
status: To Do
assignee: []
created_date: '2026-05-05 16:18'
updated_date: '2026-05-05 16:23'
labels:
  - backend
  - design
dependencies: []
documentation:
  - 'https://datatracker.ietf.org/doc/html/rfc7235'
  - 'https://datatracker.ietf.org/doc/html/rfc8555'
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Specify HTTP API contract used by external issuer controller to interact with PKI Manager: auth, CSR signing, revocation, CA bundle retrieval. Document request/response schemas (Zod), error codes, idempotency keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 OpenAPI spec or markdown doc covering POST /api/v1/external/sign, POST /api/v1/external/revoke, GET /api/v1/external/ca-bundle, GET /api/v1/external/health
- [ ] #2 Contract supports idempotent CSR signing keyed by request UID
- [ ] #3 Auth model documented (bearer token per cluster, scoped to one CA)
- [ ] #4 Error response shape standardized (code, message, retryable flag)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Authentication: Bearer (RFC 7235). Idempotency-Key header pattern (Stripe-style) keyed on CertificateRequest UID. Reference ACME (RFC 8555) for revocation reason codes alignment.
<!-- SECTION:NOTES:END -->
