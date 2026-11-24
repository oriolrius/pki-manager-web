---
id: TASK-274
title: Release the merged work
status: To Do
assignee: []
created_date: '2026-11-24T11:52:00Z'
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
- [ ] #1 A GitHub release exists with title vX.Y.Z — <description> and hand-written notes
- [ ] #2 The backend and frontend images for the new tag are published
<!-- AC:END -->
