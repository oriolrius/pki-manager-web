---
id: TASK-247
title: 'SSH sign-user fleet tokens: optional principal and lifetime limits'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T18:57:00Z'
updated_date: '2026-11-23T19:21:00Z'
labels:
  - ssh
  - backend
  - frontend
dependencies: []
ordinal: 74014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A sign-user fleet token can sign any subject with any principals and any lifetime in its zone. A leaked CI token is therefore a root-on-every-host token. Add optional limits at mint time (allowed principals from the zone catalog, maximum certificate lifetime), enforce them in sign-user, and make unrestricted tokens visible in the UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An admin can mint a sign-user token with allowed principals (from the token zone catalog) and a maximum certificate lifetime, via tRPC and REST
- [x] #2 Minting with a principal that is not in the token zone catalog, or with limits on a token without sign-user, is refused
- [x] #3 sign-user with a principal outside the allowed list, or a validForSeconds above the maximum, is refused with 403 and a clear message, and audited
- [x] #4 sign-user without validForSeconds on a limited token gets min(default lifetime, maximum)
- [x] #5 Tokens minted without limits keep working as before, and the Fleet tokens page shows them as unrestricted with a warning
- [x] #6 The mint form shows Allowed principals and Max certificate lifetime when sign-user is ticked (suggesting 15 minutes), and the table shows each token limits
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Schema: ssh_fleet_tokens.allowed_principals (JSON string[] | NULL) + max_valid_for_seconds (int | NULL); migration 0013 (existing tokens = NULL = unrestricted).
2. Mint: limits only with sign-user; principals must exist in the token zone catalog; audit the limits. DTO + VerifiedToken carry them.
3. sign-user: 403 TOKEN_LIMIT (+ failure audit) on a principal outside the list (P@host accepted when P is allowed) or validForSeconds > max; no validForSeconds -> min(1 week default, max).
4. tRPC/REST mint schema; docs/ssh-api-contract.md.
5. UI: mint form fields when sign-user ticked (catalog checkboxes, lifetime preset 15 min), Limits column + Unrestricted warning.
6. Tests backend (mint + sign-user enforcement with KMS when available) + RTL.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
sign-user fleet tokens can now carry limits.

- Migration `0013_overjoyed_wilson_fisk.sql`: `ssh_fleet_tokens.allowed_principals` (JSON names) + `max_valid_for_seconds`. Existing rows NULL = unrestricted (unchanged behaviour).
- Mint (`ssh.token.mint`, `POST /api/v1/ssh/tokens`): optional `allowedPrincipals: string[]`, `maxValidForSeconds: number`; refused without sign-user or with a principal outside the token zone catalog; limits in the `ssh.token.mint` audit details and in list DTOs.
- `POST /api/v1/external/ssh/sign-user`: `applySignUserLimits` -> 403 `TOKEN_LIMIT` (principal outside list; `P@host` allowed when `P` is; or validForSeconds > max), failure audit `ssh.external.sign` on the token, no identity upsert. No validForSeconds -> min(604800, max).
- UI (FleetTokensPanel): "sign-user limits" fieldset with "Allowed principals" checkboxes and "Max certificate lifetime" (default "15 minutes (suggested for CI)"), unrestricted warning, "Limits" column, amber "Unrestricted" pill.
- docs/ssh-api-contract.md documents the limits.
- Tests: ssh-token-limits.integration.test.ts (incl. KMS signing path), FleetTokensPanel.test.tsx, fleet-token.test.ts.
<!-- SECTION:NOTES:END -->
