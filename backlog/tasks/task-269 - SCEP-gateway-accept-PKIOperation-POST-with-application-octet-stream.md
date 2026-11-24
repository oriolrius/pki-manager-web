---
id: TASK-269
title: 'SCEP gateway: accept PKIOperation POST with application/octet-stream'
status: To Do
assignee: []
created_date: '2026-11-24T10:19:00Z'
updated_date: '2026-11-24T11:04:00Z'
labels:
  - scep
dependencies: []
ordinal: 89014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
micromdm scepclient v2.3.0 posts PKIOperation as application/octet-stream and the gateway answers 415 (docs integrations guide, 2026-11-24). Common clients use this content type.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 micromdm scepclient can enroll against the gateway
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/issues/26
<!-- SECTION:NOTES:END -->
