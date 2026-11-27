## v4.0.0 (2026-11-27)

**OpenBao replaces Cosmian KMS: no Cosmian dependency any more**

> [!IMPORTANT]
> **PKI Manager 4 does not use Cosmian KMS for anything.** The backend, the SCEP gateway, the Kubernetes issuer and the web UI have no Cosmian client and send no KMIP request. A v4 installation runs without any Cosmian container.
>
> Cosmian is needed only on the way out of v3: the offline migration tool `pki-migrate` reads the v3 keys from it once, and the `kms/` folder can start an isolated Cosmian to inspect a restored v3 backup. After the migration and its recovery window, remove the Cosmian container and its data.

PKI Manager 4 uses the PKI Manager fork of OpenBao for X.509 issuance, CRLs, SSH and SCEP. Every private key is in OpenBao Transit, and PKI Manager builds the certificates and CRLs itself. The backend and the SCEP registration authority use separate credentials. The application keeps its certificate and revocation records in SQLite.

Why: Cosmian KMS is licensed under BUSL-1.1, and v3 depended on its `Certify` operation to build certificates. See [decision-018](backlog/decisions/decision-018%20-%20Replace-Cosmian-KMS-with-a-KeyStore-abstraction-backed-by-OpenBao-Transit.md).

### Upgrade from 3.x

- Stop the v3 writers and make a SQLite backup with the migration tool. Rehearse on a copy. Inventory the keys, approve their disposition and verify the cutover against the frozen source. Keep the original installation available for recovery until you accept v4 writes.
- Transfer eligible keys with wrapped export and import. A non-transferable key needs an explicit rotation or reprovisioning plan. If the SCEP RA needs a new key, refresh GetCACert on devices and update any MDM profile that pins the old RA certificate.
- Upgrade the backend and the SCEP gateway together. Configure the two OpenBao credentials before starting SCEP.
- Back up SQLite and OpenBao together with writers stopped. On recovery, restore the two files from the same checked backup directory and verify them before starting the backend.
- The OpenSSL executable remains necessary for PKCS#12 downloads that include a private key. This preserves mixed-case names and compatibility with legacy passwords.

