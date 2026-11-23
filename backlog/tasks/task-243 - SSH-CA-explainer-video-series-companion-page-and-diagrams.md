---
id: TASK-243
title: 'SSH CA explainer: video series, companion page and diagrams'
status: To Do
assignee: []
created_date: '2026-11-23T16:11:00Z'
labels:
  - docs
  - ssh
dependencies: []
ordinal: 70014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sysadmins who know Linux but not SSH certificates need a visual, step-by-step explanation of how the SSH CA works and how to operate it with PKI Manager. Deliver a short video series (vector animation, English, Oriol's voice), a companion HTML page and PlantUML diagrams in oriolrius.me colours, all under docs/ssh/explainer/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A validated English script covers every episode: why certificates, two CAs, host certs, user certs, principals, lifecycle/revocation, per-host blocks, zones, automation, recap/troubleshooting
- [ ] #2 Every PlantUML diagram uses one shared oriolrius.me theme and renders to SVG
- [ ] #3 Each episode renders to an MP4 with narration in the oriol-en voice and matching subtitles from a self-contained build in the repo
- [ ] #4 A companion HTML page explains every episode with its diagrams and links to the clips
- [ ] #5 Content matches the current code (e.g. ECDSA P-256 host keys, 1-week user and 52-week host TTLs)
<!-- AC:END -->
