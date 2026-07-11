---
id: doc-009
title: Ansible Integration Milestone
type: specification
created_date: '2026-07-11 09:30'
---

# Ansible Integration Milestone

> Human-readable anchor for the **Ansible Integration** milestone (12 tasks, ANS-00..ANS-11).
> Goal: bring the `ansible/` module to **100 % coverage of every host-deployable feature**
> the project now exposes — SSH-first — and prove it with a **dockerized Ansible e2e suite**
> that treats containers as managed hosts.
> Predecessors: [SSH Certificate Manager](doc-006%20-%20SSH-Certificate-Manager-Milestone.md) ·
> [SSH KRL Client Distribution](doc-007%20-%20SSH-KRL-Client-Distribution-Milestone.md) ·
> [SSH Host Access Blocks](doc-008%20-%20SSH-Host-Access-Blocks-Milestone.md) *(this milestone
> operationalises what those three shipped, so a fleet is provisionable and verifiable end-to-end
> from one `ansible-playbook` run).*
> Suggested branch: `feat/ansible-integration` off `main`.
> **Status: planned 2026-07-11** (grounded against the code + adversarially verified; not yet implemented).

## Goal

Today the `ansible/` module has exactly **one role — `ssh_host_cert`** — and it covers the
*issuance* half of a host's lifecycle well: it generates the Ed25519 host key on the node,
signs it via `POST /api/v1/external/ssh/sign-host`, installs the User- and Host-CA trust
anchors, writes a sshd drop-in, validates, and reloads. But a host provisioned by the role
today is **not actually a fully working SSH-CA node**:

- **Cert-based login is broken out of the box.** The drop-in sets
  `AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u`, but the role never creates that
  directory or populates it — so a user with a perfectly valid User-CA cert gets
  *Permission denied*. The authoritative per-account principal render exists only behind
  admin OIDC (`ssh-principal.service.ts` → `trpc.ssh.principal.render`); a host cannot
  self-fetch it with its fleet token.
- **The encrypted-KRL (ECIES) path is undeployable.** The role *registers* an ECIES key
  but installs **no `krl-client` binary, config, state dir, or scheduler** — the entire
  `krl-client/packaging/` set (service, timer, man page, crontab) goes unused. Worse, it
  registers the **ed25519** key while ECIES is **P-256-only**, so `register-host-pubkey`
  `409`s `ECIES_KEY_UNSUPPORTED` on a role-provisioned host.
- **Host certs are never renewed.** TTL is +52 w and the role signs once with a *stable*
  `Idempotency-Key`, so even re-running the playbook returns the **cached original cert**.
- **The drop-in is hand-rolled** (`blockinfile`) with hardcoded ed25519 paths, instead of
  the algorithm-aware single-source-of-truth render served at `GET /ssh/hosts/:id/sshd-config`.
- **There are zero container-as-host e2e tests.** Every existing sshd harness
  (`e2e.test.ts`, `e2e-blocks.test.ts`) runs sshd userspace in a tmpdir from Vitest against
  the *service layer* — none exercises the Ansible role, the external HTTP API, or
  multi-host KRL distribution.

This milestone closes those gaps as role tasks (+ the one backend endpoint a host needs to
self-serve its principals), and lands a **molecule/docker** e2e that asserts **idempotence**
and **real-sshd behavior**: cert accepted with no TOFU, principal RBAC enforced, a revocation
/ per-host block lands via the puller and the blocked user is denied on that host while still
accepted elsewhere.

Non-SSH X.509 host automation (CA trust-store install + CRL refresh cron) is included **only
as a low-priority stretch** (ANS-09) so the milestone stays SSH-focused — see the open
decision on splitting it into its own X.509-host milestone.

## Grounding & verification (2026-07-11)

The gap matrix below was produced by a 6-way parallel read of the code (ansible role, external
+ public + operator SSH API, `krl-client` packaging, principals/`ssh-config` renderers, the
existing test harnesses, and the non-SSH surface) and then **adversarially verified** one gap
per finding against the real source. Verdict tally: **13 real gaps, 7 already-covered
(correctly excluded), 4 not-applicable, 2 partially-wrong (re-scoped)**. Items marked
`already` / `n/a` below are recorded so the "100 %" claim is auditable — they are *not* tasks.

