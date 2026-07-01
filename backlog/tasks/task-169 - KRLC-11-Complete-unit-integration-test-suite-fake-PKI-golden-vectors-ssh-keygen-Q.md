---
id: TASK-169
title: >-
  KRLC-11: Complete unit + integration test suite (fake PKI + golden vectors +
  ssh-keygen -Q)
status: To Do
assignee: []
created_date: '2026-07-01 07:15'
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
- [ ] #1 go test ./... -race passes; the integration test drives a full fetch->local-decrypt->validate->verify->install cycle against the fake PKI and asserts a 0444 file plus the correct persisted state
- [ ] #2 A second poll with the cached version returns 304 and performs no write; anti-rollback, bad-signature, expired, host-mismatch, and null-signature-without-allow-unsigned cases each assert their exit codes (8,4,5,6,4)
- [ ] #3 An ssh-keygen -Q check against the installed golden KRL reports the revoked test key as revoked (byte-compatibility with real OpenSSH tooling)
<!-- AC:END -->
