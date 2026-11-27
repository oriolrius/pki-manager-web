# Docker deployment

This page describes how to run PKI Manager v4 with Docker Compose: the backend, the web UI and the
PKI Manager fork of OpenBao, which keeps the private keys. For a first installation on one machine,
follow [Install PKI Manager and log in](../get-started/install.md). To build the images from
source, see [CI and releases](../development/ci.md).

| Installation | Key store | Files and procedure |
|---|---|---|
| v4 | PKI Manager fork of OpenBao, with three Transit mounts | `docker/docker-compose.yml` of this repository, this page and [Operate the OpenBao key store](openbao.md) |
| v3 (3.19.1 and earlier) | Cosmian KMS | The files of the tag `v3.19.1`: the [v3 deployment guide](https://github.com/oriolrius/pki-manager-web/blob/v3.19.1/docs/operations/deployment.md), the [v3 installation guide](https://github.com/oriolrius/pki-manager-web/blob/v3.19.1/docs/get-started/install.md) and the [v3 Compose file](https://github.com/oriolrius/pki-manager-web/blob/v3.19.1/docker/docker-compose.yml) |

The v4 backend has no Cosmian KMS client. A v4 stack that starts on a v3 database does not get the
v3 keys: they stay in the Cosmian database. Keep the v3 stack, its SQLite database and its KMS
database as one backup set until you have tested the migration to v4 on a copy. To run or recover
a v3 installation, use the `v3.19.1` files of the table. The [kms folder](../../kms/README.md) starts an
isolated Cosmian service for a restored v3 backup.

## Overview

`docker/docker-compose.yml` has these services:

| Service (container) | What it does | Networks |
|---|---|---|
| `openbao` (`pki-openbao`) | The OpenBao fork. It keeps the keys in its Raft storage and signs with them, on HTTPS port 8200. It has no host port | `keystore-internal` |
| `openbao-agent` (`pki-openbao-agent`) | Logs in with the AppRole `pki-manager-backend` and writes the X.509/SSH token to a file | `keystore-internal` |
| `openbao-agent-ra` (`pki-openbao-agent-ra`) | SCEP only (profile `scep`): logs in with the AppRole `pki-manager-ra` and writes the SCEP RA token to a separate file | `keystore-internal` |
| `backend` (`pki-backend`) | Fastify API, certificate logic, SQLite database in `pki/`. It reads the token files on each call to OpenBao | `pki-network`, `keystore-internal` |
| `frontend` (`pki-frontend`) | Web UI (nginx). It also forwards the backend paths (see [the single-origin proxy](#the-fix-already-applied-to-dockernginxconf)) | `pki-network` |
| `openbao-bootstrap` | One-shot operator helper (profile `bootstrap`): policies, Transit mounts, AppRole credentials | `keystore-internal` |

`keystore-internal` is an internal Docker network: its containers have no route out of the host.
The backend image includes the SQLite migration tools.

> Deploying the **SSH Certificate Manager** to real servers? See the SSH guides:
> [concept](../ssh/concept.md) · [host & client setup](../ssh/setup.md) ·
> [Ansible role](../../ansible/README.md). Hosts need NTP and outbound access to the
> public trust/KRL endpoints (`/ssh/...`, `/krl/<caId>.bin`).

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- `docker/.env`, made from `docker/.env.example`. The Compose file stops when `OPENBAO_IMAGE` is
  not set.
- A server certificate for OpenBao from your deployment CA, with the DNS SAN `openbao` and the IP
  SAN `127.0.0.1` ([details](openbao.md#prepare-the-host)).
- Custodians for the unseal key shares. OpenBao is sealed after each restart.
- (Optional) `cosign`, to check the signature of the OpenBao image.

## Production deployment

Run the commands of this page from the `docker/` directory of the checkout.
[Operate the OpenBao key store](openbao.md) runs its commands from the repository root.

### Step 1: Prepare the environment

```bash
cp .env.example .env
```

Set these values in `docker/.env`:

```bash
# Backend and frontend images: a 4.x release tag, with no leading "v".
# "latest" changes under you. A 3.x image needs Cosmian KMS: it does not work with this file.
IMAGE_TAG=<4.x.y>

# Host ports
BACKEND_EXTERNAL_PORT=3000
FRONTEND_EXTERNAL_PORT=80

# Backend
NODE_ENV=production
# Written into every certificate you issue: set it before the first CA.
CRL_DISTRIBUTION_URL=https://your-domain.com/crl
```

If your checkout has no published 4.x images, build the backend and frontend images from it:
see [Run the stack from source](../development/ci.md#run-the-stack-from-source).

`OPENBAO_IMAGE` in `.env.example` is the signed image of the OpenBao fork, pinned by digest. It
must be the same as `OPENBAO_PUBLISHED_IMAGE` in [openbao/image.env](../../openbao/image.env),
the one place of the pin. Check the value, the signature and the source commit:

```bash
grep '^OPENBAO_IMAGE=' .env
. ../openbao/image.env
echo "$OPENBAO_PUBLISHED_IMAGE"          # the same reference as in .env
tag="${OPENBAO_PUBLISHED_IMAGE%@*}"; tag="${tag##*:}"
cosign verify "$OPENBAO_PUBLISHED_IMAGE" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity "https://github.com/oriolrius/openbao/.github/workflows/pki-manager-image.yml@refs/tags/v$tag"
bash ../scripts/openbao-image.sh verify "$OPENBAO_PUBLISHED_IMAGE"
```

`cosign verify` checks the keyless signature of the release workflow of the fork, for the tag of
the image. `openbao-image.sh verify` checks that `bao version` in the image gives the commit
`OPENBAO_FORK_COMMIT` of `image.env`.

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

### Step 2: Pull the images

```bash
docker compose pull
```

This pulls the backend, frontend and OpenBao images. The images are public.

### Step 3: Start OpenBao and the application

OpenBao must be initialized, unsealed and configured before the backend can use a key. Do these
steps of [Operate the OpenBao key store](openbao.md) in this sequence:

1. [Prepare the host](openbao.md#prepare-the-host): the folders of `openbao/state/` and `pki/`
   with their owners, and the TLS files.
2. [Initialize and unseal](openbao.md#initialize-and-unseal): initialize an empty store once,
   then unseal it.
3. [Configure access and start the application](openbao.md#configure-access-and-start-the-application):
   policies, Transit mounts and AppRoles, then the Agents, then `backend` and `frontend`. With
   SCEP, set `COMPOSE_PROFILES=scep` in `docker/.env` to run the RA Agent.

Then check the stack:

```bash
docker compose ps
docker compose exec openbao bao status   # Sealed false
curl -s http://localhost:3000/health
```

The health check does not use a key. Issue a certificate from a test CA and verify it against
that CA. After a restart of the host or of `pki-openbao`, the custodians unseal OpenBao again
([Initialize and unseal](openbao.md#initialize-and-unseal), step 3). The backend cannot use the
keys while OpenBao is sealed.

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
headers included) live in [docker/nginx.conf](../../docker/nginx.conf). For a
single-origin deployment, point the SPA at the same origin by setting
`"apiUrl": "/trpc"` in `docker/config.json` (so the browser hits the edge, not `:3000` directly).

### Verify

```bash
# With the stack running (Step 3), from docker/:
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

`OPENBAO_IMAGE` is the only variable with no default: the Compose file stops without it. The
stack also needs the TLS files and the AppRole credentials in `openbao/state/`
([Operate the OpenBao key store](openbao.md)). For production, also set `IMAGE_TAG` and
`CRL_DISTRIBUTION_URL` ([Step 1](#step-1-prepare-the-environment)).

### Available Variables

See [docker/.env.example](../../docker/.env.example) for full list. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_TAG` | `latest` | Tag of the backend and frontend images. Use a 4.x release tag |
| `BACKEND_EXTERNAL_PORT` | `3000` | Host port for backend API |
| `FRONTEND_EXTERNAL_PORT` | `8080` | Host port for frontend |
| `NODE_ENV` | `production` | Node environment |
| `FRONTEND_URL` | _(empty)_ | Browser origins allowed to call the API (CORS). Empty allows every origin ([details](#browser-origins-frontend_url)) |
| `DATABASE_PATH` | `/app/backend/data/pki.db` | Database file path (in container) |
| `OPENBAO_IMAGE` | _(none, required)_ | The OpenBao fork image: `OPENBAO_PUBLISHED_IMAGE` of [openbao/image.env](../../openbao/image.env), with its digest |
| `OPENBAO_ADDR` | `https://openbao:8200` | OpenBao URL of the backend, on the `keystore-internal` network |
| `OPENBAO_TRANSIT_MOUNT` | `pki-manager` | Transit mount of the X.509 CA and certificate keys |
| `OPENBAO_SSH_MOUNT` | `pki-manager-ssh` | Transit mount of the SSH CA keys |
| `OPENBAO_RA_MOUNT` | `pki-manager-ra` | Transit mount of the SCEP RA keys |
| `COMPOSE_PROFILES` | _(empty)_ | `scep` starts `openbao-agent-ra`, the SCEP RA credential. Without it, the RA endpoints answer 503 and the rest works |
| `CRL_DISTRIBUTION_URL` | `http://localhost:3000/crl` | Public URL for CRL distribution points |
| `TRUST_PROXY` | _(empty)_ | Reverse proxies allowed to set the client IP ([details](#client-ips-behind-a-reverse-proxy-trust_proxy)) |
| `ALLOW_CA_KEY_EXPORT` | `false` | Enable audited PKCS#12/JKS CA keystore downloads for administrators. Set it before you create a CA that requires export. An existing non-exportable key stays non-exportable. CRL signing runs inside OpenBao. |
| `OIDC_DISCOVERY_BASE_URL` | _(empty)_ | Base URL to fetch the OIDC discovery document and the JWKS when the backend cannot reach `OIDC_ISSUER` ([OIDC login](oidc.md)) |
| `ALLOW_UNAUTHENTICATED_SSH_CA` | `false` | Allow the SSH CA operations with OIDC off. Local tests only |
| `SSH_ECIES_ENABLED` | `false` | Serve the ECIES-encrypted per-host KRL to `krl-client` |
| `SSH_HOST_KRL_SERVE` | `true` | `false` serves the per-CA KRL instead of the per-host KRL (rollback switch) |
| `SSH_HOST_KRL_PUBLIC` | `false` | Serve the per-host KRL with no token at `/krl/hosts/<id>.bin\|.json` |
| `SSH_BLOCK_ISSUANCE_GATE` | `false` | On user certificate issue, remove the principals that reach only hosts where the identity is blocked |
| `VITE_API_URL` | `http://localhost:3000/trpc` | Build argument of the frontend image only. At run time, set `apiUrl` in `docker/config.json` |

The three Transit mounts must be different. Keep their names through restarts and restores:
a change of a variable does not move the keys that exist
([details](openbao.md#configure-access-and-start-the-application)).

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

### Login (OIDC)

Login is optional and uses OIDC. The backend reads the `OIDC_*` variables from `.env`. The web UI
reads its part from `docker/config.json`. Both are described in one place:

- [OIDC login](oidc.md): variables, providers, roles, roles from UserInfo, and how to run without login.
- [Keycloak setup](keycloak.md): step by step, with screenshots.
- [Install and log in](../get-started/install.md#5-choose-how-people-log-in): the minimum to start.

### Secrets Management

The backend environment has no OpenBao credential. The Agent writes a renewable X.509/SSH token
to `openbao/state/token/`, and the RA Agent writes the SCEP RA token to `openbao/state/token-ra/`.
The backend mounts both folders read-only. The two tokens have separate AppRoles and policies:
only the RA token reaches the RA keys. Only the Agents and the bootstrap helper mount the AppRole
credentials of `openbao/state/approle/` and `openbao/state/approle-ra/`. To renew the tokens
and replace a SecretID, see
[Renew tokens and rotate the SecretID](openbao.md#renew-tokens-and-rotate-the-secretid). Keep the
unseal shares in separate custody, and protect the root token separately.

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

The key store image `ghcr.io/oriolrius/openbao` comes from the release workflow of the fork
repository [oriolrius/openbao](https://github.com/oriolrius/openbao), for `linux/amd64` and
`linux/arm64`, with a keyless cosign signature. PKI Manager uses it only by the digest in
[openbao/image.env](../../openbao/image.env).

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
docker compose logs openbao openbao-agent openbao-agent-ra
```

### Database Issues

Check backend logs, disk space and ownership of `pki/` (UID 1001). Stop writers before copying or restoring SQLite. Preserve the original database and use its [matching key store backup](#backup-and-restore).

### Key store connection issues

Run `docker compose exec openbao bao status`. Unseal if required. Inspect `docker compose logs openbao-agent` (and `openbao-agent-ra` for SCEP) for TLS, permission and AppRole errors. A 503 `RA key provider is not configured` from the RA endpoints means that the backend has no readable SCEP RA token: start `openbao-agent-ra`. See the [OpenBao runbook](openbao.md#configure-access-and-start-the-application) for the token file check.

For a v3 installation with Cosmian KMS, see the
[v3 deployment guide](https://github.com/oriolrius/pki-manager-web/blob/v3.19.1/docs/operations/deployment.md#kms-connection-issues).

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
- [ ] Set `IMAGE_TAG` to a 4.x release tag, and `OPENBAO_IMAGE` to the pin of `openbao/image.env`
- [ ] Set `CRL_DISTRIBUTION_URL` to a URL that clients can reach, before the first CA
- [ ] Set `apiUrl` in `docker/config.json` to the public API URL
- [ ] Give the unseal shares to separate custodians, and retire the initial root token
- [ ] Verify the Agent token file and a signing operation through the backend ([OpenBao](openbao.md))
- [ ] Configure OIDC authentication (see [OIDC login](oidc.md))
- [ ] Use HTTPS with reverse proxy
- [ ] Configure firewall rules
- [ ] Back up SQLite and the OpenBao Raft storage together ([Backup and Restore](#backup-and-restore))
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
The RA keys of the gateway are in the `OPENBAO_RA_MOUNT` Transit mount.

## Upgrades

- Read the [release notes](../../CHANGELOG.md) before each upgrade. A release that needs a manual step says so.
- The backend applies the database migrations when it starts. Make a [backup](#backup-and-restore) first.
- Runbooks for the upgrades that need care: [migration 0009 (SSH zones)](migration-0009.md) and
  [migration 0010 (integrations)](migration-0010.md).
- When a release changes the pin in `openbao/image.env`, back up SQLite and Raft together, set
  the new `OPENBAO_IMAGE` in `docker/.env`, check it as in [Step 1](#step-1-prepare-the-environment),
  and recreate the OpenBao containers. Then unseal OpenBao.
- A v3 installation that stays on Cosmian KMS: the KMS upgrade procedure is in the
  [v3 deployment guide](https://github.com/oriolrius/pki-manager-web/blob/v3.19.1/docs/operations/deployment.md#kms-upgrade-backup-before-recreating-the-container).

## Backup and Restore

The SQLite database in `pki/` has the CAs, the certificates, the audit log and the references to
the keys. The OpenBao Raft storage in `openbao/state/data/` has the keys. One folder without the
other is not a complete backup.
[Back up and restore SQLite and Raft together](openbao.md#back-up-and-restore-sqlite-and-raft-together).

For a v3 installation, the backup set is `pki/` and the Cosmian database `kms/data/`: see the
[v3 backup and restore procedure](https://github.com/oriolrius/pki-manager-web/blob/v3.19.1/docs/operations/deployment.md#backup-and-restore).

## Monitoring

### Health Checks

The backend and frontend containers have HTTP health checks. These checks do not use a key. Also
check the seal status of OpenBao, and verify a signing operation.

```bash
# Check overall health
docker compose ps

# Test endpoints
curl http://localhost:3000/health  # Backend
curl http://localhost:8080/health  # Frontend
docker compose exec openbao bao status  # OpenBao, internal TLS endpoint
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
