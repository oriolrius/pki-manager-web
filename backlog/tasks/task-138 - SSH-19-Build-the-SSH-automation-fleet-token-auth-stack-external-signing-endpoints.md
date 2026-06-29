---
id: TASK-138
title: >-
  SSH-19: Build the SSH automation fleet-token auth stack + external signing
  endpoints
status: To Do
assignee: []
created_date: '2026-06-29 15:42'
updated_date: '2026-06-29 15:47'
labels:
  - ssh-cert-manager
  - backend
  - api
  - security
milestone: SSH Certificate Manager
dependencies:
  - TASK-130
  - TASK-131
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NET-NEW security-critical infrastructure (the cluster/external-issuer machinery this was meant to 'generalise' does NOT exist on this branch — verified: no clusters table, cluster.service.ts, cluster-auth, or external.routes.ts). Build an SSH automation fleet-token system from scratch and threat-model it: a tokens table + service storing only SHA-256 hashes, constant-time verify, plaintext shown exactly once (pkimg_ prefix), one token scoped to exactly one SSH CA pair (user+host) + op-set, last_seen, revoke. Add an ssh-cluster-auth preHandler and ssh-external.routes.ts registered in server.ts AFTER the OIDC block so it bypasses OIDC: POST /api/v1/external/ssh/sign-host, /sign-user, /register-host-pubkey, idempotent on Idempotency-Key (host: host_id+pubkey-fp; user: request id). Issued certs carry source_type='automation'. Token mint/list/revoke exposed via tRPC+REST for an Automation page. If the k8s cluster stack later merges in, the two token models can be unified, but this milestone does not depend on it.

**Epic:** SSH API Surface (tRPC + REST/OpenAPI + Automation)
**Logical deps:** SSH-12, SSH-13
**Touchpoints:** backend/src/db/schema.ts, backend/src/services/ssh-fleet-token.service.ts, backend/src/rest/middleware/ssh-cluster-auth.ts, backend/src/rest/routes/ssh-external.routes.ts, backend/src/server.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can mint an automation token scoped to a specific SSH User+Host CA pair + op-set (shown once, pkimg_ prefix); it is stored only as a SHA-256 hash, verified with constant-time comparison, updates last_seen, and is rejected 401/403 when invalid/revoked or used outside its scope
- [ ] #2 The Ansible role can POST a node's public host key with a bearer token over TLS and receive a signed host cert; CI can POST a user pubkey and receive a signed user cert with requested principals/extensions; every sign/register writes an audit row with the token identity and source IP
- [ ] #3 Repeating a sign call with the same Idempotency-Key returns the cached certificate, not a new serial; an SSH token cannot call any X.509 endpoint
- [ ] #4 Token mint/list/revoke is exposed and an operator can rotate a token without downtime; the external endpoints require TLS and are rate-limited (per SSH-MON/abuse controls)
<!-- AC:END -->
