---
id: TASK-254
title: Reproducible demo stack and screenshot/screencast pipeline
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T10:26:00Z'
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
- [x] #1 One command starts a clean stack, seeds demo data and regenerates all doc screenshots
- [x] #2 Screencasts are short (under 60 s) WebM/MP4 clips with no audio
- [x] #3 No screenshot shows real names, emails, hosts or keys
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `docs/site/demo/demo.sh shots`: clean stack (real docker/docker-compose.yml, published 3.15.0 images + compose.demo.yml overlay with Keycloak and fake users alex/uma @example.com), then Playwright specs 01-04 create the data through the UI/API and write docs/guides/img/** and docs/guides/video/*.webm. Verified on a clean run (11 passed + integrations 5 passed).
- Two parts need outside pieces and skip without them (their screenshots stay from the verified runs): k8s spec STEP=2 (needs a kind cluster and the renewed SERIAL) and integrations part D (needs compose.scep-demo.yml + an enrolled device).
- Screencast: private-ca-issue-server.webm, 15 s, no audio. Helper fails a screencast over 60 s.
- Only fake data: Acme / Example Corp, *.acme.example, *.example.internal, example.com users.
<!-- SECTION:NOTES:END -->
