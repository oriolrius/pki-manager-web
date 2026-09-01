---
id: TASK-231
title: Add Codex project guidance
status: Done
assignee:
  - '@codex'
created_date: '2026-09-01 08:13'
updated_date: '2026-09-01 08:16'
labels:
  - tooling
  - documentation
dependencies: []
ordinal: 58014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the repository equally usable with Codex by providing current, scoped AGENTS.md instructions alongside the existing Claude Code guidance and Backlog workflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Codex receives current repository-wide architecture, commands, and workflow guidance from AGENTS.md
- [x] #2 Codex receives subsystem-specific guidance when working in backend, frontend, or k8s/issuer
- [x] #3 Claude Code guidance remains available and Codex guidance does not conflict with the Backlog CLI workflow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review existing Claude Code guidance and repository tooling
2. Add concise repository and subsystem AGENTS.md guidance for Codex
3. Verify instruction consistency and preserve the Backlog CLI workflow
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added a repository-level AGENTS.md introduction for Codex with project layout, commands, engineering boundaries, and the existing Backlog CLI workflow.

- Added scoped Codex instructions in backend/, frontend/, and k8s/issuer/.
- Retained all CLAUDE.md files and added a root synchronization note.
- Verified documented issuer Make targets and ran git diff --check.
- No runtime tests were needed because this change only adds agent guidance.
<!-- SECTION:NOTES:END -->
