---
id: TASK-197
title: >-
  ANS-03: Role: install the authoritative sshd drop-in instead of hand-rolling
  it
status: To Do
assignee: []
created_date: '2026-07-11 09:32'
labels:
  - ansible
  - ansible-integration
  - config
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: medium
ordinal: 24014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the hand-composed blockinfile (tasks/main.yml:94-109) with a fetch of GET /ssh/hosts/:id/sshd-config, the single-source-of-truth render (ssh-config.ts:106-129), installed verbatim. This eliminates the two-sources-of-truth drift and makes the drop-in algorithm-aware (correct HostKey/HostCertificate paths for ecdsa vs ed25519 hosts, which the hardcoded defaults get wrong for ECIES hosts). Requires resolving the host's server-side id (via the sign-host response or a lookup); keep validate + reload behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The installed /etc/ssh/sshd_config.d/60-ssh-ca.conf byte-matches the content served by GET /ssh/hosts/:id/sshd-config for that host
- [ ] #2 On an ecdsa-keyed host the drop-in references the ecdsa host key/cert paths (no ed25519 hardcoding)
- [ ] #3 sshd -t passes and sshd reloads only when the served content changes
- [ ] #4 A second role run reports no change when the server render is unchanged
<!-- AC:END -->
