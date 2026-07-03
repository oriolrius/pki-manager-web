---
id: decision-016
title: Per-Host User Access Blocks (SSH)
date: '2026-07-03 04:06'
status: Accepted
---
## Context

The SSH v1 access model is **allow-only and has no per-(identity, host) concept**: an
identity's cert carries role principals (free-form by default; entitlement check is
opt-in, `ssh-user.service.ts:57`), and each host maps principals → local accounts via
`ssh_host_principal_maps` rendered into `/etc/ssh/auth_principals/<account>`
(`ssh-principal.service.ts:126-156`). No table or service links an identity to a host —
`whoCanBecome` literally discards identities (`ssh-principal.service.ts:176-184`).

Consequently "Alice must no longer reach host Y, but keeps everything else" is not
expressible today. The available levers are all the wrong shape:

- **Revoke her cert / offboard (SSH-32c)** — global: kills her access *everywhere*.
- **Remove a principal entitlement or unmap it from Y** — per-role: affects every host
  using that role, or every user holding it.
- **Wait out the +1w TTL** — neither immediate nor targeted.

The operator intent "block THIS user on THIS host" needs to become one first-class,
reversible, auditable UI action — without touching the accepted architecture
(decision-011..014: KMS-resident CAs + `signRaw`, separate `ssh_*` schema, verbatim
blobs, bare-unsigned-KRL + detached-signature trust split, per-CA monotonic serials,
short TTLs as primary revocation).

### Verified OpenSSH fundamentals the design rests on

Verified 2026-07-03 against openssh-portable master (`auth2-pubkey.c`, `krl.c`,
`sshkey.c`, `PROTOCOL.krl`, `sshd_config.5`) and local man pages:

1. **`RevokedKeys` is re-read on every publickey auth attempt** — `sshbuf_load_file` per
   check (`ssh_krl_file_contains_key`, `krl.c:1272`, load at `:1280`), nothing cached.
   An atomically replaced file is effective on the very next attempt, no sshd reload.
   `sshd_config.5` (master) requires the contents "consistent at all times" and says the
   file "should only be atomically replaced and never modified in place".
2. **Fail-closed**: an unreadable `RevokedKeys` file refuses ALL pubkey auth.
3. **KRL fingerprint/explicit-key sections match certificates too**: sshd fingerprints a
   presented cert as its *underlying plain key* (`force_plain`, `sshkey.c:1005`;
   `plain_key_blob` drops cert info, `krl.c:367`) and checks those trees *before* cert
   sections (`krl.c:1192`). Revoking Alice's public key by SHA256 fingerprint therefore
   blocks raw-key auth AND any certificate over that key, from any CA.
4. **KRLs are purely host-local state** — nothing in the protocol or server assumes
   cross-host consistency. *Different hosts holding different KRLs is by-design usage.*
5. `AuthorizedPrincipalsFile` is likewise re-read fresh per attempt (glob + fopen,
   `auth2-pubkey.c:318/512`).

Fact (4) is the door: sshd already gives us a per-host deny artifact — we just serve
every host the same per-CA KRL today.

## Decision

**Adopt per-host KRL composition ("host access blocks"): a new `ssh_host_blocks`
table keyed (identity, host), resolved at build time into a HOST-SPECIFIC KRL that each
host installs through the unchanged existing distribution channel.** Design chosen by a
3-lens adversarial review (see *Options considered*).

### UI behaviour (the product surface)

One verb pair — **Block / Unblock** — in three places, matching existing conventions
(handmade Tailwind, `confirm()`/`prompt()` gates, `alert()` feedback, lucide icons,
`STATUS_STYLES` pills):

**Host detail (`ssh.hosts.$id.tsx`) — new "Access" card** between the header card and
DeployPanel. It first shows *who can currently reach this host* (a read-only join of
`ssh_user_principals` × `ssh_host_principal_maps`: identity / via roles / local
accounts) with a per-row **[Block]**; blocked identities render as red rows with
reason / by / when / state and **[Unblock]**. A dropdown allows pre-emptively blocking
an identity not currently entitled.

