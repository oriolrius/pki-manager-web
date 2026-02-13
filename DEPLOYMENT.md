# PKI Manager - Docker Deployment Guide

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Local Development with Docker](#local-development-with-docker)
- [Production Deployment](#production-deployment)
- [Environment Configuration](#environment-configuration)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [E2E Testing](#e2e-testing)
- [Troubleshooting](#troubleshooting)

## Overview

PKI Manager uses Docker for containerized deployment with the following components:

- **Backend**: Fastify + tRPC API server (Node.js 22 Alpine)
- **Frontend**: React SPA served by Nginx (Alpine)
- **KMS**: Cosmian Key Management System (official image)

All images are published exclusively to **GitHub Container Registry (ghcr.io)**.

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- (Optional) `.env` file for custom configuration
- For CI/CD: GitHub repository with GHCR access

## Local Development with Docker

### Quick Start

1. **Clone and navigate to the project**:
   ```bash
   cd pki-manager
   ```

2. **Create `.env` file** (optional, uses defaults if not present):
   ```bash
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

3. **Build and start all services**:
   ```bash
   docker-compose up --build
   ```

4. **Access the application**:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000
   - KMS: http://localhost:9998

### Building Individual Images

**Build backend only**:
```bash
docker build --target backend -t pki-manager-backend:dev .
```

**Build frontend only**:
```bash
docker build --target frontend \
  --build-arg VITE_API_URL=http://localhost:3000/trpc \
  -t pki-manager-frontend:dev .
```

### Development Commands

```bash
# Start services in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v

# Rebuild specific service
docker-compose up --build backend

# Execute commands in running container
docker-compose exec backend sh
```

## Production Deployment

### Step 1: Prepare Environment

Create a `.env` file with production values:

```bash
# Image Configuration
GITHUB_REPOSITORY_OWNER=your-org
IMAGE_TAG=latest  # or specific version like v1.0.0

# Network Configuration
BACKEND_EXTERNAL_PORT=3000
FRONTEND_EXTERNAL_PORT=80
KMS_EXTERNAL_PORT=9998

# Backend Configuration
NODE_ENV=production
FRONTEND_URL=https://your-domain.com

# KMS Configuration
KMS_URL=http://kms:9998
KMS_API_KEY=your-secure-api-key  # Optional

# Frontend Build Configuration
VITE_API_URL=https://your-domain.com/trpc
```

### Step 2: Pull Images from GHCR

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull images
docker-compose pull
```

### Step 3: Deploy

```bash
# Start services
docker-compose up -d

# Verify health
docker-compose ps
docker-compose logs
```

### Step 4: Run Database Migrations

**Important**: On first deployment, you must run database migrations to create the required tables:

```bash
docker exec pki-backend node /app/backend/dist/db/migrate.js
```

Expected output:
```
Running migrations...
Migrations folder: /app/backend/dist/db/migrations
Migrations completed successfully!
```

> **Note**: The production container only includes compiled JavaScript. The standard `pnpm db:migrate` command won't work. Always use the direct `node` command above.

### Step 5: Configure Reverse Proxy (Optional)

Example Nginx configuration for production:

```nginx
# /etc/nginx/sites-available/pki-manager
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Frontend
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /trpc {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Environment Configuration

### Required Variables

None! The stack runs with sensible defaults. However, you should customize for production.

### Available Variables

See [.env.example](.env.example) for full list. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_REPOSITORY_OWNER` | `pki-manager` | GitHub org/user for image naming |
| `IMAGE_TAG` | `latest` | Docker image tag to use |
| `BACKEND_EXTERNAL_PORT` | `3000` | Host port for backend API |
| `FRONTEND_EXTERNAL_PORT` | `8080` | Host port for frontend |
| `KMS_EXTERNAL_PORT` | `9998` | Host port for KMS |
| `NODE_ENV` | `production` | Node environment |
| `FRONTEND_URL` | `http://localhost:8080` | Frontend URL for CORS |
| `DATABASE_PATH` | `/app/backend/data/pki.db` | Database file path (in container) |
| `KMS_URL` | `http://kms:9998` | KMS service URL |
| `KMS_API_KEY` | _(empty)_ | Optional KMS authentication |
| `CRL_DISTRIBUTION_URL` | `http://localhost:3000/crl` | Public URL for CRL distribution points |
| `VITE_API_URL` | `http://localhost:3000/trpc` | API URL for frontend |

### OIDC Authentication Configuration

PKI Manager supports OpenID Connect (OIDC) authentication with any compliant provider (Keycloak, Auth0, Okta, Azure AD, etc.). Authentication is **optional** - leave OIDC variables unset to run without authentication.

#### Backend OIDC Variables

Add these to your `.env` file:

| Variable | Example | Description |
|----------|---------|-------------|
| `OIDC_ISSUER` | `https://keycloak.example.com/realms/pki` | OIDC provider base URL (must match token `iss` claim) |
| `OIDC_AUDIENCE` | `pki-web,pki-service` | Expected audience claim(s), comma-separated |
| `OIDC_ROLES_CLAIM` | `realm_access.roles` | JWT path to roles (provider-specific) |
| `OIDC_DISCOVERY_BASE_URL` | _(optional)_ | Override URL for fetching OIDC discovery (for Docker networking) |

**Provider-specific issuer URLs:**
- **Keycloak**: `https://keycloak.example.com/realms/your-realm`
- **Auth0**: `https://your-tenant.auth0.com`
- **Okta**: `https://your-org.okta.com`
- **Azure AD**: `https://login.microsoftonline.com/{tenant-id}/v2.0`

**Provider-specific roles claim paths:**
- **Keycloak**: `realm_access.roles`
- **Auth0**: `permissions` or custom namespace
- **Okta**: `groups`
- **Azure AD**: `roles`

#### Frontend OIDC Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_OIDC_AUTHORITY` | `https://keycloak.example.com/realms/pki` | Same as backend `OIDC_ISSUER` |
| `VITE_OIDC_CLIENT_ID` | `pki-web` | Public OIDC client ID (PKCE-enabled) |
| `VITE_OIDC_SCOPE` | `openid profile email` | OAuth2 scopes (optional, defaults shown) |

> **Important for Docker**: Frontend OIDC variables are **build-time only**. You must either:
> 1. Rebuild the image with `--build-arg VITE_OIDC_AUTHORITY=...` (requires Dockerfile modification), or
> 2. Use runtime config by mounting a custom `config.json` (see below)

#### Runtime OIDC Configuration (Docker)

For production Docker deployments, mount a custom `config.json` to configure OIDC without rebuilding:

```bash
# Create config.json with OIDC settings
cat > /opt/stacks/pki-manager/config.json << 'EOF'
{
  "apiUrl": "https://api.pki.example.com/trpc",
  "oidc": {
    "authority": "https://keycloak.example.com/realms/pki",
    "clientId": "pki-web",
    "scope": "openid profile email"
  }
}
EOF
```

Add the volume mount to `docker-compose.yml`:

```yaml
services:
  frontend:
    volumes:
      - ./config.json:/usr/share/nginx/html/config.json:ro
```

#### Keycloak Setup Example

For detailed step-by-step instructions with screenshots, see **[KEYCLOAK.md](KEYCLOAK.md)**.

**Quick summary:**

1. **Create a Realm** (e.g., `pki-manager`)

2. **Create a Client** for the SPA:
   - Client ID: `pki-web`
   - Client authentication: **Off** (public client)
   - Standard flow: **Enabled** (for PKCE)
   - Valid redirect URIs: `https://pki.example.com/*`
   - Web origins: `https://pki.example.com`

3. **Create a Client** for M2M (optional):
   - Client ID: `pki-service`
   - Client authentication: **On** (confidential)
   - Service accounts roles: **Enabled**

4. **Create a test user** with username and password

5. **Configure `.env`**:

```bash
# Backend
OIDC_ISSUER=https://keycloak.example.com/realms/pki-manager
OIDC_AUDIENCE=pki-web,pki-service
OIDC_ROLES_CLAIM=realm_access.roles

# Frontend (build-time or runtime)
VITE_OIDC_AUTHORITY=https://keycloak.example.com/realms/pki-manager
VITE_OIDC_CLIENT_ID=pki-web
```

#### Disabling Authentication

To run without authentication, simply leave the OIDC variables unset or empty:

```bash
# Backend - no OIDC_ISSUER = all endpoints public
# OIDC_ISSUER=

# Frontend - no VITE_OIDC_AUTHORITY = no login required
# VITE_OIDC_AUTHORITY=
```

### Secrets Management

**For production**, use Docker secrets or environment variable injection:

```yaml
# docker-compose.override.yml
services:
  backend:
    secrets:
      - kms_api_key
    environment:
      - KMS_API_KEY_FILE=/run/secrets/kms_api_key

secrets:
  kms_api_key:
    external: true
```

## GitHub Actions CI/CD

### Workflow Overview

The [`.github/workflows/docker-build.yml`](.github/workflows/docker-build.yml) workflow:

1. **Triggers**: On `main` branch pushes, tags (`v*.*.*`), and PRs
2. **Builds**: Both backend and frontend images
3. **Publishes**: Only to `ghcr.io` (never Docker Hub)
4. **Tags**: Semantic versioning, branch names, git SHA
5. **Security**: Trivy vulnerability scanning, SLSA attestation
6. **Multi-arch**: Builds for `linux/amd64` and `linux/arm64`

### Setup Requirements

1. **Enable GHCR**:
   - Go to repository Settings → Actions → General
   - Under "Workflow permissions", enable "Read and write permissions"

2. **Configure Variables** (Settings → Secrets and variables → Actions → Variables):
   - `VITE_API_URL`: Production API URL (e.g., `https://api.your-domain.com/trpc`)

3. **Create Release**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

### Published Image Tags

Images are published to:
- `ghcr.io/YOUR_ORG/pki-manager/backend:TAG`
- `ghcr.io/YOUR_ORG/pki-manager/frontend:TAG`

Available tags:
- `latest` - Latest main branch build
- `v1.0.0`, `v1.0`, `v1` - Semantic version tags
- `main-sha-abc123` - Branch + commit SHA
- `pr-123` - Pull request builds

## E2E Testing

PKI Manager includes comprehensive E2E tests for Role-Based Access Control (RBAC). Tests can run against a local Docker environment or production.

### E2E Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Host Machine                                  │
│  ┌────────────────┐                                                 │
│  │  Playwright    │ ──────────────────┐                             │
│  │  Test Runner   │                   │                             │
│  └────────────────┘                   ▼                             │
│         │                    localhost:8080 (Frontend)              │
│         │                    localhost:3000 (Backend API)           │
│         │                    localhost:8180 (Keycloak)              │
│         │                             │                             │
│  ═══════╪═════════════════════════════╪═════════════════════════    │
│         │          Docker Network     │                             │
│         ▼               (pki-e2e-network)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Frontend   │  │   Backend   │  │  Keycloak   │  │     KMS     │ │
│  │  (nginx)    │  │  (Node.js)  │  │   (OIDC)    │  │  (Cosmian)  │ │
│  │  :8080      │──│  :3000      │──│  :8080      │  │  :9998      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
│                          │                                          │
│                          └──── OIDC_DISCOVERY_BASE_URL ────┘        │
│                                (keycloak:8080)                      │
└─────────────────────────────────────────────────────────────────────┘
```

The backend uses `OIDC_DISCOVERY_BASE_URL` to fetch OIDC configuration from the Docker network (`keycloak:8080`) while validating tokens against the issuer URL that browsers use (`localhost:8180`).

### Local E2E Testing (Recommended)

The `docker-compose.e2e.yml` provides a complete isolated environment for testing:

```bash
# 1. Build images with latest code (if you made changes)
docker build --target backend -t ghcr.io/oriolrius/pki-manager-web/backend:latest -f docker/Dockerfile .
docker build --target frontend -t ghcr.io/oriolrius/pki-manager-web/frontend:latest -f docker/Dockerfile .

# 2. Start the E2E environment (includes Keycloak with pre-configured test users)
docker compose -f docker/docker-compose.e2e.yml up -d

# 3. Wait for all services to be healthy (~60-90 seconds for Keycloak)
docker compose -f docker/docker-compose.e2e.yml ps

# 4. Run the RBAC tests
pnpm playwright test tests/e2e-rbac.spec.ts --reporter=list

# 5. Cleanup when done
docker compose -f docker/docker-compose.e2e.yml down -v
```

### E2E Test Users

The E2E environment includes pre-configured test users in Keycloak:

| Username | Password | Role | Description |
|----------|----------|------|-------------|
| `testadmin` | `Test123!` | `admin` | Full access - can create, revoke, delete CAs and certificates |
| `testuser` | `Test123!` | `user` | Limited access - can view and issue certificates, cannot perform admin operations |

### E2E Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:8080 | PKI Manager UI |
| Backend API | http://localhost:3000 | tRPC API |
| Keycloak | http://localhost:8180 | Identity Provider (admin/admin for Keycloak console) |
| KMS | Internal only | Cosmian Key Management System |

### Production E2E Testing

To test against a production environment:

```bash
E2E_TARGET=production pnpm playwright test tests/e2e-rbac.spec.ts --reporter=list
```

Or with custom URLs:

```bash
E2E_FRONTEND_URL=https://pki.example.com \
E2E_ADMIN_USER=testadmin \
E2E_ADMIN_PASSWORD=Test123! \
pnpm playwright test tests/e2e-rbac.spec.ts
```

### E2E Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_TARGET` | `local` | Target environment: `local` or `production` |
| `E2E_FRONTEND_URL` | (from target) | Override frontend URL |
| `E2E_ADMIN_USER` | `testadmin` | Admin test user |
| `E2E_ADMIN_PASSWORD` | `Test123!` | Admin password |
| `E2E_TEST_USER` | `testuser` | Regular test user |
| `E2E_TEST_PASSWORD` | `Test123!` | Regular user password |

## Troubleshooting

### Build Failures

**Problem**: TypeScript compilation errors during build

**Solution**: Ensure TypeScript type errors are fixed in the codebase:
```bash
cd backend && pnpm typecheck
```

### Image Pull Failures

**Problem**: Cannot pull from ghcr.io

**Solution**:
```bash
# Create personal access token with packages:read scope
# Then login:
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

### Service Health Issues

**Check service health**:
```bash
docker-compose ps
docker inspect pki-backend --format='{{.State.Health.Status}}'
```

**View detailed logs**:
```bash
docker-compose logs backend
docker-compose logs frontend
docker-compose logs kms
```

### Database Issues

**Problem**: Database locked or corrupted

**Solution**:
```bash
# Stop services
docker-compose down

# Remove volume (⚠️ deletes data)
docker volume rm pki-backend-data

# Restart
docker-compose up -d
```

### KMS Connection Issues

**Problem**: Backend cannot connect to KMS

**Check network**:
```bash
docker-compose exec backend ping kms
docker-compose exec backend wget -O- http://kms:9998/version
```

**Verify KMS is healthy**:
```bash
docker-compose ps kms
```

### Port Conflicts

**Problem**: Port already in use

**Solution**: Change ports in `.env`:
```bash
BACKEND_EXTERNAL_PORT=3001
FRONTEND_EXTERNAL_PORT=8081
KMS_EXTERNAL_PORT=9999
```

### E2E Test Failures

**Problem**: "no such table: audit_log" error

**Solution**: Database migrations didn't run. The E2E docker-compose automatically runs migrations on startup. If using a custom setup:
```bash
docker exec pki-e2e-backend node /app/backend/dist/db/migrate.js
```

**Problem**: OIDC token validation fails in Docker

**Solution**: Ensure `OIDC_DISCOVERY_BASE_URL` is set for Docker networking:
```yaml
# docker-compose.e2e.yml
environment:
  - OIDC_ISSUER=http://localhost:8180/realms/pki-e2e
  - OIDC_DISCOVERY_BASE_URL=http://keycloak:8080/realms/pki-e2e
```

**Problem**: Keycloak healthcheck fails (timeout)

**Solution**: Keycloak 26+ takes ~60-90 seconds to start. The healthcheck has a 90-second start period. Check logs:
```bash
docker logs pki-e2e-keycloak
```

**Problem**: Tests fail with "Login button not found"

**Solution**: Wait for all services to be healthy before running tests:
```bash
docker compose -f docker/docker-compose.e2e.yml ps
# All services should show "healthy" status
```

### Production Configuration

**Security Checklist**:
- [ ] Run database migrations: `docker exec pki-backend node /app/backend/dist/db/migrate.js`
- [ ] Set `NODE_ENV=production`
- [ ] Configure `FRONTEND_URL` with production domain
- [ ] Set strong `KMS_API_KEY`
- [ ] Configure OIDC authentication (see [OIDC Configuration](#oidc-authentication-configuration))
- [ ] Use HTTPS with reverse proxy
- [ ] Configure firewall rules
- [ ] Set up backup strategy for volumes
- [ ] Enable Docker restart policies (already configured)
- [ ] Monitor resource limits
- [ ] Review security scan results

## Resource Requirements

### Minimum

- CPU: 2 cores
- RAM: 4GB
- Disk: 10GB

### Recommended (Production)

- CPU: 4+ cores
- RAM: 8GB+
- Disk: 50GB+ (SSD)

### Resource Limits

Configured in `docker-compose.yml` (can be customized):

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

## Backup and Restore

### Backup

```bash
# Backup database
docker-compose exec backend tar czf - /app/backend/data | \
  gzip > backup-$(date +%Y%m%d).tar.gz

# Or backup volume directly
docker run --rm \
  -v pki-backend-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/db-backup.tar.gz -C /data .
```

### Restore

```bash
# Restore from backup
docker run --rm \
  -v pki-backend-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/db-backup.tar.gz -C /data
```

## Monitoring

### Health Checks

All services include health checks:

```bash
# Check overall health
docker-compose ps

# Test endpoints
curl http://localhost:3000/health  # Backend
curl http://localhost:8080/health  # Frontend
curl http://localhost:9998/version # KMS
```

### Logs

```bash
# Follow all logs
docker-compose logs -f

# Follow specific service
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100

# Export logs
docker-compose logs > logs-$(date +%Y%m%d).txt
```

## Support

For issues or questions:
- GitHub Issues: [https://github.com/YOUR_ORG/pki-manager/issues](https://github.com/YOUR_ORG/pki-manager/issues)
- Documentation: [README.md](README.md)
- Project Instructions: [CLAUDE.md](CLAUDE.md)
