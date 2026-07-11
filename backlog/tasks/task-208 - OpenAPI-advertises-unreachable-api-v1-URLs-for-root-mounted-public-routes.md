---
id: TASK-208
title: OpenAPI advertises unreachable /api/v1 URLs for root-mounted public routes
status: To Do
assignee: []
created_date: '2026-07-11 16:47'
labels:
  - bug
  - api
  - openapi
milestone: API bugs
dependencies: []
ordinal: 35014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public trust-material / KRL routes (/ssh/cas/:id/ca.pub, /ssh/host-ca-keys, /ssh/trusted-user-ca-keys, /ssh/cert-authority, /ssh/hosts/:id/cert.pub, /ssh/hosts/:id/sshd-config, /krl/:caId.bin|.json, /krl/hosts/:hostId.bin|.json) are served at the server ROOT but the OpenAPI lists them under servers:[{url:/api/v1}]. A client resolving them therefore requests /api/v1/ssh/... and gets a 404 (confirmed against pki.joor.net). Either exclude these root-mounted routes from the /api/v1 Swagger document, or document them at their real (root) base so every advertised URL is reachable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every path in the published openapi.json resolves to a live route at the documented server base (no advertised URL 404s)
- [ ] #2 The public SSH/KRL root routes are either documented at their correct (root) base or omitted from the /api/v1 spec
<!-- AC:END -->
