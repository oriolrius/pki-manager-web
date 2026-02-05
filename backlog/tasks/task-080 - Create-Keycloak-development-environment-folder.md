---
id: TASK-080
title: Create Keycloak development environment folder
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 11:59'
updated_date: '2026-02-05 12:10'
labels:
  - keycloak
  - docker
  - infrastructure
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a standalone keycloak/ directory at project root (following the kms/ pattern) with Docker Compose configuration for running Keycloak identity server in development.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Keycloak service uses port 8081 (KEYCLOAK_PORT env var) to avoid conflict with frontend on 8080
- [x] #2 Service uses pki-manager-network and follows existing kms/ patterns (restart policy, healthcheck)
- [x] #3 Realm JSON auto-imports on startup using --import-realm flag
- [x] #4 Volume mount for realm configuration at keycloak/dev-realm.json
- [x] #5 Service uses KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD environment variables
- [x] #6 Keycloak starts in dev mode (start-dev) for local development
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
