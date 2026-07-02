---
id: TASK-175
title: >-
  krl-client: bind anti-rollback to the CA-signed KRL number, not the unsigned
  envelope field
status: Done
assignee:
  - '@myself'
created_date: '2026-07-02 16:43'
updated_date: '2026-07-02 18:06'
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
- [x] #1 Anti-rollback compares the CA-signed KRL number embedded in the signed KRL bytes, so a replayed old-but-signed KRL with an inflated unsigned krl_number is rejected
- [x] #2 A test replays an older signed KRL with a higher unsigned number and asserts it is rejected (exit 8)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full migration (no back-compat; pre-release DEV). Anti-rollback now reads the monotonic number from the CA-SIGNED OpenSSH KRL header (big-endian uint64 at bytes[12:20]) instead of the unsigned JSON krl_number.

Client: payload.go adds krlHeaderNumber() (magic + format_version + bounds + int64-overflow guards, 100% covered) and Parse() sources Number from the signed bytes; removed krl_number from the wire struct; Validate() anti-rollback compares the header number and drops the old p.Number!=0 skip (which would have let a version-0 replay through). Backend: ssh-external.routes.ts stops emitting krl_number (buildKrl already embeds it in the header; row.krlNumber starts at 1 and increments, so prevNumber==0 unambiguously means nothing installed). Golden vectors regenerated with `ssh-keygen -k -z 42` so the header number (42) == meta.krl_number and payload.json drops the field; real ssh-keygen -Q interop still passes.

Tests: real KRL-header builders in both test packages; TestAntiRollbackUsesSignedHeaderNotJSON proves an inflated JSON krl_number=9999 + old header number 2 vs installed 5 -> rejected (exit 8); TestParseRejectsNonKRL covers all four header guards. Docs: decision-015, doc-007, README updated. Verified: gofmt/vet clean, 88 client tests pass, backend route typechecks clean + ssh crypto tests pass. Adversarial review (4 agents): 0 blockers.
<!-- SECTION:NOTES:END -->
