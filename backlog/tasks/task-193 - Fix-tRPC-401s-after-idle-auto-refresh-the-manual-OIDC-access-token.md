---
id: TASK-193
title: 'Fix tRPC 401s after idle: auto-refresh the manual OIDC access token'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-11 08:35'
updated_date: '2026-07-11 08:35'
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
- [ ] #1 During an active session, when the access token expires the next tRPC request auto-refreshes it via the stored refresh_token and succeeds (200) without a page reload
- [ ] #2 Concurrent/batched tRPC requests that hit an expired token trigger at most one token refresh (single-flight)
- [ ] #3 When the refresh_token is invalid/expired, the stored token is cleared and the app falls back to the login redirect instead of looping on 401s
- [ ] #4 Existing behavior is unchanged for a still-valid token and for OIDC-disabled (unauthenticated) mode
- [ ] #5 Unit tests cover: refresh-on-expiry success, single-flight dedup, and refresh-failure fallback
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. token.ts: add refreshManualAccessToken() posting grant_type=refresh_token to the Keycloak token endpoint, updating localStorage (rotated refresh token) and returning the new access token; on failure clear stored token and return null.
2. token.ts: change getManualAccessToken() to refresh when the token is expired/expiring (60s buffer) if a refresh_token exists, with a module-level single-flight promise shared across concurrent/batched callers.
3. Keep getAccessToken() (UserManager first, then manual) and OIDC-disabled behavior intact.
4. Add token.test.ts covering refresh-on-expiry, single-flight dedup, and refresh-failure fallback.
5. Verify: frontend typecheck + vitest.
<!-- SECTION:PLAN:END -->
