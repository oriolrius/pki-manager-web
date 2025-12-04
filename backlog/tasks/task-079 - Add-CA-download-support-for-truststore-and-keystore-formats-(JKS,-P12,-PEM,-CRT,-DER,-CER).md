---
id: task-079
title: >-
  Add CA download support for truststore and keystore formats (JKS, P12, PEM,
  CRT, DER, CER)
status: To Do
assignee: []
created_date: '2025-12-04 11:32'
updated_date: '2025-12-04 11:39'
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

## Security Consideration
**Password must NEVER be passed as a URL query parameter** - it would be visible in logs, browser history, and not encrypted in transit properly. Formats requiring a password must use POST with the password in the request body.

## Requirements

### 1. Backend REST API - Two Separate Endpoints

#### Public Formats (GET) - No sensitive data
**Endpoint:** `GET /api/v1/cas/{id}/download?format={format}`

| Format | Description | Contains Private Key |
|--------|-------------|---------------------|
| `pem` | PEM text format | No |
| `crt` | CRT text certificate | No |
| `der` | DER binary compact | No |
| `cer` | CER Windows compatible | No |
| `p12-truststore` | PKCS#12 truststore (public cert only) | No |
| `jks-truststore` | Java KeyStore truststore (public cert only) | No |

- Uses default password "changeit" for P12/JKS truststores (industry standard)
- No sensitive information in URL

#### Private Key Formats (POST) - Sensitive data in body
**Endpoint:** `POST /api/v1/cas/{id}/download`

**Request Body:**
```json
{
  "format": "jks-keystore" | "p12-keystore",
  "password": "user-provided-password"
}
```

| Format | Description | Contains Private Key |
|--------|-------------|---------------------|
| `p12-keystore` | PKCS#12 keystore (cert + private key) | **Yes** |
| `jks-keystore` | Java KeyStore keystore (cert + private key) | **Yes** |

- Password is **required** (no default) - forces user to set secure password
- Password transmitted securely in request body (encrypted via HTTPS)
- Keystore formats require KMS access to retrieve private key

### 2. Frontend Dropdown Enhancement
**File:** `frontend/src/routes/cas.$id.tsx`

Update the format dropdown to include all 8 formats:
- Certificate only: PEM, CRT, DER, CER
- Truststore (public cert): P12 Truststore, JKS Truststore  
- Keystore (cert + key): P12 Keystore, JKS Keystore

Password input field appears ONLY for keystore formats (p12-keystore, jks-keystore).
Download button triggers:
- GET request for public formats
- POST request with password payload for keystore formats

### 3. Storage Location Section Update
**File:** `frontend/src/routes/cas.$id.tsx`

Update the storage location section:
- Show direct URLs only for public formats (GET endpoints)
- For keystore formats, show a note like "Use Download button with password" instead of URL
- Group by category (Certificate, Truststore, Keystore) for clarity

### 4. OpenAPI Documentation
**File:** `backend/src/rest/openapi.ts` and `backend/src/rest/schemas/openapi-schemas.ts`

Document both endpoints:
- GET endpoint for public formats
- POST endpoint for keystore formats with request body schema
- Security notes explaining why POST is required for sensitive formats

### Technical Notes
- **Truststore:** Contains only the public certificate, used to verify signatures/establish trust
- **Keystore:** Contains certificate AND private key, used for signing/authentication
- JKS generation uses `jksService.createTruststore()` and `jksService.createKeystore()` (requires Java keytool)
- P12 truststore/keystore can use node-forge directly
- Binary formats should use `application/octet-stream` MIME type
- POST endpoint returns binary file as response (not JSON)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA download dropdown at /cas/:id includes all 8 format options: PEM, CRT, DER, CER, P12-truststore, P12-keystore, JKS-truststore, JKS-keystore
- [ ] #2 Storage location section shows direct URLs only for public formats (GET); keystore formats show instruction to use download button
- [ ] #3 Password input field appears ONLY when keystore format (p12-keystore, jks-keystore) is selected
- [ ] #4 GET /api/v1/cas/{id}/download?format={format} endpoint serves public formats: pem, crt, der, cer, p12-truststore, jks-truststore
- [ ] #5 POST /api/v1/cas/{id}/download endpoint with JSON body {format, password} serves keystore formats: p12-keystore, jks-keystore
- [ ] #6 Password is NEVER passed as URL query parameter - always in POST request body for security
- [ ] #7 Truststore formats use default password 'changeit'; keystore formats require user-provided password
- [ ] #8 OpenAPI specification documents both GET and POST endpoints with security rationale

- [ ] #9 Downloaded JKS-truststore file can be used to verify certificates in Java applications
- [ ] #10 Downloaded JKS-keystore file can be used for CA signing operations in Java applications
<!-- AC:END -->
