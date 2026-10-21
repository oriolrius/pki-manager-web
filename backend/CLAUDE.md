# Backend — `@pki-manager/backend`

Fastify 5 (ESM, Node ≥22) server exposing **two parallel APIs** over one shared service
layer, doing X.509 PKI via `node-forge` + a **Cosmian KMS**, with metadata in SQLite
(Drizzle + better-sqlite3). See the root `CLAUDE.md` for repo-wide rules.

## Commands

| Command | Runs |
|---|---|
| `pnpm dev` | `tsx watch --env-file=.env src/server.ts` |
| `pnpm build` / `build:strict` | `tsc -p tsconfig.prod.json` (relaxed, no tests) / `tsc` (strict) |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm test` / `test:coverage` | Vitest |
| `pnpm lint` | `eslint src --ext .ts` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | drizzle-kit / `tsx src/db/migrate.ts` / studio |

`build` uses relaxed `tsconfig.prod.json` (no `strict`); always run `pnpm typecheck`
(strict) — a green build ≠ a clean typecheck. Use `.js` extensions in relative imports (ESM).

## Architecture

`src/server.ts` registers, in order:
- **REST** (`src/rest/`) at `/api/v1` — Swagger UI `/api/docs`, spec `/api/v1/openapi.json|yaml`.
- **External issuer** at `/api/v1/external` — cluster-token auth, separate from OIDC.
- **tRPC** (`src/trpc/`) at `/trpc` — routers: `ca, certificate, crl, audit, domain, search, dashboard, cluster, health`.
- **Public** server routes: `GET /health`, `GET /cas/:caId.:fmt`, `GET /crl/:caId.:fmt`.

Flow: **route/procedure → service (`src/services/*`) → crypto / KMS / db.** Both API layers
call the *same* singleton services — put business logic in services, not routes. Services
throw typed errors (`CANotFoundError`, …); the edge maps them to tRPC/HTTP codes.

## Auth (two independent mechanisms)

- **OIDC bearer JWT** (tRPC + REST): `src/lib/oidc.ts` + `jwt.ts` (JWKS via `jose`).
  **If `OIDC_ISSUER`/`OIDC_AUDIENCE` are unset, OIDC is disabled and all auth + admin
  checks are skipped (every endpoint is public).** Roles from `OIDC_ROLES_CLAIM` (default `realm_access.roles`).
- **Cluster bearer tokens** (external API only): `pkimg_<...>`, looked up by 12-char
  prefix, compared SHA-256 + `timingSafeEqual` (the `schema.ts` "argon2" comment is wrong).
  Each cluster is scoped to one CA.

## KMS & crypto

`src/kms/` (`KMSService`→`KMSClient`) speaks **KMIP 2.1 as JSON over HTTP POST to
`<KMS_URL>/kmip/2_1`**. Private keys live in the KMS; the DB stores only
`kmsCertificateId`/`kmsKeyId`. `src/crypto/` is pure node-forge (X.509/CSR/CRL/DN/keys);
algorithms RSA-2048/4096, ECDSA-P256/P384.

## Data model — `src/db/schema.ts`

SQLite (Drizzle; WAL + `foreign_keys=ON`; path `DATABASE_PATH`, default `./data/pki.db`).
Tables: `certificate_authorities`, `certificates` (CA FK; `source_type` manual|k8s;
`certificate_pem` cache for offline-signed), `clusters`, `crls`, `audit_log`.
DB change: edit `schema.ts` → `pnpm db:generate` → `pnpm db:migrate`.

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
`foreign_key_check` after. Runbook: [docs/ssh/zones-migration-runbook.md](../docs/ssh/zones-migration-runbook.md).

## Gotchas

- **KMS is a hard dependency** for almost all CA/cert paths; unreachable → most ops fail
  (`CAKmsInconsistencyError`). `getKMSService()` defaults `KMS_URL` to `http://wsl.ymbihq.local:42998`.
- KMS `certify` modes: pass a `publicKeyId` to certify a KMS-held key (CA creation, manual
  issuance); pass a `csr` + `preserveCsrKey` to sign a CSR's **own** public key (the external
  `/sign` path — the CA key stays in the KMS). The CSR goes in the KMIP `CertificateRequestValue`
  field and Cosmian copies the CSR's SAN/keyUsage/EKU, so don't re-supply those in `x509Extensions`
  (would duplicate). See `src/kms/spike-csr-certify.ts` and TASK-109.22.
- **CRL signing**: CRLs are real, signed X.509 v2 (RFC 5280) — `crl.service` exports the CA
  key (`getPrivateKey`) and signs with node `crypto` (Cosmian has no usable KMIP Sign for
  RSA/ECDSA; see `backlog/decisions/decision-010`). Revoking via tRPC/REST/external `/revoke`
  auto-regenerates the CA CRL; the public `/crl/:caId.crl|.der` serves it and lazily refreshes
  past `nextUpdate`. Issued certs carry a CDP when `CRL_DISTRIBUTION_URL` is set.
- CA `kmsKeyId` may be missing from the Certify response (certify-from-subject generates the
  keypair server-side); it is resolved from the cert's KMIP `PrivateKeyLink`
  (`getCertificatePrivateKeyId`). Needed for CRL signing and PKCS#12/key export.
- Renewal always generates a new KMS key pair (no reuse); rejected for certs ≥90 days old.
- Tests are Vitest **single-fork, `fileParallelism:false`** (SQLite races); KMS integration
  tests auto-start/skip via `src/test/kms-helper.ts`. CORS is `origin:true` (review for prod).

## Env

`PORT` (3000) · `HOST` · `DATABASE_PATH` · `KMS_URL` · `KMS_API_KEY?` · `OIDC_ISSUER` ·
`OIDC_AUDIENCE` · `OIDC_ROLES_CLAIM` · `OIDC_DISCOVERY_BASE_URL`. See `.env.example`.
(The old `EXTERNAL_ISSUER_CA_*` offline-signing vars were removed — `/sign` signs via the KMS.)
