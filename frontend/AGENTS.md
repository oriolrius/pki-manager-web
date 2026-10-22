# Frontend — PKI Manager Web UI

React 19 SPA: **TanStack Router** (file-based) + **TanStack Query** + a **tRPC v11** client
that imports the backend's `AppRouter` type for end-to-end type safety. **OIDC** auth
(oidc-client-ts + react-oidc-context, provider-agnostic), **Tailwind 4**, **Vite 7**, Vitest +
RTL. See the root `AGENTS.md` for repo-wide rules.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Vite dev — host `0.0.0.0`, **port `52080`** (not 5173) |
| `npm run build` | `tsc -b && vite build` |
| `npm run build:docker` | `vite build` only (relaxed `tsconfig.build.json`) |
| `npm run typecheck` / `lint` / `test` | `tsc --noEmit` / `eslint .` / `vitest run` |

Use **npm** here (this dir has `package-lock.json`), even though the repo root uses pnpm.

## Architecture

`main.tsx`: `loadConfig()` (fetch `/config.json`) → `initTrpcClient()` → render
(`ThemeProvider → trpc.Provider → QueryClientProvider → RouterProvider`).
`AuthProvider`/`AuthGuard` wrap the router root (`routes/__root.tsx`), not `main.tsx`.

- **tRPC ↔ Query**: `src/lib/trpc.ts` = `createTRPCReact<AppRouter>()`; `AppRouter` is a
  **type** imported from `../../../backend/...` (no codegen — backend types flow in directly,
  so the backend must compile). Call `trpc.<router>.<proc>.useQuery/useMutation()`.
- **Auth on requests**: `httpBatchLink` `headers` fn calls `getAccessToken()` and sets
  `Authorization: Bearer …` when a token exists.

## Routing (file-based, flat naming)

Dots → `/` segments; `$id` = param; `routeTree.gen.ts` is **generated** (router Vite plugin)
— never edit. Add a route: create `src/routes/<name>.tsx` exporting `createFileRoute`.

| File | URL |
|---|---|
| `__root.tsx` | layout (nav + global auth via `AuthGuard`) |
| `index.tsx` / `callback.tsx` | `/` / `/callback` (OIDC) |
| `cas.tsx` · `cas.new.tsx` · `cas.$id.tsx` | `/cas` · `/cas/new` · `/cas/$id` |
| `certificates.tsx` · `.new` · `.bulk` · `.$id` | `/certificates[...]` |
| `clusters.tsx` / `api-docs.tsx` | `/clusters` / `/api-docs` |

`_authenticated.tsx` exists but its folder is **empty/unused** — auth is enforced globally.

## Config & auth (custom — read before touching)

Two config layers, **runtime wins**: build-time `VITE_*` (`VITE_API_URL`, `VITE_OIDC_*`) vs
runtime `public/config.json` (fetched at startup; `apiUrl` + optional `oidc` block). Ships
with placeholder `{"apiUrl":"__API_URL__"}` substituted at deploy time. **OIDC is optional**
— enabled only when an authority is set; otherwise the app runs unauthenticated.

The whole flow is the library's (PR #7): endpoints come from OIDC discovery, login/logout are
`signinRedirect`/`signoutRedirect`, PKCE + state/nonce are validated by oidc-client-ts. One
**shared `UserManager`** (`token.ts` `getUserManager()`) feeds both `AuthProvider` (via its
`userManager` prop) and the tRPC `getAccessToken()`, which renews on demand (`signinSilent`,
single-flight, 60 s buffer). The session lives in **`localStorage`** (`userStore`), key
`oidc.user:<authority>:<clientId>`. **Requires a secure context** (HTTPS or
`http://localhost`): `AuthProvider` shows an explicit error otherwise. There is no
non-HTTPS fallback any more — don't reintroduce one. Silent renew prefers the refresh
token; the iframe fallback uses `public/silent-renew.html` (loads oidc-client-ts from a **CDN**).

## Styling

Tailwind **4** via PostCSS (no `tailwind.config.js`; tokens are CSS-first in `src/index.css`
`@theme`). Dark mode is class-based (`ThemeProvider`, persisted `vite-ui-theme`).
`components.json` references shadcn config that doesn't exist — treat as aspirational.

## Gotchas

- **Dev port `52080`, open it as `http://localhost:52080`.** `vite.config.ts` has no
  `allowedHosts`, so only localhost/IPs are accepted, and only localhost is a secure context.
- `build:docker`/`tsconfig.build.json` **relax strictness** — run `npm run typecheck` to catch real type errors.
- `silent-renew.html` pulls oidc-client-ts from a public CDN — silent renew breaks in air-gapped envs.
