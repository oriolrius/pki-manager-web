---
id: TASK-183
title: >-
  BLK-06: Serving cutover — ECIES payload from ssh_host_krls + public per-host
  endpoints
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:25'
updated_date: '2026-07-03 22:56'
labels:
  - ssh-host-blocks
  - backend
  - api
milestone: SSH Host Access Blocks
dependencies:
  - TASK-178
  - TASK-180
  - TASK-182
references:
  - backend/src/rest/routes/ssh-external.routes.ts
priority: high
ordinal: 10014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ECIES POST /api/v1/external/ssh/krl switches its payload source to the freshest ssh_host_krls row — envelope, valid_until, 304, and telemetry stamping unchanged; host_puller.sh, the 15-min timer, and the sshd drop-in stay byte-identical (zero host-side changes).

FIRST FETCH / CUTOVER: when NO per-host row exists (every already-enrolled host at cutover), synchronously generate the first composed KRL — seeded per BLK-03 global numbering, so it always exceeds any per-CA number the host has installed. If that first generation FAILS, respond with the existing not-initialized error (NO_KRL-style; krl-client "not provisioned" exit-9 semantics) — NO per-CA fallback (decided by Oriol 2026-07-03: simpler is fine; pullers keep last-good and retry on the next interval). After the first row exists, generation failure serves last-good per-host (existing pattern).

Cutover is env-gated: SSH_HOST_KRL_SERVE (default ON; the off-switch is SAFE because BLK-03 numbering is globally monotonic — per-CA rows generated after per-host rows still carry higher numbers; runbook in BLK-12).

Public GET /krl/hosts/:hostId.bin|.json beside /krl/:caId.bin with identical ETag / lazy-regen / last-good / rate-limit semantics, env-gated SSH_HOST_KRL_PUBLIC default OFF (leaks per-host deny intel unauthenticated). Per-CA endpoints stay for block-free/legacy hosts. .env.example updated. Builds on the BLK-01 fix in the same route.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ECIES serves the per-host row; 200/304/telemetry semantics unchanged (contract tests); payload fields byte-compatible for existing pullers
- [ ] #2 SSH_HOST_KRL_SERVE=false serves per-CA (documented); SSH_HOST_KRL_PUBLIC default OFF; when ON, per-host public endpoints have ETag/lazy-regen/last-good/rate-limit parity
- [ ] #3 ed25519-only / unregistered-ECIES hosts unchanged (ECIES_KEY_UNSUPPORTED path intact)
- [ ] #4 First-fetch with empty ssh_host_krls synchronously generates + serves a seeded row; generation failure returns the not-initialized/NO_KRL error (no per-CA fallback — pullers fail-stale on last-good and retry); post-first-row failure serves last-good per-host
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ECIES /krl: SSH_HOST_KRL_SERVE gate (default ON) -> freshest ssh_host_krls row; first-fetch sync generate, failure -> NO_KRL (no per-CA fallback); stale regen keeps last-good; envelope/304/telemetry unchanged
2. Public GET /krl/hosts/:hostId.bin|.json gated SSH_HOST_KRL_PUBLIC (default OFF) with ETag/lazy-regen/last-good/rate-limit parity
3. .env.example; adjust BLK-01 test to pin legacy branch
4. Contract tests: first-fetch, NO_KRL, last-good, gate off->per-CA, ECIES_KEY_UNSUPPORTED intact, public endpoints
<!-- SECTION:PLAN:END -->
