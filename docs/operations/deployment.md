# Docker deployment

Reference for running the published images in production. For a first install, follow
[Install PKI Manager and log in](../get-started/install.md): it is shorter and every step was run.
To build the images from source, see [CI and releases](../development/ci.md).

## Overview

PKI Manager uses Docker for containerized deployment with the following components:

- **Backend**: Fastify + tRPC API server (Node.js 22 Alpine)
- **Frontend**: React SPA served by Nginx (Alpine)
- **KMS**: Cosmian Key Management System (official image)

All images are published exclusively to **GitHub Container Registry (ghcr.io)**.

> Deploying the **SSH Certificate Manager** to real servers? See the SSH guides:
> [concept](../ssh/concept.md) · [host & client setup](../ssh/setup.md) ·
> [Ansible role](../../ansible/README.md). Hosts need NTP and outbound access to the
> public trust/KRL endpoints (`/ssh/...`, `/krl/<caId>.bin`).

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- (Optional) `.env` file for custom configuration

## Production Deployment

### Step 1: Prepare Environment

Create a `.env` file with production values:

```bash
# Image: a release tag (tags have no leading "v"). "latest" changes under you.
IMAGE_TAG=3.17.0

# Host ports
BACKEND_EXTERNAL_PORT=3000
FRONTEND_EXTERNAL_PORT=80

# Backend
NODE_ENV=production
# Written into every certificate you issue: set it before the first CA.
CRL_DISTRIBUTION_URL=https://your-domain.com/crl

# KMS
KMS_URL=http://kms:9998
KMS_API_KEY=your-secure-api-key  # Optional
```

The browser needs the URL of the API. Set it in `docker/config.json`, which the Compose file
mounts into the frontend container:

```json
{
  "apiUrl": "https://your-domain.com/trpc"
}
```

`docker/config.json` is the only run-time setting of the web UI. The frontend container does not
read environment variables. `VITE_API_URL` is a build argument: it sets the default that is
compiled into a frontend image that you build yourself, and `apiUrl` overrides it. The published
images have the default `http://localhost:3000/trpc`.

