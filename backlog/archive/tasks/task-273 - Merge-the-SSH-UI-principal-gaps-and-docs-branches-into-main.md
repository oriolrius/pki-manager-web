---
id: TASK-273
title: Merge the SSH UI, principal gaps and docs branches into main
status: Done
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
- [x] #1 Each PR is merged into main after its CI checks pass
- [x] #2 main contains the offboard/tokens UI, the principal fixes, the SSH explainer and the docs site
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Stacked PRs merged with merge commits, each after green CI: #30 (offboard + fleet tokens UI, merge 604a838), #31 (principal gaps, retargeted to main, merge edb3510), #32 (SSH explainer + docs site, merge 92a7bd8).
- Retargeting a PR does not trigger the Actions workflows: close + reopen did.
- The four m-3 backlog commits were cherry-picked onto main.
<!-- SECTION:NOTES:END -->
