---
id: TASK-288
title: Release PKI Manager with OpenBao as the only runtime key store
status: In Progress
assignee:
  - '@codex'
created_date: '2026-11-26T20:25:00Z'
updated_date: '2026-11-26T20:25:00Z'
labels: []
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deliver decision-018 and doc-012. Release the next major only after migration, recovery and product validation without Cosmian.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 X.509, CRL, SSH and SCEP operate against OpenBao with Cosmian disconnected.
- [ ] #2 Existing installations can rehearse migration, reconcile identities and restore their data.
- [ ] #3 Development, tests, deployment and current product documentation use the fork and clients retain their supported operations.
- [ ] #4 Independent review and required release checks pass on the release candidate.
- [ ] #5 A major GitHub release and its required installable artifacts are published and verified.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Port certificate issuance and CRL signing, SSH and RA to Transit.
2. Replace runtime and test stacks, synchronize UI, guides and API consumers.
3. Rehearse a v3 migration and restore using disposable identities.
4. Run live end-to-end flows and independent review with Cosmian disconnected.
5. Integrate through project CI, publish the major version and verify the artifacts.
<!-- SECTION:PLAN:END -->
