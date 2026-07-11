---
id: TASK-201
title: >-
  ANS-08: Role: install known_hosts @cert-authority trust line (gated, for
  client/bastion hosts)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 09:55'
labels:
  - ansible
  - ansible-integration
  - client-trust
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: medium
ordinal: 28014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
For managed hosts that are also SSH clients (jump/bastion, CI runners, host-to-host), install the Host-CA @cert-authority line (rendered by GET /ssh/cert-authority, ssh-config.ts:131-134) into /etc/ssh/ssh_known_hosts so the box trusts other hosts' certs without TOFU. Gate behind a role variable (default off, since leaf servers don't need it).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When enabled, /etc/ssh/ssh_known_hosts contains the @cert-authority line for the configured pattern trusting the Host CA
- [ ] #2 An ssh client on the host connects to another cert-presenting host with StrictHostKeyChecking=yes and no known_hosts prompt
- [ ] #3 When the variable is off (default) no known_hosts change is made
- [ ] #4 A second role run reports no change
<!-- AC:END -->
