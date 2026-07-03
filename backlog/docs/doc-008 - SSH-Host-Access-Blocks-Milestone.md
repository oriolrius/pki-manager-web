---
id: doc-008
title: SSH Host Access Blocks Milestone
type: specification
created_date: '2026-07-03 21:27'
---

# SSH Host Access Blocks Milestone

> Human-readable anchor for the **SSH Host Access Blocks** milestone (14 tasks, TASK-177..190, BLK-00..BLK-13).
> Decisions: [decision-016 — Per-Host User Access Blocks (SSH)](../decisions/decision-016%20-%20Per-Host-User-Access-Blocks-SSH.md) *(the contract this milestone implements)* ·
> [decision-015 — SSH KRL Client Decryption Model](../decisions/decision-015%20-%20SSH-KRL-Client-Decryption-Model.md) *(whose Host-CA/User-CA open caveat BLK-10 forces to resolution)* ·
> decisions 011-014 *(preserved verbatim — this milestone is purely additive)*.
> Branch: `feat/ssh-host-blocks` off `main`.

## Goal

Make "block THIS user on THIS host" one first-class, reversible, auditable UI action —
without touching the accepted SSH architecture. The mechanism (decision-016, design A of
three adversarially judged options): a new `ssh_host_blocks` table keyed
(identity, host), resolved at build time into a **HOST-SPECIFIC composed KRL** that each
host installs through the unchanged existing distribution channel:

```
KRL(host Y) =   host-CA revocation set
              ∪ all user-CA revocation sets
              ∪ resolve(active blocks on Y)     ← serials of unexpired certs (per issuing CA)
                                                  + SHA256 fingerprints of every certified key
```

Blocks are a **new concept, not revocations** — the blocked identity's certs stay
`status='active'` (they ARE valid on every other host); `ssh_revocations`/`ssh_krls`
semantics are untouched. sshd's own semantics make it work: `RevokedKeys` is re-read
per auth attempt, fail-closed, and KRLs are by-design host-local state. Side effect
(the "bonus fix"): revoked user certs finally reach ECIES-pulling hosts, which today
receive the host-CA KRL only.

## Load-bearing findings from adversarial grounding (2026-07-03)

The task breakdown was grounded against the actual code and adversarially critiqued
(3 lenses, 35 findings). Four findings shape the plan and MUST NOT be lost:

1. **Trust-anchor mismatch (critical → BLK-10).** decision-016 pins Host-CA signing of
   the composed KRL, but the deployed Go client's DEFAULT `--ca-pubkey` is
   `/etc/ssh/ssh-user-ca.pub` — the **User CA** (`krl-client/internal/config/config.go:39`).
   On defaults, every pull fails signature verify (exit 4), keeps last-good, and **blocks
   silently never land fleet-wide**. BLK-10 reconciles end-to-end (canonical Host-CA
   pubkey path in `ssh-config.ts` → drop-in + Ansible install it → krl-client default
   flipped), with a round-trip verify test. This is decision-015's open
   "Host-CA vs User-CA asymmetry" caveat forced to resolution.
2. **KRL-number allocation must be globally monotonic and transactional (critical →
   BLK-02/BLK-03).** The client's anti-rollback (post-TASK-175) strictly compares the
   CA-signed header number; the existing `(ca_id, krl_number)` index is NOT unique and
   the read-max-then-insert pattern races across ≥4 concurrent regen triggers. Fix by
   construction: `number = max(all per-CA and per-host lineages) + 1` inside a
   transaction + UNIQUE `(host_id, krl_number)`. This simultaneously satisfies pinned
   req #4 (first per-host KRL > any installed per-CA number), removes the race, and
   makes cutover **rollback-safe** (per-CA rows generated later still carry higher numbers).
3. **Revocation-latency regression window (major → BLK-05 before BLK-06).** Today
   revocation synchronously regenerates the per-CA KRL. Once ECIES serves per-host rows,
   an unhooked revocation would sit stale until the 1h `nextUpdate` backstop. BLK-05
   hooks EVERY revoke entry point with cheap invalidation (`next_update` clamp; eager
   regen only for hosts with active blocks — never O(fleet) KMS signs) and therefore
   **must land before or with the BLK-06 cutover**.
4. **Cutover first-fetch (simplified, per Oriol 2026-07-03).** At cutover
   `ssh_host_krls` is empty for every host; the route synchronously generates the
   first composed row. If that generation fails, respond **not-initialized**
   (NO_KRL-style) — **no per-CA fallback**: pullers fail-stale on their last-good
   installed KRL and retry on the next interval. Accepted trade-off for simplicity;
   avoids any risk of serving a lower per-CA number a client would later reject.

