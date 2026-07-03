---
id: TASK-177
title: 'BLK-00: Milestone baseline — fleet/puller inventory + preconditions pinned'
status: To Do
assignee: []
created_date: '2026-07-03 21:23'
labels:
  - ssh-host-blocks
  - docs
milestone: SSH Host Access Blocks
dependencies: []
references:
  - backlog/decisions/decision-016 - Per-Host-User-Access-Blocks-SSH.md
priority: medium
ordinal: 4014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Baseline task (doc-006 SSH-00 pattern) for the SSH Host Access Blocks milestone (decision-016, doc-008).
Pin the verified starting state the correctness-critical tasks depend on:
1. Base branch feat/ssh-host-blocks off main; migration head read from backend/src/db/migrations/meta/_journal.json (0007_ssh_fleet_tokens at authoring time — never hard-code numbers).
2. Fleet preconditions load-bearing for pinned req #4: all deployed pullers must run post-TASK-175 krl-client (anti-rollback = strict monotonic check on the CA-signed KRL header number, payload.go:120-124) or host_puller.sh (sha256-equality only). Inventory which hosts run which client and the trust anchor each verifies KRL signatures against (krl-client default --ca-pubkey /etc/ssh/ssh-user-ca.pub = USER CA vs host_puller.sh CA_PUBLIC_KEY_ID = Host CA) — direct input to BLK-10 trust-anchor reconciliation.
3. Per-CA ssh_krls.krl_number high-water marks per lineage — inputs to BLK-03 global-monotonic seeding and the BLK-11 cutover test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 doc-008 records base branch + migration head (from _journal.json) + the krl-client >= TASK-175 fleet precondition
- [ ] #2 Puller inventory documented: client type per host + trust-anchor path/value each verifies KRL signatures against
- [ ] #3 Per-CA krl_number high-water marks recorded as cutover-test inputs
<!-- AC:END -->
