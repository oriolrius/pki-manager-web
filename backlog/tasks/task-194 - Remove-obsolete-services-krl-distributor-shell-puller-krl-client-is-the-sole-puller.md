---
id: TASK-194
title: >-
  Remove obsolete services/krl-distributor shell puller; krl-client is the sole
  puller
status: Done
assignee:
  - '@myself'
created_date: '2026-07-11 08:48'
updated_date: '2026-07-11 08:51'
labels:
  - docs
  - ssh
  - cleanup
dependencies: []
ordinal: 21014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
services/krl-distributor/ is the first-generation host-side KRL puller (bash host_puller.sh + systemd unit/timer, SSH-24 / TASK-145). It decrypts via the KMS-resident ECIES model (cosmian kms ec decrypt against a KMS-held per-host private key). That model was retired by decision-015 / KRLC-02 (TASK-160, Done): the backend now encrypts natively to each host's own SSH host key for LOCAL decryption, which is what the Go krl-client does. So host_puller.sh can no longer decrypt what the backend produces — it is dead, and ansible/README.md + docs/ssh/host-blocks-runbook.md still present it as a valid alternative, which misleads operators. Remove the folder and scrub the docs so krl-client is the single supported puller.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 services/krl-distributor/ is deleted from the repo
- [x] #2 ansible/README.md no longer points operators at the removed shell puller
- [x] #3 docs/ssh/host-blocks-runbook.md no longer presents host_puller.sh as a puller option (krl-client only)
- [x] #4 No remaining repo references imply host_puller.sh/krl-distributor is a usable option
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed services/krl-distributor/ (host_puller.sh + krl-puller.service/.timer + README) — the retired KMS-resident ECIES shell puller (decision-013, superseded by decision-015 / KRLC-02 TASK-160). krl-client (Go, local-key decryption) is now the sole supported host-side puller. Scrubbed references: ansible/README.md and the ssh_host_cert role comment point at krl-client; docs/ssh/host-blocks-runbook.md drops the host_puller.sh table row; backend comments (ssh-host-state.ts, ssh-host-krl.service.ts, ssh-host-state.test.ts) reworded around krl-client's --allow-unsigned instead of host_puller.sh; spike-ssh-ecies.ts comment annotated as historical/retired. Only backlog task/decision records still mention it (correct — historical). Verified: backend typecheck clean, ssh-host-state tests 6/6 pass, no non-backlog references remain.
<!-- SECTION:NOTES:END -->
