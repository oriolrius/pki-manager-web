---
id: decision-014
title: SSH Milestone Base Branch and Reuse Inventory
date: '2026-06-29 17:20'
status: Accepted
---
## Context

The SSH Certificate Manager milestone (doc-006) was designed against an assumed baseline that
"reuses" a CRL-signing seam and the k8s cluster / external-issuer machinery. That assumption had
to be verified, not trusted, before any SSH code is written or any migration is numbered — a wrong
base would make every "reuse"/"generalise" claim reference absent code and would collide on
migration numbers. SSH-00 (TASK-116) is that verification.

## Decision

**Base branch:** build the SSH milestone on `ssh-cert-manager` (this worktree, forked from
`main` at `3f95581`; HEAD confirmed a descendant of `origin/main`). The milestone AUTHORS the
raw-signing seam and the automation fleet-token stack FROM SCRATCH — it does not generalise code
that does not exist on this base.

**Verified migration head:** `0003_restore_key_algorithm` is the current head in
`backend/src/db/migrations/meta/_journal.json` (files `0000`–`0003` present). The first SSH
migration is therefore `0004`, but every SSH migration task references "the next sequential
migration after the verified head" and re-derives it from `_journal.json` at branch-cut — the
number is never hard-coded, because a different chosen base (e.g. one carrying the cluster work)
would have a different head.

**Reuse inventory** (verified by grep/ls on this branch — see SSH-00 acceptance):

| Component the design names as "reused" | State on this base | Consequence |
|---|---|---|
| `kmsService.signRaw()` raw-signing seam | **ABSENT** (`grep signRaw backend/src/kms` → none) | SSH-03 AUTHORS it (first consumer). |
| CRL signing implementation | **ABSENT** — `crl.service.ts:156` is `const crlPem = ''` (placeholder) | SSH does not depend on it; CRL may later adopt `signRaw`. |
| `clusters` table | **ABSENT** (`schema.ts` has only `certificate_authorities`, `certificates`, `crls`, `audit_log`) | SSH-19 builds its own fleet-token table. |
| `cluster.service.ts` / cluster-auth middleware | **ABSENT** | SSH-19 builds the auth stack from scratch. |
| `external.routes.ts` (k8s external issuer) | **ABSENT** | SSH-19 authors `ssh-external.routes.ts`. |
| Public bare-bytes serving route (`/crl`) ETag/304/lazy-regen | partial — a `/crl` route exists but has **no** ETag/304/lazy-regen (503s when empty) | SSH-22 authors that behaviour as NEW scope, not a "mirror". |
| Decision `decision-010` (CRL signing) | **not committed** on this branch (untracked only) | SSH decisions take 011–014; slot 010 left free. |

## Consequences

- Downstream tasks must not assert reuse of absent code; SSH-03 (signRaw) and SSH-19 (fleet
  tokens) are framed as net-new, security-critical authoring tasks.
- Migration numbering is journal-derived at integration time; SSH-05…SSH-09 say "next after the
  verified head", currently `0004`.
- If the k8s cluster/external-issuer branch later merges in, the SSH fleet-token model (SSH-19)
  and the cluster-token model can be unified as a follow-up; this milestone does not block on it.
- The KMS-signing decision is settled separately and empirically in **decision-011** (the
  SSH-SENS spike), which this task unblocked.

## Related tasks

- TASK-116 (SSH-00) — this verification. **Done.**
- All SSH migration tasks (TASK-122…126) — reference the journal-verified head, not a literal.
- decision-011 — the signing-path decision SSH-00 gated.
