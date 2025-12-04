---
id: task-079
title: 'Add CA download support for truststore formats (JKS, P12, PEM, CRT, DER, CER)'
status: To Do
assignee: []
created_date: '2025-12-04 11:32'
labels:
  - backend
  - frontend
  - rest-api
  - openapi
  - feature
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the CA download functionality to support truststore formats, enabling users to download CA certificates in formats suitable for Java applications and other trust stores.

## Current State
- CA downloads only support 4 formats: PEM, CRT, DER, CER (via `/cas/{id}.{format}`)
- Certificate downloads support 15 formats including P12 and JKS (via `/api/v1/certificates/{id}/download`)
- JKS truststore service already exists in `backend/src/services/jks.service.ts` (createTruststore function)
- Frontend CA detail page (`frontend/src/routes/cas.$id.tsx`) has dropdown with 4 format options
- Storage location section shows hardcoded URLs for PEM, CRT, DER, CER formats only

## Requirements

### 1. Backend REST API Enhancements
**File:** `backend/src/rest/routes/ca.routes.ts`

Add new endpoint or extend existing:
- `GET /api/v1/cas/{id}/download?format={format}&password={password}`
- Supported formats: `pem`, `crt`, `der`, `cer`, `p12` (PKCS#12), `jks` (Java KeyStore truststore)
- Password parameter required for P12 and JKS formats (default: "changeit")

Implementation pattern to follow from certificate downloads in `certificate.routes.ts` (lines 745-1087).

### 2. Frontend Dropdown Enhancement
**File:** `frontend/src/routes/cas.$id.tsx`

Update the format dropdown (lines 454-463) to include:
- Current: PEM, CRT, DER, CER
- Add: P12 (PKCS#12 truststore), JKS (Java KeyStore truststore)

Add password input field that appears when P12 or JKS is selected.

### 3. Storage Location Section Update
**File:** `frontend/src/routes/cas.$id.tsx`

Update the storage location section (lines 602-652) to:
- Show URLs for all supported formats including JKS
- Format: `/api/v1/cas/{id}/download?format=jks`
- Note for password-protected formats

### 4. OpenAPI Documentation
**File:** `backend/src/rest/openapi.ts` and `backend/src/rest/schemas/openapi-schemas.ts`

Document the new CA download endpoint with:
- All supported format options
- Password parameter description
- Response types and MIME types
- Example requests

### Technical Notes
- JKS truststore generation uses `jksService.createTruststore()` which requires Java keytool
- P12 truststore can use node-forge directly (no Java dependency)
- Binary formats (DER, P12, JKS) should use `application/octet-stream` MIME type
- Include proper Content-Disposition headers for file downloads
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA download dropdown at /cas/:id includes options for PEM, CRT, DER, CER, P12, and JKS formats
- [ ] #2 Storage location section at /cas/:id shows download URLs for all formats including .jks
- [ ] #3 Password input field appears when P12 or JKS format is selected in dropdown
- [ ] #4 REST API endpoint GET /api/v1/cas/{id}/download accepts format query parameter with all supported formats
- [ ] #5 P12 and JKS downloads work with optional password parameter (default: changeit)
- [ ] #6 OpenAPI specification documents the CA download endpoint with all formats and parameters
- [ ] #7 Downloaded JKS file can be used as a truststore in Java applications
- [ ] #8 Downloaded P12 file can be imported as trusted certificate in browsers/OS
<!-- AC:END -->
