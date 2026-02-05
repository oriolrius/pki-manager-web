---
id: TASK-081
title: Create Keycloak dev realm JSON configuration
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 12:00'
updated_date: '2026-02-05 12:14'
labels:
  - keycloak
  - configuration
dependencies:
  - TASK-080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create keycloak/dev-realm.json file with OAuth2 Client Credentials flow configuration for development and testing. The realm should include service accounts for machine-to-machine communication and confidential clients for web apps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Realm named 'pki-dev' is created and enabled
- [x] #2 OAuth2 Client Credentials client 'pki-service' with serviceAccountsEnabled=true exists
- [x] #3 Confidential web client 'pki-web' with valid redirect URIs for localhost:5173 and localhost:8080 exists
- [x] #4 Test users exist: admin user with 'admin' role, regular user with 'user' role
- [x] #5 Realm roles defined: admin, user
- [x] #6 SSL requirement disabled (sslRequired: none) for local dev
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Updated keycloak/dev-realm.json with:\n- Realm: pki-dev\n- Clients: pki-service (client credentials), pki-web (confidential)\n- Roles: admin, user\n- Users: admin/admin, user/user\n- Client secrets documented in .env and README.md
<!-- SECTION:NOTES:END -->
