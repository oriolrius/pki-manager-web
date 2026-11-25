---
id: TASK-252
title: Move existing docs into the site
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T09:33:00Z'
labels:
  - docs
milestone: m-0
dependencies:
  - TASK-251
ordinal: 72014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bring the existing docs (DEPLOYMENT, OIDC, KEYCLOAK, docs/ssh/*, docs/api/integrations, k8s-csr-signing, private-root-ca-deployment) into the site as one source of truth, checked against the current code. No duplicate copies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each existing doc is in the site once; repo README links to the site
- [x] #2 Statements that do not match the current code are fixed or removed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- scripts/sync-docs.mjs copies 17 repo docs into the site at build time (generated, gitignored): repo files stay the single source. It rewrites links (site links for mapped docs, GitHub links for other repo files) and copies images.
- Not on the site on purpose: docs/ssh/zones-migration-runbook.md (one-off prod runbook with private hosts), DEVELOPMENT.md (linked from Get started).
- Four Sonnet reviewers checked the docs against the code; fixes in DEPLOYMENT, OIDC, KEYCLOAK, private-root-ca-deployment, k8s-csr-signing, integrations, ssh-api-contract, zones-migration-runbook.
- Not checked against code: the generic browser/OS trust-store chapters of private-root-ca-deployment.
- README: docs badge + link; stale "requires PR #18" note removed.
<!-- SECTION:NOTES:END -->
