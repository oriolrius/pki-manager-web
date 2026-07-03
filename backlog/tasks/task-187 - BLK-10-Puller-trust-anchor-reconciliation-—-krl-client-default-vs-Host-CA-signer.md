---
id: TASK-187
title: >-
  BLK-10: Puller trust-anchor reconciliation — krl-client default vs Host-CA
  signer
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:26'
updated_date: '2026-07-03 22:55'
labels:
  - ssh-host-blocks
  - krl-client
  - ansible
milestone: SSH Host Access Blocks
dependencies:
  - TASK-177
  - TASK-180
references:
  - krl-client/internal/config/config.go
  - backend/src/services/ssh-config.ts
priority: high
ordinal: 14014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CRITICAL adversarial finding: decision-016 pinned req #1 signs the composed KRL with the HOST-CA key, but the deployed Go client's DEFAULT --ca-pubkey is /etc/ssh/ssh-user-ca.pub — the USER CA (krl-client/internal/config/config.go:39, README, man page). A krl-client host on defaults fails signature verify (exit 4) on every pull, keeps last-good, and blocks silently never land fleet-wide. This is the decision-015 open caveat ("Host-CA vs User-CA asymmetry") forced to a resolution by this milestone.

Reconcile END-TO-END, keeping req #1 (Host-CA signing):
1. Ship the Host-CA public key to hosts at a canonical path — new constant in backend/src/services/ssh-config.ts (the declared single source of truth for on-host paths); the generated 60-ssh-ca.conf drop-in bundle and the Ansible role install it.
2. Flip krl-client DefaultCAPubkey to that path; update README / man page / packaging; unit tests updated.
3. host_puller.sh CA_PUBLIC_KEY_ID guidance aligned.
4. Integration check: a backend-signed composed KRL verifies in krl-client verify.Check with the shipped default.

BLK-00's puller inventory feeds the fleet migration: existing hosts need the new trust-anchor file BEFORE the BLK-06 cutover — ordering documented in the BLK-12 runbook.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ssh-config.ts gains the Host-CA pubkey canonical path; drop-in generator + Ansible role install it
- [x] #2 krl-client default --ca-pubkey points at the Host-CA pubkey; README/man/packaging + tests updated
- [x] #3 Round-trip test: backend-signed composed KRL passes krl-client verify.Check on defaults
- [x] #4 host_puller.sh docs/vars aligned; trust-anchor-before-cutover ordering documented
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. HOST_CA_PATH constant in ssh-config.ts + drop-in @cert-authority guidance; check drop-in generator/Ansible install path
2. Flip krl-client DefaultCAPubkey to /etc/ssh/ssh-host-ca.pub; update comments/tests/README/man/env example/service files
3. host_puller.sh CA_PUBLIC_KEY_ID guidance aligned
4. Go round-trip test: backend-format detached sig verifies via verify.Check with shipped default path
<!-- SECTION:PLAN:END -->
