---
id: TASK-002
title: Create Keycloak dev realm JSON configuration
status: To Do
assignee: []
created_date: '2026-02-05 12:00'
labels:
  - keycloak
  - configuration
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a dev-realm.json file with OAuth2 Client Credentials flow configuration for development and testing. The realm should include service accounts for machine-to-machine communication and confidential clients for web apps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Realm named 'pki-dev' is created and enabled
- [ ] #2 OAuth2 Client Credentials client 'pki-service' with serviceAccountsEnabled=true exists
- [ ] #3 Confidential web client 'pki-web' with valid redirect URIs for localhost:5173 and localhost:8080 exists
- [ ] #4 Test users exist: admin user with 'admin' role, regular user with 'user' role
- [ ] #5 Realm roles defined: admin, user
- [ ] #6 SSL requirement disabled (sslRequired: none) for local dev
- [ ] #7 Client secrets are documented in comments or .env.example
<!-- AC:END -->
