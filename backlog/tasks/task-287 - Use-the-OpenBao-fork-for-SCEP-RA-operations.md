---
id: TASK-287
title: Use the OpenBao fork for SCEP RA operations
status: Done
assignee:
  - '@codex'
created_date: '2026-11-26T18:08:00Z'
updated_date: '2026-11-26T18:47:00Z'
labels: []
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Connect the verified downstream Transit operation to an explicit RA binding in PKI Manager. Retain the Cosmian path during rollout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The bound RA signs and recovers CMS session keys with its configured OpenBao key version.
- [x] #2 Existing Cosmian integrations continue to work and new gateways send the CMS key length.
- [x] #3 A disposable enrollment and renewal use the real fork and record any remaining Cosmian calls.
- [x] #4 The CLI snapshot and integration documentation match the backend API.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Independently review gateway/backend length propagation.
2. Refresh CLI OpenAPI from the matching backend.
3. Connect provisioning, signing and decryption to a bound OpenBao RA.
4. Run live enrollment and renewal with disposable services and review the adapter.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gateway/backend commit a3dc4904; CLI flag commit 6c2aa680. Full backend run on gateway commit had one intermittent anonymous audit-limiter test failure. Provider wiring and live acceptance remain pending.

Independent review of a3dc4904 passed 1021 backend tests, Go race tests and site checks (184 pages). Confirmed backward compatibility and CLI schema parity at f414f60 (107 operations). Independent fixtures confirmed streamed BER and DER. AES-GCM requires CMS EnvelopedData; AuthEnvelopedData is unsupported. Live fork tests pending.

Implementation ff235156, local branch feat/openbao-scep-ra. Reported live enrollment, device renewal, RA certificate renewal and gateway restart passed using the TLS fork 0e3024e and a separate Cosmian issuing CA. Legacy RA binding also passed. Backend 1036/1036; gateway race tests passed. Independent adapter review pending before closure. 3DES lacked a full-stack fixture.

Independent adapter review passed 29 focused tests and migration checks. Follow-up 11ff25a3 rejects imported or soft-deleted keys during RA provisioning and renewal, documents mount-wide backend permissions, and clarifies the OpenAPI field. Final 30 focused backend tests, typecheck, lint and site links passed. CLI 3e7df70 mirrors the schema and all 62 tests pass. Live validation predates this small follow-up. Production deployment and X.509/CRL migration remain outside this slice.
<!-- SECTION:NOTES:END -->