```
┌ web1.example.com ──────────────────── [Renew] [Revoke] [Offboard] ┐
│ Access                                            [ Block user… ] │
│ ┌────────────┬──────────────┬───────────┬───────────────────────┐ │
│ │ Identity   │ Via / as     │ By, when  │ State                 │ │
│ │ jane@corp  │ admins→root  │           │ allowed        [Block]│ │
│ │ alice@corp │ (blocked)    │ or, 07-03 │ ● Effective  [Unblock]│ │
│ │ bob@corp   │ (blocked)    │ or, 07-03 │ ● Pending    [Unblock]│ │
│ └────────────┴──────────────┴───────────┴───────────────────────┘ │
```

- **Block** → `confirm("Block alice@corp on web1.example.com? Access to all other
  hosts is unaffected.")` + optional `prompt()` reason. If her public key is also
  certified for another identity, the confirm warns: *"this key is also certified for
  bob@corp — blocking will deny both on this host"* (see fingerprint over-blocking).
- **State pill** (from existing telemetry, `ssh_hosts.last_krl_version` stamped on
  ECIES 200, `ssh-external.routes.ts:230`): green **Effective** when
  `lastKrlVersion === current versionHash`; yellow **Pending** (and **Lifting** after
  an Unblock, until the post-lift version lands); gray **Unknown (public fetch)** for
  hosts on the anonymous `.bin` path. Tooltip states honestly: *"served to host puller
  at &lt;time&gt; — not confirmation of install"*.

**Users page (`ssh.users.tsx`)** — expanded IdentityCard gains a "Blocked on:" row of
red host pills (each with state) and a "Block on host…" select.

**KRL page (`ssh.krl.tsx`)** — the HostDistribution table gains **Blocks** (count) and
**State** columns, making it the fleet-wide propagation view.

The admin never sees serials, fingerprints, or KRL mechanics; the click means exactly
what it says, is reversible server-side, and needs no cooperation from Alice.

### Technical mechanism

For every host, the served KRL becomes a composed artifact:

```
KRL(host Y) =   host-CA revocation set
              ∪ all non-retired user-CA revocation sets
              ∪ resolve(active blocks on Y)
```

where `resolve(identity)` at build time =
- **serials of all not-yet-expired certs** of that identity, as CA-scoped
  `CERT_SERIAL_LIST` groups (the only cert subsection the builder emits,
  `crypto/ssh/krl.ts:19,22,48-62`), and
- **SHA256 fingerprints of every public key ever certified for it**
  (`SECTION_FINGERPRINT_SHA256`, `krl.ts:21,71-76`), read from the existing
  `ssh_certificates.subject_pubkey_fingerprint` column (schema.ts:324, populated at
  signing) via the existing `fingerprintToHash()` (`ssh-krl.service.ts:38-46`) — the
  belt-and-braces entry that survives cert reissue over the same key (verified fact 3)
  and even kills stray `authorized_keys` entries.

Blocks are a **new concept, not revocations**: the cert rows stay `status='active'`
(they ARE valid elsewhere); `ssh_revocations` and `ssh_krls` semantics are untouched.

**Bonus fix.** Today the ECIES route resolves the host's CA and serves the **host-CA
KRL only** (`ssh-external.routes.ts:190-200`) — i.e. *revoked USER certs never reach
ECIES-pulling hosts at all*. The composed KRL closes this pre-existing coverage gap as
a side effect.

**Data model**
- `ssh_host_blocks`: `id, host_id FK, identity_id FK, reason, status ∈ {active,lifted},
  created_by/at, lifted_by/at`; partial-unique `(host_id, identity_id)` while active;
  lifted rows kept for audit.
- `ssh_host_krls`: mirrors `ssh_krls` keyed by `host_id` (`krl_number` monotonic per
  host lineage but **seeded above the per-CA lineage** — see pinned req #4;
  `version_hash`, `krl_blob`, `ca_signature`, `this/next_update`,
  `revoked_count`, `block_count`).
