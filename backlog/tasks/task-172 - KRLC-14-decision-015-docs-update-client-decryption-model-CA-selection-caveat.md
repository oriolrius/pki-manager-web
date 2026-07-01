---
id: TASK-172
title: >-
  KRLC-14: decision-015 + docs update (client decryption model, CA-selection
  caveat)
status: To Do
assignee: []
created_date: '2026-07-01 07:16'
updated_date: '2026-07-01 07:43'
labels:
  - ssh-cert-manager
  - docs
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-159
  - TASK-160
priority: medium
ordinal: 14
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write backlog/decisions/decision-015 'SSH KRL Client Decryption Model' via the backlog CLI, mirroring decision-013 structure (Context, Decision, Consequences, Related tasks). Record: (1) the LOCAL-KEY model as chosen (host decrypts in-process, no per-host KMS access, native Go, no cosmian CLI), preferred over the KMS-resident model; (2) the client REUSES the host's EXISTING SSH host keypair as the ECIES key at pki-manager's canonical path /etc/ssh/ssh_host_ecdsa_key, and ALL client on-host path defaults derive from the ssh-config.ts single-source-of-truth constants (hostKeyPathFor, USER_CA_PATH, REVOKED_KEYS_PATH) so the client, the generated 60-ssh-ca.conf drop-in and the Ansible role never disagree; (3) the required backend change (KRLC-02: encrypt to the host's already-registered ecdsa pubkey); (4) the P-256 constraint (ecdsa host key required; ed25519-cert hosts register their ecdsa host pubkey) and the SSH-host-key-reuse trade-off (with a dedicated-key override); (5) the client security posture (anti-rollback, host-id binding, signature-before-install). Capture the open caveats: Host-CA-vs-User-CA KRL asymmetry, and telemetry-not-updated-on-304. Keep doc-007 links in sync. All edits via the backlog CLI (no hand-edited task files).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 decision-015 exists (status Accepted), mirrors decision-013 format, and records the chosen local-key model, the backend enablement it requires, the rejected KMS-resident alternative, and the client security posture
- [ ] #2 The decision cross-links decision-013 and lists the KRLC-* related tasks; the CA-selection asymmetry and 304-telemetry caveats are captured as consequences/open questions
- [ ] #3 doc-007 (anchor) and the README reference decision-015; all decision/doc edits are made via the backlog CLI
- [ ] #4 doc-007 (anchor) and the README reference decision-015; all decision/doc edits are made via the backlog CLI
<!-- AC:END -->
