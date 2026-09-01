---
id: TASK-231
title: Add Codex project guidance
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-01 08:13'
updated_date: '2026-09-01 08:13'
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
- [ ] #1 Codex receives current repository-wide architecture, commands, and workflow guidance from AGENTS.md
- [ ] #2 Codex receives subsystem-specific guidance when working in backend, frontend, or k8s/issuer
- [ ] #3 Claude Code guidance remains available and Codex guidance does not conflict with the Backlog CLI workflow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review existing Claude Code guidance and repository tooling
2. Add concise repository and subsystem AGENTS.md guidance for Codex
3. Verify instruction consistency and preserve the Backlog CLI workflow
<!-- SECTION:PLAN:END -->
