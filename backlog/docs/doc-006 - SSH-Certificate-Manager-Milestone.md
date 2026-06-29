---
id: doc-006
title: SSH Certificate Manager Milestone
type: specification
created_date: '2026-06-29 15:51'
---

# SSH Certificate Manager Milestone

> Human-readable anchor for the **SSH Certificate Manager** milestone (41 tasks, TASK-116..156).
> Decisions: [decision-011](../decisions/decision-011%20-%20SSH-Certificate-Signing-Approach.md) ·
> [decision-012](../decisions/decision-012%20-%20SSH-Data-Model-and-KRL-State.md) ·
> [decision-013](../decisions/decision-013%20-%20SSH-KRL-Distribution.md).

## Goal

Productise the ssh-certs PoC into pki-manager: issue, manage, and revoke OpenSSH host and user
certificates from a KMS-backed dual CA (User CA + Host CA), with principal/RBAC catalogs, KRL
revocation and distribution, and host/user lifecycle management — integrated into the existing
React UI, tRPC, REST/OpenAPI, and Cosmian KMS using established pki-manager patterns rather than
a parallel stack, and faithful to the PoC's security posture (non-exportable CA keys where the
live KMS supports it).

## Executive summary

SSH certs become a first-class domain that mirrors the existing X.509 service + tRPC + REST
triple. An SSH certificate is fundamentally different from X.509 (no PEM, principals instead of
SANs, extensions/critical-options instead of KU/EKU, OpenSSH-wire trust material instead of
chains), so it gets its own `ssh_*` tables, services, tRPC sub-routers, REST routes under
`/api/v1/ssh`, and a single grouped SSH section in the React console — but every piece is a
recognizable twin of an existing component.

Branch-baseline reality (verified): this worktree is on `ssh-cert-manager`, forked from `main`.
It does NOT contain the CRL-signing milestone (`crl.service.ts` still returns `''`, `server.ts`
returns 503 "not yet implemented"), there is no `signRaw` seam, and NONE of the
cluster/external-issuer machinery (no clusters table, cluster-auth, or external.routes.ts). The
migration head is 0003. Therefore this milestone AUTHORS the raw-signing seam and the
fleet-token auth stack from scratch — **SSH-00** makes the base branch and true migration head
an explicit, verified precondition (numbers taken from `meta/_journal.json`, never hard-coded).

The cryptographic core is the only genuinely new code: a dependency-free OpenSSH wire-format
encoder (cert + KRL share the RFC4251 wire primitives), an SSH public-key parser, and a raw
ECDSA signing path validated byte-for-byte against `ssh-keygen` and a real `sshd`. The signing
security model is a **blocking decision** (SSH-SENS), not an open question: the PoC keeps both
CA keys `--sensitive true` (non-exportable) and signs via Cosmian native `ec sign`. The
non-exportable path is preferred; in-memory export-and-sign is a documented, signed-off
DOWNGRADE used only if both Sign paths are proven impossible. All paths sit behind one
`kmsService.signRaw()` seam.

Revocation is two-tier and stated honestly: short TTLs (+1w users, +52w hosts) are the PRIMARY
mechanism; the emergency path is an OpenSSH KRL that is **natively unsigned** — sshd does NOT
verify any signature on a RevokedKeys file. The bare KRL is served like the existing `/crl`
route (integrity = TLS + 0444 root-owned file perms), with a SEPARATE detached CA signature
verified only by the optional custom puller. Per-host ECIES distribution is IN v1 scope but
**gated on the SSH-23 feasibility spike**; if the spike disproves Cosmian's external-pubkey
Register / locate-by-tag / ec encrypt-decrypt for nistp256, SSH-15 and SSH-24 are dropped and
revocation falls back to the bare served KRL.

## Integration approach

