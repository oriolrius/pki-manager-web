---
id: TASK-189
title: 'BLK-12: Ansible role + operator docs + cutover runbook'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:27'
updated_date: '2026-07-03 23:25'
labels:
  - ssh-host-blocks
  - ansible
  - docs
milestone: SSH Host Access Blocks
dependencies:
  - TASK-183
  - TASK-187
references:
  - ansible/README.md
priority: medium
ordinal: 16014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ANSIBLE (ssh_host_cert role): per-host fetch URL option for public-path hosts (the one-line switch from /krl/:caId.bin to /krl/hosts/:hostId.bin) + Host-CA trust-anchor file install (BLK-10), with ordering: trust anchor BEFORE cutover.

OPERATOR DOCS (docs/ssh/, DEPLOYMENT.md, .env.example): SSH_HOST_KRL_SERVE and SSH_HOST_KRL_PUBLIC (default OFF — enabling leaks per-host deny intel unauthenticated; public-path hosts get blocks ONLY if the deployment sets it AND the role switches the URL). CUTOVER RUNBOOK: trust anchor -> canary -> cutover -> verify states; switch-back/rollback story (safe by BLK-03 global monotonic numbering; puller state-file reset documented as last-resort recovery); --allow-unsigned posture per client type (krl-client fail-stales on unsigned KRLs; host_puller.sh installs them).

RESIDUAL LIMITATIONS stated honestly (decision-016 Consequences — every item): <=1 pull-interval before a host enforces (irreducible in a pull model); v1 new-key race for blocked-but-active identities (closed ONLY by the optional BLK-13 issuance gate — must be documented since BLK-13 is flag-gated); Effective = "ciphertext served", not verified install; fingerprint entries over-block a second identity sharing the same pubkey (anti-pattern, warned at block time); an offline/never-pulling host keeps its last KRL (visible via stalePullingHosts, never shown Effective).

Final cross-references: decision-016 Related-tasks section + doc-008 anchor reconciled (KRLC-14 pattern).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Role supports per-host URL + trust-anchor install with documented ordering
- [ ] #2 Runbook covers canary, cutover, rollback/recovery, and the --allow-unsigned posture per client type
- [ ] #3 All residual limitations including the new-key race documented in operator docs; .env.example complete
- [ ] #4 decision-016 and doc-008 cross-references final
<!-- AC:END -->
