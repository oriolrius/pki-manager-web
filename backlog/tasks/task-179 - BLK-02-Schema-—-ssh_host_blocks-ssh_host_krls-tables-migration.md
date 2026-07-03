---
id: TASK-179
title: 'BLK-02: Schema — ssh_host_blocks + ssh_host_krls tables (+ migration)'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:24'
updated_date: '2026-07-03 22:35'
labels:
  - ssh-host-blocks
  - backend
  - schema
milestone: SSH Host Access Blocks
dependencies:
  - TASK-191
references:
  - backlog/decisions/decision-016 - Per-Host-User-Access-Blocks-SSH.md
priority: medium
ordinal: 6014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New tables per the decision-016 data model, with EXPLICIT columns (not a blind mirror of ssh_krls).

ssh_host_blocks: id, host_id FK -> ssh_hosts ON DELETE RESTRICT, identity_id FK -> ssh_identities ON DELETE RESTRICT, reason, status in {active,lifted}, created_by/created_at, lifted_by/lifted_at. PARTIAL-UNIQUE (host_id, identity_id) WHERE status='active' — follow the existing uq_ssh_cas_active_type pattern (schema.ts:243-248) — so lifted rows are kept for audit and re-block-after-lift works.

ssh_host_krls: id, host_id FK RESTRICT, krl_number, version_hash, krl_blob, ca_signature (nullable), this_update, next_update, revoked_count, block_count (mandated by decision-016 — ssh_krls has only revoked_count), created_at. UNIQUE index on (host_id, krl_number) — uniqueIndex(), NOT index() like idx_ssh_krls_ca_number (schema.ts:434) — kept as a tripwire behind the allocator. Index on version_hash.

ssh_krl_seq: single-row global KRL-number allocator (id=1, value integer) shared by BOTH lineages (per-CA and per-host). The migration seeds it: INSERT INTO ssh_krl_seq VALUES (1, COALESCE((SELECT MAX(krl_number) FROM ssh_krls), 0)). Allocation is one atomic statement (UPDATE ... SET value = value + 1 RETURNING value — better-sqlite3 is synchronous single-writer, so this cannot race). Rationale vs max()+1: immune to future pruning of old KRL rows (a max()-based allocator regresses the day krl_blob cleanup lands → client rejects as rollback); no 2-table scan; and one shared number space makes cutover AND switch-back monotonic by construction (pinned req #4). Gaps from failed generations are harmless — the client only requires strictly-newer.

Migration number = next after current head read from meta/_journal.json.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Both tables migrate up cleanly from head; pnpm db:generate && pnpm db:migrate green; Drizzle types exported
- [x] #2 UNIQUE (host_id, krl_number) proven by a duplicate-insert test
- [x] #3 Partial-unique on active (host_id, identity_id): second active block rejected; block -> lift -> re-block succeeds and keeps the lifted row
- [x] #4 FKs ON DELETE RESTRICT verified: host/identity rows cannot be hard-deleted while referenced by blocks or host KRLs
- [x] #5 ssh_krl_seq exists, seeded from max(ssh_krls.krl_number); allocation via atomic UPDATE...RETURNING proven monotonic under parallel calls
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add ssh_host_blocks, ssh_host_krls (uniqueIndex host_id+krl_number), ssh_krl_seq to schema.ts
2. pnpm db:generate; append allocator seed INSERT to the migration; pnpm db:migrate
3. Allocator helper (atomic UPDATE...RETURNING) in src/db/krl-seq.ts
4. Schema tests: dup-insert, partial-unique block lifecycle, FK RESTRICT, allocator monotonic under parallel calls
<!-- SECTION:PLAN:END -->