| Layer | Approach |
|---|---|
| **UI** | ONE grouped "SSH" top-level nav entry in `__root.tsx` (FontAwesome, matching the existing nav) → SSH landing page with a second-level sub-nav (SSH CAs, Hosts, Users, Principals, Revocation/KRL). File-based routes follow the `certificates.tsx` shape (list+Outlet, `.new.tsx`, `.$id.tsx`). Central primitive: config-snippet generators via reusable `<ConfigSnippet>` / `<DeployPanel>` emitting ready-to-paste sshd_config / known_hosts / ssh_config / auth_principals drop-ins. A live `ssh-keygen -L` decoded-cert preview is mandatory. All under `_authenticated`; empty-state-gated until one `ssh_ca` exists. |
| **OpenAPI** | Zod-first single source of truth: every DTO is a Zod schema in `trpc/ssh-schemas.ts`, converted via the EXISTING `toJsonSchema()` helper. Authenticated CRUD under `/api/v1/ssh` in the same Swagger at `/api/docs`. PUBLIC OpenSSH-format downloads (ca.pub, trusted-user-ca-keys, cert-authority, `/krl/:caId.bin`) registered like `/crl` — bare `server.get` outside `registerRestApi`, on the public-path allowlist. Errors use the standard `{error:{code,message}}` shape. |
| **tRPC** | `procedures/ssh-ca.ts`, `ssh-host.ts`, `ssh-user.ts`, `ssh-principal.ts`, `ssh-krl.ts` mirroring `certificate.ts`/`crl.ts`: protected for issuance/reads, admin for CA create/rotate/revoke, Zod input, local `mapServiceError()`. One `ssh` namespace composed in `router.ts`. Admin gate is vacuous when OIDC is off, so **SSH-34** adds a fail-closed guard. |
| **KMS** | ONE new `kmsService.signRaw(keyId,data,{hash,format})` seam — the FIRST consumer on this branch (authored, not reused). Path chosen by SSH-SENS: non-exportable Cosmian `ec sign`/KMIP Sign preferred; in-memory export fallback only if both Sign paths fail (zeroized + alerted). CA creation uses `createKeyPair({keyAlgorithm:'ECDSA-P256', tags:['ssh-<type>-ca']})`. ECIES register/locate/encrypt/decrypt confined to the deferred path, gated behind SSH-23. |
| **Data model** | New `ssh_*` Drizzle tables (minimal-schema philosophy: KMS holds keys, SQLite holds metadata + denormalized fields + verbatim signed cert/KRL blobs). Migration numbers generated from the ACTUAL head (`meta/_journal.json`), never hard-coded. `ssh_cas` (rotation columns), `ssh_hosts` (KRL/principal telemetry), `ssh_identities`, `ssh_certificates` (cert_openssh verbatim on-row, per-CA serial), principal catalog + maps, `ssh_revocations`, `ssh_krls` (bare `krl_blob` + distinct `ca_signature`). `audit_log` reused; only the audit unions grow. Additive/forward-only with an env kill-switch. |
| **Automation** | NET-NEW security-critical fleet-token auth stack (SSH-19): tokens stored as SHA-256 hashes, constant-time verify, plaintext once (`pkimg_` prefix), one token scoped to one SSH CA pair + op-set, TLS-mandatory, rate-limited, audited. `ssh-external.routes.ts` registered AFTER the OIDC block (bypasses OIDC): `POST /api/v1/external/ssh/sign-host|/sign-user|/register-host-pubkey`, idempotent on Idempotency-Key. The Ansible role and CI call these. Encrypted per-host KRL sidecar gated on the ECIES spike. |

## Epics

