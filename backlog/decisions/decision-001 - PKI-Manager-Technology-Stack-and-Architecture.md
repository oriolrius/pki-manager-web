---
id: decision-001
title: 001 - PKI Manager Technology Stack and Architecture
date: '2025-10-21 15:06'
status: approved
---
## Context

The PKI Manager project is a specialized application for managing Public Key Infrastructure operations including certificate generation, signing, revocation, and key management. Unlike general-purpose web applications, this project requires deep integration with cryptographic operations and secure key storage.

### Project Requirements

1. **Lightweight Database**: Simple, embedded database without external dependencies
2. **Enterprise Key Management**: Integration with Cosmian KMS for secure key operations
3. **PKI Operations**: Certificate lifecycle management (creation, signing, revocation, renewal)
4. **Security First**: All cryptographic operations must be secure and auditable
5. **Developer Experience**: Modern tooling with type safety and good DX

### Key Architectural Decisions

- **SQLite over Supabase**: We prefer a simple, embedded database that doesn't require external services or infrastructure. SQLite provides ACID compliance, excellent performance for our use case, and zero configuration.
- **Cosmian KMS Backend**: Enterprise-grade key management system for secure storage and operations on cryptographic keys, supporting HSM integration and compliance requirements.

## Decision

### Technology Stack Overview

The PKI Manager is built as a **full-stack TypeScript application** with the following architecture:

- **Frontend**: React 19 SPA with TanStack Router
- **Backend**: Node.js/Fastify API server with tRPC v11
- **Database**: SQLite with better-sqlite3 driver
- **KMS Backend**: Cosmian KMS for key management and cryptographic operations
- **Build System**: Vite (frontend) + esbuild (backend)
- **Package Manager**: pnpm with workspaces (optional monorepo structure)
- **Testing**: Vitest for both frontend and backend

### Technology Choices

#### 1. Database Layer - SQLite

**Choice**: SQLite with better-sqlite3

**Rationale**:
- **Zero Configuration**: Embedded database, no separate server process
- **ACID Compliance**: Full transaction support with rollback
- **Performance**: Excellent for read-heavy workloads (certificate lookups)
- **Portability**: Single file database, easy backup and distribution
- **Sufficient Scale**: Handles millions of certificates efficiently
- **Type Safety**: Works well with Drizzle ORM or Kysely for TypeScript

**Trade-offs**:
- No built-in Row Level Security (must implement in application layer)
- Single writer limitation (acceptable for PKI use case)
- No real-time subscriptions (not needed for certificate management)

#### 2. Key Management - Cosmian KMS

**Choice**: Cosmian KMS as the cryptographic backend

**Rationale**:
- **Enterprise Security**: HSM support, FIPS 140-2 compliance capability
- **Key Lifecycle Management**: Secure generation, rotation, and destruction of keys
- **Access Control**: Fine-grained policies for key usage
- **Audit Trail**: Complete logging of all cryptographic operations
- **API Integration**: RESTful API for easy integration with Node.js backend
- **Multi-tenancy**: Support for multiple domains/organizations

**Integration Points**:
- Certificate signing operations
- Private key storage and access
- Key rotation workflows
- Audit logging for compliance

#### 3. Frontend Stack

**React 19 Ecosystem**:
- **React 19**: Latest version with concurrent features and improved performance
- **TanStack Router**: Type-safe file-based routing for certificate/CA management views
- **TanStack Query**: Server state management for certificate data caching
- **Tailwind CSS v4**: Utility-first styling with OKLCH color format
- **Shadcn/UI**: Accessible component library built on Radix UI primitives

**Frontend Structure**:
```
src/
├── routes/              # TanStack Router file-based routes
│   ├── __root.tsx
│   ├── certificates/    # Certificate management
│   ├── cas/            # Certificate Authority management
│   ├── requests/       # Certificate signing requests
│   └── audit/          # Audit log viewer
├── components/         # React components
│   ├── ui/            # Shadcn/UI components
│   └── certificates/  # Certificate-specific components
└── lib/               # Utilities and tRPC client
```

#### 4. Backend Stack

