---
id: TASK-254
title: Reproducible demo stack and screenshot/screencast pipeline
status: To Do
assignee: []
created_date: '2026-11-24T09:15:00Z'
labels:
  - docs
milestone: m-1
dependencies: []
priority: high
ordinal: 74014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A seed script fills a local stack with realistic, fake demo data. A Playwright spec (extending tests/screenshots.spec.ts) captures the screenshots and short screencasts the guides use, so they can be regenerated after each UI change. Never capture prod data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One command starts a clean stack, seeds demo data and regenerates all doc screenshots
- [ ] #2 Screencasts are short (under 60 s) WebM/MP4 clips with no audio
- [ ] #3 No screenshot shows real names, emails, hosts or keys
<!-- AC:END -->