### 1. SSH Crypto Core & Baseline
The verified branch baseline + migration head, the empirical signing decision, and the
dependency-free OpenSSH wire primitives + signing seam — the only genuinely new crypto.
- TASK-116 — SSH-00: Establish SSH milestone base branch, true migration head, and reuse inventory
- TASK-117 — SSH-SENS: Decision + spike: keep SSH CA keys NON-exportable and sign via Cosmian native ec sign (PKCS#11/KMIP) vs in-memory export
- TASK-118 — SSH-01: OpenSSH wire-format primitives + certificate encoder (TS) with empty-principal/key-id guards
- TASK-119 — SSH-02: SSH public-key parser + OpenSSH/SPKI format conversion
- TASK-120 — SSH-03: kmsService.signRaw() canonical raw-signature seam + SSH ECDSA signer
- TASK-121 — SSH-04: Pin and document the detached-signature format end-to-end (signer ↔ KRL puller ↔ KMS)

### 2. SSH Data Model & Migrations
The `ssh_*` tables, per-CA monotonic serial allocation, the two-artifact KRL trust model, and
audit-union extensions, with migration numbers from the actual head.
- TASK-122 — SSH-05: Schema: ssh_cas table (dual User/Host CA, rotation columns, per-CA serial allocator)
- TASK-123 — SSH-06: Schema: ssh_hosts (+ KRL/principal telemetry) + ssh_identities
- TASK-124 — SSH-07: Schema: ssh_certificates (host + user certs, signed blob on-row)
- TASK-125 — SSH-08: Schema: principal catalog + host principal-maps (RBAC source of truth)
- TASK-126 — SSH-09: Schema: ssh_revocations + ssh_krls (bare-KRL + detached-sig split); audit-union + serial/key-id decision

### 3. SSH CA & Signing Services
Dual-CA lifecycle (incl. import), the single `signCertificate` primitive, and host/user/principal
services as (ctx,params) singletons.
- TASK-127 — SSH-10: ssh-ca.service.ts: dual SSH CA lifecycle + trust-anchor publishing
- TASK-128 — SSH-IMPORT: Import an existing SSH CA (User or Host) into pki-manager
- TASK-129 — SSH-11: signCertificate primitive: per-CA serial/key-id allocation, guards, host-only backdate, renewal semantics
- TASK-130 — SSH-12: ssh-host.service.ts: issue/list/get/revoke host certificates + sshd drop-in
- TASK-131 — SSH-13: ssh-user.service.ts: issue/list/get/revoke user certs with extensions + validated critical options
- TASK-132 — SSH-14: ssh-principal.service.ts: principal catalog + host→account map + auth_principals rendering + drift awareness
- TASK-133 — SSH-15: Host public-key registration in KMS (v1 scope, gated on the SSH-23 ECIES feasibility spike)

### 4. SSH API Surface (tRPC + REST/OpenAPI + Automation)
Typed tRPC + REST/OpenAPI under `/api/v1/ssh`, public trust-anchor downloads, the fail-closed
auth guard, the net-new fleet-token stack, and bulk renew/revoke.
- TASK-134 — SSH-16: SSH Zod schemas (single source of truth for tRPC + OpenAPI) with input validation
- TASK-135 — SSH-17: tRPC sub-routers (ssh.ca/host/user/principal) wired into router.ts
- TASK-136 — SSH-18: REST routes + OpenAPI under /api/v1/ssh (authenticated CRUD) + public download routes
- TASK-137 — SSH-34: Fail-closed authorization for SSH CA management and signing when OIDC is disabled
- TASK-138 — SSH-19: Build the SSH automation fleet-token auth stack + external signing endpoints
- TASK-139 — SSH-BULK: Bulk renew expiring + bulk revoke SSH certs

### 5. SSH Revocation & KRL
Native KRL build, public bare-KRL serving with ETag/304/lazy-regen/last-good-fallback, detached
CA signature, rate limiting/abuse controls, the ECIES gate spike, and the (gated) encrypted
sidecar.
- TASK-140 — SSH-20: Native OpenSSH KRL encoder + version hashing (key-hash + explicit-serial)
- TASK-141 — SSH-21: krl.service.ts: revoke ops + build bare KRL + detached CA signature + persist + tRPC ssh.krl
- TASK-142 — SSH-22: Public bare-KRL serving endpoint + NEW ETag/304/lazy-regen/last-good-fallback + auto-regen on revocation
- TASK-143 — SSH-MON: Rate limiting + abuse controls + health/metrics for expiring certs, stale KRLs, non-pulling hosts
- TASK-144 — SSH-23: Spike Cosmian EC encrypt/decrypt (ECIES) + external-pubkey Register + locate-by-tag; v1 GATE for per-host distribution
- TASK-145 — SSH-24: Stateless encrypted KRL distribution sidecar + host-side puller

### 6. SSH Operator Console (Frontend)
The React 19 / TanStack SSH section with config-snippet generators as the central primitive.
- TASK-146 — SSH-25: Grouped SSH nav section (FontAwesome), route scaffold, reusable ConfigSnippet/DeployPanel
- TASK-147 — SSH-26: SSH CAs: list + create/import dual CA + detail with trust-material generators
- TASK-148 — SSH-27: SSH Hosts: register/issue host cert + detail with deploy bundle and renew/revoke
- TASK-149 — SSH-28: SSH Users: issue cert with capability editor + live decoded preview + detail
- TASK-150 — SSH-29: Principals/RBAC catalog UI + Revocation/KRL UI with telemetry-sourced distribution status
- TASK-151 — SSH-30: Dashboard SSH tiles + Expiring-Soon SSH rows (union widened in lockstep) + frontend tests

### 7. Automation, Ops, Docs & E2E
The Ansible host-cert role + API contract docs, CA-rotation and host/user offboarding lifecycle
ops, and the real-sshd end-to-end verification harness.
- TASK-152 — SSH-31: Ansible ssh_host_cert role + SSH API contract docs
- TASK-153 — SSH-32a: CA rotation: dual-trust overlap and predecessor retirement
- TASK-154 — SSH-32b: Host offboarding / decommission in one action
- TASK-155 — SSH-32c: User/identity offboarding (disable) in one action
- TASK-156 — SSH-33: End-to-end crypto + revocation verification harness against real sshd

## Sequencing (7 phases)

- **Phase 0 — Baseline & signing decision (blocking)**: SSH-00, SSH-SENS. Two blocking
  preconditions: pin the base branch + TRUE migration head + reuse inventory, and settle the
  CA-key-exportability/signing decision empirically against the live KMS (preferring
  non-exportable native `ec sign`). Nothing downstream is correctly specifiable until these land.
- **Phase 1 — Crypto foundation**: SSH-01, SSH-02, SSH-03, SSH-04. The wire encoder (with
  empty-principal/key-id guards), the pubkey parser (actionable RSA-rejection), the `signRaw`
  seam, and the pinned detached-signature format — the bedrock, independently testable against
  `ssh-keygen`.
- **Phase 2 — Data model**: SSH-05, SSH-06, SSH-07, SSH-08, SSH-09. All `ssh_*` tables and
  decision-012 land before services persist. SSH-05 (with rotation columns) is the root; SSH-09
  settles the bare-KRL-unsigned vs detached-signature model and the single serial scheme.
- **Phase 3 — Services**: SSH-10, SSH-IMPORT, SSH-11, SSH-12, SSH-13, SSH-14. CA lifecycle +
  import, the single `signCertificate` primitive (the linchpin SSH-12/13 block on), then
  host/user/principal services. SSH-15 is intentionally gated to Phase 5.
- **Phase 4 — API surface**: SSH-16, SSH-17, SSH-18, SSH-34, SSH-19, SSH-BULK. Zod-first tRPC +
  REST/OpenAPI; SSH-34 closes the fail-open admin gap; SSH-19 builds the fleet-token stack from
  scratch; SSH-BULK reuses the X.509 bulk triple.
- **Phase 5 — Revocation & KRL**: SSH-20, SSH-21, SSH-22, SSH-MON, SSH-23, SSH-15, SSH-24. KRL
  encoder reuses Phase-1 wire primitives; SSH-22 serves bare bytes with new caching; SSH-23
  spikes ECIES — only if viable do SSH-15 and SSH-24 proceed.
- **Phase 6 — Frontend**: SSH-25, SSH-26, SSH-27, SSH-28, SSH-29, SSH-30. SSH-25 lands first
  (nav + ConfigSnippet/DeployPanel, no backend dep); pages consume the typed tRPC routers;
  SSH-30 widens the dashboard union in lockstep.
- **Phase 7 — Automation, ops, docs & E2E**: SSH-31, SSH-32a, SSH-32b, SSH-32c, SSH-33. Ansible
  role + contract docs, three focused lifecycle tasks (CA rotation, host/user offboarding), and
  the real-sshd E2E harness as the final byte-compatibility gate.

## Top risks & mitigations

- **Branch/dependency mismatch (verified blocker)**: the design referenced a CRL signing seam,
  decision-010, and cluster/external-issuer machinery that DO NOT exist on this branch. →
  SSH-00 makes the base branch and TRUE migration head explicit preconditions + a reuse
  inventory; SSH-03 AUTHORS `signRaw`; SSH-19 BUILDS the fleet-token stack from scratch.
- **Signing security downgrade vs the PoC (blocker)**: exporting the CA key into Node memory on
  every signature widens any RCE/heap-dump to permanent CA-key theft. → SSH-SENS promotes this
  to a blocking decision (decision-011) preferring the non-exportable native-sign path; export
  is adopted only if both Sign paths are proven impossible, then zeroized + alerted.
- **Admin gating is vacuous in the default posture**: `adminRoleMiddleware` skips the role check
  when OIDC is off — an unauthenticated CA-forgery primitive. → SSH-34 adds a fail-closed guard
  (refuse SSH CA-management/signing unless an explicit dev opt-in is set).
- **KRL signature/trust conflation**: OpenSSH KRLs are natively unsigned; sshd verifies no
  signature. → SSH-09 splits the artifact (bare `krl_blob` vs detached `ca_signature`); SSH-22
  implements ETag/304/lazy-regen/last-good-fallback as NEW scope and owns the public raw-bytes
  route; SSH-04 pins the detached format.
- **ECIES per-host distribution depends on unverified Cosmian capabilities** (external-pubkey
  Register, locate-by-tag, ec encrypt/decrypt for nistp256) and could be INFEASIBLE. → Ship the
  bare/served public KRL (SSH-22) as the guaranteed mechanism; gate SSH-15 + SSH-24 behind the
  SSH-23 spike; SSH-15 binds registration to the just-signed cert's fingerprint.
- **Signing non-determinism** (random nonce; verbatim-served KRL for stable 304s). → Persist
  `cert_openssh` and `krl_blob` verbatim on-row (SSH-07/SSH-09); downloads return stored bytes.
- **Per-CA monotonic serial allocation is net-new** and uint64 exceeds JS safe-integer range. →
  SSH-09 fixes ONE serial scheme; SSH-11 allocates transactionally (optimistic
  UPDATE...WHERE, retry on 0 rows) and handles serials as bigint/TEXT; serial-RANGE revocation
  dropped from v1.
- **Short user TTLs are sensitive to clock drift**; the PoC backdates only host certs. → SSH-11
  backdates HOST certs only; SSH-28 surfaces valid_after/before in operator-TZ + UTC with an NTP
  note; docs flag NTP as a hard host prerequisite.
- **Per-host KRL distribution status needs fetch telemetry** the stateless distributor lacks. →
  SSH-06 adds telemetry columns; SSH-22 (and SSH-24's callback if ECIES ships) records the
  requesting host_id + installed version; SSH-29 degrades to "unknown" when absent.
- **force-command/source-address enforce unconditionally**; key_id is logged verbatim; empty
  principals = "valid for all". → SSH-16/SSH-13 validate source-address as CIDRs and constrain
  key_id; SSH-01/SSH-11 reject empty principals unless explicitly wildcarded; the live preview
  (SSH-28) shows exactly what will be enforced.

## Open questions

- **[DEFERRED] Per-host ECIES KRL distribution** (SSH-15/23/24) is gated on the SSH-23 spike;
  the bare/served public KRL + short TTLs is complete, honest revocation on its own. ECIES only
  hides WHICH keys are revoked and depends on three unverified Cosmian capabilities.
- **[DEFERRED] P-384 SSH CA support** is out of v1 (P-256-only matches the PoC and PKCS#11 v2.40
  and halves the encoder/sign test matrix); the schema constrains to ECDSA-P256.
- **[DEFERRED] Serial-RANGE/bitmap KRL revocation** is out of v1 (serial gaps make ranges an
  over-revocation foot-gun); v1 ships revoke-by-key-fingerprint and revoke-by-explicit-serial.
- Should user-cert principals be free-form role names (injection-safe grammar only) or
  constrained to each identity's `ssh_user_principals` entitlement? Current default: free-form
  with optional catalog constraint.
- Where does `host_id` come from canonically — FQDN, a manager-assigned UUID, or both? For v1
  (no ECIES) FQDN suffices; if ECIES ships, the KMS tag, payload binding, and puller identity
  must all use the same identifier.
- Should default TTL caps (+1w users / +52w hosts) be per-CA policy columns enforced at sign
  time, or service/config constants? SSH-11 supports an optional CA-level cap either way.
- Should `ssh_identities` optionally link to an X.509 client cert / OIDC subject to unify human
  identity, or stay independent? `external_subject` is a placeholder for now.
- If the k8s cluster/external-issuer branch later merges in, should the SSH fleet-token model
  (SSH-19) be unified with the cluster-token model, or kept separate? SSH-19 builds an
  independent stack for now; unification is a follow-up.

## Related decisions

- [decision-011 — SSH Certificate Signing Approach](../decisions/decision-011%20-%20SSH-Certificate-Signing-Approach.md)
- [decision-012 — SSH Data Model and KRL State](../decisions/decision-012%20-%20SSH-Data-Model-and-KRL-State.md)
- [decision-013 — SSH KRL Distribution](../decisions/decision-013%20-%20SSH-KRL-Distribution.md)
