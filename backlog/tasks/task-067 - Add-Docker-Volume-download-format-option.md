---
id: task-067
title: Add "Docker Volume" download format option
status: To Do
assignee: []
created_date: '2025-11-27 12:01'
updated_date: '2025-11-27 12:04'
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
- [ ] #1 "Docker Volume" option appears in download format dropdown (both single and bulk)
- [ ] #2 Exported .tar file contains certificate, private key, and full CA chain in proper directory structure
- [ ] #3 Progress popup shows export status during tar creation
- [ ] #4 Post-download info popup displays Docker volume import command with copy-to-clipboard
- [ ] #5 Works for both single certificate and bulk certificate downloads
<!-- AC:END -->