## Gap matrix (host-deployable feature → current `ssh_host_cert` coverage)

| Feature | SSH? | Coverage | Owner task | Evidence |
|---|---|---|---|---|
| Ed25519 host key generated on the node | ✅ | **yes** | — | `tasks/main.yml:7-14` |
| Host cert issuance + install (`/sign-host`) | ✅ | **yes** | — | `tasks/main.yml:18-46` |
| User-CA trust bundle (`TrustedUserCAKeys`) | ✅ | **yes** | — | `tasks/main.yml:48-67` |
| Host-CA trust anchor (`ssh-host-ca.pub`, KRL verify) | ✅ | **yes** | — | `tasks/main.yml:73-91`; `config.go:39` |
| `sshd -t` validate + reload handler | ✅ | **yes** | — | `tasks/main.yml:111-114` |
| Public-path KRL refresh cron (opt-in) | ✅ | **yes** (partial semantics) | ANS-11 docs | `tasks/main.yml:138-148` |
| Galaxy dep (`community.crypto`) | ✅ | **partial** (manual pre-step) | ANS-11 | `requirements.yml`; `meta/main.yml` |
| **`auth_principals/%u` dir + per-account files** | ✅ | **no** | **ANS-01 + ANS-02** | directive `tasks/main.yml:106`, no populate task |
| **`RevokedKeys` file exists by default** | ✅ | **no** | **ANS-02** | fail-closed directive `:107`, file only via opt-in cron |
| **sshd drop-in from authoritative renderer** | ✅ | **partial** (hand-rolled, ed25519-hardcoded) | **ANS-03** | `blockinfile :94-109` vs `ssh-config.ts:106-129` |
| **Host-cert renewal cadence (< 52 w)** | ✅ | **no** | **ANS-04** | one-shot + stable Idempotency-Key `:24` |
| **ECIES ecdsa-nistp256 host key** | ✅ | **no** | **ANS-05** | role gens ed25519 only; `krl-client` decrypts ecdsa `config.go:38` |
| **ECIES register succeeds (not 409)** | ✅ | **partial** (409 on ed25519) | **ANS-05** | `ssh-external.routes.ts:176-184` |
| **`krl-client` binary + man page install** | ✅ | **no** | **ANS-06** | `packaging/krl-client.8`; no install task |
| **`krl-client` config + state dir** | ✅ | **no** | **ANS-07** | `config.go:42-44,102`; dead `ssh_ca_krl_url` |
| **`krl-client` scheduler + first-run pull/verify** | ✅ | **no** | **ANS-07** | `packaging/*.{service,timer}` unused |
| **`--ca-bundle` TLS trust (private-CA server)** | ✅ | **no** | **ANS-07** | `config.go:108-109` |
| **`SSH_ECIES_ENABLED` backend preflight** | ✅ | **no** | **ANS-07** | 501 at `ssh-external.routes.ts:175,192` |
| **`known_hosts` `@cert-authority` line** | ✅ | **no** | **ANS-08** | `ssh-config.ts:131-134`; `/ssh/cert-authority` |
| **NTP / time-sync enforcement** | ✅ | **no** (prose only) | **ANS-07/ANS-11** | `README.md:62`; `krl-client` exit 5 on drift |
| **Dockerized Ansible e2e (containers-as-hosts)** | ✅ | **no** | **ANS-10** | no molecule dir; harnesses are userspace tmpdir |
| X.509 CA trust-anchor install into OS store | ✖ | **no** | ANS-09 *(stretch)* | `GET /cas/:id.pem` `server.ts:55` |
| X.509 CRL refresh cron onto host | ✖ | **no** | ANS-09 *(stretch)* | `GET /crl/:id.crl` |
| X.509 TLS leaf issuance + deploy to host | ✖ | **no** | *out of scope* | no host fleet-token issuance path |
| cert-manager external issuer (k8s) | ✖ | n/a | *out of scope* | `k8s/issuer/` Helm-deployed |
| OCSP responder / stapling | ✖ | n/a | *does not exist* | only EKU enum `crypto/types.ts:83` |

