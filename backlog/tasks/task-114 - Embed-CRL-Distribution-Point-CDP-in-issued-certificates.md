---
id: TASK-114
title: Embed CRL Distribution Point (CDP) in issued certificates
status: To Do
assignee: []
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:04'
labels:
  - crl
  - backend
  - crypto
milestone: CRL Signing & Distribution
dependencies:
  - TASK-111
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
For CRLs to be usable, issued certs must advertise where to fetch them. Add a CRL Distribution Point extension (URL to the /crl endpoint for the issuing CA) to leaf certs across all issuance paths: manual, bulk, and the k8s external /sign path. Base URL must be configurable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Newly issued certificates (manual, bulk, and k8s external /sign) include a CDP extension pointing at the CRL endpoint for their CA
- [ ] #2 The CDP base URL is configurable via env/setting
- [ ] #3 openssl x509 -ext crlDistributionPoints shows the expected URL
<!-- AC:END -->
