---
id: TASK-171
title: 'KRLC-13: Detailed README + man/usage + crontab + systemd timer'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-01 07:16'
updated_date: '2026-07-02 16:13'
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
- [x] #1 The README documents the enable sequence (reusing the existing ecdsa host key, no keygen), every flag/env/config key with its canonical default, and the full exit-code table; a host set up from the generated 60-ssh-ca.conf runs with only --server-url
- [x] #2 packaging/ ships a working systemd oneshot .service + jittered .timer (inside the ssh-mon staleness window) and an example crontab line, all relying on the canonical defaults + --log-format json
- [x] #3 The README warns that NTP is required and that the encrypted endpoint serves the Host-CA KRL (not the User-CA KRL sshd RevokedKeys expects), cross-linking decision-015
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packaging/krl-client.service — Type=oneshot, root, hardened (NoNewPrivileges, ProtectSystem=strict, ReadWritePaths=/etc/ssh /var/lib/krl-client, +curated sandbox), ExecStart --systemd (forces json), After time-sync.target
2. packaging/krl-client.timer — OnUnitActiveSec=15m + RandomizedDelaySec=5m jitter (max ~20m < 30m ssh-mon staleness; ~1 req/15m << 120/60s), Persistent
3. packaging/krl-client.env.example + packaging/crontab.example (json, jittered, escaped %)
4. packaging/krl-client.8 man page
5. README: enable sequence (reuse ecdsa key, SSH_ECIES_ENABLED), usage synopsis, If-None-Match=krl_version (not sha256-of-file), post-install sshd -t && systemctl reload ssh, NTP prerequisite + Host-CA vs User-CA KRL caveat (decision-015), packaging/install section
6. Verify units parse + go build unchanged; tick ACs; notes; Done
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wrote krl-client/README.md and krl-client/packaging/.

README: added Enable sequence (reuse ecdsa host key, no keygen: register host -> issue host cert + 60-ssh-ca.conf drop-in -> register ssh_host_ecdsa_key.pub -> backend SSH_ECIES_ENABLED=true), full flag/env/config reference with canonical defaults (stresses a 60-ssh-ca.conf host runs with only --server-url), exit-code table, "How a run works" clarifying If-None-Match carries the server krl_version token (X-KRL-Version), NOT sha256-of-file, and the post-install `sshd -t && systemctl reload ssh` note. Two WARNING callouts: NTP hard prerequisite (exit 5 on drift) and the Host-CA-vs-User-CA KRL mismatch, cross-linking decision-013 (exists) and decision-015 (KRLC-14).

packaging/: krl-client.service (Type=oneshot, root, NoNewPrivileges + ProtectSystem=strict + ReadWritePaths=/etc/ssh /var/lib/krl-client + curated sandbox + caps dropped, After=time-sync.target, ExecStart --systemd => json); krl-client.timer (OnUnitActiveSec=15m + RandomizedDelaySec=300 jitter, Persistent — max ~20m < 30m ssh-mon staleness, ~1 req/15m << 120/60s rate limit); krl-client.env.example; crontab.example (15m jittered, --log-format json --quiet, escaped \%); krl-client.8 man page (section 8).

Verified: `go build ./...` OK (code unchanged), `systemd-analyze verify` parses both units cleanly (only note: binary not yet installed on this dev box), man page renders with no troff warnings.
<!-- SECTION:NOTES:END -->
