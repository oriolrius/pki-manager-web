---
id: TASK-285
title: Fix OSV findings in project dependencies
status: Done
assignee:
  - '@codex'
created_date: '2026-11-25T20:47:00Z'
updated_date: '2026-11-25T21:21:00Z'
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
OSV-Scanner v2.7.1 found 163 unique advisory IDs on main at effa6410 and zero in the rebased branch across nine manifests. No ignore rules.

The frozen install, strict backend and frontend typechecks, frontend build, and lint passed. Lint reported ten frontend warnings and zero errors. All 925 backend tests and 154 frontend tests passed. Go vet and tests passed in all four modules. The site link checker checked 183 pages.

Replace numeric TRUST_PROXY values with proxy IPs or CIDRs before deployment. The merged builder pins match the Go requirements.
<!-- SECTION:NOTES:END -->
