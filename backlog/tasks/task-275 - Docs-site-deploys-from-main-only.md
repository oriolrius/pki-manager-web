---
id: TASK-275
title: Docs site deploys from main only
status: To Do
assignee: []
created_date: '2026-11-24T11:52:00Z'
labels:
  - docs
milestone: m-3
dependencies:
  - TASK-273
ordinal: 95014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The first deploy ran from docs/site before the merge (TASK-251 follow-up). Links in the YouTube descriptions point to main.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A push to main deploys the docs site; docs/site no longer triggers a deploy and is not allowed by the github-pages environment
- [ ] #2 The repository links in the YouTube video descriptions resolve
<!-- AC:END -->