- `ssh_certificates.identity_id` **already exists** (schema.ts:315, migration 0006) and
  is set by every user-cert issuance path (`ssh-user.service.ts:168` →
  `ssh-cert.service.ts:125`, carried through bulk renew), so block resolution and the
  issuance trigger key off it as-is — no schema change or backfill. The only hardening
  is to *forbid* `keyId`-based identity resolution for user certs (`keyId` stays
  caller-settable, `ssh-user.service.ts:161`).

**Lifecycle interactions**: host offboard retires that host's KRL lineage and keeps its
block rows (moot, retained for audit); identity offboard (SSH-32c) supersedes blocks —
its global revocation already covers every host — rows stay, UI annotates them;
blocking a *disabled* identity is allowed (pre-emptive: it still denies any unexpired
certs); `ssh_host_blocks` FKs are ON DELETE RESTRICT — hosts/identities are soft-state
(`offboarded`/`disabled`), never hard-deleted while referenced.

**Pinned implementation requirements** (adversarially verified — a naive
implementation fails without these):
1. **The composed KRL MUST be signed with the Host-CA key**: `host_puller.sh` verifies
   the detached signature against a fixed `CA_PUBLIC_KEY_ID` (the Host CA). Signing
   with a user-CA key makes every puller fail verification and go fail-stale.
   **Caveat (found at milestone grounding, 2026-07-03): the production `krl-client`'s
   DEFAULT `--ca-pubkey` is `/etc/ssh/ssh-user-ca.pub` — the USER CA
   (`krl-client/internal/config/config.go:39`)** — so on defaults it fails verify
   (exit 4) against a Host-CA-signed KRL and blocks never land. This is decision-015's
   open "Host-CA vs User-CA asymmetry" caveat; the milestone reconciles it end-to-end
   (BLK-10 / TASK-187: canonical Host-CA pubkey path shipped to hosts, client default
   flipped, round-trip verify test) while keeping this requirement as pinned.
2. **It MUST union the host-CA revocation set** it displaces (see Bonus fix — dropping
   it would regress host-cert revocation).
3. **Regeneration stays off the issuance hot path**: block/unblock regenerate
   synchronously; *new cert issued to a blocked identity* triggers regen of affected
   host KRLs asynchronously (hook in `SshCertService.sign` — the true choke point that
   also covers `bulkRenew` and external `sign-user`), with the existing lazy
   regen-on-fetch (`nextUpdate` past) as backstop. KMS `signRaw` failure stays
   non-fatal (`ssh-krl.service.ts:144-149`, KRL persisted with `ca_signature: null`) —
   note `host_puller.sh` then *skips* verification and installs the unsigned KRL anyway
   (`host_puller.sh:69-87`); it fail-stales only on a present-but-invalid signature.
   **`krl-client` however REJECTS unsigned KRLs by default (`--allow-unsigned` false)
   and fail-stales on last-good** — surfaced as a distinct state (BLK-07), documented
   per client type (BLK-12).
   Deny availability wins over signature coverage — acceptable, since the bare-KRL
   integrity story already rests on TLS (decision-012), and here the ECIES envelope
   still binds host and freshness.
