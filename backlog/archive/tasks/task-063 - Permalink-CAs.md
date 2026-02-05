---
id: task-063
title: Permalink CAs
status: Done
assignee:
  - '@myself'
created_date: '2025-10-24 07:21'
updated_date: '2025-10-24 12:21'
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

### Download Endpoint Implementation:

**Backend (server.ts):**
- Created REST endpoint: `GET /cas/:caId.:format`
- Supported formats: `.pem`, `.crt`, `.cer`, `.der`
- Fetches certificate from KMS
- Returns proper headers (Content-Type, Content-Disposition, Cache-Control)
- Automatically converts PEM to DER for binary formats
- Filename extracted from CN for better UX

**Frontend (cas.$id.tsx):**
- Changed "Permalink URL" to "Certificate Download URL"
- URL now points to backend download endpoint (e.g., `/cas/:id.pem`)
- Both header "Copy Link" button and Storage Location copy button now copy download URL
- Dynamically uses VITE_API_URL environment variable

**Testing:**
```bash
# PEM format (ASCII)
curl http://wsl.ymbihq.local:52081/cas/280245c2-6e20-4665-ad69-eeb3ff6f3838.pem

# DER format (binary)
curl http://wsl.ymbihq.local:52081/cas/280245c2-6e20-4665-ad69-eeb3ff6f3838.der -o ca.der

# CRT format (ASCII, alternative to PEM)
curl http://wsl.ymbihq.local:52081/cas/280245c2-6e20-4665-ad69-eeb3ff6f3838.crt

# CER format (binary, Windows compatible)
curl http://wsl.ymbihq.local:52081/cas/280245c2-6e20-4665-ad69-eeb3ff6f3838.cer -o ca.cer
```

Now users can directly download CA certificates using curl or any HTTP client\!

### Enhanced with Format Selector:

**Header:**
- Added format dropdown selector (PEM, CRT, DER, CER)
- "Copy Link" button copies URL in selected format
- Format selection persists across both header and storage location

**Storage Location Section:**
- Displays all 4 download URLs simultaneously:
  - PEM: ASCII format (most common)
  - CRT: ASCII format (alternative extension)
  - DER: Binary format (compact)
  - CER: Binary format (Windows compatible)
- Format selector dropdown at the top
- "Copy URL" button copies the selected format
- All URLs are clickable and open in new tab

**User Experience:**
1. Select desired format from dropdown (PEM, CRT, DER, or CER)
2. Click "Copy Link" in header or "Copy URL" in Storage Location
3. Format selection is synchronized between both locations
4. Visual feedback with checkmark when copied

### Final Layout:

**Storage Location Section:**
```
┌─────────────────────────────────────────────────────────────┐
│ Storage Location                                            │
├──────────────────────────────┬──────────────────────────────┤
│ Certificate Download URLs:   │ KMS Provider:                │
│   PEM: [link]                │ Cosmian KMS                  │
│   CRT: [link]                │                              │
│   DER: [link]                │ KMS Key ID:                  │
│   CER: [link]                │ [key-id]                     │
├──────────────────────────────┼──────────────────────────────┤
│ Created:                     │ Last Modified:               │
│ [date/time]                  │ [date/time]                  │
└──────────────────────────────┴──────────────────────────────┘
```

**Header:**
- Format selector dropdown (PEM, CRT, DER, CER)
- "Copy Link" button copies selected format URL

**User Flow:**
1. Select format from header dropdown
2. Click "Copy Link" to copy that format URL
3. Or click any format link directly in Storage Location to download
<!-- SECTION:NOTES:END -->
