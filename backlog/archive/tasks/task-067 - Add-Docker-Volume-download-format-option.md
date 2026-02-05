---
id: task-067
title: Add "Docker Volume" download format option
status: Done
assignee:
  - '@myself'
created_date: '2025-11-27 12:01'
updated_date: '2025-11-27 12:13'
labels:
  - frontend
  - backend
  - feature
  - docker
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new "docker-volume" format to the existing certificate download format dropdown. This format will export certificates with their CA chain as a .tar file structured for direct import into Docker volumes.

**Current System Context:**
- Download format selection exists in both single certificate (`certificates.$id.tsx`) and bulk download (`certificates.tsx`) dialogs
- 13 formats already supported (pem, der, pkcs12, jks, etc.) defined in `schemas.ts`
- Backend handles formats in `certificate.ts` procedures: `download` (single) and `bulkDownload` (bulk)
- JKS format already shows a progress popup during export and an info popup with usage instructions after download

**New Format Requirements:**
- Add `docker-volume` option to DOWNLOAD_FORMATS array in both frontend files
- Add format to Zod schema enums in `schemas.ts`
- Implement backend handler creating .tar with structure: `/certs/{cn}.pem`, `/certs/{cn}.key`, `/certs/ca-chain.pem`
- Show progress popup during tar creation (similar to JKS)
- Show post-download info popup with Docker volume import command:
  ```bash
  docker run --rm -v my_volume:/data -v $(pwd):/backup busybox tar xvf /backup/certificates.tar -C /data
  ```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 "Docker Volume" option appears in download format dropdown (both single and bulk)
- [x] #2 Exported .tar file contains certificate, private key, and full CA chain in proper directory structure
- [x] #3 Progress popup shows export status during tar creation
- [x] #4 Post-download info popup displays Docker volume import command with copy-to-clipboard
- [x] #5 Works for both single certificate and bulk certificate downloads
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Files Modified:

**Backend:**
- `backend/src/trpc/schemas.ts` - Added `docker-volume` format to Zod enums
- `backend/src/trpc/procedures/certificate.ts` - Implemented docker-volume handlers for single and bulk download

**Frontend:**
- `frontend/src/routes/certificates.$id.tsx` - Added Docker Volume format option with progress and info popups
- `frontend/src/routes/certificates.tsx` - Added Docker Volume format option with progress and info popups for bulk download

### Features:
- New "Docker Volume - TAR for Docker volume import" option in download format dropdown
- Progress popup during TAR creation
- Info popup after download with:
  - TAR file structure explanation
  - Docker volume import command (copy-able)
  - Docker Compose usage example (copy-able)
<!-- SECTION:NOTES:END -->