## Tasks (ANS-00 .. ANS-11)

Execution waves (from the dependency graph): **①** ANS-00 → **②** ANS-01/03/04/05/06/08/09
(parallel) → **③** ANS-02, ANS-07 → **④** ANS-10, ANS-11.

| Task | Code | Pri | Title | Depends on |
|---|---|---|---|---|
| TASK-195 | ANS-00 | high | Milestone baseline: gap-matrix doc-anchor + low-risk drift cleanup | — |
| TASK-196 | ANS-01 | high | Backend: fleet-token endpoint serving a host's rendered `auth_principals` | ANS-00 |
| TASK-203 | ANS-02 | high | Role: populate `AuthorizedPrincipalsFile` + guarantee `RevokedKeys` exists | ANS-01 |
| TASK-197 | ANS-03 | med  | Role: install the authoritative sshd drop-in (fetch, don't hand-roll) | ANS-00 |
| TASK-198 | ANS-04 | high | Host-cert renewal cadence (re-sign before 52-week expiry) | ANS-00 |
| TASK-199 | ANS-05 | high | ECIES: provision + register an `ecdsa-nistp256` key so encrypted KRL is deployable | ANS-00 |
| TASK-200 | ANS-06 | high | Role: install the `krl-client` binary + man page | ANS-00 |
| TASK-204 | ANS-07 | high | Role: `krl-client` config + state dir + scheduler + first-run pull/verify | ANS-05, ANS-06 |
| TASK-201 | ANS-08 | med  | Role: install `known_hosts` `@cert-authority` line (gated) | ANS-00 |
| TASK-202 | ANS-09 | low  | *Stretch:* X.509 CA trust-anchor install + CRL refresh cron (non-SSH) | ANS-00 |
| TASK-205 | ANS-10 | high | Dockerized Ansible e2e suite (containers-as-hosts, idempotence + real-sshd) | ANS-02, ANS-03, ANS-04, ANS-07 |
| TASK-206 | ANS-11 | med  | Docs + requirements refresh for the grown module | ANS-02..ANS-08 |

## Dockerized e2e design (ANS-10)

**Tooling: molecule + docker driver** (not plain compose) — molecule gives the role-native
`create → prepare → converge → idempotence → verify → destroy` lifecycle with a **built-in
idempotence gate** (the "second run = no changes" assertion), while the backend+KMS half
(not Ansible-managed) is brought up from the existing `docker/docker-compose.yml` +
`kms/docker-compose.yml` in a `prepare` hook.

**Topology (one shared docker network):**
- **backend + KMS** — reuse the compose stacks; OIDC left unset so the role authenticates to
  the external API with a **fleet bearer token** (per `backend/CLAUDE.md`, backend runs
  unauthenticated without `OIDC_ISSUER`). Reuse the `KMS_AVAILABLE` auto-start/skip helper
  (`backend/src/test/kms-helper.ts`) so the suite **skips cleanly** when docker/KMS is absent.
- **managed-host container(s)** — a purpose-built image: `openssh-server` + `python3` (for
  Ansible) + a scheduler substrate (systemd **or** cron — see open decision) + `curl` +
  `krl-client` runtime deps. **Two hosts (Y/Z)** enable the per-host block-narrowing
  assertions (a block on Y must not affect Z).
- **client container** — minimal `openssh-client` used to drive real `ssh` logins.

**A run:** `create` host+client containers → `prepare` brings up backend+KMS, waits for
`/health`, bootstraps a Host CA + User CA and mints a `sign-host`-scoped fleet token (reuse
the `getSshFleetTokenService` flow proven in `ssh-external.integration.test.ts`), injects
token + base URL into role vars → `converge` runs the role → `idempotence` re-converges and
**fails on any changed task** → `verify` drives real `ssh` from the client and asserts (reusing
the SSH-33 / BLK-11 vocabulary): (1) a User-CA cert with a matching principal logs in under
`StrictHostKeyChecking=yes` via the `@cert-authority` line **with no TOFU**; (2) **principal
RBAC** — a matching-principal cert accepted, a non-listed one denied; (3) **revocation** — an
operator block regenerates the composed per-host KRL, the host's puller (krl-client timer for
the ECIES scenario, curl cron for the public scenario) installs a fresh `RevokedKeys`, sshd
re-reads it, and the cert is now **denied on the blocked host but still accepted on the other**;
(4) *(ECIES)* the installed `RevokedKeys` is the signature-verified decrypted per-host payload
(byte-decode with the `decodeKrl` pattern). Two scenarios share the converge: **`public-cron`**
(ed25519 host + curl KRL cron) and **`ecies`** (ecdsa host + krl-client timer). CI gating models
`.github/workflows/test.yml` (KMS as a service, gated job); the new job needs docker +
`ansible-core` + `community.crypto` and **skips** when docker/KMS is unavailable.

