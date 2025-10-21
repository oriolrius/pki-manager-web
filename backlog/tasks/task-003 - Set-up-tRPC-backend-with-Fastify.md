---
id: task-003
title: Set up tRPC backend with Fastify
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 16:07'
labels:
  - backend
  - api
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Initialize Fastify server with tRPC integration, configure routers for ca, certificate, crl, and audit endpoints. Set up Zod validation schemas for type-safe API.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Fastify server initialized and running
- [x] #2 tRPC middleware configured
- [x] #3 Router structure created (ca, certificate, crl, audit)
- [x] #4 Zod schemas defined for input validation
- [x] #5 Health check endpoint working
- [x] #6 CORS and security middleware configured
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review existing Fastify and tRPC setup from task-001
2. Expand router structure with separate router files for ca, certificate, crl, and audit
3. Create Zod validation schemas for all input types
4. Add database and KMS placeholders to tRPC context
5. Configure error handling middleware
6. Test all endpoints and middleware
7. Add comprehensive logging configuration
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Completed tRPC backend setup with Fastify server and comprehensive router structure.

Implemented:
- tRPC context updated to include database client from task-002
- Comprehensive Zod validation schemas (schemas.ts):
  * Common schemas (ID, timestamp, DN)
  * CA operations (create, list, get, revoke, delete)
  * Certificate operations (issue, list, get, renew, revoke, delete, download)
  * CRL operations (generate, get, list)
  * Audit log operations (list, export)
  * Input validation for all parameters
- Modular router structure with separate files:
  * ca.ts - Certificate Authority operations
  * certificate.ts - Certificate lifecycle management
  * crl.ts - Certificate Revocation List operations
  * audit.ts - Audit log queries
- Error handling middleware with Zod error formatting
- Logging middleware for performance monitoring
- Main router composition in router.ts
- Type-safe AppRouter export for frontend client

All routers have placeholder implementations with TODO comments referencing the specific tasks where they will be implemented (task-007 through task-027).

Server configuration (from task-001, already working):
- Fastify server on port 3000
- CORS middleware configured for frontend
- tRPC adapter integrated
- Health check endpoint at /health
- Pino logger with pretty formatting

The API structure is complete and ready for implementation of business logic in subsequent tasks.
<!-- SECTION:NOTES:END -->
