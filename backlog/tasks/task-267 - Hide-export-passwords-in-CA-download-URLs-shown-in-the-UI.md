---
id: TASK-267
title: Hide export passwords in CA download URLs shown in the UI
status: To Do
assignee: []
created_date: '2026-11-24T10:19:00Z'
labels:
  - security
  - ui
dependencies: []
ordinal: 87014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CA detail page prints download URLs that contain the export password in the query string (docs private CA guide, 2026-11-24). Passwords in URLs end up in logs and history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No page shows a URL that contains an export password
- [ ] #2 Keystore downloads do not need the password in the URL
<!-- AC:END -->
