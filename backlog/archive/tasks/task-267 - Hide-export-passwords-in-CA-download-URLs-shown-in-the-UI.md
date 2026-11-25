---
id: TASK-267
title: Hide export passwords in CA download URLs shown in the UI
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T10:19:00Z'
updated_date: '2026-11-24T16:02:00Z'
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
- [x] #1 No page shows a URL that contains an export password
- [x] #2 Keystore downloads do not need the password in the URL
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/security/advisories/GHSA-r6w7-c6gj-h7hr

Fixed in PR #42 (merged 2026-11-24; #45 fixed the combined test). Ships in the next release (3.17.0 planned). Advisory stays a private draft until prod (k5) runs the fix.
<!-- SECTION:NOTES:END -->
