---
id: TASK-274
title: Release the merged work
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T11:52:00Z'
updated_date: '2026-11-24T13:10:00Z'
labels:
  - release
milestone: m-3
dependencies:
  - TASK-273
ordinal: 94014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commitizen bump (minor: new features and migrations 0012/0013), CHANGELOG section with a hand-written title and notes, tag pushed explicitly so the release and images are built.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A GitHub release exists with title vX.Y.Z — <description> and hand-written notes
- [x] #2 The backend and frontend images for the new tag are published
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- v3.16.0 (MINOR from feat commits), cz bump --files-only + curated CHANGELOG section (bold title, intro, Feat/Fix/Refactor + hand-written Docs), bump commit 8cde062, tag pushed explicitly.
- Release https://github.com/oriolrius/pki-manager-web/releases/tag/v3.16.0 titled "v3.16.0 — SSH principal fixes, fleet tokens UI and the documentation site", Latest.
- Images ghcr.io/oriolrius/pki-manager-web/{backend,frontend}:3.16.0 published; krl-client and SCEP workflows green.
- Prod (k5) not touched.
<!-- SECTION:NOTES:END -->
