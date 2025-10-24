---
id: task-061
title: Fix empty key algorithm column in CA table
status: Done
assignee:
  - '@myself'
created_date: '2025-10-24 05:24'
updated_date: '2025-10-24 13:45'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 'key algorithm' column in the CA table at /cas route displays no values for existing CAs. Need to investigate why the column is empty and ensure the key algorithm is properly displayed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Key algorithm is displayed for all CAs in the table
- [ ] #2 Column shows correct algorithm values (e.g., RSA, ECDSA)
- [ ] #3 Data is correctly fetched from backend or KMS
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add keyAlgorithm field to database schema as denormalized field
2. Generate and run migration
3. Update CA create endpoint to store keyAlgorithm
4. Update CA list endpoint to return keyAlgorithm
5. Create script to backfill existing CAs
6. Test the fix
<!-- SECTION:PLAN:END -->
