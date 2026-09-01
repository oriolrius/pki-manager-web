---
id: doc-010
title: SSH Zones Milestone
type: specification
created_date: '2026-09-01 04:42'
---

# SSH Zones Milestone

> Human-readable anchor for the **SSH Zones** milestone (14 tasks, TASK-217..230, ZONE-00..ZONE-13).
> Decision: [decision-017 — SSH Zones: Multi-CA Grouping and Trust Boundary](../decisions/decision-017%20-%20SSH-Zones-%E2%80%94-Multi-CA-Grouping-and-Trust-Boundary.md)
> *(Accepted 2026-09-01, incl. amendments A1–A3 — the contract this milestone implements)*.
> Preserved verbatim: decisions 011–016 (KMS-resident CAs + `signRaw`, separate `ssh_*`
> schema, verbatim blobs, bare-unsigned-KRL + detached signature, per-CA monotonic serials,
> short TTLs, per-host composed KRLs). This milestone **scopes** them; it changes none of them.
> Suggested branch: `feat/ssh-zones` off `main`.

## Goal

Let one PKI Manager run **N independent SSH trust domains** — prod vs staging, customer A
vs customer B, datacenter vs lab — where the grouping is a real trust boundary, not a UI
label. Today the SSH CA supports exactly one User CA and one Host CA for the whole
installation, and every host trusts every user CA.

```
                       BEFORE                                    AFTER
        ┌──────────────────────────────┐        ┌─────────────────┐  ┌─────────────────┐
        │  1 User CA    1 Host CA      │        │ zone: prod      │  │ zone: staging   │
        │       ↓            ↓         │        │  User CA  Host CA│  │  User CA  Host CA│
        │  every identity, every host  │        │  identities      │  │  identities      │
        │  every host trusts EVERY     │        │  hosts           │  │  hosts           │
        │  user CA (host-krl:251)      │        │  principals      │  │  principals      │
        └──────────────────────────────┘        └─────────────────┘  └─────────────────┘
                                                  a prod host trusts ONLY prod's user CAs
```

The mechanism (decision-017): a generic `zones` table; `zone_id NOT NULL` on `ssh_cas`,
`ssh_hosts`, `ssh_identities`, `ssh_principals`, `ssh_fleet_tokens`; the two partial unique
indexes rekeyed from `(ca_type)` to `(zone_id, ca_type)`; and every "active CA of type T"
lookup rescoped to "in zone Z", where Z comes from the subject entity already in the call.

## The one behaviour change that is not additive

`ssh-host-krl.service.ts:107` composes a host's KRL from
`allCas.filter(c => c.status !== 'retired')` — **every** non-retired CA in the install.
ZONE-05 narrows that union to the host's own zone. In the migrated single-zone state the
composed bytes are identical; the change is observable only once a second zone exists,
which is exactly the intended semantics. Everything else in this milestone is additive.

## Load-bearing findings from code grounding (2026-09-01)

Five findings shape the plan and MUST NOT be lost.

1. **Implicit CA resolution is the feature, not the obstacle (ZONE-03/04).** No issuance
   path takes a `caId`; four call sites query "the active CA of this type"
   (`ssh-user.service.ts:246`, `ssh-host.service.ts:232,433`, `ssh-external.routes.ts:317`,
   plus the create/import collision guards at `ssh-ca.service.ts:80,142`). Because one
   active CA per `(zone, ca_type)` is preserved, each becomes "…in zone Z" and **no
   issuance API gains a `caId` parameter**. Any task that starts threading explicit CA ids
   through the UI has misread the decision.

2. **Zone resolution must be implicit-then-fail-closed (amendment A1, ZONE-02).**
   `src/test/setup.ts` migrates the real `src/db/migrations` folder, so the seeded
   `default` zone exists in every one of the 33 SSH test files' DBs. A shared
   `resolveZone(ctx, explicit?)` that (a) uses the explicit zone, else (b) uses the single
   non-archived zone if there is exactly one, else (c) throws `SshZoneAmbiguousError` keeps
   every existing test, the sibling `pki-manager-cli`, the Galaxy collection and the live
   `pki.joor.net` install working untouched — and makes every un-scoped caller fail loudly
   the moment a second zone exists. Defaulting to "the first zone" instead would silently
   sign with the wrong trust domain's CA.

3. **`(zone_id, fqdn)` uniqueness breaks the unauthenticated ECIES route (amendment A2,
   ZONE-09/10).** `POST /api/v1/external/ssh/krl` has no app auth by design and resolves
   the host by FQDN alone (`ssh-external.routes.ts:280`); two same-named hosts in different
   zones would get an arbitrary one's envelope. Fix: optional `zone` in the body; omitted +
   one match → serve; omitted + several → `409 AMBIGUOUS_HOST`; `krl-client` gains
   `--zone`. The token-authenticated external routes need no client change — the fleet
   token's zone is authoritative — but their **upsert-by-fqdn** (`sign-host`, line 119) and
   **upsert-by-subject** (`sign-user`, line 168) lookups must become zone-scoped or
   automation will adopt a foreign zone's host/identity row.

