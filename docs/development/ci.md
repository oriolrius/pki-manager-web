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

2. Copy `.env.example` to `.env`. Set `IMAGE_TAG` to a local tag for the build.
3. Prepare the OpenBao image, TLS files, persistent storage and AppRole credentials. Follow
   the [OpenBao operations guide](../operations/openbao.md). The Compose stack reads the
   image reference from `OPENBAO_IMAGE`.
4. Create the backend data folder so the container user can write to it.

   ```bash
   mkdir -p ../pki
   sudo chown 1001:1001 ../pki
   ```

5. Build the backend and frontend from your checkout, then start the stack.

   ```bash
   docker compose build backend frontend
   docker compose up -d
   ```

The frontend listens on `http://localhost:8080` and the backend on `http://localhost:3000`
with the default ports. The backend and OpenBao Agent reach OpenBao on the
`keystore-internal` network.

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
| Test | `test.yml` | push and pull request to `main` that touch `backend/`, `frontend/`, `package.json` or `pnpm-lock.yaml` | Backend tests with the OpenBao fork and a scoped token. Type check and lint of backend and frontend |
| Docker Build and Publish | `docker-build.yml` | push to `main`, tags `v*.*.*`, pull requests | Builds the backend and frontend images (`linux/amd64`), checks the security headers of the frontend image (`docker/check-security-headers.sh`), publishes the images to `ghcr.io`, attests the build, scans with Trivy |
| SCEP | `scep.yml` | changes under `scep/`, tags `v*.*.*` | Tests the SCEP gateway and publishes its image |
| k8s-issuer | `k8s-issuer.yml` | changes under `k8s/issuer/`, tags `v*.*.*` | Tests the issuer, publishes its image, signs it with cosign, makes an SBOM |
| krl-client | `krl-client.yml` | changes under `krl-client/`, tags `v*.*.*` | Tests the KRL client; on a tag, attaches the signed binary, its SBOM and its SLSA provenance to the release |
| E2E | `e2e.yml` | pull requests to `main` that touch the backend, frontend, Docker or OpenBao fixtures, tests or their configuration; manual | Builds the images, starts `docker/docker-compose.e2e.yml`, runs the Playwright RBAC tests (see [E2E in CI](testing.md#e2e-in-ci)) |
| Ansible e2e | `ansible-e2e.yml` | changes to `ansible/`, the SSH routes and services, `krl-client/` | End-to-end test of the SSH host role in Docker |
| Fuzz | `fuzz.yml` | push and pull request that touch `scep/`, `krl-client/` or `k8s/issuer/`; every Monday; manual | Runs each Go fuzz target for 30 s (5 minutes on Monday) and, on Monday, the backend property tests with more cases (see [Fuzzing](testing.md#fuzzing)) |
| Security | `security.yml` | push and pull request to `main` | Secret scan (gitleaks) |
| CodeQL | `codeql.yml` | push and pull request to `main`; weekly | Static analysis of the TypeScript/JavaScript, Go and Python code and of the workflows. Results go to code scanning |
| Dependency review | `dependency-review.yml` | pull requests to `main` | Fails when the pull request adds a dependency with a known vulnerability of severity high or critical |
| Scorecard | `scorecard.yml` | push to `main`; weekly; a change of the branch protection | Runs [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/oriolrius/pki-manager-web), sends the result to code scanning and publishes it (the badge of the README) |
| Docs site | `docs.yml` | changes to the documentation, the site or the backend source | Builds the site, runs the API examples against the demo stack; from `main`, publishes the site image (see [Website deploy](#website-deploy)) |
| Release | `release.yml` | tags `v*.*.*` | Creates the GitHub Release from the matching `CHANGELOG.md` section |

The Node.js version of the Test workflow comes from `.nvmrc` (major 22), and the Docs site
workflow uses `site/.nvmrc`.

Images go only to GitHub Container Registry. The image names and tags are in
[Docker deployment](../operations/deployment.md#published-images).

`VITE_API_URL` is a repository variable (Settings → Secrets and variables → Actions → Variables).
The frontend image is built with it; without it the default is `http://localhost:3000/trpc`.

## Supply chain

These rules keep a change of someone else's code from entering a build without a review. To report a
vulnerability, read the [security policy](../../SECURITY.md).

Two OpenSSF checks show the state of these rules in the README:

- [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/oriolrius/pki-manager-web):
  automatic, from `scorecard.yml`.
- [OpenSSF Best Practices](https://www.bestpractices.dev/projects/17126), level *passing*: a
  self-assessment by the maintainer, with a justification for each criterion. When a change makes
  an answer false (for example a new tool, or a check that stops running), update the answer on
  that page in the same week.

### Token permissions

Each workflow starts with `permissions: contents: read` (`scorecard.yml` with `permissions: {}`).
A job that must write asks for it itself, and only for what it needs:

| Job | Extra permission | Why |
|---|---|---|
| `release.yml` → `release` | `contents: write` | create the GitHub Release |
| `krl-client.yml` → `release` | `contents: write`, `id-token: write` | attach the binary to the release; sign it with cosign (keyless) |
| `krl-client.yml` → `provenance` | `contents: write`, `id-token: write`, `actions: read` | make, sign and attach the SLSA provenance |
| `docker-build.yml` → `build-and-push` | `packages: write`, `id-token: write`, `attestations: write` | push the images; attest the build |
| `docker-build.yml` → `cleanup-sha256-tags` | `packages: write` | delete the `sha256-*` tags |
| `docker-build.yml` → `security-scan`, `codeql.yml`, `scorecard.yml` | `security-events: write` | upload results to code scanning |
| `k8s-issuer.yml` → `build` | `packages: write`, `id-token: write` | push the image; sign it with cosign |
| `scep.yml` → `image`, `docs.yml` → `image` | `packages: write` | push the image |
| `docs.yml` → `legacy-redirect` | `pages: write`, `id-token: write` | publish the redirect page on GitHub Pages |

### Pinned versions

- **Actions**: each `uses:` names a full commit SHA, with the release in a comment:
  `uses: actions/checkout@<40 hex characters> # v4.4.0`. A tag can move; a commit cannot.
  To find the commit of a release: `gh api repos/OWNER/REPO/commits/vX.Y.Z --jq .sha`.
- **One exception**: `slsa-framework/slsa-github-generator` is named by tag (`@v2.1.0`). It is a
  reusable workflow, and the verifier of the provenance (`slsa-verifier`) reads the tag of the
  builder, so that project asks for a tag.
- **Base images**: each `FROM` of a Dockerfile keeps its tag and adds the digest of the
  multi-platform index: `node:22-alpine@sha256:...`. To find it:
  `docker buildx imagetools inspect node:22-alpine --format '{{.Manifest.Digest}}'`.
- **Python tools in CI**: `ansible/tests/e2e/requirements.txt` pins `ansible-core` and its
  dependencies by version and hash, and CI installs it with `pip install --require-hashes`.
  Change `requirements.in`, then run the `uv pip compile` command that is written in it.
- **npm and Go**: CI installs from the lock files (`pnpm install --frozen-lockfile`, `npm ci`,
  `go.sum`).

A new workflow or Dockerfile must follow these rules. Check the workflows with
[actionlint](https://github.com/rhysd/actionlint) before you push.

### Dependabot

`.github/dependabot.yml` asks Dependabot to look for new versions each Monday: the actions, the
npm packages (the root pnpm workspace, `site/`, the video tooling), the Go modules, the base images
of the Dockerfiles (tag and digest) and `ansible/tests/e2e/requirements.txt`.

- Minor and patch updates of one ecosystem come in one grouped pull request. A major update comes
  alone.
- A new version must be 7 days old before Dependabot proposes it (`cooldown`). A security update
  does not wait.
- The commit prefix is `build(deps)`, or `ci(deps)` for the actions, so `cz bump` reads the commits.
- Update the Keycloak Compose image and the OpenBao fork pin in `openbao/image.env` by hand.
  Run the backend integration tests and the RBAC stack with each new version.
- The application image and the Node.js types follow Node.js 22. The issuer builder follows Go
  1.26. Dependabot still proposes patch and digest updates on these runtime lines.
- Upgrade the ESLint 10 preset together with the ESLint engine and its TypeScript plugins.

Handle a Dependabot pull request like any other:

1. Wait for the checks: the workflows that the change touches, CodeQL and Dependency review.
2. Read the release notes of a major update, and of an action (an action runs with the token of
   the job). For an action, Dependabot changes the commit SHA and the version comment together.
3. Merge when the checks are green. If an update breaks a build, close the pull request or fix
   the code on its branch; `@dependabot ignore this major version` stops the proposal.

### Branch protection

`main` is protected:

- A change goes in through a pull request. Force pushes and branch deletion are off.
- These checks must pass, because they run on every pull request: **Secret scan (gitleaks)**,
  **Analyze (javascript-typescript)**, **Analyze (go)**, **Analyze (actions)** and
  **Dependency review**. The other workflows run only when their paths change; check them on the
  pull request before the merge.
- A pull request needs one approving review, and open review conversations must be resolved.

The project has one maintainer, and GitHub does not count the approval of the author. So the
maintainer merges as administrator (`gh pr merge N --merge --admin`) after the checks are green,
and pushes the `cz bump` commit and tag of a release directly. The protection still applies to
everybody else. A pull request from another person gets a real review from the maintainer.

### Signed artifacts

| Artifact | Proof | Made by |
|---|---|---|
| Backend and frontend images | GitHub build attestation, in the registry (`gh attestation verify oci://ghcr.io/oriolrius/pki-manager-web/backend:<tag> --owner oriolrius`) | `docker-build.yml` |
| Issuer image | cosign keyless signature | `k8s-issuer.yml` |
| `krl-client-linux-amd64` (release asset) | cosign keyless signature (`.sig`, `.pem`), `checksums.txt`, SPDX SBOM, and SLSA provenance `krl-client-linux-amd64.intoto.jsonl` | `krl-client.yml` |

The SLSA provenance is made by the generic generator of
[slsa-github-generator](https://github.com/slsa-framework/slsa-github-generator) in a job of its
own, which the build job cannot change. Check a downloaded binary with
[slsa-verifier](https://github.com/slsa-framework/slsa-verifier):

```bash
slsa-verifier verify-artifact krl-client-linux-amd64 \
  --provenance-path krl-client-linux-amd64.intoto.jsonl \
  --source-uri github.com/oriolrius/pki-manager-web \
  --source-tag vX.Y.Z
```

The first release with the provenance file is the one after 3.17.0.

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
