# Backend — `@pki-manager/backend`

Fastify 5 (ESM, Node ≥22) server exposing **two parallel APIs** over one shared service
layer. The backend builds X.509 certificates and CRLs and signs them with **OpenBao Transit**.
SQLite holds metadata and public certificates (Drizzle + better-sqlite3). See the root `AGENTS.md` for repo-wide rules.

## Commands

| Command | Runs |
|---|---|
| `pnpm dev` | `tsx watch --env-file=.env src/server.ts` |
| `pnpm build` / `build:strict` | `tsc -p tsconfig.prod.json` (strict, no tests) / `tsc` (strict, incl. tests) |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm test` / `test:coverage` | Vitest |
| `pnpm lint` | `eslint src --ext .ts` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | drizzle-kit / `tsx src/db/migrate.ts` / studio |

`tsconfig.prod.json` is full strict (only unused-symbol checks relaxed, tests excluded) —
never reintroduce `strict: false`: without `strictNullChecks` Drizzle/Zod inference silently
mistypes inserts. Run `pnpm typecheck` to cover tests too. Use `.js` extensions in relative
imports (ESM).

## Architecture

`src/server.ts` registers, in order:
- **REST** (`src/rest/`) at `/api/v1` — Swagger UI `/api/docs`, spec `/api/v1/openapi.json|yaml`.
- **External issuer** at `/api/v1/external` — cluster-token auth, separate from OIDC.
- **tRPC** (`src/trpc/`) at `/trpc` — routers: `ca, certificate, crl, audit, domain, search, dashboard, cluster, health`.
- **Public** server routes: `GET /health`, `GET /cas/:caId.:fmt`, `GET /crl/:caId.:fmt`.

Flow: **route/procedure → service (`src/services/*`) → crypto / OpenBao / db.** Both API layers
call the *same* singleton services — put business logic in services, not routes. Services
throw typed errors (`CANotFoundError`, …); the edge maps them to tRPC/HTTP codes.

## Auth (two independent mechanisms)

- **OIDC bearer JWT** (tRPC + REST): `src/lib/oidc.ts` + `jwt.ts` (JWKS via `jose`).
  **If `OIDC_ISSUER`/`OIDC_AUDIENCE` are unset, OIDC is disabled and all auth + admin
  checks are skipped (every endpoint is public).** Roles from `OIDC_ROLES_CLAIM` (default
  `realm_access.roles`), read from the access token, or — with `OIDC_ROLES_SOURCE=userinfo`
  — from the issuer's UserInfo endpoint per request (`resolveRoles`, after local JWT
  validation; fails closed, no cache).
- **Cluster bearer tokens** (external API only): `pkimg_<...>`, looked up by 12-char
  prefix, compared SHA-256 + `timingSafeEqual` (the `schema.ts` "argon2" comment is wrong).
  Each cluster is scoped to one CA.

## Key storage and signing

- X.509 routes use `src/kms/service.ts` (`KMSService`), which delegates to
  `src/keystore/x509-store.ts`. It keeps the existing API fields and `kms.*` audit operation
  names. New key operations record `provider: openbao`.
- `src/openbao/x509-transit.ts` creates RSA or EC keys and sends signing requests to the
  pinned key version. Public CA and leaf certificates live in SQLite. CA key export depends
  on `ALLOW_CA_KEY_EXPORT`, the key's creation policy and the OpenBao token policy.
- SSH CAs use `src/openbao/ssh-transit.ts`. SCEP RA bindings use `src/openbao/ra-transit.ts`.
  Both keep non-exportable keys. RA decryption uses the fork's
  `session-key/pkcs1v15` endpoint with the expected CMS key size.

## Data model — `src/db/schema.ts`

SQLite (Drizzle; WAL + `foreign_keys=ON`; path `DATABASE_PATH`, default `./data/pki.db`).
X.509 records use `kms_*` columns to link to `keystore_objects`. This table stores the public
certificate PEM, key links, Transit mount, name, version and public key. Other tables include
`integrations`, `crls` and `audit_log`.
DB change: edit `schema.ts` → `pnpm db:generate` → `pnpm db:migrate`; never hand-edit the
generated migration metadata (`src/db/migrations/meta`). New SSH data paths must stay zone-scoped.

**SSH Zones** (decision-017, migration `0009`): a generic `zones` table; `ssh_cas`,
`ssh_hosts`, `ssh_identities`, `ssh_principals`, `ssh_fleet_tokens` carry a
`zone_id NOT NULL DEFAULT 'default'` FK (`ON DELETE RESTRICT`); the CA partial-unique
indexes are `(zone_id, ca_type)` and the natural keys `(zone_id, fqdn|subject|name)`. A host
trusts only its own zone's user CAs (`ssh-host-krl.service` narrows the composed KRL union to
`host.zone_id`). Zone lookup is **fail-closed** via `resolveZone(ctx, explicit?)` in
`services/ssh-zone.service.ts` (single zone → implicit; several → `SshZoneAmbiguousError`);
`assertZoneUsable` gates new entities/issuance in an archived zone. **Migration gotcha**: the
0009 rebuild DROPs FK-referenced parents, so `migrate.ts` toggles `foreign_keys=OFF` around
`migrate()` (the `PRAGMA` inside the `.sql` is a no-op in drizzle's transaction) and asserts
`foreign_key_check` after. Runbook: [docs/operations/migration-0009.md](../docs/operations/migration-0009.md).

## Gotchas

- Start the dev key store with `just openbao` at the repository root. `just dev` passes
  its TLS and token file settings to the backend. Key operations require an unsealed server
  and a valid scoped token. Legacy Cosmian SSH CA and RA references require migration.
- X.509 CA creation generates a key in Transit. Manual issuance can use an existing public key
  reference. For external issuance, `signCertificate` with `csr` and `preserveCsrKey: true`
  retains the CSR's public key. The backend verifies the CSR and builds the certificate.
  See [CSR signing](../docs/guides/k8s-csr-signing.md).
- `crl.service.ts` builds the X.509 v2 CRL and passes its signed data to `KMSService.signData`.
  Transit signs it with the CA key. Revocation regenerates the CRL. The public route
  `/crl/:caId.crl|.der` refreshes it after `nextUpdate`.
- Renewal with `generateNewKey: false` resolves the key link in `keystore_objects`.
  The service rejects key reuse for certificates at least 90 days old. `revokeOriginal`
  revokes the original certificate as superseded and writes a `certificate.revoke` audit row.
- Vitest uses one fork with `fileParallelism: false` for SQLite. For live tests start the
  isolated fixture with `scripts/openbao-test.sh` at the repository root. Set
  `OPENBAO_TEST_REQUIRED=1` for a run that requires the fixture. See
  [Testing](../docs/development/testing.md#unit-tests-and-checks).
- Key exports (`src/crypto/pkcs12.ts`): an encrypted PKCS#8 key uses Node crypto. JKS stores
  and PKCS#12 truststores use the Java KeyStore API through `KeyStoreExport.java` (needs
  `java`; the image compiles it, a source checkout runs it in source-file mode). Only a PKCS#12
  bundle with a private key runs the `openssl` CLI: Java lowercases its friendlyName and
  encodes non-ASCII passwords wrongly for legacy 3DES. A legacy PKCS#12 truststore therefore
  rejects a non-ASCII password. `src/crypto/keystore-export.test.ts` runs without `openssl`.
- CORS reads the comma-separated origins in `FRONTEND_URL` through `src/lib/cors-origins.ts`.
  An unset value permits every origin.

## Environment

Configure the TLS address in `OPENBAO_ADDR`, the trusted CA file in `OPENBAO_CACERT`,
the X.509/SSH token file in `OPENBAO_TOKEN_FILE` (policy `pki-manager-backend`) and the SCEP RA
token file in `OPENBAO_RA_TOKEN_FILE` (policy `pki-manager-ra`). Only `openbao/ra-transit.ts`
reads the RA token; it refuses the same file as `OPENBAO_TOKEN_FILE`, and without it the RA
operations answer 503 while the rest of the backend works. Never give one token both policies.
The X.509, SSH and RA clients use `OPENBAO_TRANSIT_MOUNT`, `OPENBAO_SSH_MOUNT` and
`OPENBAO_RA_MOUNT`, respectively.
See `.env.example` for server, database, OIDC and proxy settings.
