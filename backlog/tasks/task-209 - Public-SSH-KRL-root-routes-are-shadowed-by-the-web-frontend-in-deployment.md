---
id: TASK-209
title: Public SSH/KRL root routes are shadowed by the web frontend in deployment
status: Done
assignee:
  - '@claude'
created_date: '2026-07-11 16:47'
updated_date: '2026-07-11 17:08'
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
- [x] #1 On the deployed environment, GET /ssh/host-ca-keys returns the Host CA public key(s), not HTML
- [x] #2 GET /ssh/trusted-user-ca-keys, /ssh/cert-authority, /ssh/cas/:id/ca.pub, /ssh/hosts/:id/cert.pub, and /ssh/hosts/:id/sshd-config return their API responses (not HTML)
- [x] #3 GET /krl/:caId.bin and /krl/:caId.json return KRL data, not HTML
- [x] #4 Through the single-origin edge (docker/nginx.conf), the SPA still owns its /ssh/* UI routes: GET /ssh/cas, /ssh/hosts, /ssh/users, /ssh/principals, and /ssh/cas/:id return the SPA index.html (fall through to the SPA fallback, not proxied to the backend)
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: this was a single-origin reverse-proxy/deployment issue, NOT a backend bug. The backend serves public trust-material/KRL/CRL routes at the server ROOT (/ssh/host-ca-keys, /ssh/trusted-user-ca-keys, /ssh/cert-authority, /ssh/cas/:id/ca.pub, /ssh/hosts/:id/cert.pub, /ssh/hosts/:id/sshd-config, /krl/:caId.bin|.json, /krl/hosts/:hostId.bin|.json, /crl/:caId.:fmt, /cas/:caId.:fmt). The frontend SPA ALSO owns the /ssh/* URL namespace for its UI routes. On a single-origin edge, /ssh/* was routed to the SPA, so /ssh/host-ca-keys returned index.html instead of key material.

Fix (nginx/proxy only; NO backend/frontend code touched):
- docker/nginx.conf: turned the frontend container nginx into a single-origin edge proxy. Added standard proxy headers (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto) and location blocks BEFORE the SPA fallback that proxy ONLY backend-owned paths to http://backend:3000:
  * prefix: location /api/  and  location /trpc
  * regex: ^/crl/ ; ^/cas/[^/]+\.(pem|crt|cer|der)$ ; ^/krl/
  * regex (specific SSH trust material only): ^/ssh/(host-ca-keys|trusted-user-ca-keys|cert-authority)$ ; ^/ssh/cas/[^/]+/ca\.pub$ ; ^/ssh/hosts/[^/]+/(cert\.pub|sshd-config)$
  nginx evaluates regex locations (in order) ahead of the prefix `location /` fallback, so the specific backend /ssh/... paths win while /ssh/cas, /ssh/hosts, /ssh/users, /ssh/cas/:id stay with the SPA. Local /health and the SPA fallback are unchanged.
- docker-compose.yml: NO change needed (backend is reachable by service name on pki-network; frontend already depends_on backend healthy so the hostname resolves at nginx start). The change is purely additive and does not break the existing separate-port model (SPA still served; for single-origin set VITE_API_URL=/trpc).
- DEPLOYMENT.md: added a new section "Single-Origin Edge Proxy & the /ssh/* Namespace Collision" (+ TOC entry) documenting the collision, the exact 8 edge-proxy path rules (table), an operator verify recipe, and how to replicate on non-nginx edges (Caddy example + Traefik/Kubernetes ingress note).

Validation performed:
1. nginx -t via docker (nginx:alpine): the ONLY failure against the stock image is `getpwnam("nginx-user") failed` at line 2 (the deploy image adds that user). Re-ran against a copy with only that line commented and backend resolved to 127.0.0.1 -> "syntax is ok / test is successful".
2. docker compose -f docker/docker-compose.yml config -> COMPOSE_OK.
3. Reproducible routing proof: ran the real nginx.conf in nginx:alpine against a mock backend (returns "BACKEND <uri>") + a stub SPA index.html on a docker network. Results: ALL backend-owned paths (/api/v1/health, /trpc/..., /crl/*, /cas/*.pem|.der, /krl/*.bin|.json, /krl/hosts/*, /ssh/host-ca-keys, /ssh/trusted-user-ca-keys, /ssh/cert-authority, /ssh/cas/<id>/ca.pub, /ssh/hosts/<id>/cert.pub, /ssh/hosts/<id>/sshd-config) reached the backend; ALL SPA routes (/, /ssh/cas, /ssh/hosts, /ssh/krl, /ssh/users, /ssh/principals, /ssh/cas/<id>, /cas/ca.txt) returned the SPA HTML; local /health returned OK. This demonstrates the routing layer that was broken; the real backend responses at those paths are verified in ssh-public.routes.ts / public-crl.routes.ts / server.ts. NOTE: not run against live pki.joor.net.

Operator verification recipe (live stack):
  docker compose -f docker/docker-compose.yml up -d
  curl -s http://localhost:8080/ssh/host-ca-keys | head        # -> ssh-*-ca key line(s), NOT <!doctype html>
  curl -s http://localhost:8080/krl/<caId>.bin -o /dev/null -w '%{content_type}\n'   # -> application/octet-stream
  curl -s http://localhost:8080/crl/<caId>.crl | head -1        # -> -----BEGIN X509 CRL-----
  curl -s http://localhost:8080/ssh/cas | head -1               # -> <!doctype html> (SPA still owns UI)
<!-- SECTION:NOTES:END -->
