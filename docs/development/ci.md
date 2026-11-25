# CI and releases

How the images are built, what each GitHub Actions workflow does, and how a release is cut.

## Build and run from source

The Compose file of production (`docker/docker-compose.yml`) can also build the images from your
checkout. Operators use the published images instead: see [Docker deployment](../operations/deployment.md).

### Run the stack from source

1. **Clone and navigate to the project**:
   ```bash
   cd pki-manager-web/docker
   ```

   The Compose file is `docker/docker-compose.yml`: run the `docker compose`
   commands below from the `docker/` directory (or add
   `-f docker/docker-compose.yml` from the repository root).

2. **Create `.env` file** (optional, uses defaults if not present):
   ```bash
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

3. **Create the backend data folder** (the backend runs as uid 1001; a folder that Docker
   creates is owned by root and the backend fails with `SqliteError: unable to open database file`):
   ```bash
   mkdir -p ../pki && sudo chown 1001:1001 ../pki
   ```

4. **Build and start all services** (`--build` builds the images from your checkout instead of pulling them):
   ```bash
   docker compose up --build
   ```

5. **Access the application**:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000
   - KMS: not published to the host (internal `kms-internal` network only)

### Build one image

**Build backend only** (from the repository root):
```bash
docker build -f docker/Dockerfile --target backend -t pki-manager-backend:dev .
```

**Build frontend only**:
```bash
docker build -f docker/Dockerfile --target frontend \
  --build-arg VITE_API_URL=http://localhost:3000/trpc \
  -t pki-manager-frontend:dev .
```

`docker/Dockerfile` has two final stages: `backend` (Node.js 22 on Alpine, with `openssl` and a Java
runtime for the PKCS#12 and JKS exports) and `frontend` (nginx).

If the build stops with TypeScript errors, fix them in the code first:

```bash
cd backend && pnpm typecheck
```

## Workflows

| Workflow | File | Runs on | What it does |
|---|---|---|---|
| Test | `test.yml` | push and pull request to `main` that touch `backend/`, `frontend/`, `package.json` or `pnpm-lock.yaml` | Backend tests, type check and lint of backend and frontend |
| Docker Build and Publish | `docker-build.yml` | push to `main`, tags `v*.*.*`, pull requests | Builds the backend and frontend images (`linux/amd64`), checks the security headers of the frontend image (`docker/check-security-headers.sh`), publishes the images to `ghcr.io`, attests the build, scans with Trivy |
| SCEP | `scep.yml` | changes under `scep/`, tags `v*.*.*` | Tests the SCEP gateway and publishes its image |
| k8s-issuer | `k8s-issuer.yml` | changes under `k8s/issuer/`, tags `v*.*.*` | Tests the issuer, publishes its image, signs it with cosign, makes an SBOM |
| krl-client | `krl-client.yml` | changes under `krl-client/`, tags `v*.*.*` | Tests the KRL client; on a tag, attaches the signed binary and its SBOM to the release |
| E2E | `e2e.yml` | pull requests to `main` that touch the backend, frontend, `docker/` or `tests/`; manual | Builds the images, starts `docker/docker-compose.e2e.yml`, runs the Playwright RBAC tests (see [E2E in CI](testing.md#e2e-in-ci)) |
| Ansible e2e | `ansible-e2e.yml` | changes to `ansible/`, the SSH routes and services, `krl-client/` | End-to-end test of the SSH host role in Docker |
| Security | `security.yml` | push and pull request to `main` | Secret scan (gitleaks) |
| Docs site | `docs.yml` | changes to the documentation, the site or the backend source | Builds the site, runs the API examples against the demo stack; from `main`, publishes the site image (see [Website deploy](#website-deploy)) |
| Release | `release.yml` | tags `v*.*.*` | Creates the GitHub Release from the matching `CHANGELOG.md` section |

The Node.js version of the Test workflow comes from `.nvmrc` (major 22), and the Docs site
workflow uses `site/.nvmrc`.

Images go only to GitHub Container Registry. The image names and tags are in
[Docker deployment](../operations/deployment.md#published-images).

`VITE_API_URL` is a repository variable (Settings → Secrets and variables → Actions → Variables).
The frontend image is built with it; without it the default is `http://localhost:3000/trpc`.

## Website deploy

The website <https://pki-manager.oriolrius.cat> runs on the maintainer's own server (k5), not on
GitHub Pages. GitHub has no access to that server and holds no secret for it: it only publishes an
image, and the server takes it.

1. A push to `main` runs `docs.yml`. It builds the site and makes an image with it:
   `ghcr.io/oriolrius/pki-manager-web/site`, tags `main` and `sha-<commit>` (public).
   The image is nginx without root (`site/Dockerfile`, `site/server/nginx.conf`). It answers
   `/healthz` and sends the header `X-Site-Revision: <commit>` on every response.
2. Every 5 minutes, a Gitea Actions workflow on the server reads the digest of the tag `main`
   (repository `k5-stack-pki-site`, not public). When the digest is new, it writes it into the
   Compose file of the stack, commits it, and deploys the stack with Dockhand.
3. It checks that `https://pki-manager.oriolrius.cat/healthz` sends the new commit and that the main
   pages answer `200`. If a check fails, it puts back the previous digest and deploys it again.

So a change on `main` is live in about 10 minutes (build, then the next poll). The Compose file
always names an image by digest, and its git history is the list of deploys.

To publish a test image from another branch, run **Docs site** by hand on that branch (Actions → Docs
site → Run workflow). It pushes only `sha-<commit>`, so nothing is deployed.

The old address `https://oriolrius.github.io/pki-manager-web/` still works: GitHub Pages now
serves one page (`site/legacy/404.html`) that sends each reader to the same path on the new site.

## Releases

Versions follow conventional commits with [Commitizen](https://commitizen-tools.github.io/commitizen/)
(`pyproject.toml`). One version covers the root, backend and frontend `package.json` files and the
issuer Helm chart.

1. `cz bump` writes the version, the `CHANGELOG.md` section and the tag `vX.Y.Z`.
2. Edit the new `CHANGELOG.md` section: its first line is the release title in bold, then a short
   description. `release.yml` uses that line as the title (`vX.Y.Z — title`) and the rest as the notes.
3. Push the commit and the tag. The tag starts the release and the image workflows.

The site shows the same `CHANGELOG.md` as its [release notes](../../CHANGELOG.md).
