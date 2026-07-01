---
id: TASK-167
title: 'KRLC-09: Structured logging + run observability'
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-166
priority: medium
ordinal: 9
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/logx over log/slog: --log-format text (human, default) or json; verbosity via --quiet (warn+ only, cron-friendly) and --verbose (debug); --systemd forces json/no-ANSI. Emit exactly one structured summary event per run carrying outcome (up_to_date|updated|error), http_status, krl_version, host_id, and exit_code, plus per-step debug events. Redact secret fields (never log key material or the full ciphertext).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --log-format json emits parseable JSON (each line a valid object) with a single summary event including outcome, http_status, krl_version, host_id, and exit_code for the run
- [ ] #2 --quiet suppresses info/debug (only warnings/errors surface) while --verbose adds per-step debug; --systemd implies json output with no ANSI escapes
- [ ] #3 Secrets are never emitted: key material and raw ciphertext do not appear at any log level (verified by scanning captured output)
<!-- AC:END -->
