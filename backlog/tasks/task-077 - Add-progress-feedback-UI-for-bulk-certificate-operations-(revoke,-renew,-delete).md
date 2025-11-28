---
id: task-077
title: >-
  Add progress feedback UI for bulk certificate operations (revoke, renew,
  delete)
status: To Do
assignee: []
created_date: '2025-11-28 08:52'
labels:
  - frontend
  - ux
  - bulk-operations
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement real-time progress feedback for bulk operations (revoke, renew, delete) similar to the existing download progress dialog used for JKS/ZIP artifacts.

**Current Behavior:**
- Bulk operations (revoke, renew, delete) show a simple confirmation dialog, execute all items at once, and show a generic success/error message
- No per-item progress or result visibility

**Desired Behavior:**
- Show an in-app progress dialog/popup during bulk operations
- Display a list of items being processed with real-time status updates
- Each item shows: certificate identifier (CN or serial), current status (pending/processing/success/error), and result message
- Progress bar showing overall completion
- Summary at the end showing success/failure counts

**Reference Implementation:**
The download progress dialog in `frontend/src/routes/certificates.tsx` (lines 689-730) uses:
- `progressSteps` state array with `{ label, status: 'pending' | 'active' | 'done' }`
- Animated progress bar with percentage
- Step-by-step status indicators

**Technical Approach:**
1. Backend already returns per-item results in bulk operations (see `bulk.routes.ts`)
2. Frontend needs to process items sequentially or show streaming results
3. Create a reusable `BulkOperationProgress` component
4. Integrate with existing bulk handlers in certificates.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Progress dialog appears when user initiates bulk revoke/renew/delete operations
- [ ] #2 Each certificate in the bulk operation is shown as a list item with its CN or serial number
- [ ] #3 Items show real-time status: pending (gray), processing (spinning), success (green checkmark), error (red X with message)
- [ ] #4 Overall progress bar updates as items complete
- [ ] #5 Summary section shows total success/failure counts when operation completes
- [ ] #6 Dialog can be dismissed only after operation completes (to prevent accidental navigation)
- [ ] #7 Error messages for failed items are descriptive and actionable
- [ ] #8 Tests validate progress state transitions for each operation type
- [ ] #9 Tests verify correct rendering of success/error states per item
- [ ] #10 Tests confirm cleanup of test data after test completion
<!-- AC:END -->
