---
id: TASK-183
title: >-
  BLK-06: Serving cutover — ECIES payload from ssh_host_krls + public per-host
  endpoints
status: To Do
assignee: []
created_date: '2026-07-03 21:25'
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

FIRST FETCH / CUTOVER: when NO per-host row exists (every already-enrolled host at cutover), synchronously generate the first composed KRL — seeded per BLK-03 global numbering, so it always exceeds any per-CA number the host has installed. If that first generation FAILS, fall back to serving the host's per-CA row so the fleet is never 503d at the riskiest moment — but ONLY while no per-host row has EVER existed for that host (afterwards a per-CA number would be rejected as rollback); enforce and test both sides. After the first row exists, generation failure serves last-good per-host (existing pattern).

Cutover is env-gated: SSH_HOST_KRL_SERVE (default ON; the off-switch is SAFE because BLK-03 numbering is globally monotonic — per-CA rows generated after per-host rows still carry higher numbers; runbook in BLK-12).

Public GET /krl/hosts/:hostId.bin|.json beside /krl/:caId.bin with identical ETag / lazy-regen / last-good / rate-limit semantics, env-gated SSH_HOST_KRL_PUBLIC default OFF (leaks per-host deny intel unauthenticated). Per-CA endpoints stay for block-free/legacy hosts. .env.example updated. Builds on the BLK-01 fix in the same route.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ECIES serves the per-host row; 200/304/telemetry semantics unchanged (contract tests); payload fields byte-compatible for existing pullers
- [ ] #2 First-fetch with empty ssh_host_krls generates + serves a seeded row; first-generation failure falls back to the per-CA row only pre-first-row; post-first-row failure serves last-good per-host
- [ ] #3 SSH_HOST_KRL_SERVE=false serves per-CA (documented); SSH_HOST_KRL_PUBLIC default OFF; when ON, per-host public endpoints have ETag/lazy-regen/last-good/rate-limit parity
- [ ] #4 ed25519-only / unregistered-ECIES hosts unchanged (ECIES_KEY_UNSUPPORTED path intact)
<!-- AC:END -->
