---
id: TASK-255
title: 'Guide: get started (install and first login)'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T10:26:00Z'
labels:
  - docs
milestone: m-1
dependencies:
  - TASK-254
  - TASK-251
ordinal: 75014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Docker Compose install, KMS and OIDC choices (or OIDC off), first login, dashboard tour. Every step verified on a clean stack.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new user installs and logs in by following only this guide
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- docs/guides/get-started.md (site: get-started/install). Verified on a clean git archive of docker/ + kms/ with published 3.15.0 images, OIDC off; OIDC login shown from the demo stack (Keycloak).
- Found: Docker-created pki/ is root-owned and the backend (uid 1001) fails with SQLITE_CANTOPEN; guide and DEPLOYMENT.md now create it with chown 1001:1001. umask 077 makes config.json unreadable (403) - noted.
<!-- SECTION:NOTES:END -->
