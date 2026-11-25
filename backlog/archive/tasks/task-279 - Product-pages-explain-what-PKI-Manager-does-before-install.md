---
id: TASK-279
title: Product pages explain what PKI Manager does before install
status: Done
assignee:
  - '@claude'
created_date: '2026-11-25T10:07:00Z'
updated_date: '2026-11-25T10:54:00Z'
labels:
  - site
milestone: m-4
dependencies: []
ordinal: 99014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A visitor must understand what the product does and how it does it without installing anything, and must see that it is a personal project with no commercial interest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The site home explains what PKI Manager is and links to features, how it works, docs and source
- [x] #2 A features page shows each capability with a real screenshot of the current release
- [x] #3 A how-it-works page shows the components and where private keys live
- [x] #4 An about page states that the project is personal, built for the owner's own use, with no commercial interest
- [x] #5 Every statement on the product pages is true for the documented release
- [x] #6 Product pages work in light and dark mode and at phone width
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Product pages on the site, written as Markdown in `docs/`.

- `docs/index.md` (home), `docs/features/*.md` (8 pages + index), `docs/how-it-works.md`, `docs/about.md`, shown with a product layout (`site/src/layouts/Product.astro`).
- Each feature page: what you can do, how it works, what it does not do. Every statement was checked against the 3.17.0 source and, for the main ones, on a 3.17.0 demo stack.
- Screenshots: `site/demo/shots/10-product.spec.ts` seeds the demo stack through the API and writes `docs/features/img/`.
- The about page, the home page, the project card and every footer state that this is a personal project with no commercial interest.
- Checked in light and dark mode, at 1440 px and 390 px, with no horizontal scroll.
<!-- SECTION:NOTES:END -->
