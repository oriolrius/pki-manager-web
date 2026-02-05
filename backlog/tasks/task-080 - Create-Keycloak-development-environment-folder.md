---
id: TASK-080
title: Create Keycloak development environment folder
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 11:59'
updated_date: '2026-02-05 12:18'
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
- [x] #1 Keycloak service uses port 42997 (KEYCLOAK_PORT env var)
- [x] #2 Service uses pki-manager-network and follows existing kms/ patterns (restart policy, healthcheck)
- [x] #3 Realm JSON auto-imports on startup using --import-realm flag
- [x] #4 Volume mount for realm configuration at keycloak/dev-realm.json
- [x] #5 Service uses KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD environment variables
- [x] #6 Keycloak starts in dev mode (start-dev) for local development
- [x] #7 Uses image quay.io/keycloak/keycloak:26.5.2
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create keycloak/ directory at project root\n2. Create docker-compose.yml following kms/ pattern\n3. Create dev-realm.json with PKI Manager realm configuration\n4. Create .env, README.md, and .gitignore\n5. Validate configuration
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created keycloak/ directory at project root following kms/ pattern:\n\n- keycloak/docker-compose.yml - Keycloak 26.0 service configuration\n- keycloak/dev-realm.json - pki-manager realm with roles and test users\n- keycloak/.env - Environment variables (port, admin credentials)\n- keycloak/README.md - Documentation\n- keycloak/.gitignore - Ignores data/ directory\n- keycloak/data/.gitkeep - Placeholder for persistent data\n\nTest users: admin/admin, operator/operator, viewer/viewer
<!-- SECTION:NOTES:END -->
