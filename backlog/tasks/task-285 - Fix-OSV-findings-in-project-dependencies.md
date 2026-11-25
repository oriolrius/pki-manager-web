---
id: TASK-285
title: Fix OSV findings in project dependencies
status: Done
assignee:
  - '@codex'
created_date: '2026-11-25T20:47:00Z'
updated_date: '2026-11-25T21:08:00Z'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Upgrade affected dependencies and verify the build and test results.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 OSV reports zero findings in the tracked dependency manifests.
- [x] #2 Workspace and module checks pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Scan all tracked manifests.
2. Upgrade affected packages.
3. Scan again and verify each build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
OSV-Scanner v2.7.1 found 163 unique advisory IDs before and zero after the upgrades. No ignores.

The frozen install, both workspace typechecks and lints, all 923 backend tests, all 152 frontend tests, both production builds, site links, Go vet and tests in all four modules, uv sync, and five Keycloak checks passed. The optional frontend tsc -b still reports the same 138 diagnostics as the base revision.

Replace numeric TRUST_PROXY values with IPs/CIDRs. Update issuer/KRL build environments to Go 1.26.11 and SCEP to 1.27.4 in the parallel workflow change.
<!-- SECTION:NOTES:END -->
