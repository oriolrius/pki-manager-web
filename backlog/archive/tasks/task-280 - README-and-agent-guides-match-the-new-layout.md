---
id: TASK-280
title: README and agent guides match the new layout
status: Done
assignee:
  - '@claude'
created_date: '2026-11-25T10:07:00Z'
updated_date: '2026-11-25T10:54:00Z'
labels:
  - docs
milestone: m-4
dependencies: []
ordinal: 100014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
README.md repeats the feature list, the stack versions and the quick start, and several statements are false for the current release. AGENTS.md files point to files that move.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README.md is a short front page that links to the site instead of repeating it
- [x] #2 README.md states that the project is personal with no commercial interest
- [x] #3 AGENTS.md files point to existing files and to just recipes
- [x] #4 No file mentions the Orca tool
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `README.md` is a short front page: what it is, the personal-project statement, links to the site, the repository layout.
- `AGENTS.md`: where things are, the documentation rules, `just` commands; no Orca, no ASCII diagram.
- `backend/`, `k8s/issuer/` agent guides and the dev Keycloak and KMS notes point to existing files and describe what the files really contain.
<!-- SECTION:NOTES:END -->
