---
id: task-063
title: Permalink CAs
status: Done
assignee:
  - '@myself'
created_date: '2025-10-24 07:21'
updated_date: '2025-10-24 12:10'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add permalink/direct link functionality for CAs to allow users to easily share and bookmark specific CA cert file. Users should be able to copy a direct URL to a CA details page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Users can navigate to a CA cert file using a permalink URL
- [x] #2 CA permalink URLs are shareable and bookmarkable
- [x] #3 Navigating to a CA permalink loads the correct CA cert file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add "Copy Permalink" button to CA detail page header
2. Implement copy-to-clipboard functionality using browser API
3. Show feedback when link is copied
4. Test that direct navigation to /cas/:id works correctly
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Added permalink functionality for Certificate Authorities (CAs) to enable easy sharing and bookmarking.

### Changes Made:

**Frontend (cas.$id.tsx):**
- Added "Copy Link" button to CA detail page header
- Implemented clipboard API to copy full URL to clipboard
- Added visual feedback with icon change (Link → Check) for 2 seconds
- Button displays "Copy Link" normally and "Copied\!" after successful copy

### Technical Details:

1. **Route Structure:** The `/cas/:id` route was already configured via TanStack Router
2. **Backend API:** The `ca.getById` endpoint was already implemented
3. **Copy Functionality:** Uses `navigator.clipboard.writeText()` to copy full URL including origin
4. **User Feedback:** Toast-style feedback with icon and text change for 2 seconds

### Testing:

- Backend running on http://127.0.0.1:52081
- Frontend running on http://localhost:52082
- Direct navigation to /cas/:id works correctly
- Copy Link button copies shareable URL to clipboard

### Files Modified:

- `frontend/src/routes/cas.$id.tsx` - Added Copy Link button and clipboard functionality

### Additional Enhancement:

**Permalink in Storage Location Section:**
- Added permalink URL display in the "Storage Location" section
- Shows full URL with copy button for easy access
- Provides visual feedback (Copy icon → Check icon) when clicked
- Makes the permalink more discoverable within the page content
<!-- SECTION:NOTES:END -->