4. **Five tables need a SQLite rebuild-and-copy migration (ZONE-01).** SQLite cannot add a
   `NOT NULL` FK column or redefine a unique index in place, so drizzle-kit emits
   `PRAGMA foreign_keys=OFF` → create-new → copy → drop → rename for `ssh_cas`, `ssh_hosts`,
   `ssh_identities`, `ssh_principals`, `ssh_fleet_tokens`. Those five tables are referenced
   by nine others; a rebuild that drops and recreates them with FKs off is where referential
   damage happens if the copy is wrong. This is the single highest-risk task in the
   milestone and is rehearsed against a copy of the production DB in ZONE-00.

5. **The Ansible role is NOT in this repo (ZONE-13).** `ansible/requirements.yml` pins the
   Galaxy collection `oriolrius.pki_manager >= 2.3.0`; the vendored copy under
   `ansible/tests/e2e/_collections/` is gitignored. Its module hits `/ssh/cert-authority`,
   `/ssh/trusted-user-ca-keys`, `/ssh/host-ca-keys` and the external API
   (`plugins/modules/pki_manager.py:1050-1095`). That is precisely why the legacy unscoped
   endpoints must keep serving the default zone (ZONE-08) — and why the in-repo Ansible e2e
   suite staying green is the compatibility proof (ZONE-12).

## Contract highlights (from decision-017)

| Aspect | Rule |
|---|---|
| Table | generic `zones` (not `ssh_zones`) — X.509 can adopt `zone_id` later |
| Slug | `name` is a URL-safe slug, globally unique; `default` is seeded by the migration |
| CA cardinality | one `active` + one `rotating` per `(zone_id, ca_type)` |
| Membership | a host and an identity each belong to **exactly one** zone |
| Uniqueness | `(zone_id, fqdn)`, `(zone_id, subject)`, `(zone_id, name)` |
| Derived zone | certs/revocations/KRLs/host-KRLs/grants/maps/blocks carry **no** `zone_id` |
| KRL numbering | `ssh_krl_seq` stays a **single global** allocator (never sharded per zone) |
| Zone change | not an update — offboard + re-enroll; `zone_id` is immutable via the API |
| Archived zone | blocks new entities & issuance; keeps serving existing trust material |
| Deletion | impossible while referenced (`ON DELETE RESTRICT`) — archive instead |

## Tasks

### Epic 0 — Baseline & migration safety
- **TASK-217 — ZONE-00**: Milestone baseline — pin the migration head, inventory every
  zone-coupled call site and test file, and **rehearse the rebuild migration against a copy
  of the production DB** (y0 `/opt/stacks/pki/data/pki/pki.db`) with row-count and FK
  integrity assertions.

### Epic 1 — Data core
- **TASK-218 — ZONE-01**: `zones` table + migration `0009` — seed `default`, backfill five
  tables, apply `NOT NULL`, swap the partial unique indexes to `(zone_id, ca_type)` and the
  natural keys to `(zone_id, …)`. Schema tests prove each constraint.
- **TASK-219 — ZONE-02**: `SshZoneService` + the shared `resolveZone()` helper (amendment
  A1), typed errors, archived-zone semantics (A3), audit rows for create/update/archive.

### Epic 2 — Service-layer scoping
- **TASK-220 — ZONE-03**: CA service — zone-scoped create/import collision guard, list
  filter, `getTrustAnchors(zoneId)`, rotation inheriting the predecessor's zone.
- **TASK-221 — ZONE-04**: Host / user / principal services — zone on register,
  createIdentity, createPrincipal; `resolveHostCa`/`resolveUserCa` scoped; zone-scoped
  lists; **cross-zone invariant guards** on principal grants, host mappings and blocks.
- **TASK-222 — ZONE-05**: *(correctness-critical)* Narrow the composed per-host KRL union
  to the host's zone; keep `ssh_krl_seq` global; add per-zone `ssh-mon` metrics.

### Epic 3 — API surface
- **TASK-223 — ZONE-06**: tRPC `zone` router + optional `zoneId` on every SSH list
  procedure + Zod schemas + zone echoed in DTOs.
