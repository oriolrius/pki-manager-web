---
id: TASK-193
title: 'Fix tRPC 401s after idle: auto-refresh the manual OIDC access token'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-11 08:35'
updated_date: '2026-07-11 08:38'
labels:
  - frontend
  - auth
  - bug
dependencies: []
ordinal: 20014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After ~<1h idle on an authenticated page (e.g. /ssh/hosts), all tRPC calls start returning 401 ('Error loading hosts') and only a full page reload restores them.

Root cause: in production the app authenticates via the hand-rolled manual token flow (frontend/src/routes/callback.tsx), which stores access_token + refresh_token + expires_at in localStorage but never renews them. oidc-client-ts automaticSilentRenew only manages tokens held by its UserManager; the manual path bypasses the UserManager, so silent renew never fires. When the Keycloak access token expires, token.ts getManualAccessToken() returns null (30s buffer) and trpc.ts getHeaders() sends the request with NO Authorization header -> backend 401. Reload works because AuthGuard re-runs, sees the expired token, redirects to Keycloak, and the still-valid SSO session mints a fresh token.

Fix: use the already-stored refresh_token to renew the access token on demand in token.ts (POST grant_type=refresh_token to the Keycloak token endpoint), with single-flight dedup for batched requests, so tRPC never sends an unauthenticated request while the SSO session is alive. On refresh failure, clear the stored token so AuthGuard redirects to login (same as a reload).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 During an active session, when the access token expires the next tRPC request auto-refreshes it via the stored refresh_token and succeeds (200) without a page reload
- [x] #2 Concurrent/batched tRPC requests that hit an expired token trigger at most one token refresh (single-flight)
- [x] #3 When the refresh_token is invalid/expired, the stored token is cleared and the app falls back to the login redirect instead of looping on 401s
- [x] #4 Existing behavior is unchanged for a still-valid token and for OIDC-disabled (unauthenticated) mode
- [x] #5 Unit tests cover: refresh-on-expiry success, single-flight dedup, and refresh-failure fallback
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. token.ts: add refreshManualAccessToken() posting grant_type=refresh_token to the Keycloak token endpoint, updating localStorage (rotated refresh token) and returning the new access token; on failure clear stored token and return null.
2. token.ts: change getManualAccessToken() to refresh when the token is expired/expiring (60s buffer) if a refresh_token exists, with a module-level single-flight promise shared across concurrent/batched callers.
3. Keep getAccessToken() (UserManager first, then manual) and OIDC-disabled behavior intact.
4. Add token.test.ts covering refresh-on-expiry, single-flight dedup, and refresh-failure fallback.
5. Verify: frontend typecheck + vitest.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in frontend/src/lib/auth/token.ts. Root cause: the prod manual token flow (routes/callback.tsx) stores access/refresh tokens in localStorage but is not managed by oidc-client-ts, so automaticSilentRenew never renews it; on access-token expiry getManualAccessToken() returned null and tRPC sent unauthenticated requests -> 401, fixable only by reload. Now getManualAccessToken() refreshes on demand via the stored refresh_token (grant_type=refresh_token) when the token is expired or within a 60s buffer, with a module-level single-flight promise shared across batched/racing callers. Rotated tokens persisted; a rejected refresh clears the stored token so AuthGuard redirects to login. UserManager path and OIDC-disabled mode untouched. Tests: token.test.ts (7 cases: valid-no-refresh, refresh-on-expiry+persist, refresh-within-buffer, single-flight dedup, refresh-failure clears+null, expired-no-refresh-token, no-stored-token). Frontend typecheck clean; full frontend suite 45 passed.
<!-- SECTION:NOTES:END -->
