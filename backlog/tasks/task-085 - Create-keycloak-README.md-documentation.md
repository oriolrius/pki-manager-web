---
id: TASK-085
title: Create keycloak/README.md documentation
status: To Do
assignee: []
created_date: '2026-02-05 12:00'
updated_date: '2026-02-05 12:04'
labels:
  - keycloak
  - documentation
dependencies:
  - TASK-080
  - TASK-081
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive README.md documentation for the Keycloak development environment, following the same pattern as kms/README.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 File created at keycloak/README.md
- [ ] #2 Documents file structure (docker-compose.yml, .env, dev-realm.json, data/)
- [ ] #3 Documents port configuration: 52997 external, 8080 internal
- [ ] #4 Includes Usage section: start, stop, logs, reset commands
- [ ] #5 Documents admin console access: http://localhost:52997 with credentials
- [ ] #6 Lists key endpoints: token endpoint, JWKS, openid-configuration
- [ ] #7 Includes curl examples for Client Credentials and Password grant flows
- [ ] #8 Documents how to export/modify realm configuration
- [ ] #9 Includes Troubleshooting section (port conflicts, realm not imported, container issues)
- [ ] #10 Documents integration with PKI Manager backend (environment variables)
- [ ] #11 Follows same structure and style as kms/README.md
<!-- AC:END -->
