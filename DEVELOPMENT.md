# Development Guide

This guide covers setting up and running PKI Manager for local development.

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker (for Cosmian KMS and Keycloak)

## Quick Start

```bash
# 1. Start infrastructure containers
cd kms && docker compose up -d          # Cosmian KMS  :42998
cd keycloak && docker compose up -d     # Keycloak     :42997 (optional, OIDC)

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 4. Run database migrations
cd backend && pnpm db:migrate

# 5. Start development servers (from root)
pnpm dev
```

### Dev stack ports

The committed dev config targets `*.ymbihq.local` on the `42xxx`/`52xxx` range
(`backend/.env`, `frontend/.env`, `frontend/vite.config.ts`) — **not** the 3000/5173
defaults.

| Service | URL | Bound by |
|---|---|---|
| Frontend (Vite) | http://wsl.ymbihq.local:52080 | `frontend/vite.config.ts` (`host: '0.0.0.0'`) |
| Backend (Fastify) | http://wsl.ymbihq.local:52081 — Swagger at `/api/docs` | `backend/.env` `PORT`/`HOST` |
| Cosmian KMS | http://localhost:42998 | `kms/docker-compose.yml` |
| Keycloak | http://localhost:42997 (admin/admin) | `keycloak/docker-compose.yml` |
| Backlog.md web UI | http://localhost:6430 | `backlog/config.yml` `defaultPort` |

## Launching the Dev Stack

`pnpm dev` at the root runs **[mprocs](https://github.com/pvolok/mprocs)** (see
`mprocs.yaml`), a TUI that supervises three panes: `backend`, `frontend`, `backlog`.

> **mprocs needs a TTY.** Backgrounding it from a script or an agent shell dies
> immediately with `Error: Stdin is not a tty.` Either run it in a real terminal, or
> start the panes individually (`cd backend && pnpm dev`, `cd frontend && pnpm dev`).

### Inside Orca (preferred)

Launch mprocs in its own visible Orca terminal tab rather than as a background process:

```bash
orca terminal create \
  --worktree path:/home/oriol/miimetiq3/pki-manager \
  --title "DEV STACK" --command "pnpm dev" --json
# → returns a handle: term_<uuid>

orca terminal read --terminal term_<uuid>   # read pane state / logs without a TTY
orca terminal switch --terminal term_<uuid> # bring the tab to the foreground
orca terminal stop  --worktree path:/home/oriol/miimetiq3/pki-manager
```

`orca terminal read` shows the mprocs process list (`backend UP`, `frontend UP`,
`backlog UP`) plus the focused pane's output — enough to verify the stack headlessly.

### Verifying

```bash
ss -ltn | grep -E ':(52080|52081|42998|42997|6430)'   # check binds
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:52081/api/v1/openapi.json
curl -s http://localhost:42998/version                # KMS liveness
```

Note: the KMS and Keycloak containers often report `unhealthy` in `docker ps` while
serving fine — probe the HTTP endpoints, don't trust the healthcheck label.

### WSL2 / Windows reachability gotcha

The Orca browser and the user resolve `localhost` on **Windows**, and WSL2 only forwards
**IPv4 (`0.0.0.0`)** binds. A server on the IPv6 wildcard (`*:PORT` in `ss`) works from
inside WSL but gives `ERR_EMPTY_RESPONSE` / a `chrome-error://` page in the browser.

- Backend and frontend already bind `0.0.0.0` — fine as-is.
- **`backlog browser` binds the IPv6 wildcard on 6430** and has no `--host` flag, so it
  is invisible from Windows. Put an IPv4 relay in front of it:

```bash
socat TCP4-LISTEN:52091,bind=0.0.0.0,fork,reuseaddr TCP4:127.0.0.1:6430 &
# then open http://localhost:52091 on Windows
```

Always confirm the bind is `0.0.0.0:PORT` (not `*:PORT`) before sending someone a URL.

### Cleaning up stale servers

Ports are shared with other projects in the runtime, so kill by PID, not by name:

```bash
for p in 52080 52081 6430 52091; do
  ss -ltnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\K[0-9]+' | head -1
done | xargs -r kill
```

## Cosmian KMS Setup

PKI Manager uses Cosmian KMS for secure key storage. For development, a standalone Docker setup is provided.

### Starting KMS

```bash
cd kms
docker compose up -d
```

