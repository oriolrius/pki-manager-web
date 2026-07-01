---
id: TASK-172
title: >-
  KRLC-14: decision-015 + docs update (client decryption model, CA-selection
  caveat)
status: To Do
assignee: []
created_date: '2026-07-01 07:16'
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
Write backlog/decisions/decision-015 'SSH KRL Client Decryption Model' via the backlog CLI, mirroring decision-013 structure (Context, Decision, Consequences, Related tasks): record the LOCAL-KEY model as the CHOSEN/shipped design (host holds its P-256 ECIES private key; backend encrypts to the host-supplied pubkey via a documented standard ECIES envelope; no per-host KMS access; native Go decrypt, no cosmian CLI), why it was preferred over the KMS-resident model (per-host KMS dependency), and the required backend change (KRLC-02). Record the client security posture (anti-rollback, host-id binding, signature-before-install). Capture the open caveats: the Host-CA-vs-User-CA KRL asymmetry, and telemetry-not-updated-on-304. Keep doc-007 (the milestone anchor) links in sync. All edits via the backlog CLI (no hand-edited task files).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 decision-015 exists (status Accepted), mirrors decision-013 format, and records the chosen local-key model, the backend enablement it requires, the rejected KMS-resident alternative, and the client security posture
- [ ] #2 The decision cross-links decision-013 and lists the KRLC-* related tasks; the CA-selection asymmetry and 304-telemetry caveats are captured as consequences/open questions
- [ ] #3 doc-007 (anchor) and the README reference decision-015; all decision/doc edits are made via the backlog CLI
<!-- AC:END -->
