# PKI Manager - AI Assistant Instructions

## Backlog.md CLI - Task Management

### Golden Rule

**NEVER edit task files directly. Always use `backlog` CLI commands.**

### Core Commands

```bash
# View/Search (use --plain for AI-readable output)
backlog task <id> --plain              # View task details
backlog task list --plain              # List all tasks
backlog search "keyword" --plain       # Search tasks

# Task Lifecycle
backlog task create "Title" -d "Description" --ac "Criterion"
backlog task edit <id> -s "In Progress" -a @myself  # Start work
backlog task edit <id> --plan $'1. Step\n2. Step'   # Add plan
backlog task edit <id> --check-ac 1                 # Mark AC complete
backlog task edit <id> --notes "Done X, Y, Z"       # Add PR description
backlog task edit <id> -s Done                      # Mark complete

# Multi-line input requires ANSI-C quoting: $'line1\nline2'
```

### Task Workflow

1. **Start**: `backlog task edit <id> -s "In Progress" -a @myself`
2. **Plan**: Add implementation plan with `--plan`
3. **Implement**: Check ACs progressively with `--check-ac <index>`
4. **Notes**: Add PR-ready description with `--notes` or `--append-notes`
5. **Complete**: `backlog task edit <id> -s Done`

### Acceptance Criteria Rules

- Must be **outcome-oriented** and **testable** (not implementation steps)
- Good: "User can login with valid credentials"
- Bad: "Add handleLogin() function in auth.ts"
- Use multiple `--check-ac` flags: `--check-ac 1 --check-ac 2 --check-ac 3`

### Quick Reference

| Action | Command |
|--------|---------|
| Add AC | `--ac "Criterion"` (multiple flags allowed) |
| Check AC | `--check-ac <index>` (multiple flags allowed) |
| Remove AC | `--remove-ac <index>` |
| Edit title | `-t "New Title"` |
| Edit description | `-d "Description"` |
| Change status | `-s "Status"` |
| Assign | `-a @user` |
| Add labels | `-l label1,label2` |

---

## Codebase Structure

### Architecture

Frontend (React + TanStack Router) ↔ tRPC ↔ Backend (Fastify) ↔ SQLite (Drizzle) ↔ Cosmian KMS

### Tech Stack

**Backend:**

- Fastify 5.2 (HTTP server)
- tRPC 11.0 (type-safe RPC)
- Drizzle ORM 0.36 (SQLite)
- Zod 3.24 (validation)
- Vitest 2.1 (testing)

**Frontend:**

- React 19.1
- TanStack Router 1.133 (file-based routing)
- TanStack Query 5.90 (data fetching)
- Tailwind CSS 4.1
- Vite 6.0

### Directory Structure

```
pki-manager/
├── backend/src/
│   ├── server.ts           # Fastify server entry
│   ├── trpc/
│   │   ├── router.ts       # Main API router
│   │   ├── schemas.ts      # Zod validation schemas
│   │   └── procedures/     # API endpoints by domain
│   │       ├── ca.ts
│   │       ├── certificate.ts
│   │       └── crl.ts
│   └── db/
│       └── schema.ts       # Drizzle ORM schema
├── frontend/src/
│   ├── main.tsx            # App entry
│   ├── routes/             # File-based routing
│   │   ├── __root.tsx      # Layout + nav
│   │   ├── index.tsx       # Dashboard (/)
│   │   ├── cas.tsx         # /cas
│   │   └── certificates.tsx # /certificates
│   └── lib/
│       └── trpc.ts         # tRPC client config
└── backlog/
    ├── tasks/              # Active tasks
    └── docs/               # Documentation
```

### Common Patterns

**Add API Endpoint:**

1. Define schema in `backend/src/trpc/schemas.ts`
2. Add procedure in `backend/src/trpc/procedures/*.ts`
3. Use in frontend: `trpc.resource.method.useQuery/useMutation()`

**Add Frontend Route:**

1. Create `frontend/src/routes/filename.tsx` → `/filename`
2. Use `filename.$id.tsx` for dynamic routes → `/filename/:id`

**Database Changes:**
```bash
# Edit backend/src/db/schema.ts, then:
cd backend && pnpm db:generate && pnpm db:migrate
```

### Development

```bash
# Terminal 1: Backend
cd backend && pnpm dev        # http://localhost:3000

# Terminal 2: Frontend
cd frontend && npm run dev    # http://localhost:5173

# Testing
cd backend && pnpm test

# Database GUI
cd backend && pnpm db:studio  # http://localhost:4983
```

### Key Files

**Backend:**

- [server.ts](backend/src/server.ts) - Fastify server
- [router.ts](backend/src/trpc/router.ts) - tRPC router
- [schemas.ts](backend/src/trpc/schemas.ts) - Zod schemas
- [schema.ts](backend/src/db/schema.ts) - DB schema

**Frontend:**

- [main.tsx](frontend/src/main.tsx) - Entry point
- [trpc.ts](frontend/src/lib/trpc.ts) - tRPC client
- [__root.tsx](frontend/src/routes/__root.tsx) - Navigation

### Troubleshooting

| Issue | Solution |
|-------|----------|
| tRPC type errors | Run `pnpm dev` in backend |
| Frontend can't connect | Check `VITE_API_URL` |
| Database locked | Close Drizzle Studio |
| Port in use | `lsof -ti:3000 \| xargs kill` |

---

## Best Practices

- **Type Safety**: Use Zod for all input validation
- **State**: tRPC cache for server state, useState for local
- **Errors**: Try-catch async ops, user-friendly messages
- **Performance**: Use React Query caching, pagination for lists
- **Testing**: Write tests in `*.test.ts` files
- **File References**: Use markdown links `[file.ts](path/file.ts)` or `[file.ts:42](path/file.ts#L42)`

## Certificate Fields

**Types:** server, client, email, code_signing

**Subject Fields (Required):**
- CN (Common Name)
- O (Organization)
- C (Country - 2 letters)

**Optional:** OU, ST, L

**SANs:** DNS names, IP addresses, Email addresses
