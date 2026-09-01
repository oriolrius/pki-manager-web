---
id: decision-017
title: SSH Zones — Multi-CA Grouping and Trust Boundary
date: '2026-08-31 17:03'
status: Accepted
---
## Context

The SSH Certificate Manager (decision-011..016) supports **exactly one User CA and one
Host CA for the whole installation**. Every other SSH entity hangs off that implicit
singleton pair, so there is no way to run two independent SSH trust domains (prod vs
staging, customer A vs customer B, datacenter vs lab) in one PKI Manager.

### Where the singleton is hard-coded today

- **Schema** — `backend/src/db/schema.ts:243-248`: partial unique indexes
  `uq_ssh_cas_active_type` / `uq_ssh_cas_rotating_type` are keyed on `ca_type` **alone**,
  enforcing one `active` + one `rotating` CA per type globally.
- **Implicit CA resolution** — no issuance path ever takes a `caId`; each one queries
  "the active CA of this type":
  `ssh-user.service.ts:246` (user certs), `ssh-host.service.ts:232,433` (host certs and
  the user-CA lookup for `sshd_config`), `ssh-external.routes.ts:317` (fleet/Ansible
  signing), `ssh-ca.service.ts:80,142` (create/import collision check).
- **Trust composition** — `ssh-host-krl.service.ts:251`: a host's KRL is composed from its
  host CA ∪ **every non-retired CA**. Today *every host trusts every user CA*; with more
  than one User CA that is exactly the wrong default.
- **Global trust endpoints** — `ssh-public.routes.ts:189-206`:
  `/ssh/trusted-user-ca-keys`, `/ssh/host-ca-keys`, `/ssh/cert-authority` return the whole
  set with no notion of *which* set a given host should see.
- **Global uniqueness** — `ssh_hosts.fqdn`, `ssh_identities.subject` and
  `ssh_principals.name` are all `UNIQUE` across the entire installation.

### The one place grouping already exists, unnamed

`ssh_fleet_tokens` (`schema.ts:517-535`) scopes a token to a `(user_ca_id, host_ca_id)`
**pair**. That pair *is* an anonymous, single-purpose grouping — evidence the concept is
missing rather than unwanted.

### Requirement

Support N User CAs and N Host CAs in one installation, grouped so that CAs, hosts, users
and KRLs can be listed and filtered by group, and so that the group is a real **trust
boundary** (a host only trusts the user CAs of its own group), not just a UI label.

## Decision

Introduce a first-class grouping entity called a **Zone**.

### 1. Naming — `zone`

`domain` is rejected: it is already taken in this codebase by
`backend/src/trpc/procedures/domain.ts`, a derived view of DNS names extracted from X.509
CN/SANs — same word, unrelated meaning. `realm` is rejected because Keycloak realms are
already part of this product's vocabulary (OIDC). `scope` collides with OAuth scopes and
with the fleet-token op-set. **`zone`** is unambiguous in both the codebase and the docs.

### 2. Data model

A **generic `zones` table** (not `ssh_zones`), so X.509 CAs/certificates/clusters can
adopt the same `zone_id` later without a rename or a second grouping concept. Only SSH
tables reference it in this change.

```
zones
  id            text pk
  name          text not null unique     -- slug, e.g. 'prod', 'staging' (URL/api key)
  display_name  text not null
  description   text
  status        text not null default 'active'   -- active | archived
  created_at / updated_at
```

FK wiring (all `zone_id text NOT NULL REFERENCES zones(id) ON DELETE RESTRICT`):

| Table | Change |
|---|---|
| `ssh_cas` | `+ zone_id`; unique indexes move from `(ca_type)` to **`(zone_id, ca_type)`** for both the `active` and `rotating` partial indexes |
| `ssh_hosts` | `+ zone_id`; `fqdn` uniqueness moves to **`(zone_id, fqdn)`** |
| `ssh_identities` | `+ zone_id`; `subject` uniqueness moves to **`(zone_id, subject)`** |
| `ssh_principals` | `+ zone_id`; `name` uniqueness moves to **`(zone_id, name)`** |
| `ssh_fleet_tokens` | `+ zone_id`; `user_ca_id`/`host_ca_id` must belong to that zone |

Tables that get **no** `zone_id` — their zone is derived, and denormalizing it would
create a second source of truth that can drift:

- `ssh_certificates` → via `ca_id`
- `ssh_revocations`, `ssh_krls` → via `ca_id`
- `ssh_host_krls` → via `host_id`
- `ssh_user_principals`, `ssh_host_principal_maps`, `ssh_host_blocks` → via their parents

