---
id: TASK-236
title: SSH CA fleet re-issue report endpoint (retirement gate)
status: Done
assignee: []
created_date: '2026-09-21 04:56'
labels:
  - ssh-ca
  - rotation
dependencies: []
ordinal: 63014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add GET /api/v1/ssh/cas/:caId/reissue-report so an operator can prove, before RETIRING a rotating CA, that no live certificate is still signed by it (decision-028 §4 retirement gate; consumed by iotgw-ng scripts/ssh-ca/fleet-report.sh, iotgw-ng task-103 AC#4). A CA is safe to retire iff it has signed zero still-live certs (status='active', not superseded, not past validBefore).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /cas/:caId/reissue-report returns {ca, successorCaId, liveCertsUnderThisCa, reissuedUnderSuccessor, safeToRetire, pending[]}
- [ ] #2 A cert superseded by a renewal (supersededBy set) is NOT counted as live, so re-issuing under the successor flips safeToRetire to true
- [ ] #3 pending[] lists the blocking certs with host fqdn where known
- [ ] #4 Integration test: issue host cert, rotate, report unsafe (1 pending); re-issue under successor, report safe (0)
<!-- AC:END -->
