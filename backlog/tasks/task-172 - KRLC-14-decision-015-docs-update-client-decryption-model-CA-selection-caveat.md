---
id: TASK-172
title: >-
  KRLC-14: decision-015 + docs update (client decryption model, CA-selection
  caveat)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:16'
updated_date: '2026-07-02 16:24'
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
Write backlog/decisions/decision-015 'SSH KRL Client Decryption Model' via the backlog CLI, mirroring decision-013's structure (Context, Decision, Consequences, Related tasks). decision-015 SUPERSEDES decision-013's KMS-resident 'adopted model'. Record: (1) decryption is ALWAYS local on the host - the KMS is never used to en/decrypt the KRL; (2) the backend encrypts NATIVELY (node:crypto) to the host's OWN public key, by default the reused SSH host key at pki-manager's canonical path /etc/ssh/ssh_host_ecdsa_key, and ALL client on-host path defaults derive from the ssh-config.ts single-source-of-truth constants (hostKeyPathFor, USER_CA_PATH, REVOKED_KEYS_PATH); (3) the pinned standard ECIES envelope (P-256 + HKDF-SHA256 + AES-256-GCM) and why native (not Cosmian's opaque ECIES) is REQUIRED for local decrypt; (4) the rebuild (KRLC-02) that retires the KMS-resident path of SSH-15/SSH-24 and migrates existing hosts; (5) the P-256 constraint (ecdsa host key; ed25519-cert hosts register their ecdsa host pubkey) and the SSH-host-key-reuse trade-off (dedicated-key override via --host-key); (6) the client security posture (anti-rollback, host-id binding, signature-before-install). Capture open caveats: Host-CA-vs-User-CA KRL asymmetry, telemetry-not-updated-on-304. Annotate decision-013 as superseded and keep doc-007 links in sync. All edits via the backlog CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 decision-015 exists (status Accepted), mirrors decision-013's format, and explicitly SUPERSEDES decision-013's KMS-resident adopted model; it records local-only decryption, native backend encryption to the host's own key, and the ssh-config.ts path-default alignment
- [x] #2 The decision documents the KRLC-02 rebuild that retires the KMS-resident path of SSH-15/SSH-24 (with host migration), the P-256/ed25519 constraint, and the SSH-host-key-reuse trade-off; it cross-links decision-013 and lists the KRLC-* tasks
- [x] #3 doc-007 and the README reference decision-015 and decision-013 is annotated as superseded; all decision/doc edits are made via the backlog CLI
- [x] #4 The krl-client README's decision-015 reference is a working relative markdown link (file exists at backlog/decisions/decision-015 - SSH-KRL-Client-Decryption-Model.md and the link resolves), not just a textual mention
<!-- AC:END -->
