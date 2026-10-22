---
id: TASK-237
title: Clarify integration service tokens and simplify standalone SCEP deployment
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-22T09:55:00Z'
updated_date: '2026-10-22T10:00:00Z'
labels: []
dependencies: []
ordinal: 64014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose CA-bound external issuer credentials as integration service tokens usable by Kubernetes and SCEP, and document/run SCEP against an existing backend and KMS with exactly one additional service.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 UI labels describe integrations and service tokens without breaking existing API routes
- [x] #2 Standalone SCEP Compose defines only a gateway using configurable existing backend and KMS endpoints
- [x] #3 Setup documentation distinguishes backend upgrade from adding a second backend and includes provisioning and readiness checks
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rename user-facing cluster registration and token labels to integrations/service tokens while preserving API compatibility.
2. Add standalone SCEP Compose against existing backend/KMS and document one-container provisioning.
3. Validate Compose service membership, focused frontend checks, SCEP image and live enrollment as feasible; report existing failures.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Renamed user-facing navigation, registration, revocation and one-time credential labels to Integrations / Service Token, preserving existing cluster API/routes and token format. Added scep/compose.yml and compose.env.example for a single gateway on an existing Docker network with configurable backend/KMS URLs; documented existing-backend upgrade, one-time RA provisioning and managed-mode overlays.
Validation: frontend 59 tests passed, focused ESLint passed, Vite build passed; backend focused external routes/KMS suite 18 tests passed and typecheck passed; Go module verification, tests and vet passed; image built with proxy CA and TLS verification. Standalone/shared, Intune and MDM Compose configurations each declare only scep. Provisioning, GetCACaps, GetCACert and live SCEP issuance plus idempotent retry passed against the already running backend/KMS. Broader pre-existing frontend build/lint and backend ESLint Ajv override failures were diagnosed during onboarding; no dependency/source fixes for those were included. Changes reviewed with git diff --check.
<!-- SECTION:NOTES:END -->
