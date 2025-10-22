---
id: task-033
title: Implement CA revocation UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:33'
labels:
  - frontend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the UI flow for revoking a Certificate Authority including warning dialog, revocation reason selection, and confirmation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA revocation dialog component created
- [ ] #2 Warning message with impact summary
- [ ] #3 Revocation reason dropdown with all standard reasons
- [ ] #4 Confirmation checkbox
- [ ] #5 Text input requiring 'REVOKE' to confirm
- [ ] #6 Option to cascade revoke all issued certificates
- [ ] #7 Validation prevents re-revoking
- [ ] #8 Success notification
- [ ] #9 CA status updated in UI after revocation
- [ ] #10 Error handling and display
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create CA revocation dialog component
2. Add warning message with impact summary (cascade effect on issued certificates)
3. Implement revocation reason dropdown with all standard RFC reasons
4. Add confirmation checkbox
5. Add text input requiring "REVOKE" to confirm
6. Add option to cascade revoke all issued certificates
7. Add validation to prevent re-revoking
8. Implement tRPC ca.revoke mutation
9. Show success notification
10. Update CA status in UI after revocation
11. Add error handling and display
<!-- SECTION:PLAN:END -->
