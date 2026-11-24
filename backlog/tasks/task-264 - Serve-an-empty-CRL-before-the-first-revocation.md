---
id: TASK-264
title: Serve an empty CRL before the first revocation
status: To Do
assignee: []
created_date: '2026-11-24T10:18:00Z'
labels:
  - crl
  - bug
dependencies: []
ordinal: 84014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every certificate embeds the CRL distribution URL, but it returns 404 (No CRL available for CA) until the first revocation; clients that require a CRL fail (found by the docs private CA guide, 2026-11-24).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The CRL URL of a new CA returns a valid, signed, empty CRL
<!-- AC:END -->
