---
id: TASK-288
title: Release PKI Manager with OpenBao as the only runtime key store
status: In Progress
assignee:
  - '@codex'
created_date: '2026-11-26T20:25:00Z'
updated_date: '2026-11-27T07:35:00Z'
labels: []
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deliver decision-018 and doc-012. Release the next major only after migration, recovery and product validation without Cosmian.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 X.509, CRL, SSH and SCEP operate against OpenBao with Cosmian disconnected.
- [ ] #2 Existing installations can rehearse migration, reconcile identities and restore their data.
- [ ] #3 Development, tests, deployment and current product documentation use the fork and clients retain their supported operations.
- [ ] #4 Independent review and required release checks pass on the release candidate.
- [ ] #5 A major GitHub release and its required installable artifacts are published and verified.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Port certificate issuance and CRL signing, SSH and RA to Transit.
2. Replace runtime and test stacks, synchronize UI, guides and API consumers.
3. Rehearse a v3 migration and restore using disposable identities.
4. Run live end-to-end flows and independent review with Cosmian disconnected.
5. Integrate through project CI, publish the major version and verify the artifacts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Release inventory: the standalone Ansible collection still starts Cosmian from tests/integration/compose.yml and run.sh. Its integration stack is part of the OpenBao acceptance gate. The CLI and both skill checkouts had no tracked Cosmian/KMIP text outside the excluded generated spec and lock files.

Provider quota interrupted X.509 implementation after schema commit e6bef611. Uncommitted X.509/CRL work is present. Handoff checks: backend typecheck passed; x509-store.test.ts passed 18/18. Real fork-backed full acceptance, integration commits and migration rehearsal remain release gates. Fork smoke fixture Go tests passed.

Candidate preflight found a release blocker in Vitest global setup: src/test/kms-helper.ts attempts to start the old KMS via Docker on a failed probe. Setting KMS_AVAILABLE=false does not prevent it. Update this helper for isolated OpenBao before counting full backend tests as Cosmian-free evidence.

Checkpoint on the real fork with no Cosmian in the stack. The corrected image starts with UID 1000. X.509 and CRL survive a restore into an independent project. SCEP enrollment/renewal passed for AES-128/256 CBC/GCM. Kind issued an approved leaf through the real backend. The preliminary 113/121 acceptance run exposed two issues: missing SSH mount permissions and missing issuer certificate in default PKCS#12 exports. Both fixes are under validation. Migration is blocked: DEFAULT_PROFILE writes key_ref/key_provider on CA, certificate and SSH rows, but schema 0017 uses keystore_objects and SSH uses versioned openbao-transit references. The default migration X.509 mount also differs from the backend. Do not tag the web release until migration, restore and independent checks pass.

Runtime commit f4d85339 and bootstrap commit 9618168c. Isolated OpenBao candidate: 159/159 core checks including positive SSH login and backup/restore, 1040/1040 backend tests, 166/166 frontend tests, live SCEP, real Kubernetes CertificateRequest, 22/22 CLI checks, Ansible idempotent second pass, site 185 links/pages checked. Separate v3.19.1 rehearsal source: seven keys including one SCEP RA also linked through its certificate, incorrectly flagged SHARED_ACROSS_CLASSES. The migrator explicitly reports ten missing target columns after applying schema 0017. Existing source data was left intact.

Application acceptance: all-in-cluster kind deployment issued a real dual-use test leaf through the in-cluster issuer, backend and OpenBao, with matching key, SAN and chain. A second deployment reused its Raft and SQLite volumes. Real Ansible SSH sessions and both KRL delivery paths passed. Playwright passed 23/23 RBAC tests and both demo login/renewal tests; all seven documented API examples ran. Production Compose AppRole initialization, scoped self-renewal, restart, SecretID rotation and revocation were verified. CLI snapshot 6ab01e0 matches the now-required sessionKeyLength; 62 Rust tests passed. The website checked 186 pages. Dependencies and original v3 keys still need end-to-end migration verification before the application release.

Additional controls: removal of the openssl executable from a disposable backend image left 102/102 live checks green (including X.509, CRL, SSH, SCEP, zero skips). The backend rerun after tightening the RA OpenAPI contract passed 1040/1040. An independent synthetic wrapped-transfer probe imported eight source keys across X.509 CA/leaf RSA and EC, Sensitive SSH and SCEP; public keys, signatures and import policies matched. A non-transferable ninth key stayed at its source. This proves the key transport, not the database mapping or the complete v3 cutover.

Scope of the 102 checks without the openssl executable: X.509 issuance, renewal, revocation, CRLs, CSR signing, SSH and SCEP. The run omitted x509_exports. PKCS#12, JKS via PKCS#12, and password-protected PKCS#8 used the executable at commit 23b37825; their interoperability checks ran separately with the normal image. The 08:00 independent review found duplicate CRL numbers under concurrency, stale CRLs after outages and X.509 error/diagnostic gaps. Release is pending corrections and independent re-verification.

Verified v3.19.1 directly with Cosmian 5.28.0 and the v3 Keycloak realm. Vitest exited 0: 110 files and 1,018 tests passed, zero failures or pending tests. The signed-image Ansible collection run also passed and found five Transit keys. The public release draft is PR #120. Its CodeQL finding at x509-extensions.ts refers to the public key identifier from RFC 5280 §4.2.1.2 method 1. Certificate signatures use SHA-256 or stronger and an independent issuer-key verification. GitGuardian identified a synthetic export-test password; the test now generates a fresh value per run.

The source cutover uses a separate, expiring OpenBao migration identity. Runtime requests to import keys get HTTP 403. The migration token imported synthetic X.509, SSH and RA keys and could not export them. The complete Ansible integration suite passed with the public fork, web policy d02873a2 and collection probe 9365518. The focused kind rerun after cleanup handling passed 4/4 with a real issued certificate. GitHub code-scanning alert 307 was triaged as a false positive specific to the public-key identifier in RFC 5280 section 4.2.1.2. Four CA fixtures independently matched that identifier and verified their signatures. Branch protection and scan rules remain enabled.
<!-- SECTION:NOTES:END -->
