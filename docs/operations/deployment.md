# Docker deployment

Choose the procedure that matches the backend image and its Compose file.

| Installation | Key store | Procedure |
|---|---|---|
| OpenBao candidate, fresh installation | PKI Manager OpenBao fork with three Transit mounts | [Prepare, initialize and operate OpenBao](openbao.md), then use the proxy and OIDC settings below. Build the application images from the candidate checkout. |
| PKI Manager v3 release | Cosmian KMS | Use the matching v3 release checkout and the [v3 installation guide](../get-started/install.md). The v3 commands below use the Compose file in that checkout. |

For an existing v3 installation, retain both databases and test migration against a copy before any cutover. Starting a new key store does not recover v3 keys. For image builds, see [CI and releases](../development/ci.md).

## Overview

Both deployments run the Fastify backend and an nginx frontend. The backend image includes the SQLite migration tools. The OpenBao candidate also runs the OpenBao server and its AppRole Agent. The v3 stack runs the Cosmian service.

> Deploying the **SSH Certificate Manager** to real servers? See the SSH guides:
> [concept](../ssh/concept.md) · [host & client setup](../ssh/setup.md) ·
> [Ansible role](../../ansible/README.md). Hosts need NTP and outbound access to the
> public trust/KRL endpoints (`/ssh/...`, `/krl/<caId>.bin`).

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- (Optional) `.env` file for custom configuration

## Production deployment

### Step 1: Prepare the environment

For the OpenBao candidate, configure `docker/.env` and the key store using [Operate the OpenBao key store](openbao.md). Configure the public CRL URL and browser settings below for either deployment.

For **v3 only**, use the following example in `docker/.env` from the matching v3 release checkout:

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

### Step 2: Pull the v3 release images

For a published v3 release, run this from its `docker/` directory. The release images are public.

```bash
docker compose pull
```

### Step 3: Start the matching stack

