---
id: TASK-167
title: 'KRLC-09: Structured logging + run observability'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 15:21'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. internal/logx: slog-based logger builder (text|json handler, quiet=warn/verbose=debug/default=info levels, injectable io.Writer, no ANSI)
2. krlclient.Result: add Status int (200/304) so the summary can report http_status
3. internal/app/run.go: build logger from cfg; accumulate a run summary struct; emit exactly ONE run_summary event (Info on up_to_date|updated, Error on failure) carrying outcome/http_status/krl_version/host_id/exit_code(+dry_run); per-step Debug events with only redacted metadata (lengths), never key/ciphertext/plaintext
4. Tests: logx_test.go (levels/format/JSON-parseable/no-ANSI) and app/run_test.go (304 up_to_date summary, error summary, quiet suppresses info, verbose adds debug, full happy-path decrypt+install with output scanned for secrets)
5. README: document logging/observability + the run_summary schema
<!-- SECTION:PLAN:END -->
