---
id: TASK-286
title: Support SCEP session-key transport in the OpenBao fork
status: Done
assignee:
  - '@codex'
created_date: '2026-11-26T17:11:00Z'
updated_date: '2026-11-26T18:02:00Z'
labels: []
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deliver the first integration slice of doc-012 in oriolrius/openbao.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An authorized RA client can recover a 16-, 24- or 32-byte session key with the configured RSA-3072 key version.
- [x] #2 Existing Transit OAEP operations retain their behavior and unrelated callers lack access to RA transport.
- [x] #3 Required transport tests run with Go and without an OpenSSL executable.
- [x] #4 An independent review verifies the implementation and records remaining gateway integration work.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Implement scoped SCEP transport in the downstream Transit engine.
2. Run Go transport and Transit regressions.
3. Review the committed diff independently with Opus 5.5 and resolve findings.
4. Record the gateway contract and outstanding end-to-end validation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fork implementation committed locally as beaa5d6. Implementer reports 182 keysutil and 266 Transit tests passed. Independent review and verification of the required Go-only tests are in progress.

Independent Opus review ran the Transit and keysutil suites. The generated and imported RA handler cases cover 16, 24 and 32 bytes using Go. ACL and audit tests passed. Added a trim regression, ran the route tests twice and published fork commit 0e3024e. RA provisioning must disable export and plaintext backup and deny runtime key configuration. Gateway and backend integration and live enrollment remain separate work.
<!-- SECTION:NOTES:END -->
