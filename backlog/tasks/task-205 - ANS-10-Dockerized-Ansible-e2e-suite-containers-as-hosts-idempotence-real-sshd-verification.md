---
id: TASK-205
title: >-
  ANS-10: Dockerized Ansible e2e suite (containers-as-hosts, idempotence +
  real-sshd verification)
status: Done
assignee: []
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 10:29'
labels:
  - ansible
  - ansible-integration
  - e2e
  - ssh
  - testing
milestone: Ansible Integration
dependencies:
  - TASK-203
  - TASK-197
  - TASK-198
  - TASK-204
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 32014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the missing container-as-managed-host e2e (no molecule/docker-sshd exists today). Use molecule with the docker driver for the managed-host container(s) so the built-in converge/idempotence/verify lifecycle drives the role, while a prepare/dependency step brings up backend+KMS from the existing compose files on a shared network and bootstraps a Host CA + fleet token programmatically. Converge applies ssh_host_cert; molecule idempotence asserts the second run is no-change; a verify stage runs real ssh from a client container reusing the SSH-33/BLK-11 assertion vocabulary (cert login under StrictHostKeyChecking, principal RBAC, KRL revocation lands and blocked user denied). Gate to skip cleanly when docker/KMS unavailable, mirroring the KMS_AVAILABLE pattern.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single command stands up backend+KMS, applies the role to an sshd container acting as a managed host, and passes
- [x] #2 molecule idempotence (second converge) reports zero changed tasks
- [x] #3 A client container performs a real ssh login accepted by the container-host's sshd via a User-CA-signed cert with no TOFU prompt
- [x] #4 After an operator block + KRL pull, the same user is denied on the blocked host ('revoked by file') while accepted elsewhere
- [x] #5 On an ECIES host, the krl-client scheduler installed by ANS-07 pulls and installs a signed RevokedKeys that sshd honors
- [x] #6 The suite skips (not fails) cleanly when docker or KMS is unavailable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ansible/tests/e2e/run.sh: one command brings up backend+KMS, applies the role to public-cron(ed25519)+ecies(ecdsa) host containers, asserts idempotence (changed=0), drives real ssh from a client (cert login no-TOFU, principal RBAC), and revocation narrowing on BOTH channels (curl-cron + krl-client); skips cleanly without docker/KMS. All 6 ACs green.
<!-- SECTION:NOTES:END -->
