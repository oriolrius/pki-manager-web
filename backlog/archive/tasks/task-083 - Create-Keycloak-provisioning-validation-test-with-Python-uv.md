---
id: TASK-083
title: Create Keycloak provisioning validation test with Python uv
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 12:00'
updated_date: '2026-02-05 12:38'
labels:
  - keycloak
  - testing
  - python
  - uv
dependencies:
  - TASK-080
  - TASK-081
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Python test using uv that validates the Keycloak development environment is properly provisioned and running. The test should verify all critical endpoints and OAuth2 flows work correctly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test verifies OpenID configuration endpoint returns valid JSON (.well-known/openid-configuration)
- [x] #2 Test verifies JWKS endpoint returns signing keys (/protocol/openid-connect/certs)
- [x] #3 Test verifies Client Credentials flow: obtains access token using pki-service client
- [x] #4 Test verifies Password grant flow: authenticates test user (admin/admin)
- [x] #5 Test validates access token contains expected claims (iss, aud, exp, sub)
- [x] #6 Run with: uv run keycloak/test_keycloak.py
- [x] #7 Clear error messages when Keycloak is not running or misconfigured
- [x] #8 Test file located at keycloak/test_keycloak.py
- [x] #9 Uses uv inline script dependencies (# /// script)
- [x] #10 Test verifies Keycloak health endpoint responds (http://localhost:42997/health/ready)
- [x] #11 Test reads configuration from keycloak/.env (KEYCLOAK_PORT, admin credentials, client secrets)
- [x] #12 Test first checks if Keycloak is running; skips remaining tests with clear message if not available
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created Python test script using uv inline dependencies:
- **File**: `keycloak/test_keycloak.py`
- **Run with**: `uv run keycloak/test_keycloak.py`

### Tests Performed
1. **Health Endpoint** - Verifies Keycloak is running via management port (42999)
2. **OpenID Configuration** - Validates .well-known/openid-configuration endpoint
3. **JWKS Endpoint** - Confirms signing keys are available
4. **Client Credentials Flow** - Tests pki-service client authentication
5. **Password Grant Flow** - Tests user authentication (admin/admin)

### Configuration Changes
- Added management port (42999) to docker-compose.yml and .env
- Renamed realm file to `pki-dev-realm.json` (Keycloak 26 requirement)
- Removed invalid `serviceAccountRoles` field from realm config

### Keycloak 26 Notes
- Health endpoints are on separate management port (9000 internally, 42999 externally)
- `sub` claim is not included in access tokens by default; available in id_token with `openid` scope
<!-- SECTION:NOTES:END -->