The KMS service runs on port **42998** (mapped from container's internal 9998).

### Verifying KMS

```bash
curl http://localhost:42998/health
```

### KMS Configuration

The KMS configuration is in `kms/kms.toml`:

| Setting | Value | Description |
|---------|-------|-------------|
| Port | 9998 (internal) | Container internal port |
| Database | SQLite | Development database type |
| Data Path | `kms/data/` | Persistent storage location |

### Backend KMS Configuration

The backend connects to KMS via environment variables in `backend/.env`:

```env
KMS_URL=http://localhost:42998
# KMS_API_KEY=your-api-key-here (optional, for authenticated KMS)
```

## Environment Configuration

### Backend (`backend/.env`)

```env
# Server
PORT=52081
HOST=0.0.0.0
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://wsl.ymbihq.local:52080/

# Database
DATABASE_PATH=./data/pki.db

# Cosmian KMS
KMS_URL=http://localhost:42998

# SSH CA REST API without OIDC (dev only)
ALLOW_UNAUTHENTICATED_SSH_CA=true

# CRL Distribution Point
CRL_DISTRIBUTION_URL=http://wsl.ymbihq.local:52081/crl
```

With no `OIDC_ISSUER`/`OIDC_AUDIENCE` set the backend runs **fully unauthenticated** and
logs `OIDC authentication is disabled` on boot — that is the default dev posture even
when the Keycloak container is up. See [OIDC.md](OIDC.md) to enable it.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://wsl.ymbihq.local:52081/trpc
```

## Development Servers

### Running All Services

From the project root:

```bash
pnpm dev
```

### Running Services Individually

Use this when you can't give mprocs a TTY (scripts, agents, CI-ish runs):

| Terminal | Directory | Command | URL |
|----------|-----------|---------|-----|
| 1 | `kms/` | `docker compose up -d` | http://localhost:42998 |
| 2 | `keycloak/` | `docker compose up -d` | http://localhost:42997 |
| 3 | `backend/` | `pnpm dev` | http://wsl.ymbihq.local:52081 |
| 4 | `frontend/` | `pnpm dev` | http://wsl.ymbihq.local:52080 |
| 5 | repo root | `backlog browser --no-open` | http://localhost:6430 |

## Available Scripts

### Root (Workspace)

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start backend and frontend in dev mode |
| `pnpm build` | Build both packages for production |
| `pnpm test` | Run tests in all packages |
| `pnpm typecheck` | Type check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm clean` | Clean build artifacts and node_modules |
| `pnpm test:screenshots` | Run Playwright screenshot tests |

### Backend

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm test` | Run Vitest tests |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Drizzle Studio (DB GUI) at http://localhost:4983 |

### Frontend

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview production build |
| `pnpm lint` | Run ESLint |

## Project Structure

```
pki-manager/
├── backend/
│   ├── src/
│   │   ├── server.ts               # Fastify server entry point
│   │   ├── trpc/
│   │   │   ├── router.ts           # Main tRPC router
│   │   │   ├── schemas.ts          # Zod validation schemas
│   │   │   └── procedures/         # API endpoints by domain
│   │   │       ├── ca.ts           # CA management
│   │   │       ├── certificate.ts  # Certificate operations
│   │   │       ├── dashboard.ts    # Dashboard stats
│   │   │       └── crl.ts          # CRL management
│   │   ├── db/
│   │   │   ├── schema.ts           # Drizzle ORM schema
│   │   │   ├── index.ts            # Database connection
│   │   │   └── migrations/         # SQL migrations
│   │   ├── kms/
│   │   │   └── client.ts           # Cosmian KMS client
│   │   └── crypto/                 # Certificate utilities
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx                # App entry point
│   │   ├── routes/                 # TanStack Router routes
│   │   │   ├── __root.tsx          # Layout with navigation
│   │   │   ├── index.tsx           # Dashboard (/)
│   │   │   ├── cas.tsx             # CA list (/cas)
│   │   │   ├── cas.new.tsx         # Create CA (/cas/new)
│   │   │   ├── cas.$id.tsx         # CA details (/cas/:id)
│   │   │   ├── certificates.tsx    # Cert list (/certificates)
│   │   │   ├── certificates.new.tsx  # Issue cert (/certificates/new)
│   │   │   ├── certificates.$id.tsx  # Cert details (/certificates/:id)
│   │   │   └── certificates.bulk.tsx # Bulk creation (/certificates/bulk)
│   │   ├── components/             # React components
│   │   │   ├── theme-provider.tsx  # Theme context
│   │   │   └── theme-toggle.tsx    # Theme switcher
│   │   └── lib/
│   │       └── trpc.ts             # tRPC client setup
│   └── package.json
├── kms/
│   ├── docker-compose.yml          # Standalone KMS for development
│   ├── kms.toml                    # KMS configuration
│   └── data/                       # KMS SQLite data (gitignored)
├── docker/
│   └── docker-compose.yml          # Full stack for production
├── backlog/
│   ├── tasks/                      # Active task files
│   ├── docs/                       # Project documentation
│   ├── decisions/                  # Architecture decision records
│   ├── drafts/                     # Work-in-progress tasks
│   ├── completed/                  # Finished tasks
│   ├── archive/                    # Archived tasks
│   └── config.yml                  # Backlog configuration
├── tests/
│   └── screenshots.spec.ts         # Playwright screenshot tests
├── assets/                         # Screenshots for documentation
└── playwright.config.ts            # Playwright configuration
```

## Task Management with Backlog.md

This project uses [Backlog.md](https://backlog.md) CLI for task management. Tasks track planned work, implementation plans, and acceptance criteria.

### Installation

Backlog.md is installed globally (not as a project dependency):

```bash
# Install
npm install -g backlog.md

# Upgrade
npm update -g backlog.md

# Verify
backlog --version
```

### When to Create Tasks

**Create a task** when work requires planning or decision-making:
- Bug fixes that need investigation
- New features requiring design decisions
- Refactoring with architectural implications

**Skip tasks** for trivial changes:
- Typo fixes
- Version bumps
- Obvious one-line fixes

### Backlog Structure

```
backlog/
├── tasks/        # Active tasks (To Do, In Progress)
├── docs/         # Project documentation and specs
├── decisions/    # Architecture Decision Records (ADRs)
├── drafts/       # Work-in-progress task drafts
├── completed/    # Finished tasks (Done status)
└── archive/      # Archived/cancelled tasks
```

### Core Commands

```bash
# View tasks
backlog task list                    # List all active tasks
backlog task list --status "To Do"   # Filter by status
backlog task <id>                    # View task details
backlog search "keyword"             # Search tasks

# Create task
backlog task create "Title" -d "Description" --ac "Acceptance criterion"

# Task lifecycle
backlog task edit <id> -s "In Progress" -a @myself   # Start work
backlog task edit <id> --plan $'1. Step one\n2. Step two'  # Add plan
backlog task edit <id> --check-ac 1                  # Mark AC complete
backlog task edit <id> --notes "Summary of changes"  # Add PR notes
backlog task edit <id> -s Done                       # Complete task

# Documents
backlog doc list                     # List documents
backlog doc <id>                     # View document
```

### Task Workflow

1. **Search first**: Check for existing tasks before creating new ones
2. **Create task**: Define title, description, and acceptance criteria
3. **Start work**: Set status to "In Progress" and assign yourself
4. **Plan**: Add implementation plan before coding
5. **Execute**: Check off acceptance criteria as you complete them
6. **Document**: Add implementation notes (used for PR description)
7. **Complete**: Set status to "Done"

### Acceptance Criteria Guidelines

Acceptance criteria must be **outcome-oriented** and **testable**:

| Good (Outcome) | Bad (Implementation) |
|----------------|---------------------|
| "User can download certificate as PFX" | "Add downloadPfx() function" |
| "API returns 404 for invalid CA ID" | "Check if CA exists in handler" |
| "Dashboard shows expiring certificates" | "Query certificates table" |

### Command Reference

| Action | Command |
|--------|---------|
| List tasks | `backlog task list` |
| View task | `backlog task <id>` |
| Create task | `backlog task create "Title"` |
| Edit status | `backlog task edit <id> -s "In Progress"` |
| Add description | `backlog task edit <id> -d "Description"` |
| Add AC | `backlog task edit <id> --ac "Criterion"` |
| Check AC | `backlog task edit <id> --check-ac 1` |
| Add plan | `backlog task edit <id> --plan "Plan text"` |
| Add notes | `backlog task edit <id> --notes "Notes"` |
| Append notes | `backlog task edit <id> --append-notes "More notes"` |
| Assign | `backlog task edit <id> -a @username` |
| Add labels | `backlog task edit <id> -l label1,label2` |
| Archive | `backlog task archive <id>` |

### Multi-line Input

Use ANSI-C quoting for multi-line content:

```bash
backlog task edit <id> --plan $'1. First step\n2. Second step\n3. Third step'
```

### Web Interface

Backlog includes a browser-based UI for visual task management:

```bash
# Start web interface (opens browser automatically)
backlog browser

# Custom port
backlog browser --port 8080

# Don't auto-open browser
backlog browser --no-open
```

Default port is 6430 (configurable in `backlog/config.yml`).

### Terminal Board View

View tasks as a Kanban board in the terminal:

```bash
# Horizontal layout (default)
backlog board

# Vertical layout
backlog board --vertical

# Group by milestone
backlog board --milestones

# Export board to markdown
backlog board export board.md
```

### Project Overview

Display project statistics and metrics:

```bash
backlog overview
```

### Tips

- Use `--plain` flag for machine-readable output
- Multiple `--ac` flags add multiple acceptance criteria
- Multiple `--check-ac` flags check multiple criteria at once
- Tasks auto-commit to git when `auto_commit: true` in config
- Press `Ctrl+C` to stop the web interface

## Development Workflow

### Adding API Endpoints

1. **Define schema** in `backend/src/trpc/schemas.ts`:

```typescript
export const createCertificateSchema = z.object({
  caId: z.string().uuid(),
  subjectDn: z.string(),
  // ...
});
```

2. **Add procedure** in `backend/src/trpc/procedures/certificate.ts`:

```typescript
export const certificateProcedures = {
  create: protectedProcedure
    .input(createCertificateSchema)
    .mutation(async ({ input, ctx }) => {
      // Implementation
    }),
};
```

3. **Use in frontend**:

```typescript
const mutation = trpc.certificate.create.useMutation();
await mutation.mutateAsync({ caId, subjectDn, /* ... */ });
```

### Adding Frontend Routes

Create file in `frontend/src/routes/`:

| File Pattern | Route |
|--------------|-------|
| `filename.tsx` | `/filename` |
| `filename.$id.tsx` | `/filename/:id` |
| `filename.new.tsx` | `/filename/new` |

### Database Changes

```bash
# 1. Edit backend/src/db/schema.ts
# 2. Generate migration
cd backend && pnpm db:generate

# 3. Apply migration
pnpm db:migrate
```

## Testing

### Unit Tests

```bash
cd backend && pnpm test
```

### Screenshot Tests

Automated screenshot testing with Playwright:

```bash
# Run all screenshot tests
pnpm test:screenshots

# Run with UI mode
pnpm test:screenshots:ui

# Run specific test
pnpm playwright test tests/screenshots.spec.ts -g "Dashboard"
```

Screenshots are saved to `assets/` directory.

## Docker Compose Files

The project includes two Docker Compose configurations:

| File | Purpose | Usage |
|------|---------|-------|
| `kms/docker-compose.yml` | Standalone KMS for development | `cd kms && docker compose up -d` |
| `docker/docker-compose.yml` | Full stack (KMS + backend + frontend) | Production/integration testing |

### Full Stack Deployment

For production or integration testing with all services containerized:

```bash
cd docker
docker compose up -d
```

Services:
- **KMS**: Internal network only (port 9998)
- **Backend**: http://localhost:3000
- **Frontend**: http://localhost:8080

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **tRPC type errors** | Run `pnpm dev` in backend to regenerate types |
| **Frontend can't connect** | Check `VITE_API_URL` in frontend env |
| **Database locked** | Close Drizzle Studio (`pnpm db:studio`) |
| **Port in use** | Kill by PID: `ss -ltnp \| grep :52081` then `kill <pid>` |
| **`pnpm dev` exits with `Stdin is not a tty`** | mprocs needs a real terminal — see [Launching the Dev Stack](#launching-the-dev-stack) |
| **Browser shows `ERR_EMPTY_RESPONSE` / `chrome-error://`** | Server bound IPv6 (`*:PORT`); WSL2 only forwards `0.0.0.0` — see the reachability gotcha above |
| **Container marked `unhealthy` but works** | Known for the KMS/Keycloak dev images; probe the HTTP endpoint instead |
| **KMS connection fails** | Verify KMS is running: `curl http://localhost:42998/version` |
| **KMS not starting** | Check Docker: `cd kms && docker compose logs` |
| **Certificate creation fails** | Check KMS permissions and CA validity |

## Building for Production

```bash
# Build both packages
pnpm build

# Start production servers
cd backend && pnpm start    # Backend
cd frontend && pnpm preview # Frontend preview
```
