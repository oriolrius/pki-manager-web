# PKI Manager

A web-based Public Key Infrastructure management application for securely generating, issuing, managing, and revoking X.509 digital certificates.

## Architecture

This is a monorepo project with two main packages:

- **Backend**: Node.js/Fastify API server with tRPC
- **Frontend**: React 19 SPA with TanStack Router

## Technology Stack

### Backend
- **Framework**: Fastify
- **API Layer**: tRPC v11
- **Database**: SQLite with better-sqlite3
- **ORM**: Drizzle ORM
- **KMS**: Cosmian KMS for key management
- **Runtime**: Node.js 20+

### Frontend
- **Framework**: React 19
- **Routing**: TanStack Router
- **State Management**: TanStack Query
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Build Tool**: Vite

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up environment variables:
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your configuration
   ```

3. Run database migrations (after task-002 is completed):
   ```bash
   cd backend
   pnpm db:migrate
   ```

4. Start development servers:
   ```bash
   pnpm dev
   ```

   This will start:
   - Backend API at http://localhost:3000
   - Frontend at http://localhost:5173

## Project Structure

```
pki-manager/
├── backend/
│   ├── src/
│   │   ├── server.ts          # Fastify server
│   │   ├── trpc/              # tRPC routers and procedures
│   │   ├── db/                # Database schema and migrations
│   │   └── kms/               # Cosmian KMS client
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── routes/            # TanStack Router routes
│   │   ├── components/        # React components
│   │   └── lib/               # Utilities and tRPC client
│   └── package.json
└── package.json               # Root workspace configuration
```

## Available Scripts

### Root (workspace)
- `pnpm dev` - Start both frontend and backend in development mode
- `pnpm build` - Build both packages for production
- `pnpm test` - Run tests in all packages
- `pnpm typecheck` - Type check all packages
- `pnpm lint` - Lint all packages

### Backend
- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build for production
- `pnpm start` - Start production server

### Frontend
- `pnpm dev` - Start Vite dev server
- `pnpm build` - Build for production
- `pnpm preview` - Preview production build

## Development Workflow

1. Backend changes are watched and auto-reload with `tsx watch`
2. Frontend changes hot-reload with Vite HMR
3. tRPC provides end-to-end type safety between frontend and backend
4. TanStack Router generates route types automatically

## License

Proprietary - Internal Use Only
