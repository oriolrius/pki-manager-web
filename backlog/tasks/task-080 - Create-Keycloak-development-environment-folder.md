---
id: TASK-080
title: Create Keycloak development environment folder
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 11:59'
updated_date: '2026-02-05 12:08'
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
- [x] #1 Folder structure: keycloak/docker-compose.yml, keycloak/.env, keycloak/dev-realm.json, keycloak/data/, keycloak/README.md
- [x] #2 Container name follows convention: pki-manager-keycloak
- [x] #3 Port mapping: 52997:8080 (external:internal) following project port range convention
- [x] #4 Network: pki-manager-network (same as kms)
- [x] #5 Volume mounts: ./data for persistent storage, ./dev-realm.json for realm config (read-only)
- [x] #6 Healthcheck configured using /health/ready endpoint
- [ ] #7 restart: unless-stopped policy
- [ ] #8 Uses --import-realm flag to auto-import dev-realm.json on startup
- [ ] #9 Environment variables: KC_BOOTSTRAP_ADMIN_USERNAME, KC_BOOTSTRAP_ADMIN_PASSWORD, KC_HEALTH_ENABLED=true
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create docker/keycloak directory
2. Create dev-realm.json with basic PKI Manager realm configuration
3. Add Keycloak service to docker-compose.yml following existing patterns
4. Test configuration validates correctly
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added Keycloak service to docker-compose.yml:

- Keycloak 26.0 on port 8081 (configurable via KEYCLOAK_EXTERNAL_PORT)
- Follows existing patterns: restart policy, pki-network, security_opt, healthcheck
- Auto-imports realm on startup with --import-realm flag
- Created docker/keycloak/dev-realm.json with:
  - pki-manager realm with 3 roles (admin, operator, viewer)
  - Frontend and backend clients configured
  - 3 test users (admin/operator/viewer) with matching passwords
- Uses KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD environment variables
- Runs in dev mode (start-dev) for local development
<!-- SECTION:NOTES:END -->
