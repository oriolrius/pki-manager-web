---
id: TASK-171
title: 'KRLC-13: Detailed README + man/usage + crontab + systemd timer'
status: To Do
assignee: []
created_date: '2026-07-01 07:16'
labels:
  - ssh-cert-manager
  - automation
  - docs
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-166
  - TASK-168
priority: medium
ordinal: 13
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write krl-client/README.md and packaging/: the enable sequence (register host -> issue host cert -> generate host ECIES key -> register its pubkey -> SSH_ECIES_ENABLED=true), the full flag/env/config reference, the exit-code table, the corrected If-None-Match semantics (server krl_version, not sha256-of-file), local-key provisioning (where the host private key lives + perms), and the post-install note `sshd -t && systemctl reload ssh`. Ship packaging/krl-client.service (Type=oneshot, hardened: NoNewPrivileges, ProtectSystem=strict, ReadWritePaths=/etc/ssh /var/lib/krl-client) + krl-client.timer (interval under 120 req/60s and inside the ~30m ssh-mon staleness window, with RandomizedDelaySec jitter) + crontab.example. Prominently WARN about (a) NTP as a hard prerequisite and (b) the encrypted /krl currently serving the HOST CA KRL while sshd RevokedKeys semantically needs the USER CA KRL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The README documents the enable sequence, every flag/env/config key with defaults, the full exit-code table, and the corrected If-None-Match=krl_version behavior; a reader can provision a host end-to-end from it
- [ ] #2 packaging/ ships a working systemd oneshot .service + jittered .timer (inside the staleness window) and an example crontab line, all invoking the binary with --log-format json/--quiet
- [ ] #3 The README explicitly warns that NTP is required and that the encrypted endpoint serves the Host-CA KRL (not the User-CA KRL sshd RevokedKeys expects), cross-linking decision-015
<!-- AC:END -->
