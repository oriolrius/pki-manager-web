---
id: TASK-250
title: 'Ansible ssh_host_cert role: acknowledge principal pushes'
status: To Do
assignee: []
created_date: '2026-11-23T19:03:00Z'
updated_date: '2026-11-23T19:03:00Z'
labels:
  - ssh
  - ansible
dependencies: []
ordinal: 77014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The role installs /etc/ssh/auth_principals/<account> from GET /api/v1/external/ssh/hosts/:fqdn/auth-principals but never tells PKI Manager, so hosts stay Stale. TASK-246 added POST /api/v1/external/ssh/hosts/:fqdn/principals-pushed (token op get-principals) taking the sha256 from the GET response. Change the role (it lives in its own repo) to call it after the files are installed and sshd is reloaded. See docs/ssh-api-contract.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a successful principal install, the role POSTs the sha256 it received (or recomputed from the installed files) to principals-pushed and the host stops being Stale
- [ ] #2 A 409 SHA256_MISMATCH makes the role fetch and install again (or fail with a clear message), never ignore it
- [ ] #3 Check mode never calls the endpoint; a run with no file change still acknowledges when the GET reports stale: true
<!-- AC:END -->
