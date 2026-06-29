---
id: TASK-134
title: >-
  SSH-16: SSH Zod schemas (single source of truth for tRPC + OpenAPI) with input
  validation
status: To Do
assignee: []
created_date: '2026-06-29 15:42'
updated_date: '2026-06-29 15:47'
labels:
  - ssh-cert-manager
  - backend
  - api
milestone: SSH Certificate Manager
dependencies:
  - TASK-126
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create backend/src/trpc/ssh-schemas.ts holding every SSH request/response Zod schema: createSshCa (curve fixed to nistp256, type user|host), importSshCa, issueHostCert, issueUserCert, principal catalog ops, revoke, krl, and shared enums (sshExtension matching the PoC table, sshCriticalOption with source-address validated as CIDR list, sshCertType, sshValidity as both relative '+1w/+52w' and absolute timestamps, key_id constrained to printable control-char-free). Export them so rest/schemas/openapi-schemas.ts converts them via the existing toJsonSchema() helper — keeping SSH endpoints in the same Swagger with zero new tooling.

**Epic:** SSH API Surface (tRPC + REST/OpenAPI + Automation)
**Logical deps:** SSH-09
**Touchpoints:** backend/src/trpc/ssh-schemas.ts, backend/src/rest/schemas/openapi-schemas.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typed Zod schemas exist for create/import-ssh-ca, issue-host-cert, issue-user-cert, manage-principal, revoke, and get-krl requests/responses
- [ ] #2 Every schema round-trips through the existing toJsonSchema() helper and appears in Swagger at /api/docs without hand-written JSON Schema
- [ ] #3 Extension and critical-option enums match the PoC; source-address is validated as one or more CIDRs and key_id is control-char-free at the schema boundary
- [ ] #4 Validity is expressible as both relative (+1w, +52w) and absolute timestamps and validated by the schema
<!-- AC:END -->
