---
id: task-065
title: Create production Docker stack with GitHub CI/CD
status: To Do
assignee: []
created_date: '2025-10-24 14:04'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up production-ready Docker infrastructure with Dockerfile, docker-compose, and GitHub Actions workflow for automated image building and publishing to ghcr.io. Stack includes both PKI Manager application and Cosmian KMS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Application has multi-stage Dockerfile optimized for production (minimal image size, non-root user, security best practices)
- [ ] #2 Docker Compose stack includes PKI Manager and Cosmian KMS with proper networking, volumes, and secrets management
- [ ] #3 GitHub Actions workflow builds and publishes images to ghcr.io on main branch pushes and releases
- [ ] #4 Images are only published to ghcr.io (never Docker Hub or other registries)
- [ ] #5 Stack includes environment configuration for production (health checks, restart policies, logging)
- [ ] #6 Documentation covers deployment, configuration, and secrets management
<!-- AC:END -->
