---
id: TASK-184
title: 'BLK-07: Host KRL state derivation + per-host ssh-mon metrics'
status: To Do
assignee: []
created_date: '2026-07-03 21:26'
labels:
  - ssh-host-blocks
  - backend
  - telemetry
milestone: SSH Host Access Blocks
dependencies:
  - TASK-178
  - TASK-180
  - TASK-181
  - TASK-183
references:
  - backend/src/services/ssh-mon.service.ts
priority: medium
ordinal: 11014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Derive the per-host distribution state from existing telemetry (ssh_hosts.last_krl_version stamped on ECIES 200; last_krl_fetch_at trustworthy after BLK-01):
- Effective: last_krl_version === current per-host version_hash
- Pending: block awaiting the post-block version to land
- Lifting: after unblock, until the post-lift version lands (needs BLK-04 lift events) — the admin never tells a user access is restored while the host still enforces the old KRL
- Unknown / unenforceable — PINNED derivation rule (server-side inferable, public per-CA fetches are anonymous): the host has NO usable ECIES registration (opensshHostPubkey null or ECIES-unsupported key type) => blocks cannot land via ECIES.
- Distinct cause when the latest per-host KRL is UNSIGNED (KMS signRaw failed): signature-requiring krl-client hosts keep last-good and reject the fresh row — surfaced, never silent (feeds the BLK-09 tooltip/pill and BLK-12 docs).

Tooltips stay honest: Effective means "ciphertext served to the host puller at <time>", NOT confirmation of install.

Extend SshMonService (ssh-mon.service.ts:36-58): per-host lineage metrics (hostKrlsPastNextUpdate, hostsWithoutHostKrl) beside the per-CA ones — after the BLK-06 cutover, per-CA staleness alone is misleading since hosts install the per-host artifact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 State function unit-tested for Effective/Pending/Lifting/Unknown + the Lifting transition + the unsigned-latest cause
- [ ] #2 Unknown rule pinned to ECIES-registration absence and tested
- [ ] #3 ssh-mon exposes hostKrlsPastNextUpdate + hostsWithoutHostKrl with tests; stalePullingHosts remains accurate for 304-only pullers (BLK-01)
<!-- AC:END -->
