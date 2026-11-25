---
id: TASK-109.01
title: Design external issuer API contract
status: Done
assignee:
  - '@myself'
created_date: '2026-05-05 16:18'
updated_date: '2026-06-29 13:11'
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
- [x] #1 OpenAPI spec or markdown doc covering POST /api/v1/external/sign, POST /api/v1/external/revoke, GET /api/v1/external/ca-bundle, GET /api/v1/external/health
- [x] #2 Contract supports idempotent CSR signing keyed by request UID
- [x] #3 Auth model documented (bearer token per cluster, scoped to one CA)
- [x] #4 Error response shape standardized (code, message, retryable flag)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Authentication: Bearer (RFC 7235). Idempotency-Key header pattern (Stripe-style) keyed on CertificateRequest UID. Reference ACME (RFC 8555) for revocation reason codes alignment.

Documented the as-built contract in k8s/issuer/docs/api-contract.md (read from external.routes.ts + signer.go): auth (per-cluster bearer token scoped to one CA, pkimg_ format, SHA-256 hashed), all four endpoints (health, ca-bundle, sign, revoke) with request/response schemas, idempotency (sign keyed by requestUid = CertificateRequest.UID; revoke by serial), and the standard error shape {error:{code,message}} with a per-code Retryable table.
AC#4 note: the as-built error body carries code+message (no literal `retryable` field); retryability is documented per status+code (5xx/transport = retryable, 4xx = terminal), which is how the controller already behaves. Documented rather than adding an unused field.
<!-- SECTION:NOTES:END -->
