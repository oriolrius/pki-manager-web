---
id: TASK-278
title: Decision records and specifications are published from backlog/
status: Done
assignee:
  - '@claude'
created_date: '2026-11-25T10:07:00Z'
updated_date: '2026-11-25T10:54:00Z'
labels:
  - docs
milestone: m-4
dependencies: []
ordinal: 98014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisions and specifications live in backlog/ and readers of the site cannot see why the product is built the way it is. They must be published from their only source, without copies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each decision in backlog/decisions has a page under Project on the site
- [x] #2 Each specification in backlog/docs has a page under Project on the site
- [x] #3 Each record page shows its date and states that it is a historical record
- [x] #4 A new decision or specification appears on the site with no change to the site code
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision records and specifications are published from `backlog/` under Project.

- Rule in `site/docs.config.mjs` (`RECORDS`): `backlog/decisions/*` -> `/project/decisions/<id>/`, `backlog/docs/*` -> `/project/specs/<id>/`, each with an index page.
- Each page starts with a note: it is a record with its date and status, not a manual.
- Both frontmatter styles of the records are read (YAML header, or the `- **Status:**` list).
- A new record needs no change to the site.
<!-- SECTION:NOTES:END -->
