---
id: TASK-166
title: 'KRLC-08: CLI/flags/config/env + documented exit codes'
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
updated_date: '2026-07-01 07:44'
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
Implement internal/config and wire main.go/internal/app with a full flag set whose ON-HOST DEFAULTS ARE DERIVED FROM the backend canonical path constants in backend/src/services/ssh-config.ts (the single source of truth for on-host paths), so the client, the generated 60-ssh-ca.conf sshd drop-in, and the Ansible role never disagree. Path defaults: --host-key /etc/ssh/ssh_host_ecdsa_key (the host's existing ECDSA SSH host key = hostKeyPathFor('ecdsa-sha2-nistp256'), reused as the ECIES key), --ca-pubkey /etc/ssh/ssh-user-ca.pub (USER_CA_PATH / TrustedUserCAKeys, already deployed to the host), --krl-file /etc/ssh/revoked_keys (REVOKED_KEYS_PATH), --host-id `hostname -f`. Other flags: --server-url (required), --allow-unsigned, --state-dir /var/lib/krl-client, --decrypt-mode local, --timeout 30s, --retries 3, --insecure, --ca-bundle, --clock-skew 300s, --dry-run, --quiet/--verbose, --log-format text|json, --systemd, --oneshot, --config /etc/krl-client/config.yaml, --version. Precedence: flags > env KRL_CLIENT_* > config file > defaults. Enforce required fields + mutually-exclusive flags. Map every failure to the documented exit codes (0..10); no secret ever on argv. Net effect: a host provisioned from pki-manager's generated 60-ssh-ca.conf needs only --server-url.
<!-- SECTION:DESCRIPTION:END -->
