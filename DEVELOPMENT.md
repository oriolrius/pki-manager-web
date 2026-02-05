# Development Guide

This guide covers setting up and running PKI Manager for local development.

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker (for Cosmian KMS)

## Quick Start

```bash
# 1. Start Cosmian KMS
cd kms && docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp backend/.env.example backend/.env

# 4. Run database migrations
cd backend && pnpm db:migrate

# 5. Start development servers (from root)
pnpm dev
```

This starts:
- **Cosmian KMS** at http://localhost:42998
- **Backend API** at http://localhost:3000
- **Frontend** at http://localhost:5173

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
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://localhost:5173

# Database
DATABASE_PATH=./data/pki.db

# Cosmian KMS
KMS_URL=http://localhost:42998

# CRL Distribution Point
CRL_DISTRIBUTION_URL=http://localhost:3000/crl
```

## Development Servers

### Running All Services

From the project root:

```bash
pnpm dev
```

### Running Services Individually

| Terminal | Directory | Command | URL |
|----------|-----------|---------|-----|
| 1 | `kms/` | `docker compose up -d` | http://localhost:42998 |
| 2 | `backend/` | `pnpm dev` | http://localhost:3000 |
| 3 | `frontend/` | `pnpm dev` | http://localhost:5173 |

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
├── tests/
│   └── screenshots.spec.ts         # Playwright screenshot tests
├── assets/                         # Screenshots for documentation
└── playwright.config.ts            # Playwright configuration
```

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
| **Port in use** | Kill process: `lsof -ti:3000 \| xargs kill` |
| **KMS connection fails** | Verify KMS is running: `curl http://localhost:42998/health` |
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
