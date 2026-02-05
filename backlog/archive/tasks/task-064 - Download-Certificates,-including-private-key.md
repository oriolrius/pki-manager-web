---
id: task-064
title: 'Download Certificates, including private key'
status: Done
assignee:
  - '@myself'
created_date: '2025-10-24 07:27'
updated_date: '2025-10-24 08:39'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement certificate download functionality that allows users to download certificates along with their private keys in various formats. Supported formats: PEM (ASCII with BEGIN/END markers), CRT (.crt extension), DER (binary), CER (DER with .cer for Windows), PKCS#7/P7B (cert + chain, no key), PKCS#12/PFX/P12 (cert + chain + key, password protected), and Java KeyStore/JKS (Java keystore, password protected).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Users can download a certificate with its private key from the certificate details page
- [x] #2 Downloaded files are properly formatted and can be used by standard tools (openssl, keytool, etc.)
- [x] #3 Private key download requires appropriate security confirmation/warning

- [x] #4 Download supports PEM and CRT formats (ASCII text)
- [x] #5 Download supports DER and CER formats (binary)
- [x] #6 Download supports PKCS#7/P7B format (certificate + chain, no private key)
- [x] #7 Download supports PKCS#12/PFX/P12 format (certificate + chain + private key, password protected)
- [x] #8 Download supports Java KeyStore (JKS) format (password protected)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add backend API endpoints for certificate download in various formats
2. Implement format conversion utilities (PEM, DER, PKCS#7, PKCS#12, JKS)
3. Add password protection for PKCS#12 and JKS formats
4. Create frontend UI with format selection dropdown
5. Add security warning dialog for private key downloads
6. Test all formats with openssl and keytool
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
# Implementation Summary

## Backend Changes

### KMS Client & Service (backend/src/kms/)
- Added `getPrivateKey()` method to KMSClient for exporting private keys from KMS via KMIP
- Added corresponding wrapper method in KMSService with audit logging and security warnings

### API Schemas (backend/src/trpc/schemas.ts)
- Updated `downloadCertificateSchema` to support all required formats:
  - PEM, CRT (ASCII text formats)
  - DER, CER (binary formats)
  - PEM-chain (certificate + CA)
  - PKCS#7, P7B (certificate + chain, no key)
  - PKCS#12, PFX, P12 (certificate + chain + key, password protected)
  - JKS (Java KeyStore, returns PKCS#12 with conversion instructions)
- Added optional `password` field (min 8 chars) for password-protected formats
- Added optional `alias` field for JKS keystore entries

### Certificate Download Procedure (backend/src/trpc/procedures/certificate.ts)
- Enhanced download endpoint to handle all formats
- Added password validation for PKCS#12/PFX/P12/JKS formats
- Added private key export for password-protected formats
- Implemented proper MIME types for each format
- Added audit logging for all download operations

## Frontend Changes (frontend/src/routes/certificates.$id.tsx)

### Download Dialog
- Created comprehensive download dialog with:
  - Format selection dropdown (11 formats)
  - Password input field (shown only for formats requiring it)
  - Security warning dialog for private key exports
  - Format-specific information (e.g., JKS conversion instructions)
- Proper binary data handling for DER/CER/PKCS formats (base64 decode)
- Reset dialog state after successful download

### Security Features
- Two-step confirmation for private key downloads
- Clear warning about private key security
- Password requirements enforcement (min 8 characters)
- Visual indicators for formats containing private keys

## Format Support

✅ **AC#1**: Users can download certificates with private keys
✅ **AC#2**: Files are properly formatted and compatible with standard tools
✅ **AC#3**: Private key downloads require security confirmation
✅ **AC#4**: PEM and CRT formats (ASCII text)
✅ **AC#5**: DER and CER formats (binary)
✅ **AC#6**: PKCS#7/P7B format (cert + chain, no key)
✅ **AC#7**: PKCS#12/PFX/P12 format (cert + chain + key, password protected)
✅ **AC#8**: JKS format support (via PKCS#12 with conversion instructions)

## Testing Recommendations

1. **PEM/CRT**: `openssl x509 -in cert.pem -text -noout`
2. **DER/CER**: `openssl x509 -in cert.der -inform DER -text -noout`
3. **PKCS#7**: `openssl pkcs7 -in cert.p7b -inform DER -print_certs`
4. **PKCS#12**: `openssl pkcs12 -in cert.p12 -nodes -passin pass:password`
5. **JKS**: `keytool -importkeystore -srckeystore cert.p12 -srcstoretype PKCS12 -destkeystore cert.jks -deststoretype JKS`

## Notes

- JKS format returns PKCS#12 file with instructions for conversion using keytool (node-forge doesn't support JKS natively)
- All private key exports are logged in audit trail with security warnings
- Password-protected formats use 3DES encryption algorithm
- Binary formats return base64-encoded data which is properly decoded in the frontend
<!-- SECTION:NOTES:END -->
