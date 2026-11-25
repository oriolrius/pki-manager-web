---
id: TASK-275
title: Docs site deploys from main only
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T11:52:00Z'
updated_date: '2026-11-24T13:10:00Z'
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
- [x] #1 A push to main deploys the docs site; docs/site no longer triggers a deploy and is not allowed by the github-pages environment
- [x] #2 The repository links in the YouTube video descriptions resolve
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- docs.yml: push trigger is main only (commit b8c08e1); github-pages environment branch policy now only "main" (docs/site policy deleted). The main push deployed the site.
- The tree/main/docs/ssh/explainer links in the YouTube descriptions resolve now that #32 is merged.
<!-- SECTION:NOTES:END -->
