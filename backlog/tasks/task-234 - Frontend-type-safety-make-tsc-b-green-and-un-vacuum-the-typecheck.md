---
id: TASK-234
title: 'Frontend type-safety: make tsc -b green and un-vacuum the typecheck'
status: To Do
assignee: []
created_date: '2026-09-09 04:55'
labels:
  - frontend
  - tech-debt
  - build
dependencies: []
ordinal: 61014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The frontend has ~100 accumulated TypeScript errors that no gate catches. Root causes: (1) 'npm run typecheck' is VACUOUS — frontend/tsconfig.json has files:[] so 'tsc --noEmit' checks nothing; (2) CI builds the image with 'vite build' (esbuild — strips types, no type-check), so nothing type-checks the frontend in the release path; (3) the only real gate, 'tsc -b' (via 'pnpm build'), is broken and was doubly-masked: first by 'erasableSyntaxOnly:true' in frontend/tsconfig.app.json + tsconfig.node.json (Vite react-ts template default) which makes the type-only backend AppRouter import fail with TS1294 on the backend's own enums/parameter-properties, and under that ~100 genuine app errors (certificates.$id.tsx ~48, cas.$id.tsx ~27, ssh.tsx ~9, index.tsx ~7, clusters/api-docs/config, etc). Fix plan: remove erasableSyntaxOnly from both frontend tsconfigs (frontend must type the backend, not police its syntax); make 'typecheck' actually check src (point it at tsconfig.app.json or use tsc -b); then work through the ~100 errors file by file; optionally wire tsc -b into CI so it can't regress. Discovered while shipping v3.12.0 (cert purge); pre-existing, unrelated to that feature.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm run typecheck (or the CI type gate) actually type-checks src/ and fails on real errors
- [ ] #2 erasableSyntaxOnly removed from frontend tsconfig.app.json and tsconfig.node.json
- [ ] #3 pnpm build (tsc -b + vite build) completes with zero TypeScript errors
- [ ] #4 a type-check step runs in CI so frontend type regressions are caught before merge
<!-- AC:END -->