See the [v4 migration guide](https://github.com/oriolrius/pki-manager-web/blob/v4.0.0/docs/operations/openbao-migration.md) and the [OpenBao operations guide](https://github.com/oriolrius/pki-manager-web/blob/v4.0.0/docs/operations/openbao.md).

### Feat

- **openbao**: give the SCEP RA its own scoped credential
- **migration**: add the v3 migration guide and the disposable rehearsal
- **migration**: add the OpenBao policy of the migration identity
- **openbao**: separate the migration identity from the runtime token
- **migration**: add the offline v3 to OpenBao migration tool
- **keystore**: run X.509, CRL, SSH and SCEP on OpenBao Transit
- **keystore**: add the keystore_objects table for OpenBao key references
- **scep**: keep the RA key of new bindings in OpenBao (opt-in)
- **scep**: pass the CMS session key length to RA decryption

### Fix

- **scep**: omit an expired RA certificate from renewal overlap
- **crl**: use the verified CRL when its issuer has expired
- **migration**: clear the live RA overlap when the RA key is replaced
- **migration**: refuse incomplete records and overlapping Raft snapshots
- **migration**: bind restored SQLite and OpenBao to one backup with a pair marker
- **crl**: wait for concurrent revocation before deleting the certificate
- **crl**: keep deleted pending revocations and serve unchanged CRLs without a scan
- **migration**: check every owned key against the v4 runtime policy in the pair check
- **migration**: verify the status and approver of migration audit entries
- **migration**: safe drop-key, RA reprovision and CA key link repair
- **migration**: check each key against the v4 runtime policy of its purpose
- **scep**: retry RA provisioning when its credential becomes available
- **migration**: bind a frozen source, reconcile every table, verify restores from the database
- **crl**: publish one ordered CRL per CA and recover stale CRLs after outages
- **migration**: accept an inventory with no certificate PEMs to transfer
- **migration**: check offline material and certificate PEMs before any import
- **keystore**: map key store outages and refusals to safe API errors
- **docker**: give backend files fixed modes in the build stage
- **migration**: leave no half backup when the snapshot is refused
- **migration**: close the import parameters of the migration policy
- **export**: drop the openssl CLI from PKCS#8, JKS and truststore exports
- **ssh**: recheck SSH CA import invariants atomically with the insert
- **scep**: require the CMS key length in the v4 API contract
- **docker**: read backend files as the configured runtime user
- **frontend**: describe what SSH host offboarding does after the OpenBao cutover
- **frontend**: name OpenBao Transit as the key store and stop key claims on CSR-only records
- **scep**: verify RA key origin and document Transit permissions

### Refactor

- **docker**: keep only the migration run as the build-time check

## v3.19.1 (2026-11-26)

**Delete a renewed certificate's original, chain in the PEM downloads, partial renew subject**

Three certificate fixes found while testing the CLI and the Ansible collection against 3.19.0.

### Upgrade notes

- `GET /certificates/{id}/download?format=chain-pem` now returns certificate + issuing CA (it
  returned only the certificate), and `full-pem` returns certificate + private key + issuing CA (it
  had no chain). A script that used `full-pem` as a "fullchain" file must use `chain-pem`:
  `full-pem` has the private key.
- A certificate that was renewed can now be deleted after it is revoked. Its renewals stay; their
  link to the deleted original is cleared.
- A renewal with `updateInfo` and only some subject fields keeps the other fields (before, a new
  CN alone gave `CN=<new>` with no O or C).

### Fix

- **certificates**: keep the subject fields a renewal does not change
- **rest**: put the issuing CA in chain-pem and full-pem downloads (#118)
- **certificates**: delete the original of a renewed certificate (#117)

## v3.19.0 (2026-11-26)

**PKCS#12 with AES-256 by default, REST responses keep every field**

PKCS#12 exports (`p12`, `pfx`, CA keystores and truststores, bulk downloads) now use AES-256-CBC
with PBKDF2-HMAC-SHA256 and a SHA-256 MAC instead of 3DES and SHA-1. The REST API now sends the
object fields that it used to send as `{}`. The dependencies are on their current versions
(Dependabot updates of the actions, pino 10, react-hooks 7, the Go modules).

### Upgrade notes

- A client that cannot read AES-256 PKCS#12 (old Java, Windows 7/2008, old embedded stacks) must
  ask for the old format: the **Legacy compatibility** option in the download dialog, or
  `legacy=true` (query parameter of `GET /certificates/{id}/download` and `GET /cas/{id}/download`,
  body field of `POST /certificates/bulk/download`). JKS conversion is not affected.
- REST clients now get the content of `subject`, `issuer`, `extensions`, `keyUsage`,
  `basicConstraints`, `renewedTo`, the audit `details` and `metadata`, and the report `summary`.
  Before, these fields were always empty objects. The web UI (tRPC) was not affected.
- The 429 answers of the SSH fleet and KRL routes now send `Retry-After: 60`.

### Feat

- **export**: use AES-256 for PKCS#12 by default

### Fix

- **rest**: stop dropping object fields from API responses

## v3.18.0 (2026-11-25)

**Security fix, OpenSSF hardening, dependency upgrades**

This release fixes the security advisory
[GHSA-cw54-v7j3-m29f](https://github.com/oriolrius/pki-manager-web/security/advisories/GHSA-cw54-v7j3-m29f):
SAN values of a certificate request could add extensions or SAN entries to the issued
certificate. It also updates every dependency with a known vulnerability (OSV-Scanner: 163 → 0),
adds fuzz and property tests (which found 7 more bugs, fixed here), rate limits on the external
APIs, and the supply-chain checks of OpenSSF Scorecard (pinned actions and images, CodeQL,
Dependabot, SLSA provenance for `krl-client`).

### Security

- **GHSA-cw54-v7j3-m29f** (medium): a line break or a comma in `sanDns`, `sanIp` or `sanEmail`
  added extensions (for example `cRLDistributionPoints`, `nameConstraints`, a second
  `basicConstraints`) or SAN entries to a certificate issued or renewed through the management
  API. The backend now refuses these values for every certificate type, at issue and at renew.
  The external signing API was not affected.
- **scep**: a truncated PKCS#7 message made the gateway panic before authentication (pkcs7
  v0.2.3); `SCEP_SHARED_SUBJECT` keys now match exactly.
- **k8s-issuer**: a sign response with no certificate no longer marks a CertificateRequest Ready.
- **api**: per-IP and per-token request limits on `/api/v1/external` and the SSH fleet and trust
  endpoints; linear parsing replaces two backtracking regular expressions.
- Dependencies with known vulnerabilities upgraded (Fastify, node-forge, Zod 4, Vite, Go modules,
  Go 1.26.11 / 1.27.4).

### Upgrade notes

- `TRUST_PROXY` no longer accepts a hop count (`1`, `2`, ...): list the proxy IPs or CIDRs. The
  backend stops at startup with a clear error otherwise.
- New limits: 600 requests per minute per client IP and 120 per integration or fleet token, per
  backend process (`API_IP_REQUESTS_PER_MINUTE`, `API_TOKEN_REQUESTS_PER_MINUTE`). Behind a proxy,
  set `TRUST_PROXY`, or all clients share the proxy's IP limit. Size the token limit for the peak
  of the Kubernetes issuer: it marks a request failed on HTTP 429.
- Stricter names: a DNS name or IP address with whitespace at an end, an IPv4 address with a
  leading zero (`010.0.0.1`) and an IPv6 address with a zone (`fe80::1%eth0`) are refused. The web
  form trims what you type.
- After a change of `config.json`, restart the frontend container (`docker compose restart
  frontend`): its CSP takes the identity provider origin from that file at start.

### Fix

- **backend**: refuse SAN values that change the KMS extension text
- **backend**: generate positive X.509 serial numbers
- **frontend**: trim the names and addresses of the certificate form
- **backend**: strict CN/SAN validators, DN parser and SSH cert parser
- **k8s-issuer**: refuse a sign response that holds no certificate
- **scep**: update pkcs7 to v0.2.3 and match shared subject keys exactly
- **security**: bound API requests and remove backtracking from input validation
- **scep**: log the full certificate serial on enrollment
- **deps**: require patched transitive versions after lockfile regeneration
- **deps**: update vulnerable JavaScript packages and migrate schema generation
- **go**: upgrade affected modules and require Go 1.26.11
- **frontend**: run strict typechecks against the backend router declarations
- **dev**: seed-ssh-dev.sh registers ecdsa P-256 host keys
- **lint**: scope the ajv override so ESLint runs, add a CI lint job
- **ssh**: scope the external Idempotency-Key cache to the fleet token
- **docker**: send the security headers on every frontend response
- **docker**: make the Compose variables reach the containers and have an effect
- **ca**: sign the CRL when a CA is revoked
- **frontend**: server-side paging, filters and sort in the certificate list
- **api**: release version and Apache-2.0 licence in OpenAPI and health
- **frontend**: bundle the silent-renew page instead of loading oidc-client-ts from a CDN
- **backlog**: keep the empty tasks and milestones folders in git

### Refactor

- **frontend**: derive form fields from router inputs
- **rest**: type route inputs, OpenAPI schemas and KRL lookup
- **trpc**: type middleware and procedure results
- **services**: infer PKI and SSH rows from the database schema
- **crypto**: type forge extensions and KMIP structures

## v3.17.0 (2026-11-24)

**Security hardening: no stack traces, no passwords in URLs, CA key export opt-in**

Three security fixes. **Behaviour change:** downloading a CA as a keystore that contains its
private key (`p12-keystore`, `jks-keystore`) is now **off by default**. Set
`ALLOW_CA_KEY_EXPORT=true` to allow it; then only admins can export, and every attempt is
audited (`ca.export_private_key`). CA certificate formats and leaf keystores are unchanged.
Export passwords now go in the `X-Export-Password` header (the `password` query parameter
still works and is deprecated). This release also carries the 3.16.1 changes as a minor
version: they included new features (audit actors, ECDSA external signing).

### Fix

- **ca**: disable CA private key keystore export by default
- **security**: send export passwords in a header, never in URLs
- **trpc**: keep the message of errors thrown on purpose
- **backend**: strip stack traces and internal messages from tRPC errors in production

### Upgrade notes

- Add `ALLOW_CA_KEY_EXPORT=true` only if you need CA keystores with the private key (see DEPLOYMENT.md).
- Scripts that send `?password=` keep working; move them to the `X-Export-Password` header.

## v3.16.1 (2026-11-24)

### Feat

- **audit**: record the actor (user, integration, SSH token) on every audit row
- **external**: sign ECDSA CSRs and accept empty-subject CSRs with a SAN

### Fix

- **certificates**: never destroy a KMS key that another certificate still uses
- **renew**: reuse the key pair when requested and state what happens to the old certificate
- **backend**: initial empty CRL on CA creation; keyAlgorithm in create response
- **frontend**: CA form lists the key usages actually issued
- **issuer**: publish chart appVersion image tag on release
- **scep**: accept application/octet-stream for PKIOperation POST
- **export**: run keytool and openssl without a shell

## v3.16.0 (2026-11-24)

**SSH principal fixes, fleet tokens UI and the documentation site**

SSH access is easier to run day to day: offboard people in one step, manage fleet tokens in the UI,
remove mappings and grants, and limit what a token may sign. The project now has a public
documentation site with verified guides, a generated API reference and the SSH certificate videos.
Database migrations 0012 and 0013 run automatically at start.

### Feat

- **ssh**: optional principal and lifetime limits on sign-user tokens
- **ssh**: host Access list shows who can really reach the host
- **ssh**: remove a host mapping and an identity grant
- **ssh**: stale means principal files changed and not pushed
- **frontend**: add SSH fleet tokens page
- **frontend**: add Offboard action for SSH identities
- **backend**: take client IPs from trusted proxies (TRUST_PROXY) and log dropped audit rows

### Fix

- **docs**: explainer render never leaves a truncated MP4
- **ssh**: issue form mapping panel shows only the identity zone

### Refactor

- **frontend**: move SSH principal UI copy out of component files

### Docs

- **site**: public documentation at https://oriolrius.github.io/pki-manager-web/ (Astro Starlight, GitHub Pages), built from the repository docs.
- **guides**: install and log in, private CA and certificates, from easy-rsa to PKI Manager (Mosquitto mTLS), Kubernetes with cert-manager, automation with integration tokens and SCEP. Every step was run on a demo stack; screenshots come from `docs/site/demo`.
- **api**: reference generated from the backend source (107 operations), a test that keeps routes and the OpenAPI document in sync, and a how-to whose `curl` examples run in CI.
- **ssh**: two video series (19 episodes, on YouTube) with diagrams and a reference page; principals guide corrected.
- **fixes**: Docker data folder must be owned by uid 1001, OIDC audience/`nbf` checks, issuer install (image tag), integrations limits; all diagrams in PlantUML.

## v3.15.0 (2026-10-23)

### Feat

- **scep**: add standalone SCEP gateway, Compose overlays and image workflow (#19)
- **integrations**: generalize CA-bound service tokens with backend-owned SCEP RA (#18)

### Fix

- **kms**: use the Cosmian 5.24 config schema so dev keys persist (#20)

## v3.14.2 (2026-10-22)

### Fix

- **frontend**: improve CA actions and support dark bulk dialogs (#17)
- **frontend**: correct issuing CA links in certificate list (#16)
- **frontend**: show dynamic page titles in browser tabs (#15)

## v3.14.1 (2026-10-22)

### Fix

- **frontend**: generate visible secure passwords for certificate exports (#14)

## v3.14.0 (2026-10-22)

### Feat

- support OIDC admin roles through UserInfo (#10)

### Fix

- authenticate CA certificate and truststore downloads (#12)

## v3.13.0 (2026-10-21)

### Feat

- **auth**: provider-agnostic OIDC login via react-oidc-context (#7)
- **auth**: finish provider-agnostic OIDC on top of PR #7

## v3.12.4 (2026-10-21)

### Fix

- **security**: stop trusting compromised eMudhra intermediates
- **docker**: install openssl CLI in backend runtime image

## v3.12.3 (2026-09-21)

### Feat

- **ssh**: CA fleet re-issue report endpoint — the rotation retirement gate (TASK-236)

## v3.12.2 (2026-09-21)

### Fix

- **ssh**: make CA rotate() atomic + archived-zone-safe (TASK-235)

## v3.12.1 (2026-09-18)

### Fix

- **nginx**: proxy zone-scoped SSH trust routes to the backend (TASK-076)

## v3.12.0 (2026-09-08)

### Feat

- **ssh**: add certificate purge (hard-delete) with KRL-safe semantics

## v3.11.0 (2026-09-01)

### Feat

- **ssh-ui**: streamline workspace navigation

## v3.10.0 (2026-09-01)

**SSH Zones — run many independent SSH trust domains in one installation**

One PKI Manager can now host N independent SSH trust domains (prod vs staging,
customer A vs B, datacenter vs lab). A generic `zones` table becomes a real
**trust boundary**, not a UI label: **a host in a zone trusts only that zone's
user CAs**. Each zone has its own `active` + `rotating` User and Host CA, and
hosts, identities and principals each belong to exactly one zone (the same FQDN,
subject or principal name can be reused across zones).

A migrated single-zone installation is **behaviourally identical** — every
existing row is backfilled to a seeded `default` zone, the legacy unscoped trust
endpoints keep serving it (with a `Deprecation` header), and the Ansible role,
`pki-manager-cli` and `krl-client` keep working untouched. Zone resolution is
**fail-closed**: implicit while one zone exists, an explicit error once several
do — so an un-scoped caller never silently signs with the wrong trust domain's
CA. Upgrade steps, including backup and rollback, are in
[docs/ssh/zones-migration-runbook.md](docs/operations/migration-0009.md);
concepts in [docs/ssh/zones.md](docs/ssh/zones.md).

Highlights: migration `0009` (rebuild-and-copy, seeds `default`); zone-scoped CA/
host/user/principal services and per-host KRLs; tRPC `ssh.zone` router + REST
`/ssh/zones` + `?zoneId=` filters; fleet-token zones and an ECIES
`409 AMBIGUOUS_HOST` disambiguation; `krl-client --zone`; a frontend zone switcher
(URL + localStorage), filters, pickers and a `/ssh/zones` management page.

### Feat

- **ssh**: SSH Zones — multi-CA grouping and trust boundary (decision-017)

## v3.9.6 (2026-08-31)

### Feat

- **ssh**: full REST/OpenAPI parity with tRPC (TASK-216)

### Fix

- **ui**: theme the Swagger page so /api-docs is readable in dark mode

## v3.9.5 (2026-08-25)

### Feat

- **ssh-ui**: reusable PrincipalSelect and per-host mapping card
- **ssh**: expose markPushed over REST (TASK-215)

## v3.9.4 (2026-07-14)

**Require ECDSA host keys for SSH**

SSH host keys must now be `ecdsa-sha2-nistp256` — a single key that serves as both
the certificate subject and the ECIES recipient for encrypted KRL distribution (an
ed25519 signing key cannot do ECDH key agreement, so it can never receive an
encrypted KRL). Host registration and the fleet `sign-host` path reject non-P256
keys with an actionable message, and the register form now guides you to
`/etc/ssh/ssh_host_ecdsa_key.pub` — so a host can no longer be registered in a
state where it silently can't receive its revocation list.

### Fix

- **ssh**: require ecdsa-sha2-nistp256 host keys, fix register-form guidance

## v3.9.3 (2026-07-13)

**SSH certificate UX & revocation modernisation**

Adds a certificate details/delivery view on the SSH Users page, brings the host
deploy panel up to date (syntax-highlighted config blocks and signed ECIES
revocation in place of the obsolete unsigned-KRL cron), and fixes a theme bug
that made several boxes unreadable in light mode.

### Feat

- **ssh**: cert details & delivery modal on the Users page — open any issued
  certificate to see its full details and re-download the signed `*-cert.pub`
  plus the ready-to-send delivery blocks.
- **ssh**: modernise the host deploy panel — syntax-highlighted config/key
  blocks, and revocation guidance pointing at the signed ECIES `krl-client`
  channel instead of cron-curling the unsigned per-CA KRL.

### Fix

- **frontend**: bind Tailwind's `dark:` variant to the theme class, so an
  OS-dark user on the light theme no longer sees unreadable dark-mode text on
  light backgrounds (and vice-versa).
- **frontend**: order issued SSH certificates newest-first by serial.

## v3.9.2 (2026-07-11)

### Fix

- **security**: resolve all 141 Trivy code-scanning alerts

## v3.9.1 (2026-07-11)

## v3.9.0 (2026-07-11)

### Feat

- **openapi**: document request/response schemas for SSH & external routes

### Fix

- **crypto**: apply CSR extensions via node-forge setAttributes
- **deploy**: proxy public SSH/KRL trust-material paths to the backend
- **openapi**: hide root-mounted public routes from the /api/v1 spec

## v3.8.0 (2026-07-11)

### Feat

- **ssh**: REST endpoints for fleet-token mint, host list, principal grant
- **ansible**: grow ssh_host_cert into a full SSH-CA node (TASK-197..204, ANS-02..09)
- **ssh**: fleet-token endpoint serving a host's rendered auth_principals (TASK-196, ANS-01)

### Fix

- **ci**: install community.docker into the e2e _collections path

### Refactor

- **ansible**: consume the oriolrius.pki_manager collection (single source of truth)

## v3.7.1 (2026-07-11)

### Fix

- **auth**: auto-refresh the manual OIDC access token to stop idle 401s (TASK-193)

## v3.7.0 (2026-07-10)

### Feat

- **ssh-ui**: add live search filter to hosts and users lists
- **ssh-ui**: clearer KRL enforcement-state labels and tooltips
- **ui**: searchable Combobox with in-menu search; use for block-host selector
- **ssh-ui**: redesign identity "Access blocks" section for clarity
- **frontend**: add success/error toasts to silent mutations; drop redundant success modal
- **frontend**: replace native pop-ups with themed toasts/dialogs; enrich SSH cert table

### Fix

- **krl-client**: report installed KRL number on 304/error runs (TASK-192)
- **ssh**: record block actor as identity not IP; show full timestamp

## v3.6.1 (2026-07-05)

### Fix

- **backend**: re-seed the ssh_krl_seq allocator row at startup

## v3.6.0 (2026-07-05)

### Feat

- **frontend**: allow lifting a per-host user block from the users page

## v3.5.1 (2026-07-04)

### Fix

- **backend**: make the prod build full-strict so Docker images compile again

## v3.5.0 (2026-07-04)

### Feat

- **ssh**: optional flag-gated issuance gate — zero-window blocks (TASK-190)
- **ssh**: Host Access card + Users blocked-on pills + KRL distribution columns (TASK-186)
- **ssh**: ssh.block.* API + host-access/state read model, tRPC + REST twins (TASK-185)
- **ssh**: per-host KRL state derivation + lineage metrics (TASK-184)
- **ssh**: serving cutover — ECIES payload from ssh_host_krls + public per-host endpoints (TASK-183)
- **ssh**: reconcile puller trust anchor — Host-CA pubkey end-to-end (TASK-187)
- **ssh**: issuance + revocation triggers for per-host KRL freshness (TASK-182)
- **ssh**: SshBlockService — block/unblock with sync per-host KRL regen + lifecycle (TASK-181)
- **ssh**: SshHostKrlService — composed per-host KRL with global monotonic numbering (TASK-180)
- **ssh**: ssh_host_blocks + ssh_host_krls schema and global KRL-number allocator (TASK-179)

### Fix

- **ssh**: close adversarial-review findings on the host-blocks milestone
- **ssh**: stamp last_krl_fetch_at on ECIES 304 responses (TASK-178)
- **types**: restore clean backend typecheck baseline + gate both workspaces in CI (TASK-191)

## v3.4.2 (2026-07-02)

### Fix

- **krl-client**: bind anti-rollback to the signed KRL header number (TASK-175)

## v3.4.1 (2026-07-02)

### Fix

- **krl-client**: warn on every run when TLS verification is disabled (TASK-176)
- **krl-client**: bound the encrypted KRL response body size (TASK-174)

## v3.4.0 (2026-07-02)

### Feat

- **krl-client**: finalize host agent — CLI/config/env, exit codes, logging, keygen, tests (KRLC-08..11)
- **krl-client**: KRLC-07 atomic KRL install + version/state cache (pipeline complete)
- **krl-client**: KRLC-06 detached CA-signature verification
- **krl-client**: KRLC-05 payload parse + validation (host/expiry/version/anti-rollback)
- **krl-client**: KRLC-01/03/04 scaffold + HTTP client + local ECIES decrypt
- **ssh**: KRLC-02 rebuild KRL distribution to local host decrypt (retire KMS ECIES)
- **krl-client**: KRLC-02a spike — native P-256 ECIES local host decrypt

## v3.3.1 (2026-07-01)

### Fix

- **ssh**: dark-mode contrast on SSH status banners

## v3.3.0 (2026-07-01)

### Feat

- **ssh**: add long-lived user-cert TTL presets (+1m…+10y)

## v3.2.0 (2026-06-30)

### Feat

- **ssh**: REST parity for principals + revocation/KRL
- **ssh**: REST endpoints for revocation + KRL
- **ssh**: REST endpoints for principal catalog + host mapping

## v3.1.0 (2026-06-30)

### Feat

- **ssh**: SSH onboarding guides — deploy bundle, guided UI, docs
- **ssh**: guided discovery — checklist, principal cross-check, callouts (P2)
- **ssh**: per-host deploy bundle + corrected user-cert handoff (P1)

### Fix

- **ssh**: serve User CA KRL for RevokedKeys + fix landing cert query

### Refactor

- **ssh**: single source of truth for on-host paths/filenames (P0)

## v3.0.1 (2026-06-30)

### Fix

- **kms**: honor requested certificate validity (daysValid)

## v3.0.0 (2026-06-30)

### Feat

- **ssh**: integrate SSH-CA feature (v3.0.0) into main

### Fix

- **ssh**: build cleanly under relaxed prod tsconfig (unblock v3.0.0 image)

## v2.0.0 (2026-06-30)

### Feat

- **certs**: wire CDP/regeneration into cert paths + enable ECDSA leaf certs & EC export (TASK-116,157,158)
- **crl**: sign CRLs with the CA key, serve over HTTP, and resolve CA key id (TASK-110..116)
- **k8s**: auto-approve cert-manager CertificateRequests via approver RBAC (TASK-109.23)
- **k8s**: sign external CSRs via KMS certify; drop offline path (TASK-109.22)
- **k8s**: browser-reachable in-cluster deploy via ingress-nginx
- **k8s**: full in-cluster e2e — PKI Manager + KMS + cert-manager + issuer in kind
- **k8s**: metrics, revoke-on-delete, signer tests, CI, source filter
- **k8s**: cert-manager external issuer controller (Go)
- **ui**: clusters management page
- **k8s**: implement CSR signing in /api/v1/external/sign
- **k8s**: backend foundation for cert-manager external issuer
- **ssh**: Phase 6 operator console frontend (SSH-25..30)
- **ssh**: Phase 7c Ansible role + API contract docs (SSH-31)
- **ssh**: Phase 7a lifecycle (SSH-32a/b/c)
- **ssh**: Phase 5c rate limiting + monitoring (SSH-MON)
- **ssh**: Phase 5b ECIES KRL distribution (SSH-23, 15, 24)
- **ssh**: Phase 5a KRL encode/build/serve (SSH-20, 21, 22)
- **ssh**: Phase 4c fleet tokens + bulk (SSH-19, SSH-BULK)
- **ssh**: Phase 4b REST + public downloads (SSH-18)
- **ssh**: Phase 4a tRPC API + fail-closed authz (SSH-16, 17, 34)
- **ssh**: Phase 3 services (SSH-10, IMPORT, 11, 12, 13, 14)
- **ssh**: Phase 2 data model + migrations (SSH-05..09)
- **ssh**: Phase 1 crypto foundation (SSH-01..04)
- **ssh**: complete SSH-00 + SSH-SENS Phase-0 spikes

### Fix

- **k8s**: remove unreachable code in certificaterequest_controller (TASK-109.24)
- **backend**: cert detail page works for offline-signed (k8s) certs
- **frontend**: UserMenu crash when OIDC disabled
- **k8s**: make e2e on kind actually pass

## v1.8.1 (2026-03-06)

### Fix

- **dashboard**: add Dual (mTLS) to expiring items type enum

## v1.8.0 (2026-03-06)

### Feat

- add dual certificate type for mTLS (serverAuth + clientAuth)

### Fix

- add dual certificate type to remaining files

## v1.7.1 (2026-03-05)

### Feat

- **cli**: add Python CLI tool for PKI Manager API

### Fix

- **api**: include X.509 extensions with SANs in certificate issuance

### Refactor

- move CLI to separate repository

## v1.7.0 (2026-03-05)

### Feat

- **api**: add OpenAPI YAML endpoint

## v1.6.3 (2026-02-13)

## v1.6.2 (2026-02-13)

### Feat

- **e2e**: add local Docker-based E2E testing environment

### Fix

- **e2e**: fix OIDC networking for Docker E2E environment

## v1.6.1 (2026-02-13)

### BREAKING CHANGE

- Regular users can no longer create CAs. Only users
with the admin role can create Certificate Authorities.

### Feat

- **rbac**: require admin role for CA creation

### Fix

- **tests**: improve CA creation test to properly capture API response
- **rbac**: add explicit admin role check in CA create mutation
- **docker**: correct GHCR image names in docker-compose

## v1.6.0 (2026-02-13)

### Fix

- **auth**: use async storage key in getAccessToken for tRPC client
- **auth**: use async storage key for token validation
- **auth**: use async config in callback route for token exchange
- **auth**: support runtime OIDC config from config.json

## v1.5.1 (2026-02-06)

### Fix

- **auth**: fix TypeScript errors and auth behavior when OIDC disabled
- **ci**: update pnpm-lock.yaml with OIDC dependencies

## v1.5.0 (2026-02-06)

### Feat

- **auth**: add OIDC authentication to REST API endpoints
- **auth**: support multiple OIDC audiences for M2M authentication
- **certificates**: allow hostname as client certificate CN
- **auth**: implement complete OIDC authentication flow
- **auth**: migrate tRPC procedures to protected/admin
- **auth**: inject Bearer token in tRPC client headers
- **auth**: add protected route layout with auth guards
- **auth**: add silent token renewal via hidden iframe
- **auth**: add UserMenu component with login/logout controls
- **auth**: add OIDC callback route for token exchange
- **auth**: add AuthProvider with OIDC configuration to frontend
- **auth**: add OIDC dependencies to frontend
- **auth**: add OIDC configuration to backend environment
- **auth**: add protected and admin procedure types to tRPC
- **auth**: add OIDC authentication infrastructure for backend

### Fix

- **keycloak**: add default roles to users for Account Console access

## v1.4.0 (2026-02-05)

### Feat

- **keycloak**: add Keycloak development environment with validation tests
- **ca**: add CA download support for truststore and keystore formats

## v1.3.2 (2025-12-02)

### Fix

- add basicConstraints and keyUsage extensions to CA certificates

## v1.3.1 (2025-12-02)

### Fix

- resolve certificate/key mismatch in P12/JKS downloads

## v1.3.0 (2025-12-02)

### Fix

- use runtime config for API docs page URL
- update pnpm-lock.yaml for swagger-ui-react dependency

## v1.2.1 (2025-11-28)

### Feat

- add OpenAPI documentation page with SwaggerUI

## v1.2.0 (2025-11-28)

### Feat

- add progress feedback UI for bulk operations and auto-revoke on renew
- add force delete and in-app dialogs for KMS inconsistency handling
- handle KMS/DB inconsistency errors with HTTP 409 CONFLICT
- implement utility REST endpoints with proper test cleanup
- implement bulk operations REST endpoints with test cleanup
- add REST API certificate routes with download support
- add JKS service for Java KeyStore generation
- add CA REST endpoints with tests and OpenAPI integration
- split JKS download into Keystore and Truststore options
- **jks**: improve JKS download with CA certificates and UX enhancements
- **frontend**: add runtime API URL configuration

### Fix

- use npm for frontend Docker build to resolve pnpm binary issues
- resolve duplicate ServiceContext export and auto-start KMS for tests
- add password field and validation for JKS Truststore bulk download
- show password field for JKS Truststore format
- add afterAll cleanup to ca-create.test.ts
- **backend**: load .env file in dev script
- **ci**: correct package path for SHA256 cleanup

### Refactor

- use shared CA and CRL services in tRPC procedures
- use shared JKS service in tRPC procedures

## v1.1.2 (2025-10-28)

### Refactor

- **docker**: consolidate nginx config and improve frontend setup

## v1.1.1 (2025-10-28)

### Refactor

- **ci**: use short SHA format for Docker tags

## v1.1.0 (2025-10-24)

### Feat

- **docker**: add production Docker stack with GitHub CI/CD

### Fix

- **ci**: use static SHA prefix for Docker tags
- **ci**: add attestations write permission for build provenance

### Refactor

- **docker**: reorganize Docker files into docker/ folder

## v1.0.0 (2025-10-24)

### Feat

- add comprehensive documentation and screenshot testing
- **ui**: increase dark mode contrast for better visibility
- **certificates**: add optional encryption for private key exports
- **bulk-certs**: add CA selection persistence with localStorage
- **certificates**: add comprehensive download format support with private key export
- **ui**: display version number below PKI Manager header
- **dashboard**: add engaging informational banner
- **ca**: add certificate download permalinks with multi-format support
- Implement certificate renewal endpoint (task-015)
- Implement certificate detail retrieval endpoint (task-014)
- Implement certificate listing with OpenAPI 3.0.3 integration (task-013)
- Implement server certificate issuance (task-012)
- Implement complete CA management backend endpoints (tasks 7-11)
- Implement X.509 certificate generation utilities (task-006)
- Implement Cosmian KMS client integration (task-005)
- Initialize PKI Manager full-stack application

### Fix

- **ui**: improve dark mode styling in bulk certificates section
- **ui**: read version number from root package.json instead of hardcoded value
