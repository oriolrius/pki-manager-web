---
id: TASK-249
title: 'SSH issue form: principal mapping panel shows only the identity zone'
status: To Do
assignee: []
created_date: '2026-11-23T18:57:00Z'
labels:
  - ssh
  - backend
  - frontend
dependencies: []
ordinal: 76014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mappingsByPrincipal groups host mappings by principal NAME across all zones. The Issue User Certificate form panel 'Where these principals grant login' therefore lists hosts from other zones, where the certificate can never log in. Scope the read to a zone and pass the selected identity zone from the form.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 mappingsByPrincipal accepts a zone (id or slug) via tRPC and REST and returns only that zone's mappings
- [ ] #2 The Issue User Certificate form panel shows only hosts in the selected identity zone
- [ ] #3 Without a zone the call keeps its current behaviour for existing clients
<!-- AC:END -->
