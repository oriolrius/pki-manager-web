---
id: TASK-273
title: Merge the SSH UI, principal gaps and docs branches into main
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-24T11:52:00Z'
updated_date: '2026-11-24T12:56:00Z'
labels:
  - release
milestone: m-3
dependencies: []
ordinal: 93014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three stacked PRs in order: feat/ssh-ui-offboard-and-tokens, feat/ssh-principal-gaps, docs/site (contains the SSH explainer and the docs site). Merge commits keep the shared history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each PR is merged into main after its CI checks pass
- [ ] #2 main contains the offboard/tokens UI, the principal fixes, the SSH explainer and the docs site
<!-- AC:END -->