**Fastify + tRPC Architecture**:
- **Fastify**: High-performance web framework with excellent TypeScript support
- **tRPC v11**: End-to-end type-safe API layer
- **Better-SQLite3**: Synchronous SQLite driver for Node.js
- **Drizzle ORM**: Type-safe SQL query builder (or Kysely as alternative)
- **Cosmian KMS SDK**: Client library for KMS operations

**Backend Structure**:
```
src/
├── server.ts           # Fastify server setup
├── trpc/
│   ├── router.ts       # Main tRPC router
│   ├── context.ts      # Request context (db, kms client)
│   ├── procedures/
│   │   ├── certificates.ts  # Certificate operations
│   │   ├── cas.ts          # CA operations
│   │   ├── csr.ts          # CSR operations
│   │   └── audit.ts        # Audit log queries
│   └── middleware/     # Auth, logging middleware
├── db/
│   ├── schema.ts       # Database schema (Drizzle)
│   ├── migrations/     # SQL migrations
│   └── client.ts       # Database client setup
└── kms/
    ├── client.ts       # Cosmian KMS client
    └── operations.ts   # Key operations wrapper
```

#### 5. Database Schema Design

**Core Entities**:

```sql
-- Certificate Authorities
CREATE TABLE certificate_authorities (
  id TEXT PRIMARY KEY,
  subject_dn TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  not_before INTEGER NOT NULL,
  not_after INTEGER NOT NULL,
  kms_key_id TEXT NOT NULL,  -- Reference to Cosmian KMS key
  certificate_pem TEXT NOT NULL,
  is_root BOOLEAN NOT NULL DEFAULT 0,
  parent_ca_id TEXT REFERENCES certificate_authorities(id),
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked', 'expired')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Certificates
CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  ca_id TEXT NOT NULL REFERENCES certificate_authorities(id) ON DELETE CASCADE,
  subject_dn TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  not_before INTEGER NOT NULL,
  not_after INTEGER NOT NULL,
  certificate_pem TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked', 'expired')),
  revocation_date INTEGER,
  revocation_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Certificate Signing Requests
CREATE TABLE certificate_requests (
  id TEXT PRIMARY KEY,
  csr_pem TEXT NOT NULL,
  subject_dn TEXT NOT NULL,
  requested_ca_id TEXT REFERENCES certificate_authorities(id),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'issued')),
  certificate_id TEXT REFERENCES certificates(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER,
  processed_by TEXT
);

-- Audit Log
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT,
  details TEXT,  -- JSON blob
  kms_operation_id TEXT  -- Reference to KMS audit trail
);

-- Indexes
CREATE INDEX idx_certificates_ca_id ON certificates(ca_id);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_certificates_serial ON certificates(serial_number);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
```

#### 6. Type Safety and Validation

**Zod Schemas for PKI Operations**:

```typescript
// Certificate request validation
const createCertificateSchema = z.object({
  subject: z.object({
    commonName: z.string().min(1),
    organization: z.string().optional(),
    organizationalUnit: z.string().optional(),
    country: z.string().length(2).optional(),
    state: z.string().optional(),
    locality: z.string().optional(),
  }),
  caId: z.string().uuid(),
  validityDays: z.number().int().positive().max(3650),
  keyType: z.enum(['RSA-2048', 'RSA-4096', 'ECDSA-P256', 'ECDSA-P384']),
  extensions: z.object({
    keyUsage: z.array(z.enum(['digitalSignature', 'keyEncipherment', 'dataEncipherment'])),
    extendedKeyUsage: z.array(z.enum(['serverAuth', 'clientAuth', 'codeSigning', 'emailProtection'])).optional(),
    subjectAlternativeNames: z.array(z.string()).optional(),
  }),
});

// Certificate revocation
const revokeCertificateSchema = z.object({
  certificateId: z.string().uuid(),
  reason: z.enum([
    'unspecified',
    'keyCompromise',
    'caCompromise',
    'affiliationChanged',
    'superseded',
    'cessationOfOperation',
  ]),
});
```

#### 7. Cosmian KMS Integration

**KMS Client Wrapper**:

