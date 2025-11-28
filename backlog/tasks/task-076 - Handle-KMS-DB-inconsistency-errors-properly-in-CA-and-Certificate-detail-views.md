---
id: task-076
title: Handle KMS/DB inconsistency errors properly in CA and Certificate detail views
status: Done
assignee:
  - '@myself'
created_date: '2025-11-28 05:18'
updated_date: '2025-11-28 05:22'
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
- [x] #1 Backend returns HTTP 409 CONFLICT (not 500) when CA/certificate exists in DB but not in KMS
- [x] #2 Error message clearly states: 'CA exists in database but certificate not found in KMS'
- [x] #3 Frontend CA detail page shows 'Data Inconsistency Detected' UI when CONFLICT error received
- [x] #4 Frontend shows 'Remove from Database' button that deletes the orphaned DB record
- [x] #5 User message explains the possible causes of the inconsistency
- [x] #6 Same error handling implemented for Certificate detail page
- [x] #7 Backend logs warning when KMS inconsistency detected with CA ID and KMS certificate ID
- [x] #8 Tests clean up any CAs/certificates they create during test execution
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: Backend Error Handling

1. Add `CAKmsInconsistencyError` class to `backend/src/services/ca.service.ts`:
   ```typescript
   export class CAKmsInconsistencyError extends Error {
     constructor(public caId: string, public kmsError: string) {
       super(`CA ${caId} exists in database but certificate not found in KMS: ${kmsError}`);
       this.name = 'CAKmsInconsistencyError';\n     }\n   }\n   ```\n\n2. Wrap KMS call in `getById` method with try-catch:\n   ```typescript\n   let certificatePem: string;\n   try {\n     certificatePem = await kmsService.getCertificate(\n       caRecord.kmsCertificateId,\n       caRecord.id\n     );\n   } catch (kmsError) {\n     logger.warn(\n       { caId: id, kmsCertificateId: caRecord.kmsCertificateId, error: kmsError },\n       'CA exists in database but certificate not found in KMS - data inconsistency detected'\n     );\n     throw new CAKmsInconsistencyError(\n       id,\n       kmsError instanceof Error ? kmsError.message : String(kmsError)\n     );\n   }\n   ```\n\n3. Update `mapServiceError` in `backend/src/trpc/procedures/ca.ts`:\n   ```typescript\n   if (error instanceof CAKmsInconsistencyError) {\n     throw new TRPCError({\n       code: 'CONFLICT',\n       message: error.message,\n     });\n   }\n   ```\n\n### Phase 2: Frontend Error Handling\n\n4. Update `frontend/src/routes/cas.$id.tsx`:\n   - Change error detection from `INTERNAL_SERVER_ERROR` to `CONFLICT`\n   - Display "Data Inconsistency Detected" UI\n   - Show "Remove from Database" button\n\n5. Update `frontend/src/routes/certificates.$id.tsx`:\n   - Same changes as CA detail page\n\n### Phase 3: Testing\n\n6. Run existing tests to ensure no regressions\n7. Verify manually with an orphaned CA record
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Changes Made

#### Backend Service (`ca.service.ts`)
- Added `CAKmsInconsistencyError` class at line 759-764
- Wrapped KMS call with try-catch at lines 234-250
- Added warning log with CA ID and KMS certificate ID

#### Backend tRPC (`ca.ts`)
- Imported `CAKmsInconsistencyError`
- Added error mapping to `CONFLICT` code (HTTP 409) at lines 28-34

#### Frontend CA Detail (`cas.$id.tsx`)
- Changed `isKmsError` to `isKmsInconsistency` checking for `CONFLICT` code
- Shows clear message explaining DB/KMS inconsistency
- "Remove from Database" button calls delete mutation

#### Frontend Certificate Detail (`certificates.$id.tsx`)
- Same changes as CA detail page

### Why HTTP 409 CONFLICT?

- HTTP 500 = unexpected server error (wrong for known situation)
- HTTP 409 = conflict in resource state (correct - DB vs KMS mismatch)
- Allows frontend to handle specifically and offer resolution

### Test Output

Existing tests pass. The KMS inconsistency scenario requires manual testing with an orphaned DB record.

## Implementation Complete

### Changes Made

**Backend - CA Service (`backend/src/services/ca.service.ts`)**
- Line 772-777: Added `CAKmsInconsistencyError` class
- Lines 234-250: Wrapped KMS `getCertificate` call with try-catch, throws `CAKmsInconsistencyError` on failure
- Logs warning with CA ID and KMS certificate ID when inconsistency detected

**Backend - CA tRPC (`backend/src/trpc/procedures/ca.ts`)**
- Lines 28-35: Added error mapping for `CAKmsInconsistencyError` to tRPC `CONFLICT` code (HTTP 409)

**Backend - Certificate Service (`backend/src/services/certificate.service.ts`)**
- Lines 1283-1288: Added `CertificateKmsInconsistencyError` class
- Lines 341-359: Wrapped KMS `getCertificate` call with try-catch in `getById` method
- Logs warning with certificate ID and KMS certificate ID when inconsistency detected

**Backend - Certificate tRPC (`backend/src/trpc/procedures/certificate.ts`)**
- Lines 369-389: Wrapped inline KMS call with try-catch, throws `CONFLICT` error on failure

**Frontend - CA Detail (`frontend/src/routes/cas.$id.tsx`)**
- Lines 116-217: Detects `CONFLICT` error code, shows "Data Inconsistency Detected" UI with:
  - Clear explanation of the problem
  - List of possible causes
  - "Remove from Database" button to clean up orphaned record
  - CA ID and error message display

**Frontend - Certificate Detail (`frontend/src/routes/certificates.$id.tsx`)**
- Lines 230-331: Same implementation as CA detail page for certificates

### Test Results
- All 333 backend tests pass
- KMS inconsistency detection verified in test logs

### Test Output

```
 ✓ src/rest/routes/certificate.routes.test.ts (36 tests) 27002ms
 ✓ src/rest/routes/ca.routes.test.ts
 ✓ src/rest/routes/utility.routes.test.ts
 ... (all test files)

 Test Files  18 passed (18)
      Tests  333 passed | 1 skipped (334)
   Start at  06:20:59
   Duration  28.23s
```

KMS inconsistency detection verified in test logs:
```
[05:21:25 UTC] WARN: Certificate exists in database but certificate not found in KMS - data inconsistency detected
    certId: "7a73d003-8a05-4741-a252-d685cd796d99"
    kmsCertificateId: "test-kms-cert-mock"
```
<!-- SECTION:NOTES:END -->
