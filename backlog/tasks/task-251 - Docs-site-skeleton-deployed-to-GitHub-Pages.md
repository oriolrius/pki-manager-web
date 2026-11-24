---
id: TASK-251
title: Docs site skeleton deployed to GitHub Pages
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T09:33:00Z'
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
- [x] #1 Site is public at the GitHub Pages URL of oriolrius/pki-manager-web
- [x] #2 A push to main rebuilds and redeploys the site; a PR build fails on broken internal links
- [x] #3 Navigation has: Get started, Guides, SSH certificates, Operations, API reference
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Starlight site in docs/site (Node 24, npm)
2. oriolrius.me theme, sidebar sections
3. GitHub Actions build + Pages deploy, link check
4. Enable Pages, first deploy
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Site: https://oriolrius.github.io/pki-manager-web/ (Astro 7.4.7 + Starlight 0.42.10, Node 24 via docs/site/.nvmrc, npm).
- Theme: oriolrius.me palette and Ubuntu fonts (copied at build from the video engine fonts).
- Sidebar: Get started, Guides, SSH certificates, Operations, API reference. Pagefind search.
- .github/workflows/docs.yml: PRs build + scripts/check-links.mjs (fails on broken internal links/anchors); push deploys to Pages.
- Pages enabled with build_type=workflow; github-pages environment allows main and docs/site.
- First deploy ran from docs/site (run 45366047803). FOLLOW-UP after merge to main: remove docs/site from the push trigger and from the github-pages environment branch policy.
<!-- SECTION:NOTES:END -->
