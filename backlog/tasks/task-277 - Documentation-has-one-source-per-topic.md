---
id: TASK-277
title: Documentation has one source per topic
status: Done
assignee:
  - '@claude'
created_date: '2026-11-25T10:07:00Z'
updated_date: '2026-11-25T10:54:00Z'
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
- [x] #1 Every documentation page under docs/ is published at the URL that equals its path
- [x] #2 Root guides (deployment, OIDC, Keycloak, development) live under docs/ and the root keeps only README, CHANGELOG, LICENSE and AGENTS
- [x] #3 Superseded copies are removed (backlog docs 002 to 005, backend OpenAPI notes, issuer install and API contract copies, Copilot instructions, template README)
- [x] #4 The site build fails when a Markdown file is neither published nor listed as repository-only
- [x] #5 Existing site URLs still work or redirect
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Every topic has one document, and the build stops a second copy.

- `docs/` mirrors the site: the URL of a page is its path. The website moved from `docs/site` to `site/`.
- Root guides moved to `docs/operations/` and `docs/development/`; contributor sections left the deployment guide (`testing.md`, `ci.md`); the rules are in `docs/development/documentation.md`.
- `site/docs.config.mjs` is the inventory. `site/scripts/sync-docs.mjs` fails on a Markdown file without a declared home (tested with a stray root file).
- Removed: backlog docs 002-005, `backend/OPENAPI*.md`, issuer install and API-contract copies, `.github/copilot-instructions.md`, template `frontend/README.md`, `assets/` and its spec, root `package-lock.json`.
- Unique, checked facts of the removed copies moved to their one home.
- All 145 URLs of the live site exist in the new build; three merged pages redirect.

Findings filed on GitHub: #48-#56.
<!-- SECTION:NOTES:END -->
