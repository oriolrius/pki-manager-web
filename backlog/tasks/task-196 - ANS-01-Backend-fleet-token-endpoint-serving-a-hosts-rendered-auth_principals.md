---
id: TASK-196
title: >-
  ANS-01: Backend: fleet-token endpoint serving a host's rendered
  auth_principals
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 09:42'
labels:
  - ansible-integration
  - api
  - backend
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 23014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The authoritative per-account AuthorizedPrincipalsFile contents are rendered only behind admin OIDC tRPC (ssh-principal.service.ts:145-180, trpc/procedures/ssh.ts:279-288), so a host cannot self-fetch them with its fleet token. Add an external/public host-fetch endpoint (fleet-token or public per the /ssh public-route pattern) that returns the same rendered map of account->file-content for a given host, so the Ansible role can install them. Reuse the existing render service; do not fork the logic. Write an audit_log row per fetch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A host holding a valid fleet token (or via the public /ssh path, matching existing trust-bundle endpoints) can GET its own per-account auth_principals content and receive exactly what ssh-principal.service render() produces
- [ ] #2 The response includes each account name and its file body (dual bare-P and P@fqdn forms) for the host
- [ ] #3 An integration test asserts the endpoint output byte-matches the admin tRPC render for the same host, and that an unauthorized/unknown-host request is rejected
- [ ] #4 Each successful fetch writes an audit_log row
<!-- AC:END -->
