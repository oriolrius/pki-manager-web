---
id: TASK-080
title: Add Keycloak service to docker-compose.yml
status: To Do
assignee: []
created_date: '2026-02-05 11:59'
updated_date: '2026-02-05 12:04'
labels:
  - keycloak
  - docker
  - infrastructure
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a standalone keycloak/ folder following the same pattern as kms/ folder. This provides a self-contained Keycloak development environment with its own docker-compose.yml, configuration, and documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Keycloak service uses port 8081 (KEYCLOAK_EXTERNAL_PORT env var) to avoid conflict with frontend on 8080
- [ ] #2 Service uses pki-network and follows existing patterns (restart policy, security_opt, healthcheck)
- [ ] #3 Realm JSON auto-imports on startup using --import-realm flag
- [ ] #4 Volume mount exists for realm configuration at docker/keycloak/dev-realm.json
- [ ] #5 Service uses KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD environment variables
- [ ] #6 Keycloak starts in dev mode (start-dev) for local development
- [ ] #7 Folder structure: keycloak/docker-compose.yml, keycloak/.env, keycloak/dev-realm.json, keycloak/data/, keycloak/README.md
- [ ] #8 Container name follows convention: pki-manager-keycloak
- [ ] #9 Port mapping: 52997:8080 (external:internal) following project port range convention
- [ ] #10 Network: pki-manager-network (same as kms)
- [ ] #11 Volume mounts: ./data for persistent storage, ./dev-realm.json for realm config (read-only)
- [ ] #12 Healthcheck configured using /health/ready endpoint
- [ ] #13 restart: unless-stopped policy
- [ ] #14 Uses --import-realm flag to auto-import dev-realm.json on startup
- [ ] #15 Environment variables: KC_BOOTSTRAP_ADMIN_USERNAME, KC_BOOTSTRAP_ADMIN_PASSWORD, KC_HEALTH_ENABLED=true
<!-- AC:END -->
