---
id: TASK-175
title: >-
  krl-client: bind anti-rollback to the CA-signed KRL number, not the unsigned
  envelope field
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-02 16:43'
updated_date: '2026-07-02 17:11'
labels:
  - ssh-cert-manager
  - krl-client
  - security
dependencies: []
ordinal: 2014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-release security review (v3.4.0): the detached CA signature covers only sha256(krl), while krl_number/valid_until/host_id are authenticated solely by the ECIES envelope the server itself produces (payload.go:74). Under full server compromise an attacker can replay an old, still-validly-CA-signed KRL with a bumped krl_number to un-revoke keys. Low severity — the guaranteed floor is the bare TLS-served KRL + short TTLs, which already has no anti-rollback by design. Cheap fix: the backend already embeds the monotonic number inside the CA-signed KRL header (ssh-krl.service.ts:137); the client should parse and compare that signed number instead of the unsigned JSON field.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Anti-rollback compares the CA-signed KRL number embedded in the signed KRL bytes, so a replayed old-but-signed KRL with an inflated unsigned krl_number is rejected
- [ ] #2 A test replays an older signed KRL with a higher unsigned number and asserts it is rejected (exit 8)
<!-- AC:END -->
