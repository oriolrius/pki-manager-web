---
id: TASK-083
title: Create Keycloak provisioning validation test with Python uv
status: To Do
assignee: []
created_date: '2026-02-05 12:00'
updated_date: '2026-02-05 12:25'
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
- [ ] #1 Test verifies OpenID configuration endpoint returns valid JSON (.well-known/openid-configuration)
- [ ] #2 Test verifies JWKS endpoint returns signing keys (/protocol/openid-connect/certs)
- [ ] #3 Test verifies Client Credentials flow: obtains access token using pki-service client
- [ ] #4 Test verifies Password grant flow: authenticates test user (admin/admin)
- [ ] #5 Test validates access token contains expected claims (iss, aud, exp, sub)
- [ ] #6 Run with: uv run keycloak/test_keycloak.py
- [ ] #7 Clear error messages when Keycloak is not running or misconfigured
- [ ] #8 Test file located at keycloak/test_keycloak.py
- [ ] #9 Uses uv inline script dependencies (# /// script)
- [ ] #10 Test verifies Keycloak health endpoint responds (http://localhost:42997/health/ready)
- [ ] #11 Test reads configuration from keycloak/.env (KEYCLOAK_PORT, admin credentials, client secrets)
- [ ] #12 Test first checks if Keycloak is running; skips remaining tests with clear message if not available
<!-- AC:END -->
