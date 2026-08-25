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
