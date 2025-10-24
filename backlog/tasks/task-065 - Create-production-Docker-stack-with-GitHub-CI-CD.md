---
id: task-065
title: Create production Docker stack with GitHub CI/CD
status: In Progress
assignee:
  - '@myself'
created_date: '2025-10-24 14:04'
updated_date: '2025-10-24 14:17'
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
- [x] #3 Environment configuration uses .env files with sensible production defaults as fallbacks when .env is not present
- [ ] #4 Local stack validated: all services healthy, application accessible, KMS integration working
- [x] #5 GitHub Actions workflow builds Docker images and publishes to ghcr.io on main branch and releases
- [x] #6 Images exclusively published to ghcr.io (authentication configured, no other registries)
- [x] #7 Production configuration includes health checks, restart policies, resource limits, and structured logging
- [x] #8 Documentation covers local setup, production deployment, environment variables, and secrets management
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Completed Work:

1. **Multi-stage Dockerfile** ():
   - Base stage with Node.js 22 Alpine and pnpm
   - Dependencies stage for production deps
   - Build stages for backend and frontend
   - Production backend: non-root user, dumb-init, health checks
   - Production frontend: Nginx Alpine, non-root user, optimized config

2. **Docker Compose Stack** ():
   - Three services: KMS (Cosmian official image), backend, frontend
   - Proper service dependencies and health checks
   - Isolated bridge network
   - Named volumes for data persistence
   - Security hardening (no-new-privileges, read-only where possible)

3. **Environment Configuration**:
   - Created `.env.example` with all configuration options
   - Sensible production defaults as fallbacks
   - Docker Compose uses environment variable substitution
   - Frontend build-time API URL configuration

4. **GitHub Actions CI/CD** (`.github/workflows/docker-build.yml`):
   - Multi-architecture builds (amd64, arm64)
   - Semantic versioning support
   - Publishes ONLY to ghcr.io (never Docker Hub)
   - Build caching for faster builds
   - Trivy security scanning
   - SLSA build attestation

5. **Supporting Files**:
   - `.dockerignore` for optimized build context
   - `docker/nginx.conf` for frontend serving
   - `DEPLOYMENT.md` - comprehensive deployment guide

### Remaining Work:

1. **TypeScript Type Errors**: The backend has ~90+ TypeScript compilation errors that prevent the Docker build from completing. These need to be fixed before the images can be built successfully.

2. **Local Stack Validation**: Once type errors are fixed, the stack needs to be tested locally with `docker-compose up --build`.

### Files Created:
- `Dockerfile` (multi-stage, backend + frontend)
- `docker-compose.yml`
- `.env.example`
- `.dockerignore`
- `docker/nginx.conf`
- `.github/workflows/docker-build.yml`
- `DEPLOYMENT.md`

### Next Steps:
1. Fix TypeScript compilation errors in backend codebase
2. Test local Docker build: `docker build --target backend -t test .`
3. Test full stack: `docker-compose up --build`
4. Validate all services are healthy and accessible
5. Test KMS integration from backend container
<!-- SECTION:NOTES:END -->