```bash
# v3 release checkout, from docker/
# The OpenBao candidate has a separate initialization and unseal procedure.
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

### Backend request limits

Each backend process accepts 600 requests per client IP per minute by default.
Set `API_IP_REQUESTS_PER_MINUTE` to change this limit. The check runs before
authentication. Integration tokens and SSH fleet tokens also have a limit of
120 requests per token per minute. Set `API_TOKEN_REQUESTS_PER_MINUTE` to
change it. Both settings take positive integers. Excess requests receive HTTP
429. The existing KRL limits also apply. Size the limits for devices that
share a proxy, fleet token or issuer. Allow for peak certificate issuance.
The Kubernetes issuer marks a CertificateRequest as failed on a signing error,
including HTTP 429. Each replica keeps its own counters.

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
(`backend:3000`) and send everything else to the frontend.

The two configurations below were tested with **Caddy 2.11.9** and **Traefik v3.8.0** in front of
a build of `main` at commit `298b92d5` (after release 3.17.0), over plain HTTP on `localhost`, with
`"apiUrl": "/trpc"` in `config.json`. Each test checked that:

- the paths of the table reach the backend, and `/`, `/cas`, `/cas/<id>`, `/ssh/cas`,
  `/ssh/cas/<id>`, `/ssh/hosts`, `/ssh/hosts/<id>`, `/ssh/zones`, `/ssh/krl` and `/callback`
  return the SPA;
- an OIDC login with Keycloak works through the proxy, the UI pages and the API calls work, the
  token renewal works (with the refresh token, and in the `silent-renew.html` iframe) and logout
  works, with no CSP violation in the browser.

TLS, certificates and `TRUST_PROXY` were not part of the test.

**Caddy**

```caddyfile
pki.example.com {
    @backend path /api/* /trpc* /crl/* /krl/* /ssh/host-ca-keys /ssh/trusted-user-ca-keys /ssh/cert-authority
    @backend_re path_regexp ^/(cas/[^/]+\.(pem|crt|cer|der)|ssh/zones/[^/]+/(host-ca-keys|trusted-user-ca-keys|cert-authority)|ssh/cas/[^/]+/ca\.pub|ssh/hosts/[^/]+/(cert\.pub|sshd-config))$
    reverse_proxy @backend backend:3000
    reverse_proxy @backend_re backend:3000
    reverse_proxy frontend:8080
}
```

Caddy needs two named matchers. Inside one named matcher, a `path` and a `path_regexp` must
both match (they are not alternatives), and only one `path_regexp` is accepted: Caddy stops with
`regular expression can only be used once per named matcher`.

**Traefik** (v3 rule syntax, dynamic configuration of the file provider)

```yaml
http:
  routers:
    pki-backend:
      entryPoints: [web]
      priority: 100
      service: pki-backend
      rule: >-
        PathPrefix(`/api/`) || PathPrefix(`/trpc`) || PathPrefix(`/crl/`) || PathPrefix(`/krl/`)
        || PathRegexp(`^/cas/[^/]+\.(pem|crt|cer|der)$`)
        || PathRegexp(`^/ssh/(host-ca-keys|trusted-user-ca-keys|cert-authority)$`)
        || PathRegexp(`^/ssh/zones/[^/]+/(host-ca-keys|trusted-user-ca-keys|cert-authority)$`)
        || PathRegexp(`^/ssh/cas/[^/]+/ca\.pub$`)
        || PathRegexp(`^/ssh/hosts/[^/]+/(cert\.pub|sshd-config)$`)
    pki-frontend:
      entryPoints: [web]
      priority: 1
      service: pki-frontend
      rule: PathPrefix(`/`)
  services:
    pki-backend:
      loadBalancer:
        servers:
          - url: http://backend:3000
    pki-frontend:
      loadBalancer:
        servers:
          - url: http://frontend:8080
```

The test started Traefik with `--entrypoints.web.address=:8080` and
`--providers.file.filename=/etc/traefik/dynamic.yml`. The backend router has the higher
priority, so the frontend router gets only the paths that the backend rule does not match.

**Kubernetes ingress** (not tested): use `Exact`/`ImplementationSpecific` path types (or a
regex-capable ingress) for the `/ssh/...`, `/krl/`, `/crl/`, `/cas/....pem`, `/api/`
and `/trpc` routes to the backend Service, with a catch-all `/` to the frontend.

With an OIDC login, register the origin of the proxy in the identity provider (redirect URI
`<origin>/callback` and `<origin>/silent-renew.html`, post-logout URI `<origin>/`, web origin).

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
- The entrypoint reads `config.json` only when the container starts. After a change of
  `config.json`, run `docker compose restart frontend`. `docker compose up -d` does not start
  the container again when only the content of the mounted file changed. With an old CSP, the
  browser blocks the calls to the new origin (`Refused to connect ... violates the following
  Content Security Policy directive: "connect-src ..."`), and a login does not start.
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

The CSP was also checked in a browser (headless Chromium) with a real OIDC login against
Keycloak 26.0.5, on a build of `main` at commit `298b92d5`: login, the main pages, the Swagger UI
page, the token renewal with the refresh token, the token renewal in the `silent-renew.html`
iframe, and logout gave no CSP violation. `just demo check` runs this check on the demo stack
(see [How the docs are organised](../development/documentation.md#demo-stack-screenshots-and-examples)).

If an edge proxy in front of the container adds the same headers, the browser gets them twice.
Two `Content-Security-Policy` headers apply together (the stricter result). Let one of them set
the headers.

## Environment Configuration

### Required Variables

The OpenBao candidate requires `OPENBAO_IMAGE`, TLS material and a configured AppRole. See [Operate the OpenBao key store](openbao.md). The v3 Compose file has defaults for a local Cosmian service.

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
| `OPENBAO_IMAGE` | Set in the deployment environment | Candidate only. Verified fork image reference. |
| `KMS_URL` | `http://kms:9998` | v3 only. Cosmian endpoint. |
| `KMS_API_KEY` | _(empty)_ | v3 only. Optional Cosmian credential. |
| `CRL_DISTRIBUTION_URL` | `http://localhost:3000/crl` | Public URL for CRL distribution points |
| `TRUST_PROXY` | _(empty)_ | Reverse proxies allowed to set the client IP ([details](#client-ips-behind-a-reverse-proxy-trust_proxy)) |
| `ALLOW_CA_KEY_EXPORT` | `false` | Enable audited PKCS#12/JKS CA keystore downloads for administrators. With OpenBao, set it before creating a CA that requires export. An existing non-exportable key stays non-exportable. CRL signing runs inside OpenBao. |
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

**v3 only.** Cosmian runs in config-file mode (`COSMIAN_KMS_CONF`): it ignores its environment variables.
Set its port and log level (`[http] port`, `[logging] rust_log`) in `kms/kms.toml`. If you change
the port, change `KMS_URL` too. The Compose file does not publish the KMS port.

### Login (OIDC)

Login is optional and uses OIDC. The backend reads the `OIDC_*` variables from `.env`. The web UI
reads its part from `docker/config.json`. Both are described in one place:

- [OIDC login](oidc.md): variables, providers, roles, roles from UserInfo, and how to run without login.
- [Keycloak setup](keycloak.md): step by step, with screenshots.
- [Install and log in](../get-started/install.md#5-choose-how-people-log-in): the minimum to start.

### Secrets Management

The OpenBao candidate reads the runtime token from a read-only directory shared with the Agent. Follow the [AppRole setup and rotation procedure](openbao.md). For v3 with Cosmian authentication, inject `KMS_API_KEY` into the backend environment from your secret store.

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
docker compose logs openbao openbao-agent  # OpenBao candidate
# In a v3 checkout: docker compose logs kms
```

### Database Issues

Check backend logs, disk space and ownership of `pki/` (UID 1001). Stop writers before copying or restoring SQLite. Preserve the original database and use its [matching key store backup](#backup-and-restore).

### Key store connection issues

For the OpenBao candidate, run `docker compose exec openbao bao status`. Unseal if required. Inspect `docker compose logs openbao-agent` for TLS, permission and AppRole errors. See the [OpenBao runbook](openbao.md) for the token file check.

For v3, check Cosmian in the v3 release checkout.

```bash
docker compose ps kms
docker compose exec backend wget -qO- http://kms:9998/health
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
- [ ] Verify Agent login and token permissions on the OpenBao candidate. For v3, configure access to Cosmian.
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
  [migration 0010 (integrations)](migration-0010.md) and the v3 Cosmian upgrade below.

### KMS upgrade: backup before recreating the container

**PKI Manager v3 with Cosmian only.**

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
   at the only copy of your 5.12 DB. The v3 Compose file for 5.28 maps `../kms/data`
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

For the OpenBao candidate, [back up and restore SQLite and Raft together](openbao.md#back-up-and-restore-sqlite-and-raft-together).

**v3 with Cosmian only.** Verify the location of the KMS database using the preceding upgrade procedure. For v3 installations with the standard bind mounts, the folders next to `docker/` are:

| Folder | Content |
|---|---|
| `pki/` | The SQLite database: CAs, certificates, audit log, and the ids of the KMS keys |
| `kms/data/` | The KMS database: the private keys |

Back up both together. The database holds the ids of keys that exist only in the KMS, so one
folder without the other is not a complete backup.

### v3 backup

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

### v3 restore

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

The backend and frontend containers have HTTP health checks. For OpenBao, also inspect the seal status and verify a signing operation.

```bash
# Check overall health
docker compose ps

# Test endpoints
curl http://localhost:3000/health  # Backend
curl http://localhost:8080/health  # Frontend
docker compose exec openbao bao status  # OpenBao candidate, internal TLS endpoint
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
