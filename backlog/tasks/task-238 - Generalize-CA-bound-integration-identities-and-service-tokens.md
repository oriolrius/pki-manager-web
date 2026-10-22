---
id: TASK-238
title: Generalize CA-bound integration identities and service tokens
status: Done
assignee:
  - '@codex'
created_date: '2026-10-22T10:36:00Z'
updated_date: '2026-10-22T10:47:00Z'
labels: []
dependencies: []
ordinal: 65014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace Kubernetes-specific token ownership with generic typed integrations across persistence, backend, APIs and frontend, preserving existing tokens and legacy cluster endpoints.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration preserves existing token hashes and certificate ownership under integrations
- [x] #2 Generic integration API supports Kubernetes, SCEP and generic identities; legacy cluster API remains compatible
- [x] #3 External issuance, status, retry and revocation are scoped to integration and correctly classify SCEP certificates
- [x] #4 Frontend creates typed integrations and uses the generic API; compatibility and isolation tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add canonical integrations persistence with typed identities and migrate token hashes and certificate ownership.
2. Introduce generic integration service/router/auth and retain cluster compatibility adapters.
3. Update issuance provenance and UI with integration types; test migration, isolation, revoked tokens, legacy API and live SCEP.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented canonical integrations persistence and IntegrationService with kubernetes/scep/generic identities and CA-bound service tokens. Generated migration 0010 preserves token hashes, revocation, usage and CA bindings, backfills integration_id, and reclassifies unambiguous historical SCEP identities/certificates. Legacy cluster tRPC calls adapt to the generic service and retain Kubernetes defaults and count fields; /clusters redirects to /integrations.
External token authentication, certificate ownership, status, idempotent retries and revocation now use integration identity. SCEP certificates use source=scep and no Kubernetes metadata; generic certificates use source=integration. Added audit logging of failed identity mutations. UI uses integration.* with explicit type selection and canonical counts. Fixed inherited CA selector response-shape mismatch against the real ca.list API.
Validation: full backend suite 750 passed/1 skipped (70 files), strict backend typecheck/build passed; after final namespace isolation changes, 16 focused route/service/migration tests passed. Frontend 61 tests and focused ESLint passed; Vite bundle passed. Real existing SCEP token survived migration; live SCEP discovery, KMS RA crypto, backend issuance and idempotent retry passed. SQLite integrity check passed and repeat migration/schema generation showed no remaining changes. Broader frontend strict build still fails on pre-existing backend enum/SSH typing issues; backend ESLint still crashes on the existing Ajv override. Screenshot expectations were updated for the compatibility redirect; screenshot/browser suite was not run. Self-review and git diff --check passed.
<!-- SECTION:NOTES:END -->