`ssh_krl_seq` (`schema.ts:509`) stays a **single global allocator**. Sharding it per zone
would break the strictly-increasing KRL-number guarantee that clients rely on (pinned
requirement #4 of decision-016) for any host that ever moves between lineages. Gaps are
already harmless.

### 3. Cardinality — one active + one rotating CA per `(zone, ca_type)`

The rotation model of SSH-32a is preserved verbatim, just scoped. Multiple CAs come from
multiple zones, **not** from multiple CAs inside a zone. This is the key simplification:
implicit CA resolution survives.

### 4. Membership — hosts and identities each belong to exactly one zone

A zone is a hard partition. A host is enrolled in one zone; an identity exists in one
zone. There is no membership join table and no cross-zone entity.

### 5. Trust topology — the zone is the trust boundary

- A host in zone Z trusts **only** the user CAs of Z.
- `ssh-host-krl.service.ts:251` must be narrowed from "every non-retired CA" to "every
  non-retired CA **in the host's zone**".
- `sshd_config` rendering, `TrustedUserCAKeys`, and the per-host KRL all derive their CA
  set from `host.zone_id`.
- **No cross-zone trust in v1.** If it is ever needed, it is additive: an explicit
  `zone_trusted_cas` import table, never an implicit union.

### 6. CA resolution — unchanged shape, zone-scoped lookup

Every existing "active CA of type T" query becomes "active CA of type T **in zone Z**",
where Z comes from the subject entity already present in the call:

| Call site | Zone source |
|---|---|
| `ssh-host.service.ts:232,433` | `host.zone_id` |
| `ssh-user.service.ts:246` | `identity.zone_id` |
| `ssh-external.routes.ts:317` | `fleetToken.zone_id` |
| `ssh-ca.service.ts:80,142` | request parameter (CA creation/import) |

**Consequence: no issuance API gains a `caId` parameter.** Only CA create/import and the
list/filter endpoints take a zone.

### 7. API surface

- **tRPC**: new `zone` router (`list`, `get`, `create`, `update`, `archive`); every SSH
  list procedure gains an optional `zoneId` filter.
- **REST**: `/api/v1/zones` CRUD; `?zoneId=` on the SSH list endpoints; `zone` echoed in
  CA/host/identity response DTOs.
- **Public trust endpoints**: add zone-scoped
  `/ssh/zones/:zone/trusted-user-ca-keys`, `/ssh/zones/:zone/host-ca-keys`,
  `/ssh/zones/:zone/cert-authority`. The existing unscoped routes keep working and serve
  the **default zone**, marked deprecated in Swagger — hosts already enrolled against
  production (see the c1h1 test VM against `pki.joor.net`) must not break.
  The per-host routes (`/ssh/hosts/:id/cert.pub`, `/ssh/hosts/:id/sshd-config`, per-host
  KRL) already resolve through the host and become zone-correct for free.
- **External/fleet API**: the token's zone scopes signing; op-set semantics unchanged.

### 8. Frontend

- A **zone switcher** in the SSH navigation, persisted (URL search param `zone` +
  localStorage), with an explicit **"All zones"** option.
- `ssh.cas`, `ssh.hosts`, `ssh.users`, `ssh.krl` filter by the selected zone and show a
  **Zone** column when "All zones" is active.
- Create forms (`ssh.cas.new`, `ssh.hosts.new`, `ssh.users.new`) require a zone, prefilled
  from the switcher.
- New `/ssh/zones` page: list, create, archive.

### 9. Migration

1. Create `zones`, seed one row `name='default'`, `display_name='Default'`.
2. Backfill `zone_id='default'` on `ssh_cas`, `ssh_hosts`, `ssh_identities`,
   `ssh_principals`, `ssh_fleet_tokens`.
3. Apply `NOT NULL` and swap the unique indexes to their zone-scoped form.

SQLite cannot add a `NOT NULL` FK column or redefine a unique index in place, so
drizzle-kit will emit table-rebuild-and-copy migrations for five tables. **Back up
production before applying** (`pki.joor.net` runs on host y0, SQLite at
`/opt/stacks/pki/data/pki/pki.db`; take the backup with `foreign_keys` handling per the
existing recipe). A single-zone installation is behaviourally identical after migration.

## Amendments (accepted 2026-09-01, from task-level code grounding)

Three contract-level points the original draft left implicit. Each was forced by a real
call site found while breaking the decision into tasks.

### A1 — Zone resolution: implicit while single-zone, fail-closed once ambiguous

Every service entry point that today resolves "the active CA of type T" takes an
**optional** zone. Resolution is one shared helper:

```
resolveZone(ctx, explicitZone?) ->
  explicit given  : look up by id or slug; not found -> SshZoneNotFoundError (404)
  omitted         : exactly ONE non-archived zone exists -> that zone
                    otherwise -> SshZoneAmbiguousError (400), listing the zone slugs
```

Rationale: `backend/src/test/setup.ts` migrates the real migrations folder, so the seeded
`default` zone exists in every test DB; the 33 SSH test files, the sibling
`pki-manager-cli`, the Galaxy `oriolrius.pki_manager` collection and the live
`pki.joor.net` install all keep working untouched after migration. The moment an operator
creates a second zone, every un-scoped caller fails loudly with an actionable message
instead of silently picking a CA from the wrong trust domain. Fail-closed beats
default-to-first.

### A2 — FQDN collisions on the unauthenticated ECIES route

Making `fqdn` unique per `(zone_id, fqdn)` makes `POST /api/v1/external/ssh/krl`
ambiguous: it has **no app auth by design** (ECIES is the authentication) and resolves the
host by FQDN alone (`ssh-external.routes.ts:280`). Two same-named hosts in different zones
would be served an arbitrary one's envelope.

- `POST /krl` accepts an optional `zone` in the body. Omitted + exactly one FQDN match →
  serve it (every single-zone install, and every multi-zone install with distinct FQDNs,
  is unaffected). Omitted + more than one match → `409 AMBIGUOUS_HOST`.
- `krl-client` gains `--zone` / `KRL_CLIENT_ZONE` / `zone:` in `config.yaml`, empty by
  default.
- The **token-authenticated** external routes (`sign-host`, `sign-user`,
  `register-host-pubkey`, `hosts/:fqdn/auth-principals`) need no client change: the fleet
  token's zone is authoritative, and their upsert-by-fqdn / upsert-by-subject lookups
  become zone-scoped.

### A3 — Archived zones

`status='archived'` blocks **new** CAs, hosts, identities, principals and certificate
issuance in that zone, and hides it from pickers. It does **not** stop serving existing
material: trust downloads, KRL generation and ECIES pulls keep working, so archiving never
silently locks operators out of hosts that are still running. Hard deletion stays
impossible while rows reference the zone (`ON DELETE RESTRICT`).

## Consequences

### Accepted costs

- **One identity row per person per zone.** With single-zone identities, `subject`
  uniqueness moves to `(zone_id, subject)`, so a human who needs access in `prod` and
  `staging` has two identity rows and two principal-grant sets. This is the deliberate
  price of a hard trust boundary; the existing production identity (`Oriol`/`f069d069`)
  lands in `default` and keeps working untouched.
- **Principals are per-zone.** `admin` in `prod` and `admin` in `staging` are different
  rows. The principal *string* in a cert may be identical — that is fine, because the
  host that validates it only ever consults its own zone's mappings.
- **Zone change is not an update.** Moving a host or identity between zones invalidates
  its certs (signed by the old zone's CA). v1 forbids mutating `zone_id`; the operation is
  offboard + re-enroll.
- **Zones cannot be deleted while populated** (`ON DELETE RESTRICT`) — they are archived.

### Behaviour changes

- **Per-host KRLs shrink.** A host's KRL stops including foreign-zone user CAs. In the
  migrated single-zone state the composed set is byte-identical; the change is only
  observable once a second zone exists — which is the intended semantics.
- **Host FQDNs become reusable across zones**, e.g. the same `web1.example.com` in
  `staging` and `prod`. Intentional.
- Fleet tokens gain a zone; existing tokens inherit `default` and their CA pair is already
  consistent with it.

### Rejected alternatives

- **Reuse `domain`** — collides with the X.509 DNS-domain view in `procedures/domain.ts`.
- **N active CAs per type with no grouping** — forces an explicit `caId` into every
  issuance call, every form and every API surface, and still gives no trust boundary.
- **Multi-zone identities via a membership join table** — more flexible but softens the
  boundary; rejected now, and re-addable later without touching existing rows.
- **Free-form tags/labels** — a UI filter only; cannot scope trust, cannot be enforced by
  a unique index, cannot scope CA resolution.

### Deferred

- OIDC role → zone mapping for per-zone RBAC (e.g. `ssh-admin:prod`).
- Cross-zone trust import (`zone_trusted_cas`).
- Adoption of `zone_id` by the X.509 side (CAs, certificates, clusters) — the `zones`
  table is already generic for this.