```typescript
// src/kms/client.ts
import { CosmianKMS } from '@cosmian/kms-client';

export class PKIKMSClient {
  private kms: CosmianKMS;

  constructor(config: { url: string; apiKey: string }) {
    this.kms = new CosmianKMS(config);
  }

  async generateCAKeyPair(params: {
    keyId: string;
    algorithm: 'RSA-2048' | 'RSA-4096' | 'ECDSA-P256';
    exportable: boolean;
  }) {
    // Generate key pair in KMS
    // Return key ID for database storage
  }

  async signCertificate(params: {
    caKeyId: string;
    csrPem: string;
    validityDays: number;
  }) {
    // Sign certificate using CA private key in KMS
    // Return signed certificate PEM
  }

  async rotateCAKey(params: {
    oldKeyId: string;
    newKeyId: string;
  }) {
    // Implement key rotation workflow
  }
}
```

#### 8. Development and Build Tools

**Build Configuration**:
- **Frontend**: Vite with React plugin, Tailwind CSS PostCSS
- **Backend**: esbuild for fast compilation, tsx for development
- **Type Checking**: TypeScript strict mode across all packages
- **Linting**: ESLint with typescript-eslint, Prettier for formatting
- **Testing**: Vitest with React Testing Library

**Development Workflow**:
```bash
# Start development servers
pnpm dev              # Runs both frontend and backend

# Database operations
pnpm db:generate      # Generate Drizzle schema
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio

# Testing
pnpm test             # Run all tests
pnpm test:ui          # Open Vitest UI

# Build
pnpm build            # Build for production
```

#### 9. Security Considerations

**Application-Level Security**:
Since SQLite doesn't provide Row Level Security, implement security in the application layer:

```typescript
// Security middleware for tRPC
export const securityMiddleware = t.middleware(async ({ ctx, next }) => {
  // Verify user authentication
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  // Verify user has permission for the operation
  const hasPermission = await checkUserPermission(ctx.user, ctx.operation);
  if (!hasPermission) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  // Audit log all operations
  await logOperation({
    userId: ctx.user.id,
    operation: ctx.operation,
    timestamp: new Date(),
  });

  return next();
});
```

**Key Security Principles**:
1. All cryptographic operations go through Cosmian KMS
2. Private keys never leave the KMS
3. Certificate operations are fully audited
4. User permissions are checked at application layer
5. Database is encrypted at rest (SQLite encryption extension)

#### 10. Testing Strategy

**Unit Tests**:
- Certificate validation logic
- DN (Distinguished Name) parsing
- CSR validation
- Database operations

**Integration Tests**:
- tRPC procedures with SQLite in-memory database
- KMS operations with mocked Cosmian client
- End-to-end certificate issuance workflow

**E2E Tests**:
- Certificate request and approval flow
- Certificate revocation
- CA hierarchy creation

## Required Skills and Knowledge Areas

### Essential Skills (Must Have)

1. **TypeScript (Advanced)**
   - Strict mode, advanced types, generics
   - Type inference with Zod and tRPC
   - Database types with Drizzle ORM

2. **React 19**
   - Hooks-based functional components
   - TanStack Router and Query
   - Form management with React Hook Form

3. **PKI and Cryptography**
   - X.509 certificate structure
   - Certificate signing requests (CSR)
   - Distinguished Names (DN)
   - Certificate extensions (Key Usage, EKU, SAN)
   - Certificate revocation (CRL, OCSP)
   - Public key algorithms (RSA, ECDSA)

4. **SQLite**
   - SQL query writing and optimization
   - Transaction management
   - Indexing strategies
   - better-sqlite3 driver usage
   - Migration patterns

5. **Cosmian KMS**
   - Key management concepts
   - KMS API integration
   - Key lifecycle operations
   - Access control policies
   - Audit trail usage

6. **tRPC v11**
   - Type-safe procedures
   - Router composition
   - Error handling
   - Input validation with Zod

7. **Backend Development**
   - Fastify server setup
   - REST API design
   - Error handling patterns
   - Logging with Pino

### Important Skills (Should Have)

1. **Security Best Practices**
   - OWASP Top 10
   - Secure key storage
   - Audit logging
   - Access control implementation

2. **Drizzle ORM**
   - Schema definition
   - Migrations
   - Type-safe queries
   - Relations and joins

3. **Frontend Development**
   - Tailwind CSS
   - Shadcn/UI components
   - Form validation patterns
   - Error handling UX

