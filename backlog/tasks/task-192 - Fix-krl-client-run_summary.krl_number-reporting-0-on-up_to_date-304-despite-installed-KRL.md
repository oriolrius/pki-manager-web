---
id: TASK-192
title: >-
  Fix krl-client run_summary.krl_number reporting 0 on up_to_date (304) despite
  installed KRL
status: Done
assignee:
  - '@myself'
created_date: '2026-07-05 00:53'
updated_date: '2026-07-08 11:54'
labels:
  - bug
  - krl-client
  - observability
dependencies: []
references:
  - krl-client/internal/app/run.go
  - krl-client/README.md
priority: low
ordinal: 19014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
krl-client emits `krl_number=0` in its single `run_summary` event on an `up_to_date` (HTTP 304) run even though a KRL IS installed on the host. The README ("Logging & observability") documents the field as "monotonic anti-rollback number read from the signed KRL header (0 when nothing is installed)", so a 304 reporting 0 is self-contradictory: it reads as "unprovisioned / nothing installed" when the host is actually current and holding KRL #N.

Root cause — internal/app/run.go: the summary field `krlNumber` (declared run.go:63) is set ONLY on the 200 path at run.go:143 (`s.krlNumber = p.Number`, after decrypt+parse). The 304 branch short-circuits earlier at run.go:118 (`if res.NotModified { s.outcome = outcomeUpToDate; return exitcodes.OK }`) before krlNumber is populated, so it keeps its int64 zero value and emit() (run.go:182) logs 0. The installed number is already available: state.Read(cfg.StateDir) is loaded at run.go:102 and `st.Number` holds the persisted installed KRL header number.

Impact — observability only; no behavior or security effect. But a monitoring pipeline keying off run_summary.krl_number sees 0 on every steady-state (304) poll — the common case for a healthy 15-min puller — indistinguishable from a genuinely unprovisioned host, causing false "not installed" alerts or masking real staleness.

Repro (found while building the ssh-cert-test Layer-2 block lab): a control host that legitimately received a 304 reported `krl_number=0` while actually holding KRL #3 — verified via /var/lib/krl-client/state.json ("krl_number": 3) and the decoded /etc/ssh/revoked_keys header (# = 3).

Fix — populate `s.krlNumber` from `st.Number` right after state load (run.go:102), so every terminal path (304 / updated / error) reports the last-known installed number, overwritten by `p.Number` on a successful install. Reconcile the README field doc accordingly (0 iff nothing is installed).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On an up_to_date (304) run with a KRL installed, run_summary.krl_number equals the installed KRL header number (from state), not 0
- [x] #2 On a fresh host with nothing installed, run_summary.krl_number is still 0
- [x] #3 README "run_summary" krl_number field doc reconciled with the behavior
- [x] #4 A test covers the 304 path asserting the installed number is reported
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. In run.go, set s.krlNumber = st.Number immediately after state.Read (run.go:102) so every terminal path reports the last-known installed number; the 200 path still overwrites with p.Number on install.
2. Update README run_summary.krl_number description.
3. Add/extend a test in internal/app/run_test.go for the 304 branch asserting krl_number == installed state number.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in krl-client/internal/app/run.go: seed s.krlNumber = st.Number right after state.Read (before the 304 short-circuit); the 200 install path still overwrites with p.Number. Now every terminal path (304 up_to_date / error) reports the last-known installed KRL header number; 0 iff nothing installed. README run_summary.krl_number doc reconciled. Tests: extended TestRunUpToDate304 to assert krl_number==5 (installed, on a 304) and TestRunErrorSummarySurfacesUnderQuiet to assert krl_number==0 (fresh host). go build + go test ./internal/app/ green (15 passed).
<!-- SECTION:NOTES:END -->
