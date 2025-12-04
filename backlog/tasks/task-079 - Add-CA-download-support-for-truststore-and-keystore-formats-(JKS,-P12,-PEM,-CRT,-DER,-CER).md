---
id: task-079
title: >-
  Add CA download support for truststore and keystore formats (JKS, P12, PEM,
  CRT, DER, CER)
status: To Do
assignee: []
created_date: '2025-12-04 11:32'
updated_date: '2025-12-04 11:36'
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
Extend the CA download functionality to support both keystore formats (with private key) and truststore formats (public certificate only), enabling users to download CA certificates in formats suitable for Java applications and other trust stores.

## Current State
- CA downloads only support 4 formats: PEM, CRT, DER, CER (via `/cas/{id}.{format}`)
- Certificate downloads support 15 formats including P12 and JKS (via `/api/v1/certificates/{id}/download`)
- JKS services already exist in `backend/src/services/jks.service.ts`:
  - `createKeystore()` - includes private key
  - `createTruststore()` - public certificate only
- Frontend CA detail page (`frontend/src/routes/cas.$id.tsx`) has dropdown with 4 format options
- Storage location section shows hardcoded URLs for PEM, CRT, DER, CER formats only

## Requirements

### 1. Backend REST API Enhancements
**File:** `backend/src/rest/routes/ca.routes.ts`

Add new endpoint:
- `GET /api/v1/cas/{id}/download?format={format}&password={password}`

**Supported formats:**

| Format | Description | Contains Private Key |
|--------|-------------|---------------------|
| `pem` | PEM text format | No |
| `crt` | CRT text certificate | No |
| `der` | DER binary compact | No |
| `cer` | CER Windows compatible | No |
| `p12-truststore` | PKCS#12 truststore (public cert only) | No |
| `p12-keystore` | PKCS#12 keystore (cert + private key) | **Yes** |
| `jks-truststore` | Java KeyStore truststore (public cert only) | No |
| `jks-keystore` | Java KeyStore keystore (cert + private key) | **Yes** |

- Password parameter required for P12 and JKS formats (default: "changeit")
- Keystore formats require KMS access to retrieve private key

### 2. Frontend Dropdown Enhancement
**File:** `frontend/src/routes/cas.$id.tsx`

Update the format dropdown to include all 8 formats:
- Certificate only: PEM, CRT, DER, CER
- Truststore (public cert): P12 Truststore, JKS Truststore  
- Keystore (cert + key): P12 Keystore, JKS Keystore

Add password input field that appears when P12 or JKS format is selected.

### 3. Storage Location Section Update
**File:** `frontend/src/routes/cas.$id.tsx`

Update the storage location section to show URLs for all supported formats:
- `/api/v1/cas/{id}/download?format=pem`
- `/api/v1/cas/{id}/download?format=jks-truststore`
- `/api/v1/cas/{id}/download?format=jks-keystore`
- etc.

Group by category (Certificate, Truststore, Keystore) for clarity.

### 4. OpenAPI Documentation
**File:** `backend/src/rest/openapi.ts` and `backend/src/rest/schemas/openapi-schemas.ts`

Document the new CA download endpoint with:
- All 8 format options with clear descriptions
- Password parameter description
- Security note: keystore formats expose private key
- Response types and MIME types

### Technical Notes
- **Truststore:** Contains only the public certificate, used to verify signatures/establish trust
- **Keystore:** Contains certificate AND private key, used for signing/authentication
- JKS generation uses `jksService.createTruststore()` and `jksService.createKeystore()` (requires Java keytool)
- P12 truststore/keystore can use node-forge directly
- Binary formats should use `application/octet-stream` MIME type
- Keystore downloads should have appropriate security warnings
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA download dropdown at /cas/:id includes all 8 format options: PEM, CRT, DER, CER, P12-truststore, P12-keystore, JKS-truststore, JKS-keystore
- [ ] #2 Storage location section at /cas/:id shows download URLs for all formats grouped by category
- [ ] #3 Password input field appears when any P12 or JKS format is selected
- [ ] #4 REST API endpoint GET /api/v1/cas/{id}/download accepts format query parameter with all 8 formats
- [ ] #5 Truststore formats (p12-truststore, jks-truststore) contain only the public certificate, no private key
- [ ] #6 Keystore formats (p12-keystore, jks-keystore) contain both certificate and private key from KMS
- [ ] #7 P12 and JKS downloads work with optional password parameter (default: changeit)
- [ ] #8 OpenAPI specification documents the CA download endpoint with all formats, parameters, and security notes

- [ ] #9 Downloaded JKS-truststore file can be used to verify certificates in Java applications
- [ ] #10 Downloaded JKS-keystore file can be used for CA signing operations in Java applications
<!-- AC:END -->
