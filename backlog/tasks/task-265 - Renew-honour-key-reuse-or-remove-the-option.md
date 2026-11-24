---
id: TASK-265
title: 'Renew: honour key reuse or remove the option'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-24T10:19:00Z'
updated_date: '2026-11-24T14:42:00Z'
labels:
  - certificates
  - bug
dependencies: []
ordinal: 85014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The UI sends generateNewKey:false, but renew always creates a new key ("Key reuse requested but not supported", certificate.service.ts). The old certificate also stays active. Found by the docs private CA guide, 2026-11-24.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Renew with key reuse keeps the same public key, or the UI no longer offers it
- [ ] #2 The UI states what happens to the old certificate after renew
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/issues/23
<!-- SECTION:NOTES:END -->
