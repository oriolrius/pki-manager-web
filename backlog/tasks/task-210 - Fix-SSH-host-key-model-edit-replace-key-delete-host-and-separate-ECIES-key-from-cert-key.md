---
id: TASK-210
title: >-
  Fix SSH host key model: edit/replace key, delete host, and separate ECIES key
  from cert key
status: To Do
assignee: []
created_date: '2026-07-14 05:15'
labels: []
dependencies: []
ordinal: 37014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The register-host UI hardcodes ed25519 guidance, but ECIES KRL distribution (default) requires an ecdsa-sha2-nistp256 key. A single opensshHostPubkey field is overloaded as BOTH the cert subject and the ECIES recipient, so a host cannot have an ed25519 host cert AND ECIES KRL. There is also no way to edit a host's key or delete a host (fqdn is UNIQUE), which permanently traps a mistyped registration. Repro: host c1h1.dev.ymbihq.local registered with ed25519 -> krl-client fails ECIES_KEY_UNSUPPORTED; had to hand-edit prod SQLite twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A registered host's public key can be replaced through the UI/API before a cert is issued
- [ ] #2 A host can be assigned a separate ecdsa-sha2-nistp256 ECIES key independent of its certificate key, and ECIES KRL uses it
- [ ] #3 A pending host with no issued certificate can be deleted through the UI/API, freeing its FQDN
- [ ] #4 The register form guides the user to the correct key type and warns when ECIES KRL would not work
<!-- AC:END -->
