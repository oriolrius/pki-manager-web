---
id: TASK-176
title: 'krl-client: warn at runtime when TLS verification is disabled (insecure)'
status: Done
assignee: []
created_date: '2026-07-02 16:43'
updated_date: '2026-07-02 17:01'
labels:
  - ssh-cert-manager
  - krl-client
  - security
dependencies: []
ordinal: 3014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-release security review (v3.4.0): 'insecure' (TLS verification off) is accepted from the root-owned config file and env (configfile.go:14) with no runtime warning when active, so an operator can silently run without TLS verification. Low severity. Emit a prominent warning (structured log at WARN) on every run whenever insecure is in effect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When TLS verification is disabled (insecure via flag/env/config), the client emits a WARN-level log on every run stating verification is off
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
run.go execute() now emits a WARN (event=insecure_tls) on every cycle when cfg.Insecure is set, before the pipeline runs. Warn level so it surfaces even under --quiet (which keeps warnings+errors) — an operator can never silently run without verifying the server. Added TestInsecureTLSEmitsWarning (insecure+--quiet emits the warn; a verified run emits none) and documented the behaviour in README and the man page. Does not affect the single-run_summary contract (the warn is a separate advisory event). Full race suite green (82 tests).
<!-- SECTION:NOTES:END -->