Also surfaced: krl-client **rejects unsigned KRLs** by default (`--allow-unsigned`
false) — a KMS outage means krl-client hosts fail-stale on last-good while
host_puller.sh installs the unsigned row; BLK-07 surfaces this as a distinct state,
BLK-12 documents the per-client posture. The decision's "puller installs unsigned
anyway" sentence is true only for host_puller.sh.

## UI surface (the product)

One verb pair — **Block / Unblock** — in three places (existing conventions only:
handmade Tailwind, `confirm()`/`prompt()` gates, STATUS_STYLES pills, lucide):

- **Host detail** (`ssh.hosts.$id.tsx`): new **Access card** between header card and
  DeployPanel — who can reach this host (identity / via-roles → accounts / state) with
  per-row [Block]; blocked rows red with reason/by/when + [Unblock]; pre-emptive
  "Block user…" dropdown. Confirm copy is pinned by decision-016, including the
  shared-key over-block warning and (new, from critique) a **hard warning when the host
  is not on a per-host channel** — a block that will not be enforced must say so at
  block time, not via a gray pill after the fact.
- **Users page**: IdentityCard "Blocked on:" red host pills (each with state) +
  "Block on host…" select.
- **KRL page**: HostDistribution gains Blocks + State columns (fleet propagation view).

State pills: **Effective** (`lastKrlVersion === version_hash`) / **Pending** /
**Lifting** (post-unblock, symmetric) / **Unknown** (no usable ECIES registration ⇒
unenforceable). Tooltip stays honest: *"served to host puller at \<time\> — not
confirmation of install"*.

## Tasks

### Epic 0 — Baseline & standalone fix
- **TASK-177 — BLK-00**: Milestone baseline — fleet/puller inventory (which client,
  which trust anchor), per-CA `krl_number` high-water marks, `krl-client ≥ TASK-175`
  precondition pinned.
- **TASK-178 — BLK-01**: Stamp `last_krl_fetch_at` on ECIES **304** (pinned req #5,
  pre-existing bug; makes `stalePullingHosts` trustworthy; ships first — BLK-06
  rewrites the same route).

### Epic 1 — Data & composition core
- **TASK-179 — BLK-02**: Schema — `ssh_host_blocks` (partial-unique active pair, FK
  RESTRICT) + `ssh_host_krls` (explicit columns incl. `block_count`; UNIQUE
  `(host_id, krl_number)`) + migration.
- **TASK-180 — BLK-03**: `SshHostKrlService` — composed KRL (incl. retired-CA serial
  scoping), **global monotonic transactional numbering**, Host-CA `signRaw` signing,
  unsigned-row semantics, `ssh.host_krl.generate` audit.
- **TASK-181 — BLK-04**: `SshBlockService` — block/unblock (sync regen), lifecycle
  (disabled ok / offboard supersede / lineage retirement), shared-fingerprint
  detection, audit.
- **TASK-182 — BLK-05**: Issuance + revocation triggers (**correctness-critical**) —
  async regen on issuance-to-blocked via the `sign()` choke point; cheap invalidation
  on EVERY revoke entry point; forbid keyId-based identity resolution.

### Epic 2 — Serving, state & API
- **TASK-183 — BLK-06**: Serving cutover — ECIES payload from `ssh_host_krls`
  (first-fetch generation + pre-first-row per-CA fallback; `SSH_HOST_KRL_SERVE`) +
  public `GET /krl/hosts/:hostId.bin|.json` (`SSH_HOST_KRL_PUBLIC`, default OFF).
- **TASK-184 — BLK-07**: State derivation (Effective/Pending/Lifting/Unknown +
  unsigned-latest cause) + per-host ssh-mon metrics.
- **TASK-185 — BLK-08**: API — `ssh.block.*` (sshProtectedProcedure + REST twins) +
  the **read model** (`ssh.host.access` entitlement join, identity blocked-on tuples,
  fleet distribution query) + contract doc.

### Epic 3 — UI, client, verification, operations
- **TASK-186 — BLK-09**: UI — Access card + Users pills + KRL columns (pinned copy,
  warnings, honest tooltips).
- **TASK-187 — BLK-10**: **Puller trust-anchor reconciliation** (critical) — Host-CA
  pubkey canonical path end-to-end; krl-client default flipped; round-trip verify test.
