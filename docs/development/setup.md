# Development setup

Run PKI Manager from source on your machine. `just` is the entry point for every task:
run `just` to list the recipes.

## Prerequisites

- Node.js 22 (LTS) and pnpm >= 9. The file `.nvmrc` at the repository root holds the Node.js
  major version (`nvm use`, `fnm use`). CI reads the same file, and `docker/Dockerfile` uses
  `node:22-alpine`. The website in `site/` pins its own exact version in `site/.nvmrc`.
- Docker with Compose v2 for OpenBao and Keycloak, and OpenSSL for the dev TLS certificates
- [just](https://just.systems), [tmux](https://github.com/tmux/tmux) and [mprocs](https://github.com/pvolok/mprocs) for the dev stack
- Optional: the [Backlog.md](https://backlog.md) CLI (`npm install -g backlog.md`) and
  [socat](http://www.dest-unreach.org/socat/) for the task board

## First run

```bash
just setup    # install dependencies, create backend/.env and frontend/.env, migrate the dev database
just dev      # start OpenBao and Keycloak (Docker), then backend, frontend and the task board
```

Then open **http://localhost:52080** and log in as **`admin` / `admin`** (realm role `admin`)
or **`user` / `user`** (realm role `user`). These are the users of the dev realm `pki-dev`
(`keycloak/pki-dev-realm.json`).

### Dev stack ports

The dev stack runs on **`localhost`** in the `42xxx`/`52xxx` range
(`backend/.env`, `frontend/.env`, `frontend/vite.config.ts`), **not** on the 3000/5173
defaults. Backend and frontend bind IPv4 `0.0.0.0`.

**Use `localhost`, not another host name.** OIDC login (PKCE) needs `crypto.subtle`, which
browsers only expose in a secure context: HTTPS or `http://localhost`. Over plain HTTP on
any other name the app shows *"Login requires a secure context"*. Production must be served
over HTTPS.

| Service | URL | Set in |
|---|---|---|
| Frontend (Vite) | http://localhost:52080 | `frontend/vite.config.ts` (`host: '0.0.0.0'`, `strictPort`) |
| Backend (Fastify) | http://localhost:52081 (Swagger at `/api/docs`) | `backend/.env` `PORT`/`HOST` |
| OpenBao | https://localhost:42996 | `openbao/docker-compose.yml`, `scripts/dev-session.sh` |
| Keycloak | http://localhost:42997 (admin/admin) | `keycloak/docker-compose.yml` |
| Backlog.md web UI | http://localhost:52082, on all interfaces | `scripts/dev-session.sh` (`BACKLOG_PORT`; Backlog itself on `127.0.0.1:52083`) |

`just urls` prints this list for your checkout.

## The dev stack

`just dev` runs **`scripts/dev-session.sh`**, which keeps **mprocs** (see `mprocs.yaml`: two
processes, `backend` and `frontend`) inside a **tmux session named `dev-pki-manager`**, and the
Backlog.md web UI in a second tmux session, `backlog-pki-manager`.

| Command | Does |
|---|---|
| `just dev` | **Restarts** the stack: stops this repository's old processes, starts and unseals OpenBao, starts Keycloak when configured, starts mprocs, and opens it when there is a terminal |
| `just openbao` | Start or unseal only the dev key store and print the backend connection settings |
| `just backlog` | **Restarts** only the Backlog.md web UI, on `0.0.0.0:52082` (see below) |
| `just attach` | Opens the running stack. Does not restart it |
| `just status` | Is it running, who holds our ports, the current mprocs screen |
| `just logs [backend\|frontend\|backlog] [lines]` | Last lines of the process logs (`.dev-logs/<name>.log`) |
| `just stop` | Stops the processes. OpenBao and Keycloak keep running, so the next `just dev` is fast |
| `just down` | `just stop`, plus the OpenBao and Keycloak containers. Containers and data are kept |

**Why a restart.** `just dev` always gives you new processes, so the backend and the frontend
run the code and the `.env` files that are on disk now. There is never a second stack on other
ports, and never an old process that still answers.

**Why tmux.** The terminal that starts the stack does not own it. When the terminal closes, the
stack keeps running, and `just attach` opens it again. The session is created detached, so an
agent can run `just dev` without a TTY: it prints the URLs and the mprocs screen, and
`just logs backend` reads the output of one process.

**What it never does.** It never matches a process by name, because other projects run their own
mprocs, node and vite. A process is ours only when its working directory is inside this
repository or one of its git worktrees. When another project holds one of our ports, `just dev`
stops and names the process; it does not kill it.

**The task board on all interfaces.** `backlog browser` listens on `127.0.0.1` only and has
no option to change it. So the script starts it on `127.0.0.1:52083` and a `socat` relay
publishes it on `0.0.0.0:52082`: open it from Windows, from the LAN or from a tablet with
`http://<host>:52082`. Backlog is restarted when it exits, and it has a 1 GB memory cap
(it leaks memory on a busy repository). `just backlog` stops only this repository's board
(the same ownership rule), never the board of another project.

Worktrees share one dev stack. OpenBao keeps its Raft data, TLS files, audit logs and dev
credentials in `openbao/dev-state/` in the main checkout. The dev bootstrap keeps the unseal
key and a root token there to restart this disposable store. The backend gets a scoped token.

### Check it

```bash
just status
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:52081/api/v1/openapi.json
# Run from the root of the main checkout.
curl -fsS --cacert openbao/dev-state/tls/ca.pem https://localhost:42996/v1/sys/health
```

## Environment configuration

`just setup` copies the two example files. Edit the copies; they are not committed.

### Backend (`backend/.env`)

```env
# Server
PORT=52081
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_PATH=./data/pki.db

# CRL Distribution Point
CRL_DISTRIBUTION_URL=http://localhost:52081/crl

# OIDC login — ON by default in dev (dev Keycloak, realm pki-dev)
OIDC_ISSUER=http://localhost:42997/realms/pki-dev
OIDC_AUDIENCE=pki-web,pki-service
```

`backend/.env.example` has the other variables, with comments.

**OIDC login is the default dev posture**, so dev uses the same auth path as
production. `just dev` starts the dev Keycloak when `OIDC_ISSUER` points at
`localhost:42997` and waits for it before it starts the backend. `just status` shows
whether login is on.

To run **without login** (quick UI work): comment out `OIDC_ISSUER`/`OIDC_AUDIENCE` here
*and* `VITE_OIDC_AUTHORITY` in `frontend/.env`, and add `ALLOW_UNAUTHENTICATED_SSH_CA=true`
(SSH CA routes are fail-closed without OIDC). The backend then logs
`OIDC authentication is disabled`. See [OIDC login](../operations/oidc.md#run-without-login).

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:52081/trpc

# OIDC login — ON by default in dev
VITE_OIDC_AUTHORITY=http://localhost:42997/realms/pki-dev
VITE_OIDC_CLIENT_ID=pki-web
```

## OpenBao and Keycloak containers

`just dev` supplies `OPENBAO_ADDR`, `OPENBAO_CACERT` and `OPENBAO_TOKEN_FILE` to the
backend process. To run the backend manually, run `just openbao` and export the three
settings it prints. The token setting names a file. Keep the token file and the dev
bootstrap credentials outside Git.

`openbao/image.env` pins the fork. `just openbao-image verify` checks the image revision.
Use a separate OpenBao instance for live tests as described in [Testing](testing.md#unit-tests-and-checks).
The dev realm configuration is in the [Keycloak guide](../../keycloak/README.md).

## Repository layout and code rules

- The top-level folders are described in the [README](../../README.md#repository-layout).
- Each subsystem has a guide with its commands, architecture and traps:
  [backend](../../backend/AGENTS.md), [frontend](../../frontend/AGENTS.md),
  [Kubernetes issuer](../../k8s/issuer/AGENTS.md). They are written for coding agents and are
  correct for people too.
- The rules for a change (new endpoint, new route, database change, audit log, where private
  keys may live) are the **Conventions** in [`AGENTS.md`](../../AGENTS.md).

### Database changes

```bash
# 1. Edit backend/src/db/schema.ts
# 2. Generate the migration
cd backend && pnpm db:generate

# 3. Apply it to the dev database
just db-migrate
```

`cd backend && pnpm db:studio` opens Drizzle Studio on the dev database.

### Frontend routes

Create a file in `frontend/src/routes/`. The router plugin regenerates `routeTree.gen.ts`.

| File pattern | Route |
|---|---|
| `filename.tsx` | `/filename` |
| `filename.$id.tsx` | `/filename/:id` |
| `filename.new.tsx` | `/filename/new` |

## Tests, images and releases

- [Testing](testing.md): unit tests, type checks, end-to-end tests in Docker.
- [CI and releases](ci.md): build the images from source, the workflows, how to cut a release.
- [How the docs are organised](documentation.md): where each document lives and how the site is built.

## Tasks, decisions and specifications

Work is tracked with the Backlog.md CLI in `backlog/`:

| Folder | Content |
|---|---|
| `backlog/tasks/` | Tasks, with acceptance criteria and notes |
| `backlog/decisions/` | Decision records in force: why something is built the way it is |
| `backlog/docs/` | Specifications: the plan of a large piece of work that is open now |
| `backlog/archive/` | Finished tasks, replaced decisions and the plans of finished work |

The task board starts with the dev stack, or alone with `just backlog` (http://localhost:52082). The rules for
tasks (always through the CLI, never by editing the files) are in [`AGENTS.md`](../../AGENTS.md).
Decisions and specifications are published on the site, under **Project**, from these folders.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **`just dev` says a port belongs to another project** | Another program listens on 52080, 52081, 52082 or 52083. `just status` names it. Stop it, or change this project's ports |
| **Vite fails with "Port 52080 is already in use"** | Intentional (`strictPort`). Run `just dev`: it stops this repository's old stack first |
| **`Stdin is not a tty`** | You ran `mprocs` directly. Use `just dev`: it runs mprocs inside tmux and works without a terminal |
| **Frontend can't connect** | Check `VITE_API_URL` in `frontend/.env` |
| **Login page says "Login requires a secure context"** | Open the app with `http://localhost:52080`, not with another host name |
| **Database locked** | Close Drizzle Studio (`pnpm db:studio`) |
| **OpenBao connection fails** | Run `just openbao`. Check the TLS health endpoint above and the token file path |
| **OpenBao fails to start** | Read its logs with `docker logs pki-manager-openbao` |
| **Certificate creation fails** | Check that OpenBao is unsealed, accepts the backend token and that the issuing CA is active |
