---
id: TASK-225
title: >-
  ZONE-08: Zone-scoped public trust endpoints + deprecated default-zone
  compatibility
status: To Do
assignee: []
created_date: '2026-09-01 04:48'
updated_date: '2026-09-01 05:41'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - api
  - rest
  - compat
milestone: SSH Zones
dependencies:
  - TASK-220
ordinal: 52014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add zone-scoped public trust downloads without breaking the hosts that are already enrolled against the current, unscoped ones.

backend/src/rest/routes/ssh-public.routes.ts registers three installation-wide endpoints outside the /api/v1 auth block:
  GET /ssh/trusted-user-ca-keys  (line 189) -- every active/rotating User CA key
  GET /ssh/host-ca-keys          (line 199) -- every active/rotating Host CA key
  GET /ssh/cert-authority        (line 206) -- @cert-authority known_hosts lines
All three call getTrustAnchors() with no zone, so on a multi-zone install they would publish every zone's keys into every host's TrustedUserCAKeys -- the exact trust leak this milestone closes.

They cannot simply be changed. Live consumers today:
  - the Galaxy collection oriolrius.pki_manager (pinned >=2.3.0 in ansible/requirements.yml, source outside this repo) hits all three from plugins/modules/pki_manager.py:1050-1063
  - ansible/tests/e2e/seed.py:107 fetches /ssh/cert-authority
  - the production install at pki.joor.net and its enrolled host

decision-017 section 7 pins the resolution: add zone-scoped routes, keep the unscoped ones serving the DEFAULT zone, and mark them deprecated.

  GET /ssh/zones/:zone/trusted-user-ca-keys
  GET /ssh/zones/:zone/host-ca-keys
  GET /ssh/zones/:zone/cert-authority?pattern=

Legacy behaviour, pinned:
  - resolve through resolveZone() with no argument, so a single-zone install is exactly correct and a multi-zone install serves the zone named 'default'
  - respond with `Deprecation: true` and a `Link: <.../ssh/zones/<slug>/...>; rel="successor-version"` header
  - respond with `X-PKI-Zone: <slug>` so an operator can see which zone answered
  - log a rate-limited warning naming the client IP when more than one zone exists, so the operator can find stragglers before archiving the default zone

Already zone-correct and needing no change: GET /ssh/cas/:id/ca.pub (a CA id implies its zone), GET /ssh/hosts/:id/cert.pub and /ssh/hosts/:id/sshd-config (resolve through the host), and GET /krl/:caId.bin (keyed by CA).

Note the shadowing caveat recorded in TASK-209: these root-mounted public routes are served under the SPA in deployment, so verify the new /ssh/zones/... paths against the deployed routing, not only against the dev server.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A host can download the trusted user CA keys, host CA keys and @cert-authority lines for a named zone, and gets only that zone's material
- [x] #2 The existing unscoped trust URLs keep working and serve the default zone, so already-enrolled hosts and the pinned Ansible collection do not break
- [x] #3 Responses from the unscoped URLs announce that they are deprecated and name both the successor URL and the zone that answered
- [x] #4 With more than one zone configured, the unscoped URLs still serve only the default zone and never a union of zones
- [ ] #5 An unknown zone slug returns 404
- [ ] #6 The in-repo Ansible end-to-end suite passes unmodified
<!-- AC:END -->









## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh-public.routes.ts: extract the three response bodies into small helpers that take a resolved zone, then register both the new /ssh/zones/:zone/... routes and the legacy ones on top of them.
2. Legacy routes: resolveZone(ctx) with no argument; add Deprecation, Link and X-PKI-Zone headers; add the rate-limited warn using the existing rateLimitOk helper as the limiter pattern.
3. New routes: 404 with a text body on an unknown zone slug (these are text/plain endpoints -- keep the error shape consistent with the existing "not found\n" convention).
4. Keep both outside the OpenAPI block exactly as today (schema: { hide: true }) -- TASK-208 recorded that advertising root-mounted routes under /api/v1 produces unreachable URLs.
5. Tests: extend ssh-public.routes.test.ts -- a zone-scoped route returns only that zone's keys; the legacy route returns the default zone's keys and carries the deprecation headers; an unknown zone slug returns 404; with two zones the legacy route still returns the default zone rather than a union.
6. Run the in-repo Ansible e2e suite (ansible/tests/e2e) unchanged as the compatibility proof, and confirm seed.py still succeeds.
7. Verify the new paths resolve in the Docker/SPA deployment, per TASK-209.
<!-- SECTION:PLAN:END -->
