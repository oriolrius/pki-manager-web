---
id: TASK-001
title: Add Keycloak service to docker-compose.yml
status: To Do
assignee: []
created_date: '2026-02-05 11:57'
labels:
  - keycloak
  - docker
  - infrastructure
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Keycloak identity server to the existing docker-compose.yml for development authentication testing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Keycloak service uses port 8081 (KEYCLOAK_EXTERNAL_PORT env var) to avoid conflict with frontend on 8080
- [ ] #2 Service uses pki-network and follows existing patterns (restart policy, security_opt, healthcheck)
- [ ] #3 Realm JSON auto-imports on startup using --import-realm flag
- [ ] #4 Volume mount exists for realm configuration at docker/keycloak/dev-realm.json
- [ ] #5 Service uses KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD environment variables
- [ ] #6 Keycloak starts in dev mode (start-dev) for local development
<!-- AC:END -->
