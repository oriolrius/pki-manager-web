---
id: TASK-266
title: 'CA create form: key usage text matches the issued CA'
status: To Do
assignee: []
created_date: '2026-11-24T10:19:00Z'
updated_date: '2026-11-24T11:04:00Z'
labels:
  - ui
  - bug
dependencies: []
ordinal: 86014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CA form lists digitalSignature in the CA key usage, but the issued CA has only keyCertSign and cRLSign (docs private CA guide, 2026-11-24).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The key usages shown in the CA form are exactly those in the issued CA certificate
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/issues/24
<!-- SECTION:NOTES:END -->
