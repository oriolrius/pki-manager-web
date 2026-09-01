# Backend - Codex Instructions

Fastify 5 ESM API for X.509 PKI, Cosmian KMS integration, and SQLite metadata. It exposes
tRPC, REST/OpenAPI, and a cluster-token external issuer API over one shared service layer.

## Commands

Run from `backend/`:

- `pnpm dev` starts `tsx watch --env-file=.env src/server.ts`.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` are the required focused checks.
- `pnpm build` uses relaxed `tsconfig.prod.json`; use `pnpm typecheck` for strict TypeScript.
- `pnpm db:generate` followed by `pnpm db:migrate` applies schema changes.

Use `.js` extensions in relative ESM imports.

## Architecture and Security

`src/server.ts` registers REST at `/api/v1`, external issuer routes at `/api/v1/external`,
tRPC at `/trpc`, and public health/CA/CRL routes. Route and procedure handlers call
`src/services/*`; services own business logic and map typed failures at the API edge.

OIDC bearer JWT auth protects tRPC and REST when configured. If `OIDC_ISSUER` or
`OIDC_AUDIENCE` is missing, OIDC is disabled, including admin checks. External issuer routes
use a separate `pkimg_` cluster token that is bound to one CA.

Private keys remain in Cosmian KMS. The database stores KMS identifiers, not private keys.
For KMS-backed CSR signing, preserve the CSR public key and avoid duplicating CSR SANs,
key usage, or EKU in explicit X.509 extensions.

## Database and Tests

SQLite uses WAL and foreign keys. Update `src/db/schema.ts`, generate a migration, then apply
it; do not hand-edit generated migration metadata. SSH zone resolution is fail-closed once
multiple zones exist, so new SSH data paths must preserve zone scoping.

Vitest runs single-fork because SQLite is shared. KMS integration tests may auto-start or skip
through `src/test/kms-helper.ts`. Add an `audit_log` record for every state-changing operation,
including failed attempts.
