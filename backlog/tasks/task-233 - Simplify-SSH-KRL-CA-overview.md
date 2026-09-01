---
id: TASK-233
title: Simplify SSH KRL CA overview
status: To Do
assignee: []
created_date: '2026-09-01 14:12'
labels: []
dependencies: []
ordinal: 60014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Present KRL capabilities as separate, compact User CA and Host CA lists while retaining the existing per-CA KRL management functions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User CAs and Host CAs are shown in separate simple KRL lists
- [ ] #2 Each CA list entry exposes its current KRL state and opens the existing management functions
- [ ] #3 KRL generation, all revocation modes, revocation history, and host distribution remain available
- [ ] #4 Frontend typecheck, lint, and relevant tests pass
<!-- AC:END -->
