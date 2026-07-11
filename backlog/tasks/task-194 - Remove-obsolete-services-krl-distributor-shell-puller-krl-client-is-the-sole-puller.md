---
id: TASK-194
title: >-
  Remove obsolete services/krl-distributor shell puller; krl-client is the sole
  puller
status: To Do
assignee: []
created_date: '2026-07-11 08:48'
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
- [ ] #1 services/krl-distributor/ is deleted from the repo
- [ ] #2 ansible/README.md no longer points operators at the removed shell puller
- [ ] #3 docs/ssh/host-blocks-runbook.md no longer presents host_puller.sh as a puller option (krl-client only)
- [ ] #4 No remaining repo references imply host_puller.sh/krl-distributor is a usable option
<!-- AC:END -->
