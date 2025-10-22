---
id: task-029
title: Implement global search backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 04:15'
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
- [ ] #1 search.global endpoint implemented
- [ ] #2 Search across certificates (CN, subject, SAN, serial, fingerprint)
- [ ] #3 Search across CAs (CN, organization)
- [ ] #4 Search across domains
- [ ] #5 Results grouped by entity type
- [ ] #6 Configurable result limits per group
- [ ] #7 Debounced/optimized for performance (< 500ms)
- [ ] #8 Highlighting of matching text
- [ ] #9 Support for quick filters (status:, type:)
- [ ] #10 Special character handling and SQL injection prevention

- [ ] #11 Unit tests implemented and passing
<!-- AC:END -->
