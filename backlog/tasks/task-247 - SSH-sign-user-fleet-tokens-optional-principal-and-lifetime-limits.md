---
id: TASK-247
title: 'SSH sign-user fleet tokens: optional principal and lifetime limits'
status: To Do
assignee: []
created_date: '2026-11-23T18:57:00Z'
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
- [ ] #1 An admin can mint a sign-user token with allowed principals (from the token zone catalog) and a maximum certificate lifetime, via tRPC and REST
- [ ] #2 Minting with a principal that is not in the token zone catalog, or with limits on a token without sign-user, is refused
- [ ] #3 sign-user with a principal outside the allowed list, or a validForSeconds above the maximum, is refused with 403 and a clear message, and audited
- [ ] #4 sign-user without validForSeconds on a limited token gets min(default lifetime, maximum)
- [ ] #5 Tokens minted without limits keep working as before, and the Fleet tokens page shows them as unrestricted with a warning
- [ ] #6 The mint form shows Allowed principals and Max certificate lifetime when sign-user is ticked (suggesting 15 minutes), and the table shows each token limits
<!-- AC:END -->
