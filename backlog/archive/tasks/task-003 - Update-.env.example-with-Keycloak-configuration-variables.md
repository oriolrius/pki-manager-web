---
id: TASK-003
title: Update .env.example with Keycloak configuration variables
status: To Do
assignee: []
created_date: '2026-02-05 11:53'
labels:
  - keycloak
  - configuration
  - documentation
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Keycloak-related environment variables to docker/.env.example following the existing documentation style and structure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 KEYCLOAK_EXTERNAL_PORT variable added with default 8081
- [ ] #2 KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD variables documented
- [ ] #3 KEYCLOAK_REALM variable with default 'pki-dev' documented
- [ ] #4 KEYCLOAK_CLIENT_ID and KEYCLOAK_CLIENT_SECRET variables documented for pki-service
- [ ] #5 KEYCLOAK_URL internal URL variable (http://keycloak:8080) documented
- [ ] #6 Section follows existing format with headers and comments
<!-- AC:END -->
