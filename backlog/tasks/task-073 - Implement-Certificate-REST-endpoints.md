---
id: task-073
title: Implement Certificate REST endpoints
status: In Progress
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 16:56'
labels:
  - openapi
  - backend
  - certificates
dependencies:
  - task-069
  - task-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for Certificate management:

- GET /api/v1/certificates - List certificates with filtering
- POST /api/v1/certificates - Issue new certificate
- GET /api/v1/certificates/{id} - Get certificate details
- POST /api/v1/certificates/{id}/renew - Renew certificate
- POST /api/v1/certificates/{id}/revoke - Revoke certificate
- DELETE /api/v1/certificates/{id} - Delete certificate
- GET /api/v1/certificates/{id}/download - Download certificate

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /api/v1/certificates returns paginated list with pagination metadata (total, limit, offset, hasMore)
- [ ] #2 GET /api/v1/certificates supports filtering by status (active/revoked/expired), type (server/client/email/code_signing), and caId
- [ ] #3 GET /api/v1/certificates supports search parameter for subject DN text search
- [ ] #4 POST /api/v1/certificates issues certificate with valid subject, type, caId and returns certificate details
- [ ] #5 POST /api/v1/certificates validates required fields (subject.cn, subject.o, subject.c, type, caId)

- [ ] #6 POST /api/v1/certificates enforces type-specific validations (server requires DNS SAN, client requires unique identifier)
- [ ] #7 GET /api/v1/certificates/{id} returns certificate details or 404 for non-existent certificate
- [ ] #8 POST /api/v1/certificates/{id}/renew creates new certificate maintaining subject and type
- [ ] #9 POST /api/v1/certificates/{id}/renew returns 409 if certificate already revoked or expired
- [ ] #10 POST /api/v1/certificates/{id}/revoke marks certificate revoked with reason and timestamp
- [ ] #11 POST /api/v1/certificates/{id}/revoke returns 409 if already revoked
- [ ] #12 DELETE /api/v1/certificates/{id} deletes revoked certificate and returns 409 for active certificates
- [ ] #13 GET /api/v1/certificates/{id}/download returns certificate in requested format via query parameter
- [ ] #14 Download endpoint supports formats: pem, der, p12, jks, chain-pem, key-pem, key-der, pkcs8-pem, pkcs8-der
- [ ] #15 All endpoints return errors in standard format: {error: {code, message, details?}}
- [ ] #16 All certificate endpoints documented in OpenAPI spec at /api/v1/openapi.json
- [ ] #17 Integration tests in certificate.routes.test.ts cover all 7 endpoints with success and error cases
- [ ] #18 Tests validate HTTP status codes: 200/201 success, 400 validation errors, 404 not found, 409 conflict
<!-- AC:END -->
