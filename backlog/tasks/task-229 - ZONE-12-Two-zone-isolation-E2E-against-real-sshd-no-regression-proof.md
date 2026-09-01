---
id: TASK-229
title: 'ZONE-12: Two-zone isolation E2E against real sshd + no-regression proof'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-09-01 04:50'
updated_date: '2026-09-01 06:03'
labels:
  - ssh-zones
  - ssh-cert-manager
  - testing
  - e2e
  - security
milestone: SSH Zones
dependencies:
  - TASK-222
  - TASK-226
  - TASK-228
ordinal: 56014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prove the trust boundary end to end, against real OpenSSH, and prove nothing that exists today broke.

Every other task in this milestone asserts its own slice. This one asserts the property the milestone actually sells: a certificate from zone A is useless on a host in zone B, and a revocation in zone A does not touch zone B.

== Isolation matrix (two zones, real crypto) ==
Set up zone A and zone B, each with its own User CA and Host CA, one host and one identity, and assert:
1. an identity from zone A cannot log in to a host in zone B -- the host's TrustedUserCAKeys simply does not contain zone A's User CA
2. an identity from zone B can log in to its own zone's host (the positive control -- an isolation test that passes because everything is broken is worthless)
3. revoking a zone-A user certificate does not add its serial to a zone-B host's KRL, and does add it to a zone-A host's KRL (decode the bytes with src/test/krl-decode.ts)
4. a zone-B host's composed KRL signature verifies against zone B's Host CA key and fails against zone A's
5. per-host blocks still behave exactly as decision-016 specifies, within a zone
6. KRL numbers stay strictly increasing across hosts in both zones (the global allocator -- a per-zone sequence would make a client reject a KRL as a rollback)
7. the same FQDN registered in both zones yields two hosts, each certified by its own zone's CA, and each ECIES pull returns an envelope only that host can decrypt

The existing real-sshd harness from the blocks milestone (backend/src/crypto/ssh/e2e*.test.ts, e2e-blocks.test.ts) is the pattern to extend; do not build a second harness.

== Regression proof for existing installations ==
- the in-repo Ansible end-to-end suite (ansible/tests/e2e, which installs the pinned Galaxy collection and drives a container fleet) passes unmodified -- this is the evidence that the deprecated unscoped endpoints from TASK-225 and the unchanged external API contract still serve the collection
- the full backend suite passes with no pre-existing test edited, which is the evidence that implicit single-zone resolution (amendment A1) works
- a database migrated from the pre-zone schema produces byte-identical composed KRLs to what it produced before
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A user certificate issued in one zone is rejected by a host in another zone, verified against a real sshd
- [x] #2 A user certificate issued in the same zone as the host is accepted, so the isolation result is not a false positive
- [x] #3 Revoking a certificate in one zone changes only that zone's hosts' KRLs, verified by decoding the KRL bytes
- [x] #4 A host's KRL signature verifies against its own zone's Host CA and fails against the other zone's
- [x] #5 The same FQDN registered in two zones yields two independently certified hosts, each able to decrypt only its own KRL envelope
- [x] #6 Per-host access blocks still behave as specified within a zone
- [x] #7 The Ansible end-to-end suite passes unmodified and the full backend suite passes with no pre-existing test edited
- [x] #8 A database migrated from the pre-zone schema produces the same composed KRL bytes it produced before
<!-- AC:END -->

















## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend the existing real-sshd e2e harness with a two-zone fixture: two User CAs, two Host CAs, two hosts, two identities, principals mapped per zone.
2. Implement the seven assertions above; keep the positive controls next to each negative one.
3. Add the "migrated DB produces identical KRL bytes" check: build a KRL on a pre-migration schema fixture, migrate, rebuild, compare.
4. Run the Ansible e2e suite unmodified (docker compose harness under ansible/tests/e2e) and record the result in the notes.
5. Run the Playwright suites that touch SSH (tests/screenshots.spec.ts, tests/e2e-rbac.spec.ts) and update only snapshots that legitimately changed because of the new switcher.
6. Record in the task notes exactly which residual gaps remain untested, honestly -- for example anything that depends on a real multi-zone fleet rather than containers.
<!-- SECTION:PLAN:END -->