4. **Lineage switch — seed the per-host KRL number above the per-CA lineage.** The
   puller's anti-rollback is (post-TASK-175) a **strict monotonic check on the
   CA-signed OpenSSH KRL header number**: it rejects any KRL whose header number is not
   strictly greater than the installed one (`payload.go:120-124`) — NOT the former
   sha256-equality state file. The builder stamps that header number from a *per-CA*
   counter (`ssh-krl.service.ts:131`, `last ssh_krls.krl_number + 1` → `:137`
   `krlVersionNumber`). So a host already running a per-CA KRL at header number N that
   is switched to the per-host lineage MUST receive a first per-host KRL whose header
   number is **> N**, or the client rejects it as a rollback and the host stays stuck on
   its old KRL — the block silently never lands, on every already-enrolled host at
   cutover. `ssh_host_krls.krl_number` MUST therefore be seeded to continue past the
   host's CA `ssh_krls.krl_number` (e.g. `max(current per-CA number, last per-host
   number) + 1`), never restarted at 1. An integration test asserts this cross-lineage
   ordering: a host installed at per-CA number N accepts the first per-host KRL and
   enforces the block.
5. **Stamp `last_krl_fetch_at` on ECIES 304 responses too**: today only the 200 branch
   stamps (`ssh-external.routes.ts:214-217` vs `:230`) while KRLs regenerate hourly, so
   a healthy 15-min puller reads as stale between regens — the state pill and
   `stalePullingHosts` are only trustworthy once 304s refresh the fetch timestamp.

**Distribution — hosts unchanged**
- ECIES `POST /api/v1/external/ssh/krl` keeps its envelope, `valid_until`, 304 and
  telemetry stamping; only the payload source switches to the freshest `ssh_host_krls`
  row. `host_puller.sh`, the 15-min `krl-puller.timer`, and the sshd_config drop-in are
  **byte-identical** — zero host-side changes.
- New public `GET /krl/hosts/:hostId.bin|.json` beside `/krl/:caId.bin` with the same
  ETag/lazy-regen/last-good/rate-limit semantics, **env-gated and disabled by default**
  (`SSH_HOST_KRL_PUBLIC`): it leaks per-host deny intel unauthenticated. ECIES is the
  preferred channel; per-CA endpoints stay for block-free/legacy hosts.

**Backend surface**: `SshBlockService.block/unblock/listForHost/listForIdentity` +
`SshHostKrlService.generate(hostId)`; Zod-first tRPC `ssh.block.*`
(`sshProtectedProcedure`, SSH-34 fail-closed) + REST twins per
`docs/ssh-api-contract.md`; audit rows `ssh.host.block` / `ssh.host.unblock`
`{identityId, hostId, reason}` and `ssh.host_krl.generate`. Block/unblock is
deliberately `sshProtectedProcedure` — the same tier as host revoke/offboard
(`trpc/procedures/ssh.ts:141,156`); CA-level actions stay admin-only.

**Effect latency**: click → sub-second server-side regen → host pulls within ≤15 min
(median ≈7.5) → enforced on the next auth attempt after atomic install. The UI never
claims Effective without the version match; dead pullers surface via the existing
`stalePullingHosts` metric (`ssh-mon.service.ts:54-58`; trustworthy once pinned
requirement 5 lands). **Unblock is symmetric**: same ≤15-min bound, shown as
**Lifting** until the version match — the admin never tells a user access is restored
while the host still enforces the old KRL.

## Options considered

Three designs were developed independently against the same verified research and
scored by three adversarial judges (UX clarity / security correctness / architecture &
migration):

| | A: per-host KRL composition | B: principals evaluated at the edge | C: narrowing gate at issuance |
|---|---|---|---|
| Mechanism | deny entries composed into each host's `RevokedKeys` | certs carry `id:<slug>`; host `auth_principals` rendered as role-expansion minus denies | deny table strips/substitutes host-scoped principals at signing; revoke+reissue for immediacy |
| UX / Sec / Arch | **8 / 7 / 7** | 4 / 5 / 4 | 3 / 8 / 5.5 |
| Fatal flaw | — | fail-**open** (a host that stops pulling never blocks); blocks are silent no-ops until a fleet cert-migration completes; requires fleet-wide puller upgrade with deletion semantics | Block revokes ALL of Alice's certs → global lockout until she fetches the narrowed one; kept-host access hangs on an unverifiable fleet `auth_principals` re-push; its "instant" lever never reaches ECIES hosts (they get the host-CA KRL) |

**A wins**: the only design that is purely additive (no re-issue wave, no puller or
drop-in change, fail-closed, works day one on every enrolled host), the only one whose
UI action does exactly what its label says, and it inherits sshd's fail-closed
`RevokedKeys` semantics. Two elements of the losers are adopted:
- from **B**: the read-only "who can reach this host" Access table (pure presentation,
  derivable today).
- from **C**: the **unconditional issuance gate as optional hardening** (below).

## Optional hardening: the issuance gate (flag-gated, priced separately)

Pure A has one recurring window: a blocked identity that legitimately retains issuance
rights can rotate keys → get a new cert → connect to Y inside the ≤15-min pull gap
(the server-side artifact updates instantly via the sign() hook; the host is stale
until its next pull). And a host that *never* pulls never enforces. C's gate closes
both **by construction**: an unconditional check in `SshCertService.sign`
(`type='user'`) strips/denies any principal resolving to a blocked host — every
post-block cert is *born unable* to authenticate on Y, bounding even a dead host by
the residual TTL (≤1w). Cost: `render()` must pre-provision dual `P` + `P@<fqdn>`
lines and the fleet re-pushed once, and narrowed certs surface in the UI. Ship the
per-host KRL first; add the gate behind a flag for deployments that need zero-window
blocks. The two mechanisms are independent layers — either enforces alone.

## Consequences

- "Block user X on host Y" becomes one honest, reversible, audited click; everything
  accepted in decisions 011-014 is preserved verbatim (KMS non-exportable CAs, `ssh_*`
  schema isolation, bare-KRL + detached-sig split, per-CA serials, +1w TTLs, principal
  catalog + render/markPushed flow, fleet tokens, ECIES envelope, all endpoints).
- Revoked user certs finally reach ECIES-pulling hosts (pre-existing gap closed).
- Accepted residual limitations, stated honestly in UI copy and docs:
  - ≤1 pull-interval before Y enforces (irreducible in a pull model; same bound as all
    revocation today);
  - v1 new-key race for blocked-but-active identities (closed by the issuance gate);
  - **Effective** means "ciphertext served", not "verified installed" (true
    confirmation would need a puller callback — out of scope);
  - fingerprint entries over-block a second identity sharing the same public key
    (anti-pattern; detected and warned at block time);
  - an offline/never-pulling host keeps its last KRL — visible via `stalePullingHosts`,
    never shown as Effective.
- New state to operate: a per-host KRL lineage beside the per-CA one; hosts on the
  public `.bin` path must switch fetch URL (one line in the Ansible role) *and* the
  deployment must set `SSH_HOST_KRL_PUBLIC=true` — otherwise blocks never land there.
- Effort ≈ one milestone-sized feature (~"SSH-35"): schema **S**, host-KRL composition
  service **M**, block service + API + audit **S**, issuance/revocation triggers **M**
  (correctness-critical), endpoints **S**, UI **M**, E2E vs real sshd (SSH-33 harness:
  blocked-on-Y / allowed-on-Z / lineage-switch / reissue-regen) **M**, Ansible/docs
  **S**. Issuance gate (optional hardening): **M** extra.

## Related tasks

- **doc-008 — SSH Host Access Blocks milestone (TASK-177..190, BLK-00..BLK-13)** —
  implements this decision on branch `feat/ssh-host-blocks`; the task breakdown was
  grounded against the code and adversarially critiqued (trust-anchor reconciliation,
  global monotonic KRL numbering, revocation-trigger sequencing, cutover fallback).
- TASK-140/141/142 (SSH-20/21/22) — KRL builder, revoke ops, public serving: reused
  verbatim by the per-host composition. **Done.**
- TASK-145 (SSH-24) — ECIES sidecar + host_puller.sh: the unchanged distribution
  channel; payload source switches server-side. **Done.**
- TASK-132 (SSH-14) — principal catalog/render: source of the Access-table join; the
  optional issuance gate touches `render()`. **Done.**
- TASK-155 (SSH-32c) — identity offboarding: the global counterpart this decision
  complements (blocks are the targeted sibling). **Done.**
- TASK-156 (SSH-33) — E2E harness against real sshd: acceptance vehicle for the
  block/allow matrix tests. **Done.**
- decision-012 (data model / KRL state), decision-013 (KRL distribution): both
  preserved; this decision layers on top.
