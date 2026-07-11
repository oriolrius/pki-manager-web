---
id: TASK-203
title: >-
  ANS-02: Role: populate AuthorizedPrincipalsFile + guarantee RevokedKeys file
  exists
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 09:55'
labels:
  - ansible
  - ansible-integration
  - principals
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-196
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 30014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make cert-based logins actually work on a role-provisioned host. Create the /etc/ssh/auth_principals/ directory, fetch the per-account principal files from ANS-01 and install each as auth_principals/<account> (0644), and create an empty 0444 /etc/ssh/revoked_keys placeholder so the always-written RevokedKeys fail-closed directive points at a real file. Reload sshd on change. Today the drop-in directs AuthorizedPrincipalsFile at /etc/ssh/auth_principals/%u (tasks/main.yml:106) but nothing creates it, so a valid user cert is denied.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After the role runs on a container-as-host, /etc/ssh/auth_principals/ exists and contains one file per mapped account with the rendered principals
- [ ] #2 A user presenting a valid cert whose principal matches an account can log in via sshd; a user whose principal is not listed is denied
- [ ] #3 /etc/ssh/revoked_keys exists (0444) even with the KRL cron disabled, and sshd -t passes and does not fail-closed for a missing RevokedKeys file
- [ ] #4 A second role run reports no changes for these tasks (idempotent)
<!-- AC:END -->
