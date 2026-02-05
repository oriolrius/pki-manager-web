---
id: decision-006
title: 006 - External Service Certificate Integration via Shared Volume Pattern
date: '2025-10-30 15:22'
status: proposed
---

# Context

External services like MQTT brokers (Mosquitto), web servers (Nginx), or IoT gateways need to consume X.509 certificates managed by PKI Manager. These services require:

1. **Initial certificate provisioning** at deployment time
2. **Automatic certificate renewal** before expiration
3. **Graceful reload** without service downtime
4. **Secure access** to private keys
5. **Simple configuration** using environment variables

The integration must work within Docker Compose environments without requiring complex orchestration tools like Kubernetes.

## Problem Statement

How can external services consume PKI Manager certificates in a way that:
- Supports automatic renewal before expiration
- Maintains security (no unnecessary privileges)
- Works with standard Docker Compose
- Requires minimal code changes to PKI Manager
- Avoids complex signal handling or IPC mechanisms

# Decision

Implement a **Shared Volume + Lightweight Sidecar** pattern:

```
┌─────────────────────────────────────────┐
│  PKI Manager Backend                    │
│  - Existing tRPC certificate.download   │
│  - Public CA endpoint: GET /cas/:id.pem │
└────────────────┬────────────────────────┘
                 │ HTTP/tRPC API
                 ▼
┌─────────────────────────────────────────┐
│  cert-exporter (sidecar service)        │
│  - Polls API every N hours              │
│  - Checks cert expiry threshold         │
│  - Downloads: CA + server cert + key    │
│  - Atomic writes to shared volume       │
│  - Configured via environment variables │
└────────────────┬────────────────────────┘
                 │ writes files
                 ▼
┌─────────────────────────────────────────┐
│  Docker Volume: cert-exports            │
│  /ca.crt, /server.crt, /server.key      │
└────────────────┬────────────────────────┘
                 │ mounted read-only
                 ▼
┌─────────────────────────────────────────┐
│  Mosquitto / Nginx / Other Service      │
│  - References /certs/* in config        │
│  - Auto-reloads on file change (inotify)│
└─────────────────────────────────────────┘
```

## Architecture Components

### 1. Certificate Exporter Service

**Purpose:** Lightweight Node.js/TypeScript service that bridges PKI Manager → external services

**Responsibilities:**
- Poll PKI Manager API on configurable interval (e.g., every 6 hours)
- Query certificate expiration dates
- Download certificates when renewal threshold reached (e.g., 30 days before expiry)
- Write certificates to shared volume using atomic operations
- Log all operations for audit trail

**Configuration (via environment variables):**
```bash
PKI_MANAGER_URL=http://backend:3000
CA_ID=root-ca-abc123
CERT_ID=mosquitto-server-xyz789
CHECK_INTERVAL_HOURS=6
RENEWAL_THRESHOLD_DAYS=30
OUTPUT_DIR=/exports
```

**Implementation Notes:**
- ~100-150 lines of TypeScript
- Uses existing tRPC client types (type-safe)
- Atomic file writes: write to `.tmp` → rename (prevents partial reads)
- Graceful error handling with exponential backoff
- Health check endpoint for Docker HEALTHCHECK

### 2. Shared Docker Volume

**Purpose:** Secure file transfer between cert-exporter and consuming services

**Security model:**
- cert-exporter: read-write access
- Consuming services (Mosquitto): read-only access
- Volume isolated to Docker network
- No host filesystem exposure

**Docker Compose definition:**
```yaml
volumes:
  cert-exports:
    driver: local
```

### 3. Consuming Service Configuration

**Example: Mosquitto MQTT Broker**

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2.0
    volumes:
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - cert-exports:/mosquitto/certs:ro  # Read-only mount
    networks:
      - pki-network
    ports:
      - "8883:8883"
```

**mosquitto.conf:**
```conf
listener 8883
protocol mqtt

# Certificates managed by cert-exporter
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key

# Mosquitto 2.0+ auto-reloads on file change (inotify)
require_certificate true
```

### 4. Environment-Based Configuration

**.env file:**
```bash
# PKI Manager API
PKI_MANAGER_URL=http://backend:3000

# Mosquitto Server Certificate
MOSQUITTO_CA_ID=root-ca-abc123
MOSQUITTO_SERVER_CERT_ID=mosquitto-server-xyz789

# Renewal Policy
CERT_CHECK_INTERVAL_HOURS=6
CERT_RENEWAL_THRESHOLD_DAYS=30
```

Users configure certificate mappings by editing `.env` and restarting the cert-exporter service.

# Alternatives Considered

## 1. Docker Secrets

**Approach:** Use Docker's native secrets management

```yaml
services:
  mosquitto:
    secrets:
      - mosquitto_server_cert
      - mosquitto_server_key

secrets:
  mosquitto_server_cert:
    external: true
```

**Rejection reason:** Docker secrets are **immutable**. To rotate certificates:
- Must create new secret with different name
- Update service definition to reference new secret
- Redeploy service
- Remove old secret

This doesn't support automatic renewal without orchestration changes.

## 2. Docker Configs (Compose 3.3+)

**Approach:** Similar to secrets but for configuration files

**Rejection reason:** Also **immutable** in Docker Compose. Only supports versioning in Swarm mode.

## 3. Direct API Integration

**Approach:** Mosquitto/Nginx fetches certificates directly from PKI Manager API

**Rejection reason:**
- Requires code changes to each consuming service
- Not possible for third-party services (Mosquitto, Nginx)
- Adds complexity to service configuration
- Breaks separation of concerns

## 4. Signal-Based Reload (Shared PID Namespace)

**Approach:** Sidecar sends SIGHUP to Mosquitto process after updating certs

```yaml
services:
  mosquitto:
    pid: "shareable"
  cert-exporter:
    pid: "service:mosquitto"
