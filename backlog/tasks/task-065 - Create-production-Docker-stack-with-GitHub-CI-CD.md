---
id: task-065
title: Create production Docker stack with GitHub CI/CD
status: To Do
assignee: []
created_date: '2025-10-24 14:04'
updated_date: '2025-10-24 14:06'
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
- [ ] #3 Local stack validated: all services healthy, application accessible, KMS integration working
- [ ] #4 GitHub Actions workflow builds Docker images and publishes to ghcr.io on main branch and releases
- [ ] #5 Images exclusively published to ghcr.io (authentication configured, no other registries)
- [ ] #6 Production configuration includes health checks, restart policies, resource limits, and structured logging

- [ ] #7 Documentation covers local setup, production deployment, environment variables, and secrets management
<!-- AC:END -->
