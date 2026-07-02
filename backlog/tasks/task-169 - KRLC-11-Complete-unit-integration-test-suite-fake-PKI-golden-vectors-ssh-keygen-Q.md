---
id: TASK-169
title: >-
  KRLC-11: Complete unit + integration test suite (fake PKI + golden vectors +
  ssh-keygen -Q)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:15'
updated_date: '2026-07-02 15:52'
labels:
  - ssh-cert-manager
  - automation
  - testing
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-162
  - TASK-165
  - TASK-167
priority: high
ordinal: 11
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Author the full Go test suite: table-driven unit tests per package plus an end-to-end integration test using an httptest fake PKI-Manager (serving 200 ciphertext, 304, and 400/404/429/501/503) with golden vectors in testdata/ (a real bare KRL, its sha256 version, a DER CA signature, the OpenSSH ca.pub, and backend-produced ECIES ciphertext/host-key pairs proving local-decrypt interop). Cover the 304 no-op, anti-rollback rejection, signature-failure, expired, host-mismatch, and null-signature paths, each asserting the documented exit code. Include an ssh-keygen -Q check (mirroring the backend integration test): after installing the golden KRL, `ssh-keygen -Q -f <krl-file> <revoked-key>` reports the key as revoked. Run with -race -covermode=atomic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 go test ./... -race passes; the integration test drives a full fetch->local-decrypt->validate->verify->install cycle against the fake PKI and asserts a 0444 file plus the correct persisted state
- [x] #2 A second poll with the cached version returns 304 and performs no write; anti-rollback, bad-signature, expired, host-mismatch, and null-signature-without-allow-unsigned cases each assert their exit codes (8,4,5,6,4)
- [x] #3 An ssh-keygen -Q check against the installed golden KRL reports the revoked test key as revoked (byte-compatibility with real OpenSSH tooling)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Generate backend-produced golden vectors in testdata/golden (Node eciesEncryptV1 + real ssh-keygen KRL): host key, ca.pub, DER CA sig, ciphertext.bin, real KRL, revoked/valid pubkeys, meta.
2. Commit a reproducible generator script under testdata/gen.
3. Golden integration test (AC1): full fetch->decrypt(backend ct)->validate->verify->install cycle; assert 0444 file + persisted state (version/number/sha256).
4. Exit-code table test (AC2): anti-rollback=8, bad-sig=4, expired=5, host-mismatch=6, null-sig=4 (+ allow-unsigned happy path), each asserting summary outcome=error and exit code.
5. ssh-keygen -Q check (AC3): after install, revoked.pub reports REVOKED (exit1), valid.pub reports ok (exit0); skip if ssh-keygen absent.
6. Run go test ./... -race -covermode=atomic; document vectors in testdata README; check ACs; notes; Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Completed the krl-client test suite (KRLC-11).

Added — all under internal/app/:
- testdata/golden/: a self-consistent, BACKEND-PRODUCED interop bundle. ciphertext.bin is emitted by the real backend eciesEncryptV1 (node:crypto), ca.pub by the backend spkiToOpenSshEcdsa, ca_signature.der is a real ECDSA-P256/DER sig over sha256(krl), and revoked_keys.krl is a real `ssh-keygen -k` bare KRL. Committing them turns the Go tests into a cross-implementation wire-contract guard.
- testdata/gen/generate-golden.mts: reproducible generator (imports the backend crypto verbatim); testdata/README.md documents the bundle + regen command.
- golden_test.go:
  - TestGoldenBackendInteropAndSshKeygenQ (AC#1+AC#3): full fetch->local-decrypt(backend ct)->validate->verify->install cycle against an httptest fake PKI; asserts installed KRL byte-for-byte, mode 0444, and persisted state (version/number/sha256). Then `ssh-keygen -Q` reports revoked_id.pub REVOKED (exit 1) and valid_id.pub ok (exit 0) — byte-compat with real OpenSSH tooling. Skips the ssh-keygen leg only if the binary is absent.
  - TestGoldenDecryptInterop: backend ciphertext -> Go decrypt.Open == committed payload.json (plaintext-level interop), and the embedded DER sig verifies under ca.pub.
- exitcodes_run_test.go (AC#2): TestRunPolicyFailureExitCodes table — anti-rollback=8, bad-signature=4, expired=5, host-mismatch=6, null-signature-without-allow-unsigned=4; each re-seals a mutated payload to the host key, asserts the exit code + one ERROR run_summary + that nothing is installed. Plus TestRunNullSignatureAllowUnsignedInstalls (the --allow-unsigned complement installs at exit 0).
- run_test.go: exposed hostPub/caKey on the fixture and factored out serveKRL() so custom ciphertext/version pairs can be served (existing 304 no-op / redaction / actionable-error tests retained).

Verification: `go test ./... -race -covermode=atomic` = 80 pass across 12 packages (was 71), 78.5% total; go build, go vet, gofmt all clean. Negative sanity: flipping one byte of the golden ciphertext fails both golden tests with AEAD auth failure (exit 3) and restoring passes — the interop guard is not vacuous.
<!-- SECTION:NOTES:END -->
