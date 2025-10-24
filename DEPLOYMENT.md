# PKI Manager - Docker Deployment Guide

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Local Development with Docker](#local-development-with-docker)
- [Production Deployment](#production-deployment)
- [Environment Configuration](#environment-configuration)
- [GitHub Actions CI/CD](#github-actions-cicd)
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

### Step 4: Configure Reverse Proxy (Optional)

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
| `VITE_API_URL` | `http://localhost:3000/trpc` | API URL for frontend |

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

## Troubleshooting

### Build Failures

**Problem**: TypeScript compilation errors during build

**Solution**: Ensure TypeScript type errors are fixed in the codebase:
```bash
cd backend && pnpm typecheck
```

###Image Pull Failures

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

### Production Configuration

**Security Checklist**:
- [ ] Set `NODE_ENV=production`
- [ ] Configure `FRONTEND_URL` with production domain
- [ ] Set strong `KMS_API_KEY`
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
