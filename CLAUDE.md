# PKI Manager - AI Assistant Instructions

Web PKI manager: CA hierarchies, X.509 issue/renew/revoke, CRLs, and a cert-manager
external issuer for Kubernetes. Private keys live in a **Cosmian KMS**; metadata in SQLite.

## Backlog.md CLI — Task Management

**Golden rule: NEVER edit task files directly — always use the `backlog` CLI.**
(`AGENTS.md` is the auto-generated long-form of these rules.)

```bash
backlog task <id> --plain                              # view (--plain = AI output)
backlog task list --plain                              # list
backlog search "kw" --plain                            # search
backlog task create "Title" -d "Desc" --ac "Criterion"
backlog task edit <id> -s "In Progress" -a @myself     # start
backlog task edit <id> --plan $'1. Step\n2. Step'      # plan (ANSI-C quoting for newlines)
backlog task edit <id> --check-ac 1                    # tick an AC
backlog task edit <id> --notes "PR description" -s Done # finish
```

Workflow: start → `--plan` → implement + `--check-ac <i>` → `--notes` → `-s Done`.
ACs must be **outcome-oriented and testable** ("User can log in"), not implementation steps.

| Action | Flag |
|---|---|
| Add / check / remove AC | `--ac "..."` / `--check-ac <i>` / `--remove-ac <i>` |
| Title / desc / status / assignee | `-t` / `-d` / `-s` / `-a` |
| Labels | `-l a,b` |

## Repository Layout

pnpm monorepo (workspaces `frontend`, `backend`) + a standalone Go module + infra dirs.

```
backend/      Fastify: tRPC + REST/OpenAPI API, crypto, KMS, SQLite   → backend/CLAUDE.md
frontend/     React 19 SPA: TanStack Router/Query + tRPC + OIDC       → frontend/CLAUDE.md
k8s/issuer/   Go cert-manager external issuer (own go.mod, Helm)      → k8s/issuer/CLAUDE.md
docker/       Full-stack Compose + Dockerfile          → DEPLOYMENT.md
keycloak/     Keycloak dev IdP + realm import          → KEYCLOAK.md
kms/          Cosmian KMS dev stack                    → kms/README.md
ansible/      SSH host-cert deploy role                → ansible/README.md
docs/ssh/     SSH onboarding guides (concept/quickstart/setup) → docs/ssh/concept.md
tests/        Playwright E2E (auth, RBAC, screenshots)
backlog/      Backlog.md tasks / docs / decisions
```

Per-directory guides: [backend](backend/CLAUDE.md) · [frontend](frontend/CLAUDE.md) ·
[k8s/issuer](k8s/issuer/CLAUDE.md). Read the relevant one for verified commands,
architecture, and gotchas before working in that subsystem.

## Architecture

```
React SPA ──tRPC──┐                 Keycloak (OIDC) ── bearer JWT
                  ▼
Backend (Fastify): /trpc · /api/v1 (REST+Swagger) · /api/v1/external (cluster tokens)
   └ services/ → crypto (node-forge) · Cosmian KMS (KMIP/HTTP, private keys) · SQLite (Drizzle)
k8s/issuer (Go) ── POST /api/v1/external/sign ──► Backend   (one cluster token = one CA)
```

The `services/` layer is exposed over **two APIs**: typed tRPC (`/trpc`, used by the
frontend) and REST/OpenAPI (`/api/v1`, Swagger at `/api/docs`), plus a cluster-token
external-issuer API. **OIDC is optional** — with no `OIDC_ISSUER`/`OIDC_AUDIENCE` set, the
backend runs fully unauthenticated.

## Tech Stack

| Area | Stack |
|---|---|
| Backend | Fastify 5 · tRPC v11 · Drizzle + better-sqlite3 · Zod · node-forge · jose · Vitest |
| Frontend | React 19 · TanStack Router/Query · tRPC client · Tailwind 4 · Vite 7 · Vitest+RTL |
| Issuer | Go 1.23 · controller-runtime 0.20 · cert-manager 1.16 · Helm |
| Tooling | pnpm workspaces (Node ≥20, pnpm ≥9) · Commitizen conventional commits |

## Root Commands

| Command | Action |
|---|---|
| `pnpm dev` | **mprocs** TUI: `backend` + `frontend` + `backlog` panes (needs a TTY) |
| `pnpm build` / `test` / `typecheck` / `lint` | fan out to both workspaces (`-r`) |
| `pnpm test:screenshots` | Playwright `tests/screenshots.spec.ts` |

Per-workspace commands (DB migrations, ports, build modes) live in the subsystem guides;
the Go issuer uses `make` from `k8s/issuer/`.

## Local Dev Quick Start

```bash
cd kms && docker compose up -d          # Cosmian KMS  (:42998)
cd keycloak && docker compose up -d     # Keycloak     (:42997, admin/admin)
pnpm install
cp backend/.env.example backend/.env && cp frontend/.env.example frontend/.env
cd backend && pnpm db:migrate
pnpm dev                                # mprocs: backend :52081 + frontend :52080 + backlog :6430
```

**Launching the stack as an agent — read
[DEVELOPMENT.md § Launching the Dev Stack](DEVELOPMENT.md#launching-the-dev-stack) first.**
Two things bite every time: `pnpm dev` runs **mprocs**, which dies with `Stdin is not a
tty` if backgrounded — launch it in a real terminal
(`orca terminal create --worktree path:<repo> --title "DEV STACK" --command "pnpm dev"`,
then `orca terminal read`); and WSL2 only forwards **IPv4** binds to the Windows browser,
so anything on the IPv6 wildcard (`*:PORT`, e.g. `backlog browser` on 6430) needs a socat
relay. That doc also has the real port table, verify commands, and cleanup-by-PID recipe.

The committed dev config targets `*.ymbihq.local` on the `42xxx`/`52xxx` port range — see
[frontend/CLAUDE.md](frontend/CLAUDE.md) and edit the `.env` files for local-only dev.
Details: [DEVELOPMENT.md](DEVELOPMENT.md) (dev), [DEPLOYMENT.md](DEPLOYMENT.md) (Docker),
[KEYCLOAK.md](KEYCLOAK.md) / [OIDC.md](OIDC.md) (auth).

## Conventions

- **New endpoint**: Zod schema → `services/*` method → expose via a tRPC procedure and/or
  REST route (both delegate to the service).
- **New frontend route**: add `frontend/src/routes/<name>.tsx`; the router plugin
  regenerates `routeTree.gen.ts`.
- **DB change**: edit `backend/src/db/schema.ts` → `pnpm db:generate && pnpm db:migrate`.
- Write an `audit_log` row for every state-changing operation (success and failure).

## Certificate Fields

- **Types:** `server`, `client`, `email`, `code_signing` (schema also allows `dual`)
- **Required subject:** CN, O, C (2-letter). **Optional:** OU, ST, L.
- **SANs:** DNS, IP, email.
