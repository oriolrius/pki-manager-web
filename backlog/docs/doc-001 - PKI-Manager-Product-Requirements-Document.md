---
id: doc-001
title: PKI Manager - Product Requirements Document
type: other
created_date: '2025-10-21 15:26'
---

# PKI Manager - Product Requirements Document

## 1. Executive Summary

### 1.1 Product Vision

PKI Manager is a web-based Public Key Infrastructure management application that enables organizations to securely generate, issue, manage, and revoke X.509 digital certificates. The application provides a complete certificate lifecycle management solution with enterprise-grade security through Cosmian KMS integration.

### 1.2 Key Objectives

- **Simplify PKI Operations**: Provide intuitive web interface for complex PKI operations
- **Enterprise Security**: Leverage Cosmian KMS for secure key generation and storage
- **Multi-Tenancy**: Support multiple root Certificate Authorities for different organizational units
- **Compliance**: Full X.509 standard compliance with comprehensive audit trails
- **Self-Service**: Enable authorized users to request and manage certificates independently

### 1.3 Target Users

- PKI Administrators
- Security Operations Teams
- DevOps Engineers
- System Administrators
- Application Owners

**Note**: Initial version focuses on core PKI operations. User authentication and role-based access control will be added in future releases.

### 1.4 Success Criteria

- Reduce time to issue certificates from hours to minutes
- 100% of private keys stored securely in KMS (never in database)
- Complete audit trail for all certificate operations
- Zero security incidents related to key compromise
- Support for 10,000+ certificates per root CA

---

## 2. Product Overview

### 2.1 Product Description

PKI Manager is a full-stack web application for managing digital certificates and Certificate Authorities. It provides:

- **Multiple Root CAs**: Create and manage multiple independent root Certificate Authorities
- **Certificate Lifecycle**: Issue, renew, revoke, and destroy certificates
- **Multi-Domain Support**: Manage certificates for multiple domains within each root CA
- **Certificate Types**: Support for server (TLS/SSL), client authentication, code signing, email encryption
- **Revocation**: Certificate Revocation Lists (CRL) generation and management
- **KMS Integration**: All cryptographic operations secured by Cosmian KMS
- **Audit Logging**: Comprehensive audit trail for compliance

### 2.2 Architecture Constraints

- **No CA Hierarchy**: Flat structure - multiple independent root CAs, no intermediate CAs
- **KMS-First**: All private keys generated and stored in Cosmian KMS
- **X.509 Compliance**: Full compliance with RFC 5280 (X.509 PKI Certificate and CRL Profile)
- **Web-Based**: React SPA with Fastify/tRPC backend
- **SQLite Storage**: Certificate metadata and audit logs in SQLite database

### 2.3 Out of Scope (v1.0)

- User authentication and login system
- Role-based access control (RBAC)
- User management (create/edit/delete users)
- Session management
- OCSP (Online Certificate Status Protocol) responder
- Certificate Templates
- Automated certificate renewal
- Integration with external ACME clients
- Certificate transparency logging
- Intermediate CA support (hierarchy)

---

## 3. User Roles & Permissions

**Status**: Future Enhancement (Post v1.0)

The initial version will operate without user authentication or role-based access control. All operations will be available to anyone with access to the application. User management, authentication, and authorization will be implemented in a future release.

---

## 4. Functional Requirements

### 4.1 Root CA Management

#### FR-CA-001: Create Root CA

**Description**: Create a new root Certificate Authority

**User Flow**:
1. Navigate to "Certificate Authorities" → "Create Root CA"
2. Fill in CA details form:
   - **Distinguished Name**:
     - Common Name (CN) - Required, max 64 chars
     - Organization (O) - Required, max 64 chars
     - Organizational Unit (OU) - Optional, max 64 chars
     - Country (C) - Required, 2 chars (ISO 3166-1)
     - State/Province (ST) - Optional, max 128 chars
     - Locality (L) - Optional, max 128 chars
   - **Key Configuration**:
     - Algorithm: RSA-4096, RSA-2048, ECDSA-P256, ECDSA-P384
     - Default: RSA-4096
   - **Validity Period**:
     - Not Before: Date picker (default: now)
     - Validity Years: Number input (1-30, default: 20)
   - **Tags/Labels**: Optional tags for organization
3. System validates input
4. User clicks "Create Root CA"
5. System displays confirmation dialog with security warning
6. Upon confirmation:
   - Backend generates key pair in Cosmian KMS
   - Creates self-signed root certificate
   - Stores certificate and metadata in database
   - Logs operation in audit trail
7. System displays success message with:
   - Certificate details
   - Download options (PEM, DER formats)
   - Certificate fingerprint (SHA-256)

**Acceptance Criteria**:
- ✅ Private key NEVER leaves KMS
- ✅ Root certificate stored in database
- ✅ KMS key ID stored in database
- ✅ Audit log entry created
- ✅ Certificate can be downloaded immediately
- ✅ Input validation prevents invalid DNs

**UI Components**:
- Form with validation
- Country code dropdown (ISO 3166-1)
- Algorithm radio buttons with descriptions
- Date picker for validity
- Confirmation dialog with warnings
- Success notification with download buttons

#### FR-CA-002: View Root CAs

**Description**: Users can view list of all root CAs with filtering and search

**User Flow**:
1. User navigates to "Certificate Authorities"
2. System displays table/card view of all root CAs:
   - **Table Columns**:
     - Common Name (CN)
     - Organization (O)
     - Status (Active, Expired, Revoked)
     - Issued Date
     - Expiry Date
     - Certificate Count (badge)
     - Actions (View, Download, Revoke)
   - **Filters**:
     - Status: All, Active, Expired, Revoked
     - Algorithm: All, RSA-4096, RSA-2048, ECDSA-P256, ECDSA-P384
     - Search: Free text (searches CN, O, OU)
   - **Sorting**:
     - Common Name (A-Z, Z-A)
     - Issued Date (newest/oldest)
     - Expiry Date (soonest/latest)
3. Click on CA row opens detail view

**Acceptance Criteria**:
- ✅ All CAs displayed with correct status
- ✅ Expired CAs highlighted in warning color
- ✅ Certificate count accurate
- ✅ Filtering works correctly
- ✅ Search is instant (client-side) or debounced (server-side)
- ✅ Sorting updates URL params

**UI Components**:
- Data table with sorting
- Status badges (Active=green, Expired=orange, Revoked=red)
- Filter dropdown/chips
- Search input with clear button
- Card view option for mobile

#### FR-CA-003: View Root CA Details

**Description**: Users can view comprehensive details of a root CA

**User Flow**:
1. User clicks on CA from list
2. System displays CA detail page with tabs:

   **Tab 1: Overview**
   - Certificate Information card:
     - Serial Number
     - Status badge
     - Issued Date
     - Expiry Date
     - Remaining Days (with progress bar)
     - Fingerprint (SHA-256, copyable)
   - Subject Distinguished Name card:
     - All DN components displayed
   - Issuer Distinguished Name card:
     - Same as subject (self-signed)
   - Key Information card:
     - Algorithm
     - Key Size/Curve
     - KMS Key ID (masked, copyable by admin only)
   - Extensions card:
     - Key Usage
     - Basic Constraints (CA:TRUE)
     - Subject Key Identifier

   **Tab 2: Certificates** (embedded list)
   - Table of certificates issued by this CA
   - Filters: Status, Type, Domain
   - Actions: View, Download, Revoke

   **Tab 3: Revocation**
   - CRL Information:
     - Last Generated
     - Next Update
     - Revoked Certificate Count
     - CRL Download button
   - Revocation Statistics chart:
     - Pie chart of revocation reasons

   **Tab 4: Audit Log**
   - Filterable audit log for this CA:
     - Timestamp
     - Operation
     - User
     - Details

