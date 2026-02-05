---
id: TASK-080
title: Create Keycloak development environment folder
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
- [ ] #1 Folder structure: keycloak/docker-compose.yml, keycloak/.env, keycloak/dev-realm.json, keycloak/data/, keycloak/README.md
- [ ] #2 Container name follows convention: pki-manager-keycloak
- [ ] #3 Port mapping: 52997:8080 (external:internal) following project port range convention
- [ ] #4 Network: pki-manager-network (same as kms)
- [ ] #5 Volume mounts: ./data for persistent storage, ./dev-realm.json for realm config (read-only)
- [ ] #6 Healthcheck configured using /health/ready endpoint
- [ ] #7 restart: unless-stopped policy
- [ ] #8 Uses --import-realm flag to auto-import dev-realm.json on startup
- [ ] #9 Environment variables: KC_BOOTSTRAP_ADMIN_USERNAME, KC_BOOTSTRAP_ADMIN_PASSWORD, KC_HEALTH_ENABLED=true
<!-- AC:END -->
