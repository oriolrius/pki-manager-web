---
id: task-065
title: Create production Docker stack with GitHub CI/CD
status: In Progress
assignee:
  - '@myself'
created_date: '2025-10-24 14:04'
updated_date: '2025-10-24 14:11'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up production-ready Docker infrastructure with Dockerfile, docker-compose, and GitHub Actions workflow for automated image building and publishing to ghcr.io. Stack includes both PKI Manager application and Cosmian KMS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Multi-stage Dockerfile builds successfully and produces minimal production image (non-root user, security hardening)
- [ ] #2 Docker Compose stack runs locally with PKI Manager and Cosmian KMS (proper networking, volume persistence, secrets)
- [ ] #3 Environment configuration uses .env files with sensible production defaults as fallbacks when .env is not present
- [ ] #4 Local stack validated: all services healthy, application accessible, KMS integration working
- [ ] #5 GitHub Actions workflow builds Docker images and publishes to ghcr.io on main branch and releases
- [ ] #6 Images exclusively published to ghcr.io (authentication configured, no other registries)
- [ ] #7 Production configuration includes health checks, restart policies, resource limits, and structured logging
- [ ] #8 Documentation covers local setup, production deployment, environment variables, and secrets management
<!-- AC:END -->