3. Action buttons in header:
   - Download Certificate (PEM/DER/PKCS#7)
   - Generate CRL
   - Revoke CA (admin only, with confirmation)
   - Delete CA (admin only, if no active certificates)

**Acceptance Criteria**:
- ✅ All certificate details accurate
- ✅ Expiry warning if < 90 days
- ✅ Fingerprint copyable with one click
- ✅ Certificate count matches database
- ✅ Download formats work correctly
- ✅ Tabs load lazily for performance

#### FR-CA-004: Revoke Root CA

**Description**: Revoke a root CA

**User Flow**:
1. Click "Revoke CA" on CA detail page
2. System displays warning dialog:
   - Impact summary (e.g., "45 active certificates will be affected")
   - Revocation reason dropdown:
     - Key Compromise
     - CA Compromise
     - Affiliation Changed
     - Superseded
     - Cessation of Operation
   - Confirmation checkbox: "I understand this action cannot be undone"
   - Text input: "Type 'REVOKE' to confirm"
3. Admin selects reason and confirms
4. System:
   - Updates CA status to "Revoked"
   - Generates new CRL including CA certificate
   - Logs operation
   - Optionally revokes all issued certificates (checkbox option)
5. System displays success notification
6. CA marked as revoked in list views

**Acceptance Criteria**:
- ✅ Cannot revoke already revoked CA
- ✅ Revocation reason required
- ✅ Confirmation text must match
- ✅ CRL generated automatically
- ✅ Audit log updated
- ✅ Optional cascading revocation works

#### FR-CA-005: Delete Root CA

**Description**: Delete a root CA (destructive operation)

**Prerequisites**:
- CA must be revoked
- All certificates must be revoked or expired
- No active certificates

**User Flow**:
1. Admin clicks "Delete CA" on CA detail page
2. System checks prerequisites:
   - If not met, displays error with blockers
   - If met, displays danger dialog:
     - Warning: "This will permanently delete the CA and all associated data"
     - Impact summary
     - Checkbox: "Permanently delete KMS key" (optional, default unchecked)
     - Text input: "Type CA common name to confirm"
3. Admin types exact CN and confirms
4. System:
   - Deletes certificate records from database
   - Deletes CA record from database
   - Optionally destroys KMS key (if checkbox selected)
   - Archives audit logs (not deleted)
   - Cleans up orphaned CRLs
5. System displays success notification
6. Redirects to CA list

**Acceptance Criteria**:
- ✅ Cannot delete CA with active certificates
- ✅ Exact CN match required
- ✅ KMS key destruction is optional
- ✅ Audit logs preserved
- ✅ Operation logged before deletion
- ✅ No orphaned records remain

### 4.2 Certificate Management

#### FR-CERT-001: Issue Server Certificate

**Description**: Issue TLS/SSL server certificates

**User Flow**:
1. User navigates to "Certificates" → "Issue Certificate"
2. User selects:
   - Certificate Authority (dropdown of active CAs)
   - Certificate Type: "Server Authentication"
3. User fills in certificate request form:

   **Subject Information**:
   - Common Name (CN) - Required, domain name (e.g., example.com)
     - Validation: Valid domain name format
   - Organization (O) - Required
   - Organizational Unit (OU) - Optional
   - Country (C) - Required, 2 chars
   - State/Province (ST) - Optional
   - Locality (L) - Optional

   **Subject Alternative Names (SAN)** - Required for server certs:
   - DNS Names: Multi-input field
     - Add multiple DNS entries (e.g., example.com, www.example.com, *.example.com)
     - Wildcard support (*.domain.com)
     - Validation: Valid DNS format
   - IP Addresses: Multi-input field (optional)
     - IPv4 and IPv6 support
     - Validation: Valid IP format

   **Key Configuration**:
   - Algorithm: RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384
   - Default: RSA-2048

   **Validity**:
   - Valid From: Date picker (default: now)
   - Validity Period: Dropdown or number input
     - Options: 1 year, 2 years, 3 years, Custom days
     - Maximum: 825 days (per CA/B Forum baseline requirements)
     - Warning if > 398 days (Apple/Google policy)

   **Key Usage** (pre-selected for server type):
   - ☑ Digital Signature
   - ☑ Key Encipherment
   - Extended Key Usage: ☑ Server Authentication

   **Tags/Labels**: Optional metadata

4. User clicks "Review Certificate Request"
5. System displays preview:
   - Certificate details summary
   - DN preview
   - SAN list
   - Validity dates
   - Extensions
   - Estimated certificate serial number
6. User clicks "Issue Certificate"
7. System:
   - Generates key pair in KMS
   - Creates Certificate Signing Request (CSR) internally
   - Signs CSR with CA private key (via KMS)
   - Stores certificate in database
   - Links to issuing CA
   - Logs operation
8. System displays success page:
   - Certificate details
   - Download buttons:
     - Certificate only (PEM/DER)
     - Full chain (Certificate + CA)
     - PKCS#12 (if private key exportable - admin only)
   - View certificate button
   - Issue another certificate link

**Acceptance Criteria**:
- ✅ CN must be valid domain name
- ✅ At least one SAN required (matches CN or explicit)
- ✅ Validity period cannot exceed 825 days
- ✅ Serial number unique per CA
- ✅ Certificate stored with correct metadata
- ✅ KMS key created successfully
- ✅ Audit log entry created
- ✅ Certificate immediately downloadable

**Validation Rules**:
- CN: Required, valid domain format, max 64 chars
- SAN DNS: Valid DNS format, support wildcards
- SAN IP: Valid IPv4/IPv6 format
- Validity: Not before < Not after, Max 825 days
- Organization: Required, min 2 chars

**UI Components**:
- Multi-step form or single page with sections
- DNS/IP multi-input component (tags input)
- Algorithm selector with descriptions
- Date pickers with validation
- Preview modal
- Download button group
- Success confirmation with actions

#### FR-CERT-002: Issue Client Certificate

**Description**: Issue client authentication certificates

**User Flow**:
Similar to FR-CERT-001 with differences:

**Certificate Type**: "Client Authentication"

**Subject Information**:
- Common Name (CN) - Required, user email or identifier
  - Validation: Email format or username format
- Email Address - Optional (can be in SAN)
- Other DN fields same as server

**Subject Alternative Names** - Optional:
- Email addresses: Multi-input
  - Validation: Valid email format
- User Principal Name (UPN): Optional
  - Format: user@domain.com

**Key Usage** (pre-selected for client type):
- ☑ Digital Signature
- ☑ Key Encipherment (optional)
- Extended Key Usage: ☑ Client Authentication

**Validity**:
- Typically shorter than server certs
- Options: 1 year, 2 years, 3 years
- Default: 1 year

**Private Key Export**:
- Checkbox: "Generate exportable private key"
- If checked, allows PKCS#12 download with password

**Acceptance Criteria**:
- ✅ CN can be email or username
- ✅ At least one identity field (CN or email SAN)
- ✅ Client auth EKU set correctly
- ✅ PKCS#12 generation if exportable key requested

#### FR-CERT-003: Issue Code Signing Certificate

**Description**: Issue code signing certificates

**User Flow**:
Similar to FR-CERT-001 with differences:

**Certificate Type**: "Code Signing"

**Subject Information**:
- Common Name (CN) - Required, organization or developer name
- Organization (O) - Required, verified organization name
- Other DN fields required for EV code signing

**Key Usage** (pre-selected for code signing):
- ☑ Digital Signature
- Extended Key Usage: ☑ Code Signing

**Validity**:
- Maximum: 3 years
- Default: 1 year

**Enhanced Validation**:
- Additional verification requirements notice
- Organization validation status display

**Acceptance Criteria**:
- ✅ Organization required and verified
- ✅ Code signing EKU set correctly
- ✅ Stricter key requirements (RSA-3072 minimum or ECDSA-P256)
- ✅ Enhanced audit logging

#### FR-CERT-004: Issue Email Protection Certificate

**Description**: Issue S/MIME email encryption/signing certificates

**User Flow**:
Similar to FR-CERT-002 with differences:

**Certificate Type**: "Email Protection (S/MIME)"

**Subject Information**:
- Common Name (CN) - Required, user's full name
- Email Address - Required (in DN or SAN)

**Subject Alternative Names** - Required:
- Email Address: Primary email (required)
- Additional Email Addresses: Multi-input (optional)
  - Validation: All from same verified domain

**Key Usage** (pre-selected for S/MIME):
- ☑ Digital Signature
- ☑ Key Encipherment
- ☑ Data Encipherment
- Extended Key Usage: ☑ Email Protection

**Acceptance Criteria**:
- ✅ At least one email address required
- ✅ Email protection EKU set correctly
- ✅ Both encryption and signing capabilities

#### FR-CERT-005: View Certificates

**Description**: Users can view, filter, and search all certificates

**User Flow**:
1. User navigates to "Certificates"
2. System displays certificate list/table:

   **Table Columns**:
   - Select (checkbox for bulk operations)
   - Status Icon (colored dot)
   - Subject CN
   - Type (badge: Server, Client, Code Signing, Email)
   - Issuer CA
   - Issued Date
   - Expiry Date
   - Remaining Days (color-coded)
   - Actions (View, Download, Renew, Revoke)

   **Filters** (multi-select):
   - Status:
     - ☐ Active (green)
     - ☐ Expired (orange)
     - ☐ Revoked (red)
     - ☐ Expiring Soon (< 30 days, yellow)
   - Certificate Authority: Dropdown (all CAs)
   - Certificate Type: Server, Client, Code Signing, Email
   - Domain: Auto-complete from existing domains
   - Date Range: Date picker (Issued/Expiry)

   **Search**:
   - Free text search: CN, Subject, SAN, Serial Number
   - Debounced, highlights matches

   **Sorting**:
   - All columns sortable
   - Default: Expiry Date (ascending, soonest first)

   **Bulk Actions** (checkbox selection):
   - Download Selected (ZIP)
   - Export to CSV
   - Revoke Selected (admin only, with confirmation)

   **Pagination**:
   - Items per page: 10, 25, 50, 100
   - Total count displayed
   - Page numbers + Previous/Next

3. Click on row opens certificate detail view

**Acceptance Criteria**:
- ✅ All certificates displayed correctly
- ✅ Status colors match certificate state
- ✅ Expiring soon highlighted
- ✅ Filters work individually and combined
- ✅ Search instant or < 300ms response
- ✅ Sorting updates URL params
- ✅ Pagination preserves filters
- ✅ Bulk actions work with selected items only

**UI Components**:
- Data table with virtual scrolling (for large datasets)
- Multi-select filter chips
- Search input with typeahead
- Checkbox column with "select all"
- Status badges and icons
- Dropdown actions menu
- Pagination controls

#### FR-CERT-006: View Certificate Details

**Description**: Users can view comprehensive certificate details

**User Flow**:
1. User clicks certificate from list or search
2. System displays certificate detail page:

   **Header Section**:
   - Certificate CN (title)
   - Status badge (Active/Expired/Revoked/Expiring Soon)
   - Serial Number (copyable)
   - Action buttons:
     - Download ⬇ (dropdown: PEM, DER, PKCS#7, Full Chain)
     - Renew 🔄 (if renewable)
     - Revoke ⛔ (if active)
     - Delete 🗑️ (if revoked/expired, admin only)

   **Tab 1: Details**

   *Certificate Information Card*:
   - Type: Badge (Server/Client/etc.)
   - Serial Number: Hex format, copyable
   - Status: Badge with explanation
   - Fingerprint SHA-256: Hex, copyable, formatted
   - Fingerprint SHA-1: Hex, copyable (for legacy compat)

   *Subject Distinguished Name Card*:
   - Common Name (CN)
   - Organization (O)
   - Organizational Unit (OU)
   - Country (C)
   - State (ST)
   - Locality (L)
   - Email (if present)
   - Copy all DN button

   *Issuer Distinguished Name Card*:
   - Same fields as subject
   - Link to CA detail page

   *Validity Period Card*:
   - Not Before: Date + time, timezone
   - Not After: Date + time, timezone
   - Valid For: Human-readable duration
   - Remaining: Days/hours remaining (if active)
   - Progress bar: Visual expiry timeline
   - Warning if < 30 days

   *Subject Alternative Names Card* (if present):
   - DNS Names: List with copy buttons
   - IP Addresses: List with copy buttons
   - Email Addresses: List with copy buttons
   - URIs: List with copy buttons

   *Key Information Card*:
   - Algorithm: RSA/ECDSA
   - Key Size/Curve: 2048/4096/P-256/P-384
   - Public Key: Expandable hex view, copyable
   - KMS Key ID: Masked (admin only), copyable

   *Extensions Card*:
   - Key Usage: List of usages (with icons)
   - Extended Key Usage: List with descriptions
   - Basic Constraints: CA flag, path length
   - Subject Key Identifier: Hex, copyable
   - Authority Key Identifier: Hex, copyable
   - CRL Distribution Points: URLs (clickable)
   - Other extensions: Expandable list

   **Tab 2: Raw Certificate**
   - PEM format: Code block, copyable
   - DER format: Hex dump, downloadable
   - Text format: OpenSSL-style output
   - Syntax highlighting for PEM

   **Tab 3: Revocation Status**
   - Current Status: Badge
   - Revocation Date: (if revoked)
   - Revocation Reason: (if revoked)
   - CRL URL: Link to download
   - CRL Last Updated: Timestamp
   - OCSP Status: (future) Not supported / responder URL

   **Tab 4: Audit History**
   - Timeline view of all operations:
     - Certificate Issued
     - Certificate Downloaded
     - Certificate Renewed
     - Certificate Revoked
     - Status Changes
   - Each entry shows:
     - Timestamp
     - Operation
     - Details: Expandable JSON
     - IP Address: (if available)

3. Responsive layout: Mobile view collapses cards to accordion

**Acceptance Criteria**:
- ✅ All certificate fields displayed accurately
- ✅ Fingerprints match actual certificate
- ✅ Copy buttons work (with toast notification)
- ✅ Links to CA detail page work
- ✅ Extension details parsed and readable
- ✅ Raw certificate formats correct
- ✅ Audit log complete and accurate
- ✅ Expiry warnings work correctly

**UI Components**:
- Card layout for information groups
- Copy button component with success feedback
- Status badge component
- Progress bar for validity timeline
- Code block with syntax highlighting
- Timeline component for audit log
- Accordion for mobile view
- Download dropdown menu

#### FR-CERT-007: Renew Certificate

**Description**: Renew certificates before or after expiry

**User Flow**:
1. User clicks "Renew" from certificate detail or list action
2. System displays renewal form:

   **Pre-filled Information** (editable):
   - Subject DN: All fields from original certificate
   - Subject Alternative Names: All SANs from original
   - Certificate Type: Same as original
   - Key Algorithm: Same as original (changeable)

   **Renewal Options**:
   - Reuse Existing Key:
     - ○ Generate New Key Pair (recommended, default)
     - ○ Reuse Original Key (only if original key in KMS)
       - Warning: "Reusing keys reduces security"
       - Only available if original cert < 90 days old

   - Validity Period:
     - Default: Same as original or max allowed
     - Options: 1 year, 2 years, 3 years, Custom
     - Warning if original was shorter

   - Update Information:
     - Checkbox: "Update subject/SAN information"
     - If checked, allows editing DN and SANs
     - Otherwise, copies exact values

   **Renewal Metadata**:
   - Renewal Reason: Dropdown
     - Normal Renewal
     - Key Compromise (forces new key)
     - Information Update
     - Cryptographic Upgrade
   - Notes: Text area (optional, stored in audit log)

3. User clicks "Review Renewal"
4. System displays comparison view:
   - Side-by-side: Original vs New
   - Highlights changes (if any)
   - Shows new validity dates
5. User clicks "Renew Certificate"
6. System:
   - Generates new key pair (if selected)
   - Issues new certificate with incremented serial
   - Links to original certificate (renewal chain)
   - Optionally revokes original (checkbox option)
   - Logs renewal operation
7. System displays success:
   - New certificate details
   - Download buttons
   - Link to new certificate
   - Optional: "Revoke original certificate?" prompt

**Acceptance Criteria**:
- ✅ Renewal preserves subject/SAN unless updated
- ✅ New serial number generated
- ✅ Key compromise forces new key
- ✅ Renewal chain tracked in database
- ✅ Original certificate optionally revoked
- ✅ Audit log links renewal to original
- ✅ Download immediately available

**Validation Rules**:
- Cannot renew revoked certificate (must re-issue)
- Key reuse only if original < 90 days old and in KMS
- Validity period cannot exceed CA remaining validity
- If key compromise, must generate new key

**UI Components**:
- Pre-filled form with edit capability
- Radio button group for key options
- Warning alerts for security implications
- Comparison table (original vs new)
- Checkbox for optional revocation
- Renewal reason dropdown

#### FR-CERT-008: Revoke Certificate

**Description**: Revoke active certificates

**User Flow**:
1. User clicks "Revoke" from certificate detail or list action
2. System displays revocation dialog:

   **Certificate Summary**:
   - Common Name
   - Serial Number
   - Issued Date
   - Currently Active indicator

   **Revocation Form**:
   - Revocation Reason: Dropdown (required)
     - ○ Unspecified
     - ○ Key Compromise ⚠️
     - ○ CA Compromise ⚠️
     - ○ Affiliation Changed
     - ○ Superseded
     - ○ Cessation of Operation
     - ○ Certificate Hold (temporary, future)
     - ○ Privilege Withdrawn

   - Effective Date: Date picker
     - Default: Now
     - Can backdate up to issued date
     - Warning if backdating

   - Reason Details: Text area (optional)
     - Max 500 chars
     - Stored in audit log

   **Impact Assessment**:
   - Automatic check for dependent systems
   - Warning if certificate is actively used (future: monitoring integration)
   - List of affected services (if known)

   **Confirmation**:
   - Checkbox: ☐ "I understand this certificate will be revoked and will no longer be trusted"
   - Checkbox: ☐ "Generate and publish updated CRL immediately"
     - Default: checked
     - If unchecked, warning about CRL lag time
   - Text input: "Type 'REVOKE' to confirm"

3. User types "REVOKE" and confirms
4. System:
   - Updates certificate status to "Revoked"
   - Records revocation date and reason
   - Adds to CA's revocation list
   - Generates new CRL (if selected)
   - Logs operation with full context
   - Sends notification (future: email/webhook)
5. System displays success notification:
   - "Certificate revoked successfully"
   - "CRL updated and ready for download"
   - Button: "Download Updated CRL"
   - Button: "View Certificate"

**Acceptance Criteria**:
- ✅ Cannot revoke already revoked certificate
- ✅ Revocation reason required
- ✅ Effective date validated (between issued and now)
- ✅ Certificate status updated immediately
- ✅ CRL generated if option selected
- ✅ Audit log includes full context
- ✅ Confirmation text must match exactly
- ✅ Reason details stored properly

**Validation Rules**:
- Certificate must be active (not expired or already revoked)
- Effective date must be >= issued date and <= current date
- Confirmation text case-sensitive: "REVOKE"

**UI Components**:
- Modal dialog with danger styling
- Revocation reason dropdown with icons
- Date picker with validation
- Text area for details
- Impact assessment card (if applicable)
- Confirmation checkboxes
- Text input for confirmation
- Danger-styled confirm button

#### FR-CERT-009: Delete Certificate

**Description**: Permanently delete certificate records (destructive operation)

**Prerequisites**:
- Certificate must be revoked OR expired for > 90 days
- Cannot delete if referenced in active audit/compliance requirements

**User Flow**:
1. Click "Delete" on certificate detail page
2. System checks prerequisites:
   - If not met, display error with blocking reasons
   - If met, display danger dialog:

     **Warning Message**:
     - "⚠️ DANGER: Permanent Deletion"
     - "This will permanently delete the certificate record from the database"
     - "This action CANNOT be undone"

     **Impact Assessment**:
     - "Certificate status: Revoked/Expired"
     - "Revocation date: [date]"
     - "Audit log entries: Will be preserved"
     - "KMS key: Will be destroyed" (if option selected)

     **Deletion Options**:
     - Checkbox: ☐ "Destroy private key in KMS"
       - Default: checked
       - Warning: "Key cannot be recovered after destruction"
     - Checkbox: ☐ "Remove from CRL"
       - Default: unchecked (keep in CRL for historical tracking)
       - Info: "Recommended to keep in CRL for audit purposes"

     **Confirmation**:
     - Text input: "Type the certificate serial number to confirm"
     - Serial number displayed above input (copyable)

3. Type exact serial number
4. Click "Permanently Delete Certificate"
5. System:
   - Verifies prerequisites again
   - Archives audit log entries (not deleted)
   - Optionally destroys KMS key
   - Removes certificate from CRL (if selected)
   - Deletes certificate record from database
   - Logs deletion operation (before deleting)
   - Cleans up orphaned metadata
6. System displays success notification
7. Redirects to certificate list

**Acceptance Criteria**:
- ✅ Cannot delete active certificates
- ✅ Cannot delete recently revoked (< 90 days)
- ✅ Serial number must match exactly
- ✅ Audit logs preserved
- ✅ KMS key destruction optional
- ✅ Operation logged before deletion
- ✅ No orphaned records

**Validation Rules**:
- Certificate status must be "Revoked" or "Expired"
- If revoked, must be > 90 days since revocation
- Serial number must match exactly (case-insensitive hex)

**UI Components**:
- Danger modal dialog
- Impact assessment card
- Checkbox group for options
- Serial number display (copyable)
- Text input for confirmation
- Red/danger styled delete button

#### FR-CERT-010: Download Certificate

**Description**: Users can download certificates in various formats

**Available Formats**:

1. **Certificate Only - PEM** (.pem, .crt)
   - BEGIN/END CERTIFICATE
   - Base64 encoded DER
   - Most common format

2. **Certificate Only - DER** (.der, .cer)
   - Binary format
   - For Windows/Java applications

3. **Certificate Chain - PEM** (.pem)
   - End-entity certificate + CA certificate
   - Concatenated PEM format
   - For web servers (Apache, Nginx)

4. **Certificate Chain - PKCS#7** (.p7b)
   - PKCS#7/CMS format
   - Certificate + CA certificate
   - For Windows certificate stores

5. **PKCS#12** (.p12, .pfx) - If key exportable
   - Certificate + private key
   - Password protected
   - For client import (browsers, email clients)

**User Flow - Single Download**:
1. User clicks "Download" button on certificate detail/list
2. System displays download format dropdown:
   - PEM (Certificate) - default
   - DER (Certificate)
   - PEM (Full Chain)
   - PKCS#7 (Full Chain)
   - PKCS#12 (Certificate + Key) - if available
3. User selects format
4. For PKCS#12, additional dialog:
   - Password input (min 8 chars, complexity required)
   - Confirm password
   - Warning: "Store password securely"
5. System generates file:
   - Correct MIME type
   - Suggested filename: `{CN}-{serial}.{ext}`
   - Download triggered
6. Audit log entry created

**User Flow - Bulk Download**:
1. User selects multiple certificates (checkboxes)
2. User clicks "Download Selected"
3. System displays bulk download dialog:
   - Selected count: "5 certificates selected"
   - Format: Dropdown (PEM/DER only for bulk)
   - Include chain: Checkbox
   - Archive format: ○ ZIP ○ TAR.GZ
4. User clicks "Download Archive"
5. System:
   - Generates all certificate files
   - Creates archive with organized structure:
     ```
     certificates.zip
     ├── example-com-1234.pem
     ├── test-com-5678.pem
     └── ...
     ```
   - Triggers download
6. Audit log entry for bulk download

**Acceptance Criteria**:
- ✅ All formats generate correctly
- ✅ PEM format has correct headers
- ✅ DER format is valid binary
- ✅ Chain includes correct CA certificate
- ✅ PKCS#12 password protected
- ✅ PKCS#12 includes certificate + key
- ✅ Filenames meaningful and safe
- ✅ MIME types correct
- ✅ Bulk download organized in ZIP
- ✅ Audit log captures format

**Validation Rules**:
- PKCS#12 password: Min 8 chars, uppercase, lowercase, number
- PKCS#12 only if key exportable
- Bulk download max 100 certificates at once
- Chain download includes valid CA certificate

**UI Components**:
- Download button with dropdown menu
- Password input modal for PKCS#12
- Progress indicator for bulk downloads
- Download success toast notification

### 4.3 Certificate Revocation List (CRL) Management

#### FR-CRL-001: Generate CRL

**Description**: System can generate Certificate Revocation Lists for each CA

**User Flow - Manual Generation**:
1. User navigates to CA detail page → Revocation tab
2. User clicks "Generate CRL"
3. System displays CRL generation dialog:

   **CRL Configuration**:
   - CRL Number: Auto-increment (display only)
   - This Update: Current date/time (display only)
   - Next Update: Date picker
     - Default: +7 days from now
     - Options: 1 day, 7 days, 30 days, Custom
     - Validation: Must be > This Update
     - Warning if > 30 days

   - Include Extensions: Checkboxes
     - ☑ CRL Number (required)
     - ☑ Authority Key Identifier (required)
     - ☐ Issuing Distribution Point
     - ☐ Delta CRL Indicator (future)

   - Revoked Certificates Summary:
     - Total Revoked: Count
     - New Since Last CRL: Count (highlighted)
     - List preview (expandable table)

4. User clicks "Generate CRL"
5. System:
   - Collects all revoked certificates for this CA
   - Generates CRL in X.509 format
   - Signs CRL with CA private key (via KMS)
   - Stores CRL in database
   - Updates last generated timestamp
   - Logs operation
6. System displays success:
   - "CRL generated successfully"
   - CRL details: Number, Update times, Entry count
   - Download buttons: PEM, DER
   - Distribution URL: Copyable link
   - Size: File size display

**User Flow - Automatic Generation**:
1. Navigate to CA detail → Settings
2. Configure automatic CRL generation:
   - Schedule: Dropdown
     - ○ Daily (at specific time)
     - ○ Weekly (day + time)
     - ○ On certificate revocation
     - ○ Manual only
   - Next Update Duration: Days (default: 7)
   - Notification: Email on generation (optional)
3. System creates scheduled job
4. CRL generated automatically per schedule
5. Admin receives email notification (if enabled)

**Acceptance Criteria**:
- ✅ CRL number increments correctly
- ✅ All revoked certificates included
- ✅ CRL properly signed by CA
- ✅ PEM and DER formats valid
- ✅ Next update date set correctly
- ✅ Extensions included as configured
- ✅ Automatic generation works on schedule
- ✅ Audit log entry created

**CRL Format**:
```
Certificate Revocation List (CRL):
    Version: 2
    Signature Algorithm: sha256WithRSAEncryption
    Issuer: CN=Example CA, O=Example, C=US
    This Update: Jan 15 12:00:00 2025 GMT
    Next Update: Jan 22 12:00:00 2025 GMT
    CRL Extensions:
        CRL Number: 42
        Authority Key Identifier: keyid:XX:XX:...
    Revoked Certificates:
        Serial Number: 1234
            Revocation Date: Jan 10 08:30:00 2025 GMT
            Reason Code: Key Compromise
        Serial Number: 5678
            Revocation Date: Jan 12 14:15:00 2025 GMT
            Reason Code: Superseded
```

**Validation Rules**:
- Next Update must be > This Update
- Next Update recommended < 30 days
- CRL number sequential per CA
- All revoked certs must be included

**UI Components**:
- Generation dialog with form
- Date picker for Next Update
- Checkbox group for extensions
- Preview table of revoked certs
- Download button group
- Schedule configuration form
- Success notification with download

#### FR-CRL-002: View CRL

**Description**: Users can view CRL details and contents

**User Flow**:
1. User navigates to CA detail → Revocation tab
2. System displays CRL information card:

   **Current CRL Summary**:
   - CRL Number: Display with badge
   - Status: Valid/Expired/Stale (color-coded)
   - This Update: Date + time
   - Next Update: Date + time
   - Remaining Valid: Days/hours (progress bar)
   - Total Revoked Certificates: Count
   - CRL Size: Bytes/KB
   - Download: Button group (PEM, DER)
   - Distribution URL: Copyable link

   **Revoked Certificates Table**:
   - Columns:
     - Serial Number (hex, sortable)
     - Certificate CN
     - Revocation Date (sortable)
     - Reason (badge)
   - Filters:
     - Reason: Multi-select
     - Date Range: Date picker
   - Search: Serial number or CN
   - Pagination: 25/50/100 per page
   - Export: CSV download
   - Link to certificate detail

   **CRL History**:
   - Timeline of previous CRLs:
     - CRL Number
     - Generated Date
     - Entry Count
     - Download (PEM/DER)
   - Show last 10, "Load more" button

   **Distribution Points**:
   - HTTP URL: http://crl.example.com/ca.crl
   - Status: Reachable ✓ / Unreachable ✗
   - Last Checked: Timestamp
   - Test Connection: Button

3. User can click on revoked cert to view full certificate details
4. User can download CRL in preferred format
5. User can view CRL history

**Acceptance Criteria**:
- ✅ CRL status accurately reflects validity
- ✅ Revoked certificate list matches CRL contents
- ✅ Filters and search work correctly
- ✅ History shows all previous CRLs
- ✅ Download formats valid
- ✅ Distribution URL accessible
- ✅ Status indicators correct

**UI Components**:
- Summary card with key metrics
- Data table with filtering/sorting
- Timeline component for history
- Progress bar for validity period
- Status badges (Valid, Expired, Stale)
- Download dropdown
- Distribution point status indicator

#### FR-CRL-003: Publish CRL

**Description**: System publishes CRL to accessible HTTP endpoint

**User Flow**:
1. CRL generated (manual or automatic)
2. System:
   - Saves CRL file to public directory
   - Updates HTTP endpoint:
     - URL format: `https://pki.example.com/crl/{ca-id}.crl`
     - MIME type: application/pkix-crl
   - Updates distribution point in new certificates
   - Logs publication
3. CRL accessible via HTTP GET:
   - No authentication required
   - Correct MIME type
   - Cache headers set appropriately

**Acceptance Criteria**:
- ✅ CRL accessible via HTTP
- ✅ Correct MIME type returned
- ✅ Cache headers set (e.g., max-age based on Next Update)
- ✅ URL consistent and predictable
- ✅ Both PEM and DER available

**HTTP Headers**:
```
Content-Type: application/pkix-crl
Cache-Control: max-age=604800, public
Last-Modified: [This Update timestamp]
Expires: [Next Update timestamp]
```

#### FR-CRL-004: CRL Distribution Point in Certificates

**Description**: Issued certificates include CRL Distribution Point extension

**User Flow**:
1. During certificate issuance (FR-CERT-001 to FR-CERT-004)
2. System automatically adds CDP extension:
   - Extension OID: 2.5.29.31
   - URL: `http://crl.example.com/ca/{ca-id}.crl`
   - Alternative URL: `https://crl.example.com/ca/{ca-id}.crl`
3. Certificate issued with CDP extension
4. Users can verify CDP in certificate details

**Acceptance Criteria**:
- ✅ CDP extension present in all issued certificates
- ✅ URL accessible
- ✅ URL points to correct CA's CRL
- ✅ Both HTTP and HTTPS supported

**Certificate Extension**:
```
X509v3 CRL Distribution Points:
    Full Name:
      URI:http://crl.example.com/ca/ca-12345.crl
```

### 4.4 Domain Management

#### FR-DOMAIN-001: Multi-Domain Support

**Description**: Each CA can manage certificates for multiple domains

**User Flow**:
1. During certificate issuance, user specifies domain(s) in CN or SAN
2. System:
   - Extracts domains from certificate requests
   - Associates domains with CA
   - Tracks certificate count per domain
3. User can view domain statistics per CA

**Domain Tracking**:
- Domain extracted from CN and SAN DNS entries
- Case-insensitive storage
- Wildcard domains tracked separately (*.example.com)
- Subdomain tracking (www.example.com vs example.com)

**UI Components** (on CA detail):
- **Domains Tab**:
  - Table of domains:
    - Domain Name
    - Certificate Count (active/total)
    - First Certificate Date
    - Last Certificate Date
  - Filter: Active domains only
  - Search: Domain name
  - Click domain to see certificates

**Acceptance Criteria**:
- ✅ Domains extracted from CN and SAN correctly
- ✅ Wildcard domains tracked
- ✅ Certificate counts accurate
- ✅ Domain list sortable and searchable

#### FR-DOMAIN-002: Domain-Based Filtering

**Description**: Users can filter certificates by domain

**User Flow**:
1. User navigates to Certificates list
2. User uses domain filter:
   - Type-ahead dropdown
   - Shows all domains with certificate counts
   - Multi-select support
3. Certificate list filtered to selected domain(s)
4. Results show only certificates for those domains

**Acceptance Criteria**:
- ✅ Domain dropdown populated from database
- ✅ Counts match actual certificates
- ✅ Multi-select works correctly
- ✅ Filter combines with other filters (status, type, etc.)

### 4.5 Search & Discovery

#### FR-SEARCH-001: Global Search

**Description**: Users can search across all entities (CAs, certificates, domains)

**User Flow**:
1. User uses global search bar (header/navigation)
2. User types search query (min 3 chars)
3. System searches across:
   - Certificate CN, Subject, SAN, Serial Number
   - CA CN, Organization
   - Domain names
   - Fingerprints
4. System displays grouped results:
   - **Certificates** (top 5)
     - CN, Status, Expiry
     - Click to view
   - **Certificate Authorities** (top 3)
     - CN, Status, Cert Count
     - Click to view
   - **Domains** (top 3)
     - Domain, Cert Count
     - Click to filter certificates
5. "View all results" link for each category
6. Keyboard navigation support (↑↓ arrows, Enter to select)

**Search Features**:
- Debounced input (300ms)
- Highlights matching text
- Recent searches saved (localStorage)
- Quick filters (e.g., "status:active", "type:server")

**Acceptance Criteria**:
- ✅ Search responsive (< 500ms)
- ✅ Results grouped logically
- ✅ Highlights matches
- ✅ Keyboard navigation works
- ✅ Handles special characters safely

**UI Components**:
- Search input with typeahead
- Grouped results dropdown
- Recent searches list
- Loading indicator
- "No results" state

### 4.6 Audit & Compliance

#### FR-AUDIT-001: Comprehensive Audit Logging

**Description**: All operations logged for compliance and security

**Logged Operations**:
- CA operations (create/revoke/delete)
- Certificate operations (issue/renew/revoke/delete/download)
- CRL operations (generate/publish)
- Configuration changes
- KMS operations (key generation/deletion)

**Audit Log Entry Format**:
```json
{
  "id": "audit-12345",
  "timestamp": "2025-01-15T12:34:56.789Z",
  "operation": "CERTIFICATE_ISSUED",
  "entity_type": "certificate",
  "entity_id": "cert-67890",
  "ip_address": "192.168.1.100",
  "status": "success",
  "details": {
    "ca_id": "ca-456",
    "subject_cn": "example.com",
    "certificate_type": "server",
    "validity_days": 365
  },
  "kms_operation_id": "kms-op-789"
}
```

**User Flow - View Audit Logs**:
1. Navigate to Audit Log
2. System displays audit log table:
   - Timestamp (sortable)
   - Operation (badge)
   - Entity Type + ID (linked)
   - Status (success/failure)
   - Details (expandable JSON)
3. Filters:
   - Date Range: Date picker
   - Operation Type: Multi-select
   - Entity Type: Multi-select
   - Status: Success/Failure
4. Search: Free text (searches all fields)
5. Export: CSV/JSON download
6. Pagination: 50/100/200 per page

**Acceptance Criteria**:
- ✅ All operations logged
- ✅ Timestamps accurate (UTC)
- ✅ KMS operations linked
- ✅ Logs immutable (append-only)
- ✅ Export works correctly
- ✅ Retention policy configurable

**UI Components**:
- Data table with advanced filtering
- Date range picker
- Multi-select filter dropdowns
- Expandable detail rows (JSON viewer)
- Export buttons
- Timeline view option

#### FR-AUDIT-002: Compliance Reporting

**Description**: Generate compliance reports for auditors

**Available Reports**:

1. **Certificate Inventory Report**
   - All certificates (active/revoked/expired)
   - Grouped by CA, type, domain
   - Expiry timeline
   - Export: CSV, PDF

2. **Revocation Report**
   - All revoked certificates
   - Revocation reasons breakdown
   - Timeline of revocations
   - Export: CSV, PDF

3. **CA Operations Report**
   - CA lifecycle events
   - Certificate issuance statistics
   - CRL generation history
   - Export: CSV, PDF

**User Flow**:
1. Navigate to Reports
2. Select report type
3. Configure parameters:
   - Date range
   - CA filter (optional)
   - Format: CSV/PDF
4. Clicks "Generate Report"
5. System:
   - Queries audit log and database
   - Generates report
   - Offers download
6. Report includes:
   - Header with generation date and parameters
   - Executive summary
   - Detailed data tables/charts
   - Footer with signature hash

**Acceptance Criteria**:
- ✅ Reports accurate and complete
- ✅ PDF formatted professionally
- ✅ CSV importable to Excel
- ✅ Generation < 30 seconds
- ✅ Report includes all requested data
- ✅ Tamper-evident (hash included)

### 4.7 Dashboard & Analytics

#### FR-DASH-001: Overview Dashboard

**Description**: Users see at-a-glance PKI health and statistics

**Dashboard Components**:

1. **Summary Cards** (top row):
   - Total Root CAs
     - Count with active/total
     - Expiring soon indicator (< 1 year)
   - Total Certificates
     - Count with active/total breakdown
     - Expiring soon count (< 30 days)
   - Expiring Soon
     - Count with urgency levels
     - Click to see list
   - Recent Revocations
     - Count last 30 days
     - Trend indicator

2. **Expiry Timeline Chart**:
   - Horizontal timeline (next 12 months)
   - Certificate expirations by month
   - CA expirations highlighted
   - Clickable bars to see certificates

3. **Certificate Distribution Charts**:
   - Pie chart: By Type (Server, Client, Code Signing, Email)
   - Pie chart: By Status (Active, Expired, Revoked)
   - Bar chart: By CA

4. **Recent Activity Feed**:
   - Last 10 operations
   - Icons for operation type
   - User, timestamp, entity
   - Click to view details

5. **Expiring Soon Table**:
   - Certificates expiring in < 30 days
   - Sorted by expiry date
   - Quick actions: View, Renew
   - Pagination

6. **CA Health Status**:
   - List of CAs with health indicators:
     - Green: Healthy (> 1 year valid)
     - Yellow: Expiring soon (< 1 year)
     - Red: Expired or revoked
   - Click to view CA details

**Acceptance Criteria**:
- ✅ All counts accurate
- ✅ Charts render correctly
- ✅ Real-time or near-real-time updates
- ✅ Expiry calculations correct
- ✅ Links to detail views work
- ✅ Responsive layout (mobile-friendly)

**UI Components**:
- Stat cards with icons
- Chart.js or Recharts for visualizations
- Activity feed with icons
- Data table for expiring certs
- Health status indicators

### 4.8 Settings & Configuration

#### FR-CONFIG-001: System Settings

**Description**: Configure system-wide settings

**Settings Categories**:

1. **General Settings**:
   - Application Name
   - Organization Name
   - Administrator Email
   - Time Zone
   - Date Format

2. **CRL Settings**:
   - Default Next Update Period (days)
   - Auto-generate CRL on revocation
   - CRL Distribution Base URL
   - CRL Retention Period (months)

3. **Certificate Defaults**:
   - Default Validity Period (days)
   - Maximum Validity Period (days)
   - Default Key Algorithm
   - Allowed Key Algorithms

4. **KMS Configuration**:
   - KMS Server URL
   - API Key (masked)
   - Connection Test button
   - Key Retention Policy

5. **Audit Settings**:
   - Audit Log Retention (days)
   - Export Frequency
   - Alert Threshold

**User Flow**:
1. Navigate to Settings
2. Select category
3. Edit settings
4. Click "Save Changes"
5. System validates and saves
6. Success notification

**Acceptance Criteria**:
- ✅ Settings persisted correctly
- ✅ Validation prevents invalid values
- ✅ Changes apply immediately or after restart (as appropriate)
- ✅ Audit log entry for setting changes
- ✅ Test buttons work (e.g., KMS connection)

---

## 5. UX/UI Specifications

### 5.1 Navigation Structure

**Primary Navigation** (Sidebar):

```
PKI Manager
├── 📊 Dashboard
├── 🏛️ Certificate Authorities
│   ├── View All CAs
│   └── Create Root CA
├── 📜 Certificates
│   ├── View All Certificates
│   ├── Issue Certificate
│   └── Expiring Soon
├── 🔍 Search
├── 📋 Reports
│   ├── Certificate Inventory
│   ├── Revocation Report
│   └── CA Operations
├── 📖 Audit Log
└── ⚙️ Settings
    ├── General
    ├── CRL Configuration
    └── KMS
```

**Top Navigation Bar**:
- Logo (left)
- Global Search (center)
- Notifications (bell icon)

### 5.2 Design System

**Color Palette**:
- Primary: #2563eb (Blue)
- Success: #10b981 (Green)
- Warning: #f59e0b (Orange)
- Danger: #ef4444 (Red)
- Neutral: #64748b (Slate)

**Status Colors**:
- Active/Valid: Green (#10b981)
- Expiring Soon: Yellow (#f59e0b)
- Expired: Orange (#fb923c)
- Revoked: Red (#ef4444)

**Typography**:
- Font Family: Inter, sans-serif
- Headings: 600-700 weight
- Body: 400 weight
- Monospace (serials, fingerprints): Fira Code

**Spacing**:
- Base unit: 4px (0.25rem)
- Common spacing: 8px, 12px, 16px, 24px, 32px

**Components** (Shadcn/UI):
- Buttons: Primary, Secondary, Danger, Ghost
- Forms: Input, Select, Checkbox, Radio, Date Picker
- Data Display: Table, Card, Badge, Progress
- Feedback: Alert, Toast, Dialog, Tooltip
- Navigation: Tabs, Breadcrumbs, Pagination

### 5.3 Responsive Design

**Breakpoints**:
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

**Mobile Adaptations**:
- Collapsible sidebar (hamburger menu)
- Stacked cards instead of tables
- Bottom navigation for key actions
- Simplified charts
- Touch-friendly button sizes (min 44x44px)

### 5.4 Accessibility

**WCAG 2.1 AA Compliance**:
- Color contrast: 4.5:1 for text, 3:1 for UI components
- Keyboard navigation: All functions accessible via keyboard
- Screen reader support: Semantic HTML, ARIA labels
- Focus indicators: Visible focus states
- Form validation: Clear error messages

**Keyboard Shortcuts**:
- `/`: Focus global search
- `n`: New certificate (from cert list)
- `r`: Refresh current view
- `?`: Show keyboard shortcuts help

### 5.5 Loading & Error States

**Loading States**:
- Skeleton screens for content loading
- Spinner for actions (button loading state)
- Progress bar for bulk operations
- "Loading..." text with animated dots

**Error States**:
- Inline validation errors (form fields)
- Error alerts with retry button
- Empty states with helpful actions
- 404 page with navigation
- 500 page with support contact

**Success Feedback**:
- Toast notifications (bottom-right)
- Success badges/icons
- Confirmation pages
- Auto-dismiss after 5 seconds (closable)

---

## 6. Technical Requirements

### 6.1 X.509 Compliance

**Standards**:
- RFC 5280: X.509 PKI Certificate and CRL Profile
- RFC 2986: PKCS #10 Certificate Request Syntax
- RFC 6960: OCSP Protocol (future)

**Certificate Versions**:
- X.509 v3 (version 2 in zero-indexed encoding)

**Signature Algorithms**:
- RSA with SHA-256 (sha256WithRSAEncryption)
- ECDSA with SHA-256 (ecdsa-with-SHA256)
- ECDSA with SHA-384 (ecdsa-with-SHA384)

**Key Algorithms**:
- RSA: 2048, 3072, 4096 bit
- ECDSA: P-256 (secp256r1), P-384 (secp384r1)

**Mandatory Extensions**:
- Subject Key Identifier
- Authority Key Identifier
- Key Usage
- Basic Constraints
- CRL Distribution Points

**Optional Extensions**:
- Extended Key Usage
- Subject Alternative Name
- Name Constraints (CA only)
- Policy Constraints
- Inhibit Any Policy

### 6.2 Cosmian KMS Integration

**Key Management**:
- All private keys generated in KMS
- No private key export (except admin-approved client certs)
- Key IDs stored in database (not keys)
- Key destruction via KMS API

**Supported Operations**:
- Generate Key Pair: `POST /api/v1/keys/generate`
- Sign Data: `POST /api/v1/keys/{id}/sign`
- Destroy Key: `DELETE /api/v1/keys/{id}`
- Get Public Key: `GET /api/v1/keys/{id}/public`

**Security**:
- KMS API authentication via bearer token
- TLS 1.3 for KMS communication
- Key usage policies enforced by KMS
- Audit logging of all KMS operations

**Error Handling**:
- KMS unavailable: Queue operations, retry
- Key not found: Alert admin, log error
- Signature failure: Retry 3 times, then fail
- Connection timeout: 30 seconds

### 6.3 Database Schema (SQLite)

**Tables**:

```sql
-- Certificate Authorities
CREATE TABLE certificate_authorities (
  id TEXT PRIMARY KEY,
  subject_dn TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  not_before INTEGER NOT NULL,
  not_after INTEGER NOT NULL,
  kms_key_id TEXT NOT NULL,
  certificate_pem TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked', 'expired')),
  revocation_date INTEGER,
  revocation_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Certificates
CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  ca_id TEXT NOT NULL REFERENCES certificate_authorities(id) ON DELETE CASCADE,
  subject_dn TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  certificate_type TEXT NOT NULL CHECK(certificate_type IN ('server', 'client', 'code_signing', 'email')),
  not_before INTEGER NOT NULL,
  not_after INTEGER NOT NULL,
  certificate_pem TEXT NOT NULL,
  kms_key_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked', 'expired')),
  revocation_date INTEGER,
  revocation_reason TEXT,
  san_dns TEXT, -- JSON array
  san_ip TEXT, -- JSON array
  san_email TEXT, -- JSON array
  renewed_from_id TEXT REFERENCES certificates(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- CRLs
CREATE TABLE crls (
  id TEXT PRIMARY KEY,
  ca_id TEXT NOT NULL REFERENCES certificate_authorities(id) ON DELETE CASCADE,
  crl_number INTEGER NOT NULL,
  this_update INTEGER NOT NULL,
  next_update INTEGER NOT NULL,
  crl_pem TEXT NOT NULL,
  revoked_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Audit Log
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  ip_address TEXT,
  status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
  details TEXT, -- JSON blob
  kms_operation_id TEXT
);

-- Indexes
CREATE INDEX idx_certificates_ca_id ON certificates(ca_id);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_certificates_serial ON certificates(serial_number);
CREATE INDEX idx_certificates_type ON certificates(certificate_type);
CREATE INDEX idx_crls_ca_id ON crls(ca_id);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
```

### 6.4 API Design (tRPC)

**Router Structure**:
```
appRouter
├── ca
│   ├── list
│   ├── getById
│   ├── create
│   ├── revoke
│   └── delete
├── certificate
│   ├── list
│   ├── getById
│   ├── issue
│   ├── renew
│   ├── revoke
│   ├── delete
│   └── download
├── crl
│   ├── generate
│   ├── getLatest
│   └── getHistory
└── audit
    ├── list
    └── export
```

**Type Safety**:
- Input validation with Zod
- Output types inferred from database schema
- End-to-end type safety from DB to UI

---

## 7. Security Requirements

### 7.1 Application Security

**Note**: Authentication and authorization will be added in future releases. Initial version assumes deployment in a trusted environment (e.g., internal network, behind VPN).

- CSRF protection (double-submit cookie)
- Network-level access control (firewall, VPN)

### 7.2 Data Protection

- All private keys in KMS (never in database or memory)
- HTTPS/TLS 1.3 for all communication
- Database encryption at rest (SQLite encryption extension)
- Secure random number generation (crypto.randomBytes)
- No sensitive data in logs or audit trails
- Secure deletion of keys from KMS on cert deletion

### 7.3 Input Validation

- All inputs validated with Zod schemas
- SQL injection prevention (parameterized queries)
- XSS prevention (React escaping + CSP)
- CSRF token validation
- File upload restrictions (if applicable)
- Rate limiting on API endpoints

### 7.4 Audit & Monitoring

- Comprehensive audit logging
- Failed login attempt tracking
- KMS operation logging
- Alert on suspicious activity
- Retention policy enforcement
- Immutable audit logs

---

## 8. Non-Functional Requirements

### 8.1 Performance

- Page load time: < 2 seconds
- Certificate issuance: < 5 seconds
- CRL generation: < 10 seconds (up to 10,000 revoked certs)
- Search response time: < 500ms
- Database query time: < 100ms (avg)
- Support 10,000+ certificates per CA
- Support 100+ concurrent users

### 8.2 Reliability

- 99.9% uptime
- Automated backups (daily)
- Database integrity checks
- KMS connection resilience (retry logic)
- Graceful error handling
- Transaction rollback on failure

### 8.3 Usability

- Intuitive UI/UX
- Minimal training required
- Clear error messages
- Contextual help/tooltips
- Responsive design (mobile-friendly)
- Accessibility (WCAG 2.1 AA)

### 8.4 Scalability

- Horizontal scaling capability (future)
- Database optimization (indexes, queries)
- Efficient caching strategy
- CDN for static assets
- Lazy loading for large data sets

### 8.5 Maintainability

- Modular codebase
- Comprehensive test coverage (> 80%)
- API documentation (OpenAPI/tRPC)
- Code comments and documentation
- Version control (Git)
- CI/CD pipeline

---

## 9. Success Metrics

### 9.1 Adoption Metrics

- Number of root CAs created
- Number of certificates issued per month
- Active users per month
- User retention rate

### 9.2 Operational Metrics

- Average time to issue certificate
- Certificate renewal rate
- Revocation rate
- CRL generation frequency
- Support tickets/issues

### 9.3 Security Metrics

- Zero key compromise incidents
- Zero unauthorized access incidents
- 100% audit log coverage
- Compliance audit pass rate

### 9.4 Performance Metrics

- Average page load time
- API response time (p95, p99)
- Error rate (< 0.1%)
- Uptime percentage

---

## 10. Future Enhancements (Post v1.0)

### 10.1 User Authentication & Authorization

- User login system (username/password)
- Session management with secure cookies
- Role-based access control (Admin, CA Operator, Read-Only)
- User management interface
- Password policies and account lockout
- SSO/SAML integration
- Multi-factor authentication (MFA)

### 10.2 Intermediate CA Support

- CA hierarchy (root → intermediate → end-entity)
- Path length constraints
- Cross-certification
- Chain validation

### 10.3 OCSP Responder

- Real-time certificate status checking
- OCSP stapling support
- Lightweight alternative to CRL

### 10.4 Certificate Templates

- Pre-defined certificate profiles
- Template-based issuance
- Workflow automation

### 10.5 Automated Renewal

- Email notifications before expiry
- Automatic renewal for approved certificates
- ACME protocol support

### 10.6 Advanced Features

- Certificate transparency logging
- External CA integration (Let's Encrypt, etc.)
- HSM direct integration (PKCS#11)
- Multi-tenancy with isolated CAs
- REST API for external integrations
- Webhooks for events
- Certificate request approval workflow

---

## 11. Glossary

- **CA**: Certificate Authority - entity that issues digital certificates
- **CRL**: Certificate Revocation List - list of revoked certificates
- **CSR**: Certificate Signing Request - request for certificate issuance
- **DN**: Distinguished Name - hierarchical identifier in X.509
- **EKU**: Extended Key Usage - certificate usage extension
- **KMS**: Key Management Service - secure key storage and operations
- **OCSP**: Online Certificate Status Protocol - real-time cert validation
- **PEM**: Privacy-Enhanced Mail - Base64 encoded DER format
- **PKI**: Public Key Infrastructure - framework for digital certificates
- **SAN**: Subject Alternative Name - additional identities in certificate
- **X.509**: Standard format for public key certificates

---

## 12. Appendix

### 12.1 Certificate Type Comparison

| Feature | Server | Client | Code Signing | Email |
|---------|--------|--------|--------------|-------|
| Common Name | Domain name | User ID/Email | Org/Developer | User name |
| SAN Required | Yes (DNS) | Optional | No | Yes (Email) |
| Key Usage | Digital Signature, Key Encipherment | Digital Signature | Digital Signature | Digital Signature, Key/Data Encipherment |
| EKU | Server Auth | Client Auth | Code Signing | Email Protection |
| Typical Validity | 1-2 years | 1-3 years | 1-3 years | 1-2 years |

### 12.2 Revocation Reasons

| Reason | Code | Use Case |
|--------|------|----------|
| Unspecified | 0 | General revocation |
| Key Compromise | 1 | Private key exposed |
| CA Compromise | 2 | CA key compromised (very serious) |
| Affiliation Changed | 3 | User left organization |
| Superseded | 4 | Certificate replaced |
| Cessation of Operation | 5 | Service decommissioned |
| Certificate Hold | 6 | Temporary suspension (future) |
| Remove from CRL | 8 | Revocation withdrawn (rare) |
| Privilege Withdrawn | 9 | Authorization revoked |

---

**Document Version**: 1.0
**Last Updated**: 2025-10-21
**Authors**: PKI Manager Team
**Status**: Approved for Development
