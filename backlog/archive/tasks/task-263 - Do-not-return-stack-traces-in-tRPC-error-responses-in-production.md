---
id: TASK-263
title: Do not return stack traces in tRPC error responses in production
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T10:18:00Z'
updated_date: '2026-11-24T16:02:00Z'
labels:
  - security
  - bug
dependencies: []
priority: high
ordinal: 83014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the published 3.15.0 image, a tRPC 401 response body contains the server stack trace (seen on the docs demo stack, 2026-11-24). Production responses must not leak internals.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With NODE_ENV=production, tRPC error responses contain no stack trace
- [x] #2 A test covers an unauthenticated tRPC call in production mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/security/advisories/GHSA-74c2-xrr6-jw46

Fixed in PR #43 (merged 2026-11-24; #45 fixed the combined test). Ships in the next release (3.17.0 planned). Advisory stays a private draft until prod (k5) runs the fix.
<!-- SECTION:NOTES:END -->
