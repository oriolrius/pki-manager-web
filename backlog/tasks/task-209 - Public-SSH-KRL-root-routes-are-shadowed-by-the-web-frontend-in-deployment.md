---
id: TASK-209
title: Public SSH/KRL root routes are shadowed by the web frontend in deployment
status: To Do
assignee: []
created_date: '2026-07-11 16:47'
labels:
  - bug
  - api
  - deployment
milestone: API bugs
dependencies: []
ordinal: 36014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the deployed environment (pki.joor.net), GET /ssh/host-ca-keys and the other ssh-public.routes.ts routes at the server root return the SPA index.html instead of API data, while /health and /crl/* correctly reach the backend. The SPA fallback / reverse proxy shadows /ssh/* (and likely /krl/*) at the root. Make these public trust-material and KRL routes reachable in production: register them before the SPA fallback, forward /ssh/* and /krl/* to the backend in the proxy, or mount them under a non-shadowed prefix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On the deployed environment, GET /ssh/host-ca-keys returns the Host CA public key(s), not HTML
- [ ] #2 GET /ssh/trusted-user-ca-keys, /ssh/cert-authority, /ssh/cas/:id/ca.pub, /ssh/hosts/:id/cert.pub, and /ssh/hosts/:id/sshd-config return their API responses (not HTML)
- [ ] #3 GET /krl/:caId.bin and /krl/:caId.json return KRL data, not HTML
<!-- AC:END -->
