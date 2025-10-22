---
id: task-028
title: Implement domain tracking backend
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 04:15'
labels:
  - backend
  - domain
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create backend logic to extract and track domains from certificates. Associate domains with CAs and track certificate counts per domain.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Domain extraction from CN and SAN DNS entries
- [x] #2 Case-insensitive domain storage
- [x] #3 Wildcard domains tracked separately
- [x] #4 Subdomain tracking
- [x] #5 Domain-to-CA association
- [x] #6 Certificate count per domain
- [x] #7 First and last certificate dates tracked
- [ ] #8 Domain list endpoint with filtering and search

- [x] #9 Unit tests implemented and passing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Examine database schema for domain tracking requirements
2. Create domain extraction utility to parse CN and SAN fields
3. Implement domain.list endpoint with filtering and search
4. Track certificate counts per domain
5. Track first and last certificate dates
6. Associate domains with CAs
7. Handle wildcard domains
8. Write unit tests
9. Test domain extraction and listing
<!-- SECTION:PLAN:END -->
