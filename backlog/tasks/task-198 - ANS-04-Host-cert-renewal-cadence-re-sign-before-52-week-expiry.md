---
id: TASK-198
title: 'ANS-04: Host-cert renewal cadence (re-sign before 52-week expiry)'
status: To Do
assignee: []
created_date: '2026-07-11 09:32'
labels:
  - ansible
  - ansible-integration
  - renewal
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 25014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Host certs are +52w (ssh-host.service.ts:25) but the role signs once and uses a stable Idempotency-Key (tasks/main.yml:24), so even re-running the playbook returns the cached original cert (ssh-external.routes.ts:91-92). Deploy a host-side timer/cron that periodically re-invokes sign-host with an Idempotency-Key that rotates per renewal period (e.g. includes a date/epoch bucket), installs the fresh cert, and reloads sshd — so certificates renew unattended well before validBefore, matching the KRL-refresh cadence asymmetry the role already accepts for revocation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scheduled unit/cron exists on the host that re-requests the host cert with a period-rotating Idempotency-Key
- [ ] #2 In a test that advances the period bucket, a new sign-host request returns a cert with a later validBefore/serial than the previous one (not the cached original)
- [ ] #3 The renewed cert is installed atomically and sshd reloads to present it; sshd -t passes
- [ ] #4 The renewal schedule and lead-time-before-expiry are configurable via role variables
<!-- AC:END -->