4. **Testing**
   - Vitest configuration
   - React Testing Library
   - Integration testing patterns
   - Mocking strategies

### Nice to Have Skills

1. **Advanced PKI Concepts**
   - OCSP responder implementation
   - CRL generation
   - Certificate transparency
   - Path validation algorithms

2. **HSM Integration**
   - PKCS#11 interface
   - HSM key operations
   - Hardware security module concepts

3. **Compliance**
   - SOC 2 requirements
   - FIPS 140-2 compliance
   - Audit trail requirements

4. **Performance Optimization**
   - SQLite query optimization
   - Certificate caching strategies
   - Batch operations

## PKI-Specific Patterns

### Certificate Lifecycle Management

```typescript
// tRPC procedure for certificate issuance
export const certificateRouter = t.router({
  issue: protectedProcedure
    .input(createCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Validate CSR
      const csr = parseCSR(input.csrPem);

      // 2. Get CA from database
      const ca = await ctx.db.query.certificateAuthorities.findFirst({
        where: eq(certificateAuthorities.id, input.caId),
      });

      // 3. Sign certificate using KMS
      const certPem = await ctx.kms.signCertificate({
        caKeyId: ca.kmsKeyId,
        csrPem: input.csrPem,
        validityDays: input.validityDays,
      });

      // 4. Store in database
      const certificate = await ctx.db.insert(certificates).values({
        id: generateId(),
        caId: input.caId,
        subjectDn: csr.subject,
        serialNumber: generateSerial(),
        certificatePem: certPem,
        status: 'active',
        // ... other fields
      }).returning();

      // 5. Audit log
      await logAuditEvent({
        operation: 'CERTIFICATE_ISSUED',
        entityType: 'certificate',
        entityId: certificate.id,
        userId: ctx.user.id,
      });

      return certificate;
    }),

  revoke: protectedProcedure
    .input(revokeCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      // Update certificate status
      // Log to audit trail
      // Optionally publish to CRL
    }),
});
```

### CA Hierarchy Management

```typescript
// Creating a subordinate CA
export const createSubordinateCA = async (params: {
  parentCAId: string;
  subject: SubjectDN;
  validityDays: number;
}) => {
  // 1. Generate key pair in KMS
  const kmsKeyId = await kms.generateCAKeyPair({
    keyId: generateId(),
    algorithm: 'RSA-4096',
    exportable: false,
  });

  // 2. Create CSR for new CA
  const csr = await createCACSR({
    subject: params.subject,
    kmsKeyId,
  });

  // 3. Sign by parent CA
  const certPem = await kms.signCertificate({
    caKeyId: parentCA.kmsKeyId,
    csrPem: csr,
    validityDays: params.validityDays,
  });

  // 4. Store in database with hierarchy
  await db.insert(certificateAuthorities).values({
    id: generateId(),
    parentCaId: params.parentCAId,
    kmsKeyId,
    certificatePem: certPem,
    // ...
  });
};
```

## Documentation and Resources

### Project Documentation Structure

```
backlog/
├── decisions/
│   ├── decision-001-technology-stack.md (this file)
│   ├── decision-002-kms-integration.md
│   └── decision-003-security-model.md
├── docs/
│   ├── doc-001-certificate-operations.md
│   ├── doc-002-database-schema.md
│   ├── doc-003-kms-integration-guide.md
│   ├── doc-004-testing-strategy.md
│   └── doc-005-deployment-guide.md
└── tasks/
    └── (managed via backlog CLI)
```

### External Resources

**PKI and Cryptography**:
- RFC 5280: X.509 Certificate and CRL Profile
- RFC 2986: PKCS #10 Certificate Request Syntax
- RFC 6960: OCSP Protocol
- NIST SP 800-57: Key Management Recommendations

**Technologies**:
- Cosmian KMS documentation
- better-sqlite3 documentation
- Drizzle ORM documentation
- tRPC v11 documentation
- React 19 and TanStack documentation

## Consequences

### Positive

