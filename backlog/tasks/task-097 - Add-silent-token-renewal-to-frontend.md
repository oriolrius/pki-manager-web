---
id: TASK-097
title: Add silent token renewal to frontend
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:29'
labels:
  - oidc
  - frontend
dependencies:
  - TASK-094
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure automatic silent token renewal using hidden iframe. Creates silent-renew.html and configures oidc-client-ts for automatic refresh.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 silent-renew.html created in frontend/public/
- [x] #2 OIDC config enables automaticSilentRenew
- [x] #3 silent_redirect_uri points to silent-renew.html
- [x] #4 Token refresh happens before expiry (60s notification)
- [x] #5 Session restored on page refresh via silent sign-in
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added silent token renewal:

- Created silent-renew.html in public/ for iframe-based renewal
- OIDC config already has automaticSilentRenew enabled
- silent_redirect_uri points to /silent-renew.html
- accessTokenExpiringNotificationTimeInSeconds set to 60
- Added onSigninCallback to clean up URL after redirect
<!-- SECTION:NOTES:END -->
