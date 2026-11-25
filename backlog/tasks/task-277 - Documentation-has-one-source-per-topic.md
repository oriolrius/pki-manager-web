---
id: TASK-277
title: Documentation has one source per topic
status: To Do
assignee: []
created_date: '2026-11-25T10:07:00Z'
labels:
  - docs
milestone: m-4
dependencies: []
ordinal: 97014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The same topics are explained in root Markdown files, docs/, backlog/docs and the site. Some copies are stale or wrong. Each topic must have one home, and the build must stop a second copy from appearing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every documentation page under docs/ is published at the URL that equals its path
- [ ] #2 Root guides (deployment, OIDC, Keycloak, development) live under docs/ and the root keeps only README, CHANGELOG, LICENSE and AGENTS
- [ ] #3 Superseded copies are removed (backlog docs 002 to 005, backend OpenAPI notes, issuer install and API contract copies, Copilot instructions, template README)
- [ ] #4 The site build fails when a Markdown file is neither published nor listed as repository-only
- [ ] #5 Existing site URLs still work or redirect
<!-- AC:END -->