1. **Simplicity**: SQLite eliminates external database dependencies, simplifying deployment
2. **Security**: Cosmian KMS provides enterprise-grade key management with HSM support
3. **Type Safety**: End-to-end type safety from database to frontend via Drizzle + tRPC
4. **Performance**: SQLite excels at read-heavy workloads typical of PKI operations
5. **Portability**: Single-file database makes backup, migration, and testing trivial
6. **Auditability**: Complete audit trail through application layer and KMS
7. **Developer Experience**: Modern TypeScript tooling with excellent DX
8. **Security Model**: All cryptographic operations isolated in KMS, keys never exposed

### Negative

1. **Concurrency Limitations**: SQLite single-writer model may limit write throughput
2. **No Native RLS**: Must implement all security in application layer
3. **Manual Scaling**: No built-in replication or clustering like PostgreSQL
4. **Learning Curve**: Team needs PKI expertise in addition to web development
5. **KMS Dependency**: Critical dependency on Cosmian KMS availability
6. **Initial Setup**: KMS integration and key hierarchy setup requires expertise

### Risks

1. **Key Management Complexity**: Improper KMS configuration could compromise security
2. **Backup Procedures**: Must ensure both SQLite database and KMS keys are backed up
3. **SQLite Corruption**: Need robust backup and recovery procedures
4. **Performance at Scale**: May need to migrate to PostgreSQL if certificate volume grows beyond SQLite capacity (millions of certs)
5. **KMS Vendor Lock-in**: Tight coupling with Cosmian KMS

### Mitigation Strategies

1. **Database Backup**: Implement automated SQLite database backups with WAL mode
2. **KMS High Availability**: Deploy KMS in HA configuration with redundancy
3. **Monitoring**: Implement comprehensive monitoring for database and KMS operations
4. **Testing**: Extensive testing of certificate operations and KMS integration
5. **Documentation**: Detailed runbooks for operations, backup, and disaster recovery
6. **Abstraction Layer**: Create KMS abstraction to allow future migration if needed

## Migration Path from SQLite to PostgreSQL

If scale requirements exceed SQLite capacity:

1. **Database Migration**:
   - Drizzle ORM supports both SQLite and PostgreSQL
   - Migrate schema with minimal changes
   - Update connection strings and configuration

2. **Application Layer**:
   - No changes to tRPC procedures
   - No changes to frontend code
   - Minor changes to database client initialization

3. **Enhanced Features**:
   - Add Row Level Security in PostgreSQL
   - Implement read replicas for scaling
   - Use PostgreSQL full-text search for certificate lookups

## Recommendations

### For Development

1. **Start Simple**: Begin with SQLite, migrate to PostgreSQL only if needed
2. **KMS First**: Implement KMS integration early, as it's critical to security
3. **Type Safety**: Leverage TypeScript and Zod for all data validation
4. **Test Thoroughly**: PKI operations must be 100% reliable
5. **Audit Everything**: Log all certificate operations for compliance

### For Production

1. **Backup Strategy**: Automated backups of SQLite database and KMS keys
2. **Monitoring**: Implement comprehensive monitoring and alerting
3. **Security Hardening**: Follow OWASP guidelines, regular security audits
4. **Documentation**: Maintain detailed operational procedures
5. **Disaster Recovery**: Test backup restoration procedures regularly

### For Future Enhancements

1. **OCSP Responder**: Implement Online Certificate Status Protocol
2. **CRL Generation**: Automated Certificate Revocation List generation
3. **Certificate Templates**: Pre-defined certificate profiles
4. **Approval Workflows**: Multi-step approval for sensitive operations
5. **Metrics Dashboard**: Real-time metrics on certificate operations

## Conclusion

The PKI Manager leverages modern TypeScript tooling with SQLite and Cosmian KMS to create a secure, maintainable, and performant certificate management system. The choice of SQLite provides simplicity and portability while Cosmian KMS ensures enterprise-grade security for cryptographic operations.

This architecture prioritizes:
- **Security**: All keys managed by enterprise KMS
- **Simplicity**: Embedded database with zero configuration
- **Type Safety**: End-to-end TypeScript with strict validation
- **Developer Experience**: Modern tooling and excellent DX
- **Auditability**: Complete audit trail for compliance

The stack is appropriate for small to medium PKI deployments (up to millions of certificates) and provides a clear migration path to PostgreSQL if scaling requirements increase.
