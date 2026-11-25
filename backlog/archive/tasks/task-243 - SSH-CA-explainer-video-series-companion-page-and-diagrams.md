---
id: TASK-243
title: 'SSH CA explainer: video series, companion page and diagrams'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T16:11:00Z'
updated_date: '2026-11-23T19:45:00Z'
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
- [x] #1 A validated English script covers every episode: why certificates, two CAs, host certs, user certs, principals, lifecycle/revocation, per-host blocks, zones, automation, recap/troubleshooting
- [x] #2 Every PlantUML diagram uses one shared oriolrius.me theme and renders to SVG
- [x] #3 A companion HTML page explains every episode with its diagrams and links to the clips
- [x] #4 Content matches the current code (e.g. ECDSA P-256 host keys, 1-week user and 52-week host TTLs)
- [x] #5 Each episode renders to an MP4 with narration in a female native-English voice (VoiceStudio dbai24-narrator-vox48) and matching subtitles from a self-contained build in the repo
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- 10-episode script (Fable-reviewed vs code), 16 PlantUML diagrams (oriolrius.me theme), companion index.html
- Self-contained engine in docs/ssh/explainer/video (local TTS + CPU ASR check, SVG scenes, Playwright+ffmpeg, soft subs, chapters)
- Female native-English voice (dbai24-narrator-vox48); 10 MP4s, ~15 min, 41 MB in docs/ssh/explainer/media (gitignored, publishing pending)
- Doc fixes: ECDSA host keys, missing RevokedKeys behaviour
- UI gaps (identity Offboard, Fleet tokens page) built on feat/ssh-ui-offboard-and-tokens (TASK-244)

- Series 2 "Principals in depth" (episodes 11-19, ~11 min, 33 MB): script-principals.md (Fable + Astra reviewed), 9 diagrams, scenes, female voice, rendered to media/
- principals-guide.md corrected (u:<name> invalid, OR semantics, Key ID + serial + CA traceability, four levers)
- Product gaps fixed on feat/ssh-principal-gaps (TASK-245..249); TASK-250 (Ansible role calls principals-pushed) open
<!-- SECTION:NOTES:END -->
