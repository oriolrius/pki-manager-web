---
id: TASK-243
title: 'SSH CA explainer: video series, companion page and diagrams'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T16:11:00Z'
updated_date: '2026-11-23T17:24:00Z'
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
- [ ] #3 A companion HTML page explains every episode with its diagrams and links to the clips
- [ ] #4 Content matches the current code (e.g. ECDSA P-256 host keys, 1-week user and 52-week host TTLs)
- [ ] #5 Each episode renders to an MP4 with narration in a female native-English voice (VoiceStudio dbai24-narrator-vox48) and matching subtitles from a self-contained build in the repo
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify facts against code and docs/ssh
2. Write English script per episode (narration + visuals)
3. Independent Fable review for accuracy and clarity; fix
4. User validates script
5. PlantUML theme + diagrams (SVG)
6. Self-contained vector video engine (SVG scenes -> Playwright frames -> ffmpeg), VoiceStudio oriol-en narration, SRT
7. Companion index.html
8. Render all episodes, review stills, commit
<!-- SECTION:PLAN:END -->
