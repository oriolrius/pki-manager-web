---
id: task-029
title: Implement global search backend endpoint
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 04:16'
labels:
  - backend
  - search
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create backend endpoint for global search across CAs, certificates, and domains. Support fuzzy matching, grouped results, and quick filters.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 search.global endpoint implemented
- [x] #2 Search across certificates (CN, subject, SAN, serial, fingerprint)
- [x] #3 Search across CAs (CN, organization)
- [x] #4 Search across domains
- [x] #5 Results grouped by entity type
- [x] #6 Configurable result limits per group
- [ ] #7 Debounced/optimized for performance (< 500ms)
- [ ] #8 Highlighting of matching text
- [x] #9 Support for quick filters (status:, type:)
- [x] #10 Special character handling and SQL injection prevention

- [x] #11 Unit tests implemented and passing
<!-- AC:END -->
