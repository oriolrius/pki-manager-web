# SSH Zones — one installation, many trust domains

> Introduced by [decision-017](../../backlog/decisions/decision-017%20-%20SSH-Zones-%E2%80%94-Multi-CA-Grouping-and-Trust-Boundary.md).
> If you run a single SSH trust domain you can ignore this page — nothing changes
> for you. A migrated single-zone install behaves exactly as before.

## What a zone is

A **zone** is a first-class grouping of SSH trust material that is a **real trust
boundary**, not a UI label. It lets one PKI Manager run **N independent SSH trust
domains** — prod vs staging, customer A vs customer B, datacenter vs lab.

Before zones, the SSH manager had exactly **one** User CA and **one** Host CA for
the whole installation, and *every host trusted every user CA*. With zones:

```
        zone: prod                         zone: staging
  ┌───────────────────────┐          ┌───────────────────────┐
  │ User CA   Host CA      │          │ User CA   Host CA      │
  │ identities             │          │ identities             │
  │ hosts                  │          │ hosts                  │
  │ principals             │          │ principals             │
  └───────────────────────┘          └───────────────────────┘
   a prod host trusts ONLY prod's user CAs — never staging's
```

## The trust boundary — the one rule that matters

**A host in zone Z trusts only the user CAs of Z.** Concretely:

- Each zone holds its own `active` User CA and `active` Host CA (rotation is
  unchanged — one `active` + one `rotating` per `(zone, type)`).
- A host's composed **KRL**, its `TrustedUserCAKeys` file and its
  `@cert-authority` lines are all derived from **that host's zone**. A revocation
  in one zone never appears in another zone's hosts.
- Host certificates are signed by the Host CA **of the host's zone**; user certs
  by the User CA **of the identity's zone**. You never pass a CA id into issuance
  — the zone comes from the subject entity.

## Membership rules

| Aspect | Rule |
|---|---|
| Zone name | a globally-unique URL-safe **slug** (`prod`, `staging`); `default` is seeded by the migration |
| CA cardinality | one `active` + one `rotating` per `(zone, ca_type)` |
| Host / identity | belongs to **exactly one** zone (a hard partition — no cross-zone entity) |
| Uniqueness | `fqdn`, identity `subject` and principal `name` are unique **per zone**, so the same `web1.example.com` can exist in `prod` and `staging` |
| One person, two zones | needs **two identity rows** (one per zone) and two principal-grant sets — the deliberate price of a hard boundary |
| Zone change | **not** an update — `zone_id` is immutable; offboard + re-enroll to move a host or identity |
| Deletion | impossible while the zone owns any CA/host/identity/principal (`ON DELETE RESTRICT`) — **archive** instead |

## Archived zones

Archiving a zone (`status='archived'`) **blocks new** CAs, hosts, identities,
principals and certificate issuance in it, and hides it from pickers. It does
**not** stop serving existing trust material: trust downloads, KRL generation and
ECIES pulls keep working, so archiving never locks operators out of hosts that
are still running. Un-archive to resume.

## Using zones

- **UI**: a persisted **zone switcher** in the SSH section header (with an
  explicit *All zones* view that adds a Zone column). Create forms require a zone,
  prefilled from the switcher. Manage zones at **`/ssh/zones`** (create, rename
  the display name, archive, un-archive).
- **tRPC**: the `ssh.zone` router (`list`/`get`/`create`/`update`/`archive`/
  `unarchive`); every SSH list procedure takes an optional `zoneId` filter; every
  create/issuance-adjacent procedure takes an optional `zone` (id or slug).
- **REST**: `/api/v1/ssh/zones` CRUD; `?zoneId=` on the list endpoints; a `zone`
  field on the create bodies.
- **Public trust endpoints**: zone-scoped
  `/ssh/zones/:zone/{trusted-user-ca-keys,host-ca-keys,cert-authority}` are
  authoritative. The legacy unscoped routes keep serving the **default** zone
  with a `Deprecation` header so already-enrolled hosts never break.

### Fail-closed resolution (why an un-scoped call can start erroring)

Every call that omits a zone resolves it **fail-closed**:

- exactly **one** non-archived zone exists → that zone (so single-zone installs,
  the CLI, the Ansible role and existing scripts keep working untouched);
- **several** zones exist and none was named → the call **fails loudly**, listing
  the available zone slugs, rather than silently signing with the wrong trust
  domain's CA.

So the moment you create a second zone, start passing `zone`/`zoneId` (or the
`--zone` flag / `KRL_CLIENT_ZONE`) to anything that was relying on the implicit
single zone.

## The ECIES KRL route and ambiguous FQDNs

`POST /api/v1/external/ssh/krl` has no app auth (ECIES is the authentication) and
resolves the host by FQDN alone. Because FQDNs are now unique only per zone, if
the same FQDN exists in several zones the route returns **`409 AMBIGUOUS_HOST`**;
pass an optional `zone` in the body (or `krl-client --zone` /
`KRL_CLIENT_ZONE`) to disambiguate. Single-zone installs, and multi-zone installs
with distinct FQDNs, are unaffected.

## Downstream consumers not updated by this milestone

- **`oriolrius.pki_manager` Ansible collection** (Galaxy, pinned `>=2.3.0`) — it
  uses the **legacy unscoped** trust endpoints and the external API, which keep
  serving the **default** zone. It works unchanged for the default zone; a
  zone-aware release (passing `zone` to the module) is follow-up work in that
  repo. Multi-zone fleets driven by Ansible need per-zone tokens and, for the
  ECIES path, `krl-client --zone` on hosts whose FQDN collides across zones.
- **`pki-manager-cli`** (sibling Python CLI, generated from the OpenAPI spec) —
  needs a client **regeneration** to expose the `/ssh/zones` endpoints and the
  `?zoneId=` / `zone` fields. Until regenerated it drives the default zone only.
- **`krl-client`** (in-repo) is already zone-aware via `--zone` /
  `KRL_CLIENT_ZONE` / `zone:` — see its README.

## Explicitly deferred (decision-017)

These are **deferred**, not forgotten — none is implemented by this milestone:

- **Cross-zone trust import** (`zone_trusted_cas`) — v1 has *no* cross-zone trust;
  if ever needed it is additive (an explicit import table, never an implicit
  union).
- **Per-zone OIDC RBAC** (e.g. `ssh-admin:prod`) — zone admin is not yet scoped by
  OIDC role.
- **X.509 adoption of `zone_id`** — the `zones` table is deliberately generic so
  CAs/certificates/clusters can adopt it later, but they do not yet.
- **Moving a host or identity between zones as an in-place update** — forbidden;
  offboard + re-enroll.
- **Multi-zone identities via a membership table** — rejected for now; re-addable
  later without touching existing rows.

→ Back to [how it works](concept.md) · Upgrading a live install:
[Zones migration runbook](zones-migration-runbook.md)
