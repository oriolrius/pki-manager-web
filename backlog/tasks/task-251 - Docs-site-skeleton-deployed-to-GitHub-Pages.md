---
id: TASK-251
title: Docs site skeleton deployed to GitHub Pages
status: To Do
assignee: []
created_date: '2026-11-24T09:15:00Z'
labels:
  - docs
milestone: m-0
dependencies: []
priority: high
ordinal: 71014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Static docs site (recommended: Astro Starlight, it fits the pnpm workspace and has built-in search) in docs/site, styled with the oriolrius.me palette and Ubuntu fonts, built and deployed to GitHub Pages by a GitHub Actions workflow. English only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Site is public at the GitHub Pages URL of oriolrius/pki-manager-web
- [ ] #2 A push to main rebuilds and redeploys the site; a PR build fails on broken internal links
- [ ] #3 Navigation has: Get started, Guides, SSH certificates, Operations, API reference
<!-- AC:END -->
