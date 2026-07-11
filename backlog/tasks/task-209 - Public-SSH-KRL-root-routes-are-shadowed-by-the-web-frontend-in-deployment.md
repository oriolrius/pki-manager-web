---
id: TASK-209
title: Public SSH/KRL root routes are shadowed by the web frontend in deployment
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-11 16:47'
updated_date: '2026-07-11 17:07'
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
- [ ] #4 Through the single-origin edge (docker/nginx.conf), the SPA still owns its /ssh/* UI routes: GET /ssh/cas, /ssh/hosts, /ssh/users, /ssh/principals, and /ssh/cas/:id return the SPA index.html (fall through to the SPA fallback, not proxied to the backend)
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read backend public route paths (ssh-public.routes.ts, server.ts /cas, public-crl.routes.ts) and the frontend /ssh/* SPA routes to confirm the namespace collision.
2. Rewrite docker/nginx.conf as a single-origin edge proxy: add an upstream/proxy to http://backend:3000 with standard proxy headers, and precise location blocks BEFORE the SPA fallback for /api/, /trpc, /crl/, /cas/*.pem|crt|cer|der, /krl/, and ONLY the specific backend /ssh/* trust-material paths (host-ca-keys|trusted-user-ca-keys|cert-authority, cas/:id/ca.pub, hosts/:id/cert.pub|sshd-config). Keep local /health and SPA fallback intact.
3. Ensure the SPA still owns /ssh/cas, /ssh/hosts, etc. via regex anchoring/ordering.
4. Document the collision + required edge-proxy rules in DEPLOYMENT.md (nginx + Traefik/Caddy/ingress note).
5. Validate: nginx -t via nginx:alpine docker (comment out user directive if it is the only error), docker compose config parse.
6. Update ticket ACs/notes; set status.
<!-- SECTION:PLAN:END -->