- **TASK-224 — ZONE-07**: REST `/api/v1/zones` + `?zoneId=` filters + OpenAPI, keeping
  `ssh-rest-parity.test.ts` (TASK-216's guard) green.
- **TASK-225 — ZONE-08**: Public trust endpoints — `/ssh/zones/:zone/…` added; the legacy
  unscoped routes keep serving the default zone with a `Deprecation` header.
- **TASK-226 — ZONE-09**: External/fleet API — token zone, zone-scoped upsert-by-fqdn and
  upsert-by-subject, ECIES `zone` body field + `409 AMBIGUOUS_HOST` (amendment A2).

### Epic 4 — Clients & UI
- **TASK-227 — ZONE-10**: `krl-client` — `--zone` flag / `KRL_CLIENT_ZONE` / `zone:` config
  key, sent in the `POST /krl` body; defaults empty (no behaviour change single-zone).
- **TASK-228 — ZONE-11**: Frontend — persisted zone switcher with "All zones", zone filters
  and Zone columns on the CA/host/user/KRL pages, zone pickers on the three create forms,
  and a `/ssh/zones` management page.

### Epic 5 — Verification & rollout
- **TASK-229 — ZONE-12**: Multi-zone isolation E2E — two zones, cross-zone denial proven at
  the KRL-bytes level and against real `sshd`; the in-repo Ansible e2e suite stays green as
  the legacy-compatibility proof.
- **TASK-230 — ZONE-13**: Docs (`docs/ssh/*`, `CLAUDE.md`, `backend/CLAUDE.md`) + the
  production migration runbook + downstream-consumer notes for the Galaxy collection and
  the sibling `pki-manager-cli`.

## Sequencing

- **Phase 0**: ZONE-00 (baseline + migration rehearsal) — gates ZONE-01.
- **Phase 1 — data**: ZONE-01 → ZONE-02. Nothing else can start meaningfully before the
  `zones` table and `resolveZone()` exist.
- **Phase 2 — services**: ZONE-03 → ZONE-04 → ZONE-05. ZONE-05 depends on hosts carrying a
  zone (ZONE-04) and is the security core of the milestone.
- **Phase 3 — API**: ZONE-06 → {ZONE-07, ZONE-08, ZONE-09} in parallel, all off ZONE-04/05.
- **Phase 4**: ZONE-10 (off ZONE-09) ∥ ZONE-11 (off ZONE-06).
- **Phase 5**: ZONE-12 (off everything in phases 2–4) → ZONE-13 last, once the shipped
  behaviour is settled.

## Top risks & mitigations

- **Migration damages production data** (highest). Five rebuild-and-copy tables with FKs
  off, on a live DB holding real CAs and an enrolled host. Mitigation: ZONE-00 rehearses on
  a byte copy of the prod DB with before/after row counts and `PRAGMA foreign_key_check`;
  ZONE-13's runbook mandates a backup and a verified restore path before `db:migrate`.
- **A zone-scoped lookup silently picks the wrong trust domain.** Mitigation: the fail-
  closed `resolveZone()` rule (A1) — never "first zone wins" — plus explicit cross-zone
  invariant guards in ZONE-04 and an isolation test in ZONE-12.
- **Already-enrolled hosts break at upgrade.** The live `pki.joor.net` install and the c1h1
  test VM use the legacy unscoped trust endpoints and the FQDN-only ECIES route.
  Mitigation: legacy routes keep serving the default zone (ZONE-08); the ECIES `zone` field
  is optional and only required on an actual FQDN collision (ZONE-09); the Ansible e2e
  suite is the regression gate (ZONE-12).
- **The 33 SSH test files become a rewrite.** Mitigation: implicit single-zone resolution
  (A1) means existing tests keep passing unmodified; new tests are added for zone behaviour
  rather than existing ones being rewritten.
- **Scope creep into X.509.** The `zones` table is generic on purpose, but wiring X.509
  CAs/certs/clusters to it is explicitly deferred (decision-017 § Deferred). A task that
  touches `certificate_authorities` is out of scope.
- **KRL-number regression.** Sharding `ssh_krl_seq` per zone would break the client's
  strictly-increasing anti-rollback check (decision-016 pinned req #4). ZONE-05 asserts the
  allocator stays global.

## Downstream consumers (outside this repo)

- **`oriolrius.pki_manager` Ansible collection** (Galaxy, pinned `>=2.3.0` in
  `ansible/requirements.yml`) — uses the legacy unscoped trust endpoints and the external
  API. Unchanged by this milestone; a zone-aware release is follow-up work in that repo.
- **`pki-manager-cli`** (sibling Python CLI, generated from the OpenAPI spec) — needs a
  client regeneration after ZONE-07 to expose the zone endpoints and filters.
- **`krl-client`** is in-repo (`krl-client/`) and is updated by ZONE-10.

## Explicitly out of scope

Cross-zone trust import (`zone_trusted_cas`) · per-zone OIDC RBAC (`ssh-admin:prod`) ·
X.509 adoption of `zone_id` · moving a host or identity between zones as an in-place
update · multi-zone identities via a membership table (decision-017 § Rejected alternatives).

## Baseline (ZONE-00, to be verified at kickoff)

- **Migration head** (from `backend/src/db/migrations/meta/_journal.json`):
  `0008_ssh_host_blocks` (idx 8). ZONE-01's migration is the next index after the head —
  **read the journal again at generation time, never hard-code the number.**
- **SSH test files**: 33 (`src/db`, `src/services`, `src/rest/routes`, `src/trpc/procedures`,
  `src/crypto/ssh`, `src/kms`).
- **SSH REST surface**: full tRPC parity as of TASK-216 — 52 procedures, guarded by
  `ssh-rest-parity.test.ts`.
- **Production**: `pki.joor.net` on host y0, SQLite at `/opt/stacks/pki/data/pki/pki.db`.
