---
id: task-076
title: Handle KMS/DB inconsistency errors properly in CA and Certificate detail views
status: To Do
assignee: []
created_date: '2025-11-28 05:18'
labels:
  - backend
  - frontend
  - error-handling
  - kms
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When a CA or Certificate record exists in the application database but its corresponding certificate data is missing from the KMS (Key Management System), the application returns an HTTP 500 Internal Server Error. This is incorrect because:

1. HTTP 500 indicates an unexpected server error, but this is a **known/manageable situation**
2. The user has no way to resolve the inconsistency
3. The error message does not explain what happened

## Root Cause

Data inconsistency between the application database and KMS can occur when:
- The certificate was deleted directly from the KMS
- The KMS database was restored from a backup without the certificate
- There was a partial failure during CA/certificate creation
- The KMS is temporarily unavailable

## Solution

### Backend Changes

1. **New Error Class** (`backend/src/services/ca.service.ts`):
   - Add `CAKmsInconsistencyError` class to represent this specific error condition

2. **Service Layer** (`backend/src/services/ca.service.ts`):
   - Wrap KMS `getCertificate` call in `getById` method with try-catch
   - Throw `CAKmsInconsistencyError` when KMS fails to retrieve the certificate
   - Log a warning with details about the inconsistency

3. **tRPC Layer** (`backend/src/trpc/procedures/ca.ts`):
   - Map `CAKmsInconsistencyError` to tRPC `CONFLICT` error code (HTTP 409)
   - HTTP 409 is appropriate because it indicates a conflict in resource state

### Frontend Changes

1. **CA Detail Page** (`frontend/src/routes/cas.$id.tsx`):
   - Detect `CONFLICT` error code from tRPC response
   - Display clear "Data Inconsistency Detected" message
   - Show "Remove from Database" button to resolve the inconsistency
   - Explain that the CA exists in DB but certificate not found in KMS

2. **Certificate Detail Page** (`frontend/src/routes/certificates.$id.tsx`):
   - Same changes as CA detail page

## Files Modified

- `backend/src/services/ca.service.ts` - Error class and KMS try-catch
- `backend/src/trpc/procedures/ca.ts` - Error mapping to CONFLICT
- `frontend/src/routes/cas.$id.tsx` - UI error handling
- `frontend/src/routes/certificates.$id.tsx` - UI error handling
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Backend returns HTTP 409 CONFLICT (not 500) when CA/certificate exists in DB but not in KMS
- [ ] #2 Error message clearly states: 'CA exists in database but certificate not found in KMS'
- [ ] #3 Frontend CA detail page shows 'Data Inconsistency Detected' UI when CONFLICT error received
- [ ] #4 Frontend shows 'Remove from Database' button that deletes the orphaned DB record
- [ ] #5 User message explains the possible causes of the inconsistency
- [ ] #6 Same error handling implemented for Certificate detail page
- [ ] #7 Backend logs warning when KMS inconsistency detected with CA ID and KMS certificate ID
- [ ] #8 Tests clean up any CAs/certificates they create during test execution
<!-- AC:END -->