```

**Rejection reason:**
- Adds complexity (PID namespace sharing)
- Requires finding process ID (`pidof mosquitto`)
- Modern services (Mosquitto 2.0+, Nginx) support inotify auto-reload
- File-based pattern is simpler and more portable

## 5. Docker Socket Access

**Approach:** Mount Docker socket in sidecar, use Docker API to send signals

```yaml
cert-exporter:
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

**Rejection reason:**
- **Security risk**: Docker socket provides root-level access to host
- Overly privileged for certificate management
- Unnecessary when file-based reload works
- Harder to secure in production

## 6. Custom Docker Volume Plugin

**Approach:** Build Docker volume driver that fetches from PKI Manager on-demand

```yaml
volumes:
  pki-certs:
    driver: pki-manager-volume-driver
    driver_opts:
      api_url: http://backend:3000
      cert_id: mosquitto-server-xyz789
```

**Rejection reason:**
- High complexity (requires Go plugin development)
- Harder to debug and maintain
- Not portable across Docker versions
- Overkill for certificate delivery

# Consequences

## Positive

✅ **Zero changes to PKI Manager core** - uses existing tRPC API
✅ **Automatic certificate renewal** - polling + threshold detection
✅ **Graceful reloads** - Mosquitto/Nginx auto-detect file changes (no downtime)
✅ **Type-safe integration** - TypeScript + tRPC client types
✅ **Audit trail** - all certificate downloads logged in PKI Manager
✅ **Secure by default** - read-only mounts, isolated Docker network
✅ **Simple configuration** - environment variables for cert IDs
✅ **Reusable pattern** - works for any service needing certs
✅ **No privileged access** - no Docker socket or PID sharing needed
✅ **Easy maintenance** - change cert ID in .env, restart exporter

## Negative

⚠️ **Additional service** - cert-exporter adds one more container
⚠️ **Polling overhead** - API calls every N hours (minimal impact)
⚠️ **Delayed renewal** - not instant (depends on polling interval)
⚠️ **Service compatibility** - requires service that supports file-based reload or SIGHUP
⚠️ **Environment variable sprawl** - one set per consuming service

## Trade-offs

- **Polling vs. Webhooks:** Polling is simpler to implement; webhooks would require PKI Manager changes and network configuration
- **Shared volume vs. Direct API:** Shared volume is more secure (consuming service never has API access)
- **Sidecar vs. Init container:** Sidecar supports runtime renewal; init container only handles startup

# Implementation Notes

## Directory Structure

```
pki-manager/
├── cert-exporter/               # NEW: Sidecar service
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── index.ts            # Main polling loop
│   │   ├── pki-client.ts       # tRPC client wrapper
│   │   ├── file-writer.ts      # Atomic file operations
│   │   └── health.ts           # Health check endpoint
│   └── tsconfig.json
├── docker/
│   └── docker-compose.yml      # UPDATED: Add cert-exporter + mosquitto
├── examples/
│   └── mosquitto/              # NEW: Reference configuration
│       ├── mosquitto.conf
│       └── .env.example
└── backlog/
    └── decisions/
        └── decision-006...     # This document
```

## Code Size Estimate

- `cert-exporter` service: ~150 lines TypeScript
- Docker Compose additions: ~30 lines YAML
- Mosquitto example config: ~20 lines
- Total new code: **~200 lines**

## Testing Strategy

1. **Unit tests:** File writer atomic operations, API client error handling
2. **Integration tests:** Full flow with test PKI Manager instance
3. **Manual testing:** Deploy Mosquitto + cert-exporter, verify:
   - Initial certificate fetch
   - File permissions (read-only for Mosquitto)
   - Renewal before expiry
   - Mosquitto reload without downtime
   - Error handling (API down, invalid cert ID)

## Security Considerations

- **Principle of least privilege:** Consuming services get read-only volume access
- **No credentials in code:** Certificate IDs in environment variables
- **Audit logging:** All downloads logged via existing PKI Manager audit system
- **Network isolation:** Services communicate only within `pki-network`
- **Private key protection:** Keys written with 0600 permissions, only root in container

## Future Enhancements

1. **Webhook support:** PKI Manager pushes renewal events (eliminates polling)
2. **Metrics endpoint:** Prometheus metrics for monitoring cert expiry
3. **Multiple certificate profiles:** Support dev/staging/prod certs in one exporter
4. **Notification system:** Slack/email alerts on renewal failures
5. **Certificate templates:** Pre-configured templates for common services
6. **Health checks:** Verify cert validity, not just file presence

## Related Decisions

- [decision-001](decision-001%20-%20PKI-Manager-Technology-Stack-and-Architecture.md): tRPC API architecture
- [decision-002](decision-002%20-%20Cosmian-KMS-Integration-Implementation.md): Certificate storage in KMS
- [decision-004](decision-004%20-%20Minimal-Schema-Architecture-for-Certificate-Storage.md): Database schema

## References

- Mosquitto TLS configuration: https://mosquitto.org/man/mosquitto-conf-5.html
- Docker Compose secrets: https://docs.docker.com/compose/use-secrets/
- Docker volumes: https://docs.docker.com/storage/volumes/
- PKI Manager tRPC API: [backend/src/trpc/router.ts](../../backend/src/trpc/router.ts)