The origins in this file also set the CSP of the web UI: see
[Security headers of the frontend container](#security-headers-of-the-frontend-container).

When the browser calls the API on another origin (for example the UI on `:8080` and the API on
`:3000`), set `FRONTEND_URL` to the origin of the UI. See
[Browser origins (`FRONTEND_URL`)](#browser-origins-frontend_url).

### Step 2: Pull Images from GHCR

The images are public: no login is needed.

```bash
docker compose pull
```

### Step 3: Deploy

```bash
# Start services from the published images
docker compose up -d --no-build --wait

# Verify health
docker compose ps
docker compose logs
```

### Step 4: Database Migrations

The backend container entrypoint (`docker/docker-entrypoint.sh`) runs the database
migrations automatically on every start, so no manual step is needed. To run them
by hand (for example to inspect the output):

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

### Client IPs behind a reverse proxy (`TRUST_PROXY`)

Behind a proxy, the backend sees the proxy as the client, so every audit row
(`audit_log.ip_address`) and every per-IP limit (KRL fetches, the anonymous
external-API rejection budget) uses the proxy's address. Set `TRUST_PROXY` on
the backend to the addresses of the proxies that forward to it, so it takes
the client IP from `X-Forwarded-For`:

| Value | Meaning |
|---|---|
| _unset_ / `false` | Ignore proxy headers (default; correct when clients connect directly) |
| `10.222.35.0/24,172.18.0.5` | Trust only these peers (IPs/CIDRs; also `loopback`, `linklocal`, `uniquelocal`). **Recommended** |

Numeric hop counts cannot identify the trusted peer. Replace them with proxy IPs or CIDRs.
The backend rejects hop counts, `true` and malformed entries. It
fails at startup instead of silently ignoring a typo. List **every** proxy hop
that can reach the backend: e.g. the edge proxy's network **and** the frontend
nginx, which also forwards `/cas/*`, `/krl/*` and `/ssh/zones/*`. Each proxy
must send `X-Forwarded-For $proxy_add_x_forwarded_for` (the example above and
`docker/nginx.conf` do). Never list networks whose other containers are untrusted:
any listed peer can choose the recorded client IP.

Check it: make a request that will be rejected, such as
`curl https://your-domain.com/api/v1/external/health` without a token, then look
at the newest `external.reject` row in the audit log. Its IP must be your
public address, not a Docker network address.

### Browser origins (`FRONTEND_URL`)

`FRONTEND_URL` is the list of browser origins that can call the API from another origin (CORS).
The backend sends CORS headers only to these origins.

| Value | Meaning |
|---|---|
| _unset_ / empty | Every origin can call the API (the Compose default, and the behaviour of 3.17.0 and earlier) |
| `http://localhost:8080` | Only the web UI on this origin. Use it with the two-port model (UI `:8080`, API `:3000`) |
| `https://pki.example.com,https://admin.example.com` | Comma-separated list of origins |

Each entry is an origin: scheme, host and optional port, with no path. An invalid entry stops the
backend at startup. When one proxy serves the UI and the API on one origin (`"apiUrl": "/trpc"`),
set `FRONTEND_URL` to that origin. CORS does not replace the login: it only controls which web
pages can read the API responses. Clients that send no `Origin` header (the CLI, scripts, the
Kubernetes issuer, the SCEP gateway) are not affected.

## Single-Origin Edge Proxy & the `/ssh/*` Namespace Collision

> **Read this if you serve the SPA and the backend on ONE origin** (one
> host/port behind a single reverse proxy or ingress — e.g. `https://pki.example.com`),
> rather than the two-port model (`:8080` frontend, `:3000` backend) used by the
> default compose file.

### The collision

`/ssh/*` is claimed by **both** layers:

- The **frontend SPA** owns `/ssh/*` as a UI URL namespace — TanStack Router pages
  such as `/ssh/cas`, `/ssh/hosts`, `/ssh/krl`, `/ssh/users`, `/ssh/principals`.
- The **backend** serves **public, unauthenticated trust material** at the server
  ROOT under `/ssh/...` (plus `/krl/...`, `/crl/...`, `/cas/....pem`) — the files
  that hosts, the Ansible role, and `krl-client` fetch.

With a naive single-origin edge (SPA fallback catching everything, or the frontend
container serving `/` with no backend proxy), `GET /ssh/host-ca-keys` returns the
SPA's `index.html` instead of the CA key material. Symptom observed in production:
`/health` and `/crl/*` reach the backend, but `/ssh/host-ca-keys` returns
`<!doctype html>`. The two-port compose model hides this because the backend and
frontend are different origins.

### The fix (already applied to `docker/nginx.conf`)

The frontend container's nginx is now a single-origin edge proxy: it proxies the
**specific backend-owned paths** to `http://backend:3000` and lets everything else
(including the SPA's own `/ssh/cas`, `/ssh/hosts`, ... UI routes) fall through to
the SPA. The proxy `location` blocks are placed **before** the `location /` SPA
fallback; nginx evaluates regex locations (in order) ahead of the prefix fallback,
so the specific backend `/ssh/...` paths win while the SPA keeps the rest. This is
purely a proxy/routing change — the backend routes are unchanged, so external
consumers (Ansible role, `krl-client`) keep working against the same paths.

Backend-owned paths that MUST be routed to the backend:

| Path pattern | What it serves |
|---|---|
| `/api/` (prefix) | REST + OpenAPI/Swagger API |
| `/trpc` (prefix) | tRPC endpoint (frontend RPC) |
| `^/crl/` | Public CRL downloads (`/crl/<caId>.crl\|.der`) |
| `^/cas/[^/]+\.(pem\|crt\|cer\|der)$` | Public CA-certificate downloads |
| `^/krl/` | Public SSH KRL (`/krl/<caId>.bin\|.json`, `/krl/hosts/<id>.bin\|.json`) |
| `^/ssh/zones/[^/]+/(host-ca-keys\|trusted-user-ca-keys\|cert-authority)$` | Zone-scoped SSH trust anchors |
| `^/ssh/(host-ca-keys\|trusted-user-ca-keys\|cert-authority)$` | SSH trust anchors + known_hosts lines (default zone) |
| `^/ssh/cas/[^/]+/ca\.pub$` | A single SSH CA's public key |
| `^/ssh/hosts/[^/]+/(cert\.pub\|sshd-config)$` | A host's cert + sshd drop-in |

Everything **not** matched above (`/`, `/assets/*`, `/ssh/cas`, `/ssh/hosts`,
`/ssh/krl`, `/ssh/users`, ...) is served by the SPA. The container's local
`/health` (used by the frontend healthcheck) stays local.

The exact nginx rules (standard `proxy_set_header Host/X-Real-IP/X-Forwarded-For/X-Forwarded-Proto`
headers included) live in [`docker/nginx.conf`](../../docker/nginx.conf). For a
single-origin deployment, point the SPA at the same origin by setting
`"apiUrl": "/trpc"` in `docker/config.json` (so the browser hits the edge, not `:3000` directly).

### Verify

```bash
docker compose -f docker/docker-compose.yml up -d
# Backend trust material through the single origin (NOT HTML):
curl -s http://localhost:8080/ssh/host-ca-keys | head        # -> ssh-...-ca key line(s)
curl -s http://localhost:8080/krl/<caId>.bin -o /dev/null -w '%{content_type}\n'  # -> application/octet-stream
curl -s http://localhost:8080/crl/<caId>.crl | head -1       # -> -----BEGIN X509 CRL-----
# SPA still owns its UI routes (IS HTML):
curl -s http://localhost:8080/ssh/cas | head -1              # -> <!doctype html>
```

### Using a different edge proxy (Traefik / Caddy / Kubernetes ingress)

If you terminate on something other than this nginx (Traefik, Caddy, HAProxy, an
ingress controller, a cloud LB), you **must replicate the same path routing** to
the backend, or the `/ssh/*` trust-material routes will be shadowed by the SPA
again. Route the nine path patterns in the table above to the backend service
(`backend:3000`) and send everything else to the frontend. Sketches:

**Caddy**

```caddyfile
pki.example.com {
    @backend {
        path /api/* /trpc*
        path /crl/* /krl/*
        path_regexp cas ^/cas/[^/]+\.(pem|crt|cer|der)$
        path /ssh/host-ca-keys /ssh/trusted-user-ca-keys /ssh/cert-authority
        path_regexp sshzone ^/ssh/zones/[^/]+/(host-ca-keys|trusted-user-ca-keys|cert-authority)$
        path_regexp sshpub ^/ssh/cas/[^/]+/ca\.pub$
        path_regexp sshhost ^/ssh/hosts/[^/]+/(cert\.pub|sshd-config)$
    }
    reverse_proxy @backend backend:3000
    reverse_proxy frontend:8080
}
```

**Traefik / ingress** — create a higher-priority router/rule matching those exact
paths/regexes to the backend service, and a default (lower priority) router to the
frontend. In Kubernetes, use `Exact`/`ImplementationSpecific` path types (or a
regex-capable ingress) for the `/ssh/...`, `/krl/`, `/crl/`, `/cas/....pem`, `/api/`,
and `/trpc` routes to the backend Service, with a catch-all `/` to the frontend.

## Security headers of the frontend container

The nginx of the frontend container adds these headers to every response, also to the
error responses:

| Header | Value |
|---|---|
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-XSS-Protection` | `0` (turns off the legacy XSS filter of old browsers, as OWASP recommends) |

The files that nginx serves itself (the SPA routes, `index.html`, `silent-renew.html`,
`config.json`, `/assets/*`, `/health`) also get this `Content-Security-Policy`:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
font-src 'self' data:; connect-src 'self' <origins>; frame-src 'self' <origins>;
frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'
```

- `script-src 'self'`: the pages load only `/assets/*.js`. There is no inline script and no eval.
- `style-src 'unsafe-inline'`: the UI sets inline styles (React `style` attributes).
- `frame-ancestors 'self'`: only the same origin can frame the pages. The app frames its own
  `/silent-renew.html` for the OIDC silent renewal.
- `<origins>`: the API and the OIDC provider can be on other origins. At start, the image
  entrypoint (`docker/nginx/csp-sources.sh`) allows every `http(s)://host[:port]` origin that it
  finds in `config.json` (`apiUrl`, `oidc.authority`). With no `apiUrl`, it allows the origin of
  the API URL built into the image (`VITE_API_URL` at build time). The startup log shows the
  result (`CSP connect-src/frame-src: ...`).
- To allow more origins (for example an OIDC token endpoint on a host other than the authority),
  list them in `config.json`. The web UI ignores this key:

  ```json
  { "apiUrl": "/trpc", "oidc": { "authority": "https://id.example.com/realms/pki" },
    "cspSources": ["https://sso.example.com"] }
  ```

The proxied backend paths (`/api/`, `/trpc`, `/crl/`, `/cas/`, `/krl/`, `/ssh/...`) get the four
headers of the table but not this CSP: the backend sets its own CSP on the pages that it serves
(Swagger UI at `/api/docs`).

The headers are in `docker/nginx/security-headers.conf` and `docker/nginx/security-headers-csp.conf`.
nginx inherits `add_header` only into a `location` that has no `add_header` of its own, so each such
`location` of `docker/nginx.conf` includes one of these files again.

Check a running container:

```bash
curl -sI http://localhost:8080/ | grep -iE 'content-security|x-frame|nosniff|referrer'
```

`docker/check-security-headers.sh <image>` starts an image and checks the headers of `/`,
`/silent-renew.html`, an asset, `/health` and the proxied paths. CI runs it on each frontend build
(`docker-build.yml`).

If an edge proxy in front of the container adds the same headers, the browser gets them twice.
Two `Content-Security-Policy` headers apply together (the stricter result). Let one of them set
the headers.

## Environment Configuration

### Required Variables

None! The stack runs with sensible defaults. However, you should customize for production.

### Available Variables

See [docker/.env.example](../../docker/.env.example) for full list. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_TAG` | `latest` | Docker image tag to use |
| `BACKEND_EXTERNAL_PORT` | `3000` | Host port for backend API |
| `FRONTEND_EXTERNAL_PORT` | `8080` | Host port for frontend |
| `NODE_ENV` | `production` | Node environment |
| `FRONTEND_URL` | _(empty)_ | Browser origins allowed to call the API (CORS). Empty allows every origin ([details](#browser-origins-frontend_url)) |
| `DATABASE_PATH` | `/app/backend/data/pki.db` | Database file path (in container) |
| `KMS_URL` | `http://kms:9998` | KMS service URL |
| `KMS_API_KEY` | _(empty)_ | Optional KMS authentication |
| `CRL_DISTRIBUTION_URL` | `http://localhost:3000/crl` | Public URL for CRL distribution points |
| `TRUST_PROXY` | _(empty)_ | Reverse proxies allowed to set the client IP ([details](#client-ips-behind-a-reverse-proxy-trust_proxy)) |
| `ALLOW_CA_KEY_EXPORT` | `false` | When `true`, an `admin` may download a CA as a PKCS#12/JKS keystore (contains the CA private key); each export is audited as `ca.export_private_key`. When `false`, `GET /api/v1/cas/{id}/download?format=p12-keystore\|jks-keystore` returns `403 CA_KEY_EXPORT_DISABLED` and the UI hides those formats. A CA key also leaves the KMS, in memory only, to sign CRLs (decision-010). |
| `OIDC_DISCOVERY_BASE_URL` | _(empty)_ | Base URL to fetch the OIDC discovery document and the JWKS when the backend cannot reach `OIDC_ISSUER` ([OIDC login](oidc.md)) |
| `ALLOW_UNAUTHENTICATED_SSH_CA` | `false` | Allow the SSH CA operations with OIDC off. Local tests only |
| `SSH_ECIES_ENABLED` | `false` | Serve the ECIES-encrypted per-host KRL to `krl-client` |
| `SSH_HOST_KRL_SERVE` | `true` | `false` serves the per-CA KRL instead of the per-host KRL (rollback switch) |
| `SSH_HOST_KRL_PUBLIC` | `false` | Serve the per-host KRL with no token at `/krl/hosts/<id>.bin\|.json` |
| `SSH_BLOCK_ISSUANCE_GATE` | `false` | On user certificate issue, remove the principals that reach only hosts where the identity is blocked |
| `VITE_API_URL` | `http://localhost:3000/trpc` | Build argument of the frontend image only. At run time, set `apiUrl` in `docker/config.json` |

The defaults of the `SSH_*` switches are the backend defaults; the
[SSH API contract](../ssh/api-contract.md) describes them. The Compose file passes only the
variables that it lists. Another backend variable needs an override file:

```yaml
# docker/docker-compose.override.yml
services:
  backend:
    environment:
      - KRL_VALID_FOR_SECONDS=3600
```

The KMS runs in config-file mode (`COSMIAN_KMS_CONF`): it ignores its environment variables.
Set its port and log level (`[http] port`, `[logging] rust_log`) in `kms/kms.toml`. If you change
the port, change `KMS_URL` too. The Compose file does not publish the KMS port.

### Login (OIDC)

Login is optional and uses OIDC. The backend reads the `OIDC_*` variables from `.env`. The web UI
reads its part from `docker/config.json`. Both are described in one place:

- [OIDC login](oidc.md): variables, providers, roles, roles from UserInfo, and how to run without login.
- [Keycloak setup](keycloak.md): step by step, with screenshots.
- [Install and log in](../get-started/install.md#5-choose-how-people-log-in): the minimum to start.

### Secrets Management

**For production**, use Docker secrets or environment variable injection:

The backend reads `KMS_API_KEY` from its environment only (`*_FILE` variables are
not supported), so inject it from your secret store into the environment:

```yaml
# docker-compose.override.yml
services:
  backend:
    environment:
      - KMS_API_KEY=${KMS_API_KEY}
```

## Published images

Each release publishes these images to GitHub Container Registry (`ghcr.io`), and nowhere else:

| Image | What it is |
|---|---|
| `ghcr.io/oriolrius/pki-manager-web/backend` | API server |
| `ghcr.io/oriolrius/pki-manager-web/frontend` | Web UI (nginx) |
| `ghcr.io/oriolrius/pki-manager-web/scep` | Optional [SCEP gateway](../../scep/README.md) |
| `ghcr.io/oriolrius/pki-manager-issuer` | [cert-manager issuer](../guides/kubernetes.md) for Kubernetes |

Tags of the backend and frontend images:

- `latest` - Latest main branch build
- `1.0.0`, `1.0`, `1` - Semantic version tags (from `v1.0.0` tags, without the `v`)
- `main` - Latest build of a branch
- `sha-abc1234` - Commit SHA (short)
- `pr-123` - Pull request builds

## Troubleshooting

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
docker compose ps
docker inspect pki-backend --format='{{.State.Health.Status}}'
```

**View detailed logs**:
```bash
docker compose logs backend
docker compose logs frontend
docker compose logs kms
```

### Database Issues

**Problem**: Database locked or corrupted

**Solution**:
```bash
# Stop services
docker compose down

# Remove the bind-mounted data directory (⚠️ deletes data)
rm -rf ../pki

# Restart
docker compose up -d
```

### KMS Connection Issues

**Problem**: Backend cannot connect to KMS

**Check network**:
```bash
docker compose exec backend ping kms
docker compose exec backend wget -qO- http://kms:9998/health
```

**Verify KMS is healthy**:
```bash
docker compose ps kms
```

### Port Conflicts

**Problem**: Port already in use

**Solution**: Change ports in `.env`:
```bash
BACKEND_EXTERNAL_PORT=3001
FRONTEND_EXTERNAL_PORT=8081
```

## Production checklist

- [ ] Check the migrations ran (the backend entrypoint runs them): `docker compose logs backend`
- [ ] Set `NODE_ENV=production`
- [ ] Set `CRL_DISTRIBUTION_URL` to a URL that clients can reach, before the first CA
- [ ] Set `apiUrl` in `docker/config.json` to the public API URL
- [ ] Set strong `KMS_API_KEY`
- [ ] Configure OIDC authentication (see [OIDC login](oidc.md))
- [ ] Use HTTPS with reverse proxy
- [ ] Configure firewall rules
- [ ] Set up backup strategy for volumes
- [ ] Enable Docker restart policies (already configured)
- [ ] Monitor resource limits
- [ ] Review security scan results

## Resource limits

Not set in `docker/docker-compose.yml`; add them in an override file if needed:

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

## Optional SCEP gateway (separate deployment)

The [SCEP gateway](../../scep/README.md) is a separate device-facing service. Deploy
the integration foundation (migration 0010) first; the gateway needs its integration token and external enrollment-state
endpoints. It adds no second backend. Use `scep/compose.yml` for an existing
installation or the `docker/docker-compose.scep.yml` overlay for the full stack.

## Upgrades

- Read the [release notes](../../CHANGELOG.md) before each upgrade. A release that needs a manual step says so.
- The backend applies the database migrations when it starts. Make a [backup](#backup-and-restore) first.
- Runbooks for the upgrades that need care: [migration 0009 (SSH zones)](migration-0009.md),
  [migration 0010 (integrations)](migration-0010.md) and the KMS upgrade below.

### KMS upgrade: backup before recreating the container

**Do not pull/recreate the KMS before locating and backing up its database.**
The historical `/root/cosmian-kms` mount may not contain the actual SQLite files.
The 5.12 container may have stored them only in its writable layer. Recover them
from that still-existing container; a new empty volume does not recover CA keys.

1. Stop gateways/controllers and backend writers. Record the deployed KMS image
   digest, container name, complete configuration, and mounts. Read the startup
   log's actual `main_db_params` SQLite path. Depending on image/configuration,
   paths can be `/cosmian-kms/sqlite-data`, `/var/lib/cosmian-kms/sqlite-data`, or
   another configured path. Do not assume the historical mount was effective.
2. Stop the KMS **without removing its container**. Make a protected, offline copy
   of the entire database directory, including WAL/SHM and all database files:

   ```sh
   # Substitute the real container name and data path found above.
   set -eu
   kms_old_container=pki-kms
   kms_old_data_path=/actual/path/from/kms-startup-log
   kms_backup_dir=/secure/backups/kms-before-524
   test ! -e "$kms_backup_dir"
   mkdir -m 700 "$kms_backup_dir"
   docker stop "$kms_old_container"
   docker cp "$kms_old_container:$kms_old_data_path/." "$kms_backup_dir/"
   ```

   Keep the old container and original data untouched until the upgrade passes.
   Verify the backup contains the existing DB, not an empty directory. Retain
   the matching PKI backend database backup as well.
3. Copy the backup into a **new staging data directory/volume**, preserving file
   ownership and permissions. Test 5.28 against that copy first. Do not point it
   at the only copy of your 5.12 DB. The full-stack Compose now maps `../kms/data`
   to `/cosmian-kms/sqlite-data`, mounts `../kms/kms.toml` at
   `/etc/cosmian/kms.toml`, and sets `COSMIAN_KMS_CONF` to that file, matching the
   configuration-file approach of `kms/docker-compose.yml`. For another data
   volume, adjust only the source side of the mount.
4. `kms.toml` uses the 5.28 `[db] database_type/sqlite_path` fields with absolute
   paths, `[http]`, and `[workspace]`. The old `[database] type/path` fields are
   ignored by the tested image. In config-file mode the TOML takes precedence
   over server/database environment settings; edit the TOML for another port.
5. Confirm the new startup log names the mounted directory, verify existing CA
   certificate retrieval and issuance, and check RA Activate/Sign/Decrypt before
   resuming writers. Test that data survives container recreation against the
   staging volume. Live Intune/device acceptance remains separate.
6. If checks fail, stop the new KMS and return to the recorded old image and
   **untouched old data**, not the staging copy. Coordinate backend rollback
   with its pre-upgrade DB backup. Never delete the old CA keys as a repair step.

## Backup and Restore

All state is in two folders next to `docker/`:

| Folder | Content |
|---|---|
| `pki/` | The SQLite database: CAs, certificates, audit log, and the ids of the KMS keys |
| `kms/data/` | The KMS database: the private keys |

Back up both together. The database holds the ids of keys that exist only in the KMS, so one
folder without the other is not a complete backup.

### Backup

Stop the stack first. The database uses write-ahead logging (WAL): a copy of `pki.db` taken
while the backend runs can be incomplete.

```bash
cd docker
docker compose stop
# use sudo when your user cannot read the folders (pki/ belongs to uid 1001)
sudo tar czf pki-backup-$(date +%Y%m%d).tar.gz -C .. pki kms/data
docker compose start
```

The archive contains the CA private keys. Keep it as safe as the KMS itself.

### Restore

Restore both folders from the same archive, with the stack stopped:

```bash
cd docker
docker compose down
# keep the current folders until the restore is checked
sudo mv ../pki ../pki.before-restore && sudo mv ../kms/data ../kms/data.before-restore
sudo tar xzf pki-backup-YYYYMMDD.tar.gz -C ..
docker compose up -d --no-build --wait
```

## Monitoring

### Health Checks

The backend and frontend containers have health checks. The KMS container has none in this Compose file.

```bash
# Check overall health
docker compose ps

# Test endpoints
curl http://localhost:3000/health  # Backend
curl http://localhost:8080/health  # Frontend
docker compose exec backend wget -qO- http://kms:9998/health  # KMS (not published to the host)
```

### Logs

```bash
# Follow all logs
docker compose logs -f

# Follow specific service
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100

# Export logs
docker compose logs > logs-$(date +%Y%m%d).txt
```

## Support

PKI Manager is a personal project. There is no commercial support and no guaranteed response
time: see [About this project](../about.md).

- Problems and questions: [GitHub Issues](https://github.com/oriolrius/pki-manager-web/issues).
- What changed in each version: [release notes](../../CHANGELOG.md).
