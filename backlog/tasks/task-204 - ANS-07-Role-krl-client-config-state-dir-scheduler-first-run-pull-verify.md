---
id: TASK-204
title: >-
  ANS-07: Role: krl-client config + state dir + scheduler + first-run
  pull/verify
status: To Do
assignee: []
created_date: '2026-07-11 09:32'
labels:
  - ansible
  - ansible-integration
  - ecies
  - krl-client
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-199
  - TASK-200
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 31014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the encrypted-KRL path: write /etc/krl-client/config.yaml (mandatory server-url, optional --ca-bundle for a private-CA TLS server; ca-pubkey already at /etc/ssh/ssh-host-ca.pub from tasks/main.yml:73-91), ensure /var/lib/krl-client state dir, install the scheduler (systemd service+timer from krl-client/packaging, or /etc/cron.d/krl-client), run a first --dry-run then a real pull, and reload sshd so RevokedKeys is read. Add a fail-fast preflight: assert the backend has SSH_ECIES_ENABLED (a probe that would otherwise 501/exit 9) and that a time-sync daemon is active (NTP is a hard prereq; krl-client exits 5 on drift).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After the role runs on an ECIES host, a krl-client run pulls, decrypts, and atomically installs a signature-verified /etc/ssh/revoked_keys, and the scheduler (timer or cron) is enabled and fires on schedule
- [ ] #2 sshd re-reads RevokedKeys and denies a cert that the pulled KRL revokes ('revoked by file'); a non-revoked cert still logs in
- [ ] #3 If the backend ECIES path is disabled or no time daemon is active, the role fails with a clear actionable message rather than deploying a broken puller
- [ ] #4 A second role run reports no change (config/units/state idempotent)
<!-- AC:END -->
