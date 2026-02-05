---
id: TASK-004
title: Create Keycloak environment validation script
status: To Do
assignee: []
created_date: '2026-02-05 11:53'
updated_date: '2026-02-05 11:54'
labels:
  - keycloak
  - testing
  - scripts
dependencies:
  - TASK-001
  - TASK-002
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a shell script that validates the Keycloak development environment is properly configured and running. The script should verify all critical endpoints and configurations work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Script located at scripts/validate-keycloak.sh
- [ ] #2 Verifies Keycloak health endpoint responds (http://localhost:8081/health)
- [ ] #3 Verifies OpenID configuration endpoint returns valid JSON (.well-known/openid-configuration)
- [ ] #4 Verifies Client Credentials flow works: obtains access token using pki-service client
- [ ] #5 Verifies JWKS endpoint returns signing keys (/protocol/openid-connect/certs)
- [ ] #6 Verifies test user can authenticate via password grant (optional, for web client)
- [ ] #7 Script outputs clear success/failure messages with troubleshooting hints
- [ ] #8 Script is executable and has proper shebang
<!-- AC:END -->