- **TASK-188 — BLK-11**: E2E — block matrix vs real sshd **+ real krl-client
  anti-rollback** (blocked-on-Y / allowed-on-Z / composition coverage incl. bonus fix /
  lineage-switch accept+reject / reissue-regen / unblock symmetry).
- **TASK-189 — BLK-12**: Ansible + operator docs + cutover runbook (trust anchor →
  canary → cutover; rollback story; `--allow-unsigned` posture; ALL residual
  limitations incl. the v1 new-key race).
- **TASK-190 — BLK-13**: *(optional, flag-gated, default OFF)* Issuance gate —
  zero-window blocks; certs born unable to reach blocked hosts; dual
  `P` + `P@<fqdn>` principal lines + one fleet re-push.

## Sequencing

- **Phase 0**: BLK-00 (baseline) ∥ BLK-01 (304 fix — independently shippable) ∥ BLK-02 (schema).
- **Phase 1 — core**: BLK-02 → BLK-03 → {BLK-04, BLK-05}. BLK-10 can start off BLK-03
  (trust anchor is fleet-rollout-critical path: hosts need it BEFORE cutover).
- **Phase 2 — cutover**: BLK-06 requires BLK-01 + BLK-03 + **BLK-05** (revocation
  triggers must not regress) — then BLK-07 (state) → BLK-08 (API).
- **Phase 3**: BLK-09 (UI, off BLK-08) ∥ BLK-11 (E2E, off BLK-04/05/06/10) ∥ BLK-12
  (docs/runbook, off BLK-06+10). BLK-13 strictly last, optional.

## Top risks & mitigations

- **Blocks that silently never land** — three distinct causes, each owned:
  wrong trust anchor (BLK-10 + BLK-11 round-trip test); duplicate/low KRL numbers
  rejected as rollback (BLK-02 unique index + BLK-03 global monotonic + concurrency
  test); host not on a per-host channel (BLK-07 Unknown state + BLK-09 hard warning at
  block time + BLK-12 Ansible switch).
- **Fail-stale at cutover** — BLK-06 first-fetch generates synchronously; a failed
  generation returns not-initialized and hosts keep last-good (accepted, no per-CA
  fallback) + `SSH_HOST_KRL_SERVE` canary gate + BLK-12 runbook ordering.
- **Revocation latency regression post-cutover** — BLK-05 invalidation hooks on every
  revoke entry point, latency test bounded by pull interval; sequencing constraint
  BLK-05 ⊑ BLK-06.
- **KMS outage → unsigned KRLs** — krl-client fail-stales (by design, fail-closed);
  surfaced as a distinct state (BLK-07), documented posture (BLK-12); deny availability
  for host_puller.sh hosts preserved (unsigned row still persisted, decision req #3).
- **Over-blocking via shared keys** — detected at block time (BLK-04), warned in the
  confirm (BLK-09), documented as anti-pattern (BLK-12).
- **O(fleet) KMS signing on the revoke hot path** — cheap `next_update` clamp
  invalidation, eager regen only where blocks exist (BLK-05).
- **v1 new-key race** (blocked-but-active identity rotates keys inside the pull gap) —
  accepted residual, documented (BLK-12); closed by construction only by the optional
  issuance gate (BLK-13).

## Accepted residual limitations (stated honestly, per decision-016)

≤1 pull-interval before a host enforces (irreducible in a pull model) · v1 new-key race
(closed only by BLK-13) · **Effective** = "ciphertext served", not "verified installed"
(true confirmation would need a puller callback — out of scope) · fingerprint entries
over-block a second identity sharing the same public key (warned at block time) · an
offline/never-pulling host keeps its last KRL (visible via `stalePullingHosts`, never
shown Effective).

## Related decisions

- [decision-016 — Per-Host User Access Blocks (SSH)](../decisions/decision-016%20-%20Per-Host-User-Access-Blocks-SSH.md) — **the contract**
- [decision-015 — SSH KRL Client Decryption Model](../decisions/decision-015%20-%20SSH-KRL-Client-Decryption-Model.md) — local-key puller whose trust-anchor caveat BLK-10 resolves
- [decision-013 — SSH KRL Distribution](../decisions/decision-013%20-%20SSH-KRL-Distribution.md) / [decision-012 — SSH Data Model and KRL State](../decisions/decision-012%20-%20SSH-Data-Model-and-KRL-State.md) — preserved; this milestone layers on top
