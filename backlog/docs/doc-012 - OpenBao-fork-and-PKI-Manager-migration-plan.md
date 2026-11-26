---
id: doc-012
title: OpenBao fork and PKI Manager migration plan
type: specification
created_date: '2026-11-26T16:59:00Z'
updated_date: '2026-11-26T17:03:00Z'
---
Decision 018 selects the downstream OpenBao build for PKI Manager. This is the implementation and release plan. Cosmian still serves the application. The previous run recorded 33/33 spike checks. One check passed because stock Transit rejected a required SCEP operation. That result establishes a baseline, not release readiness. The working spike report is Backlog doc-011, “KeyStore contract and OpenBao spike”.

## Source and license boundary

Build from the fork's `pki-manager` branch. Its initial base is OpenBao v2.7.3, commit `0439ef5812538733afb277b4445a54706edc1db7`. Keep a small downstream patch series. Record the upstream tag, downstream commit and image digest on each release. Rebuild and run the same suite when taking upstream fixes. The inherited MPL-covered files, their modifications, and new files containing covered code retain MPL-2.0. Separate original downstream files use Apache-2.0. Preserve third-party notices and provide the covered source for distributed builds. Use Cosmian's Rust tests to identify behavior. Write independent tests with fresh fixtures. [Fork licensing](https://github.com/oriolrius/openbao/blob/pki-manager/DOWNSTREAM-LICENSING.md) · [Mozilla license, §§1.10 and 3](https://www.mozilla.org/en-US/MPL/2.0/)

PKI Manager compatibility determines the release. Upstream contribution is a separate decision. The current upstream template requires a related approved issue and a declaration covering AI authorship of the code, issue and PR text. Keep the downstream origin of each change visible. [OpenBao contribution template](https://github.com/openbao/openbao/blob/main/.github/pull_request_template.md)

## Work split

| Existing behavior | Destination | Acceptance evidence |
|---|---|---|
| Generate or import keys, get public keys, sign, export permitted keys, destroy keys | Existing Transit API plus adapter | Exercise RSA 2048/3072/4096 and EC P-256/P-384 where each product profile allows them. Verify DER SPKI, RSA signatures with DigestInfo and ECDSA DER with independent tools. Pin mount, name and version for each identity. |
| Activate, resolve key links, revoke certificates, list/read certificate objects | Adapter lifecycle plus SQLite | Preserve certificate IDs, key references, issuer chains and revocation state. Reconcile shared references on deletion and retry. Preserve archived or revoked records. |
| Cosmian Certify, CRLs and SSH verification | PKI Manager services | Build TBS locally, sign in Transit, store certificate PEM, verify signatures independently. Keep profile and zone rules in the services. |
| SCEP prehashed RA sign | Existing Transit sign API | Verify the signature over the original SHA-256 digest with the RA certificate. |
| SCEP CMS RSAES-PKCS1-v1_5 session-key transport | New operation in the fork, plus gateway and backend changes | Complete a real SCEP enrollment with the same non-exportable RSA-3072 key for sign and unwrap. Verify renewal, retry, RA restart and previous-certificate overlap. |
| KMIP Query used by connection-test utilities | Provider status check | Distinguish reachable, sealed, unavailable and unauthorized in operator diagnostics. Check process liveness separately. |

## 1. Freeze the compatibility baseline

Use the ten KMIP operations and their call sites in doc-011 as the checklist. Its recording covered 731 requests on Cosmian 5.28.0. One backend test timed out through the recorder. The RA paths came from code inspection. Run current backend tests directly against Cosmian and retain their results. Generate synthetic fixtures for each CA, leaf profile, imported CSR, SSH zone and SCEP integration. Record public fingerprints, serials, expiry, chains, expected exports and roles. Keep private material out of test reports.

## 2. Implement the SCEP operation in the fork

Start in Transit routing and keysutil. Keep the existing OAEP and signature paths intact. Give only the RA service identity permission to invoke the new operation for its RA keys. Bind the integration, key name and version on the server. Accept a modulus-sized raw CMS encrypted key and a supported expected session-key length. Return session key material only across the authenticated internal service boundary. Never expose a padding-validity indicator. Keep RA key export, backup export and key configuration outside the runtime role. [Transit decrypt handler](https://github.com/openbao/openbao/blob/0439ef5812538733afb277b4445a54706edc1db7/internal/builtin/logical/transit/path_decrypt.go) · [Existing RSA decryption](https://github.com/openbao/openbao/blob/0439ef5812538733afb277b4445a54706edc1db7/sdk/helper/keysutil/policy.go#L1210)

The gateway currently sends only ciphertext. Its PKCS#7 dependency supplies empty RSA options. Derive the expected length from the CMS content-encryption OID before unwrap. Pass it through a coordinated gateway/backend API change. Supply 32 bytes explicitly in the startup self-test. Test AES-128 and AES-256 CBC and GCM. Check the current 24-byte case separately. The pinned codec recognizes 3DES-CBC, with no AES-192 OID. Inventory deployed callers of the existing RA endpoint before changing its contract. Keep old gateway/backend pairs operational during rollout and require a matching pair before switching the provider. [Gateway client](../../scep/remote_ra.go) · [PKCS#7 v0.2.3](https://github.com/smallstep/pkcs7/blob/v0.2.3/decrypt.go)

Use a reviewed library operation for legacy session-key transport. Go documents a fixed-length, randomly prefilled output buffer and explicit limits on its protection. Review repeated requests, the trusted caller's access to raw session keys, downstream CMS processing and externally observable errors before enabling it. Keep SCEP authorization, request limits and audit redaction active. Test the complete protocol response on invalid envelopes, forbidden keys, unsupported OIDs and unavailable stores. A unit test cannot establish timing safety. [Go RSA session-key API](https://pkg.go.dev/crypto/rsa#DecryptPKCS1v15SessionKey)

### Executed interoperability check

Downstream commit `347b7b9` includes a standalone Apache-2.0 test. OpenSSL encrypted fresh 16-, 24- and 32-byte session keys with an RSA-3072 public key. Go recovered all three values. Run `go test -count=1 -v ./downstream/pki-manager/interop/scep_transport_test.go` in the fork. This test exercises the primitive. The Transit endpoint and full CMS enrollment still need implementation and validation. [Downstream test](https://github.com/oriolrius/openbao/blob/347b7b9be56dc0c5562b2e6048270ddda9fa51e7/downstream/pki-manager/interop/scep_transport_test.go)

## 3. Replace Cosmian-specific application paths

1. Put both adapters behind one contract. Keep the Cosmian path available for comparison and migration. Test token expiry and renewal, sealed state, timeouts, duplicate operations and partial creation. Reconcile outcomes before retrying writes.
2. Add certificate PEM and versioned key references with an additive SQLite migration. Backfill before switching reads. Preserve rows for external CSRs with no local private key. Replace KMS reads in REST, tRPC, public downloads, bulk operations and the startup path.
3. Use a shared issuing service for create, renew, bulk and external CSR signing. Preserve CN/O/C and optional fields, SAN DNS/IP/email, KU, EKU, CA constraints, validity ceiling, SKI/AKI, CDP and positive unique serials. Preserve supported CSR signature algorithms and key sizes independently of CA generation limits. Test refusal of invalid signatures, duplicate extensions and unauthorized CA requests. Verify issue, renew with either key policy, revoke, CRL publication and chain download with OpenSSL.
4. Preserve present CA and leaf PKCS#12/JKS/PEM export permissions as a compatibility requirement wherever offered today. Import keys with the corresponding export setting and test each allowed format through its real endpoint. Require a separate policy decision before removing existing exports. CRL generation uses remote signing. SSH CA and RA keys remain non-exportable. Verify CA export denial with both a permitted client on a non-exportable test key and a denied client on an exportable test key.
5. Verify SSH user and host certificates with real sshd, both KRLs, rotation, revocation, legacy key cleanup and cross-zone isolation. Exercise cert-manager enrollment on Kubernetes and both live SCEP tests. Compare REST and tRPC responses, CLI commands, Ansible runs, UI and audit events against the baseline. Regenerate consumers only if their API changes.

## 4. Derive regression tests from the pinned Rust release

Use Cosmian 5.28.0, commit `4ab3ee65829a903abb71f1298f400657fcee7ec9`. The links identify the original scenarios. The right column specifies independent acceptance tests to write or reuse.

| Rust reference | Downstream regression |
|---|---|
| [RSA encryption and decryption](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/clients/ckms/src/tests/rsa/encrypt_decrypt.rs#L129) | OpenSSL encrypts known-length random session keys. The fork unwraps them using a generated and a migrated RA. Check each accepted length and verify OAEP regressions. |
| [RSA signing](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/clients/ckms/src/tests/rsa/sign_verify.rs#L79) and [elliptic-curve signing](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/clients/ckms/src/tests/elliptic_curve/sign_verify.rs#L79) | Verify prehashed RSA with an independent verifier and raw-message SSH ECDSA with OpenSSH. Altered data fails verification. |
| [Certify scenarios](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/clients/ckms/src/tests/certificates/certify.rs#L524) and [serial encoding](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/server/src/core/operations/certify/tests.rs#L80) | Issue from a stored public key and from CSRs with and without requested extensions. Verify policy, renewal, root self-signature, serial uniqueness and DER serial length at most 20 octets. |
| [Key wrapping](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/clients/ckms/src/tests/shared/import_export_wrapping.rs#L226) and [sensitivity](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/server/src/tests/test_always_sensitive.rs#L411) | Verify permitted migration preserves public identity and a post-import challenge signature. Test export refusal under destination policy and stop on a source key whose policy forbids transfer. |
| [Linked-object revocation](https://github.com/Cosmian/kms/blob/4ab3ee65829a903abb71f1298f400657fcee7ec9/crate/server/src/tests/revoke_tests.rs#L449) | Revoke a leaf and verify CRL membership. Delete one renewed certificate sharing a key and verify the survivor still works. Repeat after simulating a failed database update. |

## 5. Rehearse migration and recovery

1. Inventory the actual source version, all objects, references, key attributes and public fingerprints. The spike used synthetic keys on 5.28.0. Repeat on the deployed version. Mark missing, non-transferable and orphaned objects explicitly. Require a disposition for each before cutover.
2. On an isolated restored copy, copy certificate chains and import eligible keys. Include exportable X.509 CA and leaf keys, Sensitive SSH CA keys and the Sensitive RSA-3072 RA. Use a migration-only identity. Keep old-to-new mappings and per-object checkpoints. Make the second run a verified no-op. Check the same fingerprints and verify fresh signatures and SCEP enrollment using the original trust material.
3. Build a production-mode test stack with TLS, persistent Raft storage, documented seal recovery, scoped AppRole credentials and audit output. Reboot, seal, unseal and restore paired OpenBao and SQLite snapshots into a fresh instance. Verify the same identities and post-restore operations. Test outage handling and concurrent issue, sign and revoke under measured load.
4. Freeze writes for the final copy. Reconcile counts, references, revocations, serials and fingerprints. Switch one writer, then run canaries. Before accepting writes, rehearse returning to the original pair of stores. After new writes, require a reconciled forward recovery or replay plan covering new keys, issued serials and revocations. A stale snapshot alone loses state.
5. Release only after every required live suite executes against the fork with Cosmian disconnected. Archive test versions, counts, skipped cases, restore evidence and image digest. Update Compose, dev scripts, CI, issuer manifests, demo, k5 configuration and operating guides together. Retire Cosmian only after the recovery window closes.
