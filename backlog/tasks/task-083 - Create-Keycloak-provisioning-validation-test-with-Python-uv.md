---
id: TASK-083
title: Create Keycloak provisioning validation test with Python uv
status: To Do
assignee: []
created_date: '2026-02-05 12:00'
updated_date: '2026-02-05 12:21'
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
- [ ] #1 Test file located at keycloak/test_keycloak.py
- [ ] #2 Uses uv for dependency management (pyproject.toml or inline script dependencies)
- [ ] #3 Test verifies Keycloak health endpoint responds (http://localhost:42997/health/ready)
- [ ] #4 Test verifies OpenID configuration endpoint returns valid JSON (.well-known/openid-configuration)
- [ ] #5 Test verifies JWKS endpoint returns signing keys (/protocol/openid-connect/certs)
- [ ] #6 Test verifies Client Credentials flow: obtains access token using pki-service client
- [ ] #7 Test verifies Password grant flow: authenticates test user (admin/admin)
- [ ] #8 Test validates access token contains expected claims (iss, aud, exp, sub)
- [ ] #9 Test can be run with: uv run keycloak/test_keycloak.py or uv run pytest keycloak/
- [ ] #10 Clear error messages when Keycloak is not running or misconfigured
<!-- AC:END -->
