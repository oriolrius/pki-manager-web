---
id: TASK-097
title: Add silent token renewal to frontend
status: To Do
assignee: []
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 14:31'
labels:
  - oidc
  - frontend
dependencies:
  - TASK-094
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure automatic silent token renewal using hidden iframe. Creates silent-renew.html and configures oidc-client-ts for automatic refresh. Reference: decision-009.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 silent-renew.html created in frontend/public/
- [ ] #2 OIDC config enables automaticSilentRenew
- [ ] #3 silent_redirect_uri points to silent-renew.html
- [ ] #4 Token refresh happens before expiry (60s notification)
- [ ] #5 Session restored on page refresh via silent sign-in
<!-- AC:END -->
