---
id: TASK-253
title: Integrate the SSH CA explainer into the site
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T09:33:00Z'
labels:
  - docs
milestone: m-0
dependencies:
  - TASK-251
ordinal: 73014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The SSH CA work (19 videos on the public YouTube playlist, 25 PlantUML diagrams, companion page, principals guide, setup and runbooks) becomes the SSH certificates section of the site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SSH section embeds the 19 videos from the YouTube playlist with their subtitles
- [x] #2 PlantUML diagrams are rendered at build time from docs/ssh/explainer/diagrams
- [x] #3 Companion page content, principals guide and SSH runbooks are reachable from the SSH section
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- /ssh/videos/ (src/pages/ssh/videos.astro) renders the <main> of docs/ssh/explainer/index.html: single source. Local MP4 players become YouTube embeds (youtube-nocookie, cc_load_policy=1, English) from docs/ssh/explainer/youtube.json; ToC from episode headings.
- scripts/plantuml.mjs renders the 25 diagrams at build time (-failfast2); CI pins PlantUML 1.2026.9.
- SSH sidebar: videos page, concept, quickstart, setup, deploy guide, principals guide, zones, per-host blocks runbook, Ansible role, external API contract.
<!-- SECTION:NOTES:END -->
