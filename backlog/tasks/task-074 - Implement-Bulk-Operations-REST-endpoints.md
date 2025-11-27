---
id: task-074
title: Implement Bulk Operations REST endpoints
status: In Progress
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 18:39'
labels:
  - openapi
  - backend
  - bulk
dependencies:
  - task-073
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for bulk certificate operations:

- POST /api/v1/certificates/bulk/issue - Bulk issue from CSV
- POST /api/v1/certificates/bulk/revoke - Bulk revoke certificates
- POST /api/v1/certificates/bulk/renew - Bulk renew certificates
- DELETE /api/v1/certificates/bulk - Bulk delete certificates
- POST /api/v1/certificates/bulk/download - Bulk download certificates

Reference: doc-005 (OpenAPI Specification Design)

## CSV Format for Bulk Issue
```
certificateType,commonName,organization,country,sanString,validityDays
server,api.example.com,ACME Corp,US,example.com;*.example.com;192.168.1.1,365
client,john.doe@example.com,ACME Corp,US,,730
```

## Download Formats
pem, crt, der, cer, pem-chain, pem-key, pkcs7, p7b, pkcs12, pfx, p12, jks-keystore, jks-truststore, docker-volume, all
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/v1/certificates/bulk/issue accepts multipart/form-data with caId, csvData, and optional defaultValidityDays
- [ ] #2 Bulk issue parses CSV with fields: certificateType, commonName, organization, country, sanString, validityDays
- [ ] #3 Bulk issue validates certificateType is one of: server, client, code_signing, email
- [ ] #4 Bulk issue auto-detects SAN types from semicolon-separated string (DNS, IP, Email)
- [ ] #5 Bulk issue returns partial success response: {successful, failed, results: [{row, success, certificateId?, subject?, serialNumber?, error?}]}

- [ ] #6 POST /api/v1/certificates/bulk/revoke accepts JSON with certificateIds array (max 100), reason enum, optional details
- [ ] #7 Bulk revoke reason accepts: unspecified, keyCompromise, caCompromise, affiliationChanged, superseded, cessationOfOperation, certificateHold, privilegeWithdrawn
- [ ] #8 Bulk revoke returns 409 for already-revoked certificates in results array
- [ ] #9 Bulk revoke returns partial success response: {successful, failed, results: [{certificateId, success, error?}]}
- [ ] #10 POST /api/v1/certificates/bulk/renew accepts JSON with certificateIds array (max 100), generateNewKey boolean, optional validityDays, revokeOriginal boolean
- [ ] #11 Bulk renew returns 409 for revoked certificates in results array
- [ ] #12 Bulk renew returns partial success response: {successful, failed, results: [{originalCertificateId, newCertificateId?, success, error?}]}
- [ ] #13 DELETE /api/v1/certificates/bulk accepts JSON with certificateIds array (max 100), destroyKey boolean, removeFromCrl boolean
- [ ] #14 Bulk delete returns 409 for active non-expired certificates in results array (must be revoked OR expired > 90 days)
- [ ] #15 Bulk delete returns partial success response: {successful, failed, results: [{certificateId, success, error?}]}
- [ ] #16 POST /api/v1/certificates/bulk/download accepts JSON with certificateIds array (max 100), format enum, optional password, encryptPrivateKey boolean
- [ ] #17 Bulk download supports formats: pem, crt, der, cer, pem-chain, pem-key, pkcs7, p7b, pkcs12, pfx, p12, jks-keystore, jks-truststore, docker-volume, all
- [ ] #18 Bulk download returns 400 when password missing for encrypted formats (pem-key, pkcs12, pfx, p12, jks-keystore, docker-volume, all with encryptPrivateKey=true)
- [ ] #19 Bulk download returns 400 when password missing for jks-truststore (always required)
- [ ] #20 Bulk download returns ZIP file with Content-Disposition header and application/zip mime type
- [ ] #21 All bulk endpoints return errors in standard format: {error: {code, message, details?}}
- [ ] #22 All bulk endpoints documented in OpenAPI spec at /api/v1/openapi.json
- [ ] #23 Integration tests in bulk.routes.test.ts cover all 5 endpoints with success and error cases
- [ ] #24 Tests validate HTTP status codes: 200/201 success, 400 validation errors, 404 not found, 409 conflict
- [ ] #25 Tests verify partial success handling returns both successful and failed results in same response
<!-- AC:END -->
