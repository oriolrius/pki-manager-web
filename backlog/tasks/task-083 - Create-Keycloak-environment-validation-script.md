---
id: TASK-083
title: Create Keycloak environment validation script
status: To Do
assignee: []
created_date: '2026-02-05 12:00'
updated_date: '2026-02-05 12:04'
labels:
  - keycloak
  - testing
  - scripts
dependencies:
  - TASK-080
  - TASK-081
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a shell script that validates the Keycloak development environment is properly configured and running. The script should verify all critical endpoints and configurations work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Script located at scripts/validate-keycloak.sh
- [ ] #2 Verifies OpenID configuration endpoint returns valid JSON (.well-known/openid-configuration)
- [ ] #3 Verifies Client Credentials flow works: obtains access token using pki-service client
- [ ] #4 Verifies JWKS endpoint returns signing keys (/protocol/openid-connect/certs)
- [ ] #5 Verifies test user can authenticate via password grant (optional, for web client)
- [ ] #6 Script outputs clear success/failure messages with troubleshooting hints
- [ ] #7 Script is executable and has proper shebang
- [ ] #8 Verifies Keycloak health endpoint responds (http://localhost:52997/health/ready)
<!-- AC:END -->
