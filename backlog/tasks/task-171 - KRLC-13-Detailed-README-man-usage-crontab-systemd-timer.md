---
id: TASK-171
title: 'KRLC-13: Detailed README + man/usage + crontab + systemd timer'
status: To Do
assignee: []
created_date: '2026-07-01 07:16'
updated_date: '2026-07-01 07:44'
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
Write krl-client/README.md and packaging/. Enable sequence (REUSING the existing ecdsa host key - no keygen): register host -> issue host cert -> ensure /etc/ssh/ssh_host_ecdsa_key.pub is registered -> SSH_ECIES_ENABLED=true. Document the full flag/env/config reference with each flag's CANONICAL default and stress that all on-host path defaults match pki-manager's generated 60-ssh-ca.conf (--host-key=/etc/ssh/ssh_host_ecdsa_key, --ca-pubkey=/etc/ssh/ssh-user-ca.pub, --krl-file=/etc/ssh/revoked_keys), so a host provisioned from that drop-in runs with ONLY --server-url. Include the exit-code table, the corrected If-None-Match semantics (server krl_version, not sha256-of-file), and the post-install note `sshd -t && systemctl reload ssh`. Ship packaging/krl-client.service (Type=oneshot, hardened: NoNewPrivileges, ProtectSystem=strict, ReadWritePaths=/etc/ssh /var/lib/krl-client) + krl-client.timer (interval under 120 req/60s and inside the ~30m ssh-mon staleness window, RandomizedDelaySec jitter) + crontab.example. Prominently WARN about (a) NTP as a hard prerequisite and (b) the encrypted /krl currently serving the HOST CA KRL while sshd RevokedKeys semantically needs the USER CA KRL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The README documents the enable sequence (reusing the existing ecdsa host key, no keygen), every flag/env/config key with its canonical default, and the full exit-code table; a host set up from the generated 60-ssh-ca.conf runs with only --server-url
- [ ] #2 packaging/ ships a working systemd oneshot .service + jittered .timer (inside the ssh-mon staleness window) and an example crontab line, all relying on the canonical defaults + --log-format json
- [ ] #3 The README warns that NTP is required and that the encrypted endpoint serves the Host-CA KRL (not the User-CA KRL sshd RevokedKeys expects), cross-linking decision-015
<!-- AC:END -->
