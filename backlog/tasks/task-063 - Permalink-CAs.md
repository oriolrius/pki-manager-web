---
id: task-063
title: Permalink CAs
status: In Progress
assignee:
  - '@myself'
created_date: '2025-10-24 07:21'
updated_date: '2025-10-24 10:40'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add permalink/direct link functionality for CAs to allow users to easily share and bookmark specific CA cert file. Users should be able to copy a direct URL to a CA details page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Users can navigate to a CA cert file using a permalink URL
- [ ] #2 CA permalink URLs are shareable and bookmarkable
- [ ] #3 Navigating to a CA permalink loads the correct CA cert file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add "Copy Permalink" button to CA detail page header
2. Implement copy-to-clipboard functionality using browser API
3. Show feedback when link is copied
4. Test that direct navigation to /cas/:id works correctly
<!-- SECTION:PLAN:END -->
