---
id: TASK-189
title: 'BLK-12: Ansible role + operator docs + cutover runbook'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-03 21:27'
updated_date: '2026-07-03 23:27'
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
- [x] #1 Role supports per-host URL + trust-anchor install with documented ordering
- [x] #2 Runbook covers canary, cutover, rollback/recovery, and the --allow-unsigned posture per client type
- [x] #3 All residual limitations including the new-key race documented in operator docs; .env.example complete
- [x] #4 decision-016 and doc-008 cross-references final
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
docs/ssh/host-blocks-runbook.md: composition recap, per-client trust-anchor + unsigned-posture table, 4-step cutover runbook (trust anchor BEFORE anything, canary via SSH_HOST_KRL_SERVE, cutover with first-fetch NO_KRL semantics, verify via KRL page + ssh.mon metrics), rollback (switch-back safe by global numbering; stale per-CA rejection exit 8 is intended; state-dir reset last resort), public-path host dual requirement (SSH_HOST_KRL_PUBLIC + URL switch), all residual limitations verbatim from decision-016 incl. new-key race pointing at flag-gated BLK-13, audit trail. Ansible: phase 6 optional cron (/etc/cron.d/pki-manager-krl, atomic install) + ssh_host_cert_krl_fetch_url one-line per-host switch + ssh_host_cert_user_ca_id/interval vars; README what-it-does now lists Host-CA anchor install (ordering warning) + cron phase + new vars row + runbook link. backend/.env.example: ALLOW_UNAUTHENTICATED_SSH_CA documented (env now complete: SSH_ECIES_ENABLED, KRL_VALID_FOR_SECONDS, SSH_HOST_KRL_SERVE, SSH_HOST_KRL_PUBLIC). Cross-refs: decision-016 Related-tasks gains implemented-2026-07-04 note + unsigned-posture sentence corrected per doc-008 grounding; doc-008 header gains status + runbook link.
<!-- SECTION:NOTES:END -->
