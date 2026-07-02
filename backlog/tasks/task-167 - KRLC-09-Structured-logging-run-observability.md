---
id: TASK-167
title: 'KRLC-09: Structured logging + run observability'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 15:25'
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
- [x] #1 --log-format json emits parseable JSON (each line a valid object) with a single summary event including outcome, http_status, krl_version, host_id, and exit_code for the run
- [x] #2 --quiet suppresses info/debug (only warnings/errors surface) while --verbose adds per-step debug; --systemd implies json output with no ANSI escapes
- [x] #3 Secrets are never emitted: key material and raw ciphertext do not appear at any log level (verified by scanning captured output)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. internal/logx: slog-based logger builder (text|json handler, quiet=warn/verbose=debug/default=info levels, injectable io.Writer, no ANSI)
2. krlclient.Result: add Status int (200/304) so the summary can report http_status
3. internal/app/run.go: build logger from cfg; accumulate a run summary struct; emit exactly ONE run_summary event (Info on up_to_date|updated, Error on failure) carrying outcome/http_status/krl_version/host_id/exit_code(+dry_run); per-step Debug events with only redacted metadata (lengths), never key/ciphertext/plaintext
4. Tests: logx_test.go (levels/format/JSON-parseable/no-ANSI) and app/run_test.go (304 up_to_date summary, error summary, quiet suppresses info, verbose adds debug, full happy-path decrypt+install with output scanned for secrets)
5. README: document logging/observability + the run_summary schema
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented internal/logx over log/slog and wired structured observability into the run pipeline.

**internal/logx**: Options{Format,Quiet,Verbose,Writer} -> *slog.Logger. Level() maps --quiet->Warn, default->Info, --verbose->Debug (quiet wins if both). text|json handlers; neither emits ANSI (satisfies --systemd no-ANSI, which also forces json at the config layer, already present from KRLC-08).

**internal/app/run.go**: builds the logger from cfg and accumulates a `summary` struct across the pipeline, emitting exactly ONE `run_summary` event per run — INFO on up_to_date|updated (suppressed by --quiet), ERROR on failure (always surfaces). Fields: outcome, http_status, krl_version, krl_number, host_id, dry_run, exit_code (+error on failure). Per-step DEBUG events (fetch/decrypt/validate/verify/install) carry only redacted metadata (byte lengths, versions) — never key material, ciphertext, or plaintext.

**krlclient.Result**: added Status int (200/304) so the summary reports http_status.

**Tests**: internal/logx/logx_test.go (level selection, quiet/verbose gating, JSON-parseable, no-ANSI, text default); internal/app/run_test.go (full happy-path decrypt+verify+install with output scanned for plaintext/base64-KRL/ciphertext/host-key = AC#3; 304 up_to_date summary; error summary surfaces under --quiet; quiet silent on success + verbose adds steps). 65 tests pass, go vet clean, gofmt clean. README documents the logging matrix + run_summary schema.

No change to main.go (app.Run signature unchanged).
<!-- SECTION:NOTES:END -->