## Open decisions (need Oriol's call before/while implementing)

These do not block *creating* the milestone; each task carries the chosen default, but the
final call is the operator's and changes task shape:

1. **ECIES key model (ANS-05).** *Reuse* model (sign the host **with** its ecdsa key so the
   presented `HostCertificate` **is** the ecdsa key — no backend change; `register-host-pubkey`
   already re-validates the sign-host pubkey) **vs** *dual-key* (ed25519 cert for sshd + a
   decrypt-only `/etc/krl-client/ecies_key`, which needs a **new** backend endpoint that
   ingests an arbitrary pubkey). **Default: reuse model.**
2. **Renewal contract (ANS-04).** Rotate the role's `Idempotency-Key` per period (date/epoch
   bucket) to get fresh certs **vs** add a dedicated backend *renew* endpoint so `sign-host`
   idempotency stays strictly one-cert-per-key. **Default: rotating Idempotency-Key.**
3. **`auth_principals` delivery (ANS-01).** New fleet-token/public host-fetch endpoint (host
   self-serves) **vs** controller-side admin-OIDC pull the role delegates. **Default:
   fleet-token endpoint** (matches the existing trust-bundle download pattern).
4. **Scheduler substrate (ANS-04/07/10).** systemd timers (match `krl-client/packaging`,
   give `StateDirectory` + time-sync ordering, but need systemd-in-container for e2e) **vs**
   `/etc/cron.d` (simpler, works in a minimal openssh+python image). **Default: cron variant**
   for e2e portability; systemd optional via a role var.
5. **`krl-client` binary provenance (ANS-06).** Build-from-source in CI and publish a
   versioned artifact the role `get_url`s **vs** vendor a checked-in static binary. **Default:
   CI artifact URL + checksum var.**
6. **CI scope (ANS-10).** Add a docker+ansible molecule job to CI (heavier runners) **vs**
   keep the e2e local/on-demand out of the default matrix. **Default: gated CI job that skips
   without docker/KMS.**
7. **X.509 stretch scope (ANS-09).** Keep the non-SSH CA-trust + CRL install in this milestone
   as a low-priority stretch **vs** split into a dedicated X.509-host milestone to keep this
   one SSH-pure. **Default: keep as ANS-09 `stretch`, splittable later.**

## Definition of "100 % coverage"

Every **host-deployable** feature in the gap matrix reaches `yes`, i.e. a single
`ansible-playbook site.yml` run against a fresh host produces a node where: cert-based login
works with principal RBAC; the chosen KRL channel (public cron **or** ECIES `krl-client`)
installs and honours revocations/blocks; host certs auto-renew before expiry; the sshd config
matches the server's authoritative render; and the whole thing is proven by the ANS-10
dockerized e2e (idempotent + real-sshd verified). Non-host-deployable surfaces (cert-manager
k8s issuer, OCSP, TLS leaf-to-host) are explicitly out of scope and recorded above.
