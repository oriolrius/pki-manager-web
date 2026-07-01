---
id: TASK-166
title: 'KRLC-08: CLI/flags/config/env + documented exit codes'
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-165
priority: high
ordinal: 8
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/config and wire main.go/internal/app: the full flag set (--server-url, --host-id defaulting to `hostname -f`, --krl-file /etc/ssh/revoked_keys, --ca-pubkey, --allow-unsigned, --state-dir, --host-key (host-held ECIES private key, required in the default local mode), --decrypt-mode (default local), --timeout, --retries, --insecure, --ca-bundle, --clock-skew, --dry-run, --quiet, --verbose, --log-format, --systemd, --oneshot, --config, --version) with precedence flags > env KRL_CLIENT_* > /etc/krl-client/config.yaml > defaults. Enforce required fields and mutually-exclusive flags (--quiet/--verbose, --insecure/--ca-bundle). Map every failure class to the documented exit codes (0..10). No secrets on argv.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Configuration resolves with documented precedence (a flag overrides the same env var, which overrides the config file, which overrides the built-in default), verified for at least server-url, host-id, and host-key
- [ ] #2 --host-id defaults to the host FQDN, and required combinations are enforced (local mode without --host-key fails fast with exit 1 and a clear message)
- [ ] #3 Each terminal condition returns its documented exit code (updated/up-to-date=0, network=2, decrypt=3, verify=4, expired=5, host-mismatch=6, install=7, version/anti-rollback=8, not-provisioned/disabled=9, rate-limited=10)
<!-- AC:END -->
