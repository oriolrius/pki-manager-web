---
id: decision-002
title: Cosmian KMS Integration Implementation
date: '2025-10-21 16:35'
status: approved
---

## Context

The PKI Manager requires a secure Key Management System (KMS) for cryptographic operations including key generation, storage, signing, and destruction. Based on decision-001, Cosmian KMS was selected as the cryptographic backend. This decision document covers the implementation approach for integrating Cosmian KMS with the PKI Manager application.

### Requirements

1. **Secure Key Operations**: Generate and manage RSA key pairs (2048-4096 bits)
2. **Certificate Signing**: Sign certificates using keys stored in KMS
3. **Key Lifecycle**: Support key revocation and destruction
4. **Audit Trail**: Log all KMS operations for compliance
5. **Error Handling**: Robust retry logic and error handling
6. **Data Persistence**: Keys must persist across KMS container restarts
7. **Development Experience**: Easy local development setup
8. **Testing**: Comprehensive tests for all operations

### Technology Constraints

- Backend: Node.js/TypeScript with Fastify
- Database: SQLite with Drizzle ORM
- KMS: Cosmian KMS (Docker container)
- Protocol: KMIP 2.1 JSON TTLV

## Decision

### Implementation Architecture

We implemented a **layered architecture** with three distinct layers for KMS integration:

```
Application Layer (tRPC procedures)
         ↓
Service Layer (KMSService) - Business logic + Audit trail
         ↓
Client Layer (KMSClient) - HTTP/KMIP protocol
         ↓
Cosmian KMS Server (Docker container)
```

### Key Design Decisions

#### 1. Docker Deployment Strategy

**Choice**: Local Docker Compose deployment with host-mounted data folder

**Implementation**:
- KMS container port: `42998` (custom port in range 42000-43000)
- Data volume: `./kms/data` → `/cosmian-kms/sqlite-data` (host folder, not Docker volume)
- Configuration: Explicit `kms.toml` file mounted read-only

**Rationale**:
- **Custom Port Range**: Avoids conflicts with standard ports; maintains consistency across project services
- **Host Folder Mounting**: Easier inspection, backup, and debugging than Docker volumes
- **Explicit Configuration**: Clearer understanding of KMS settings; version-controlled configuration
- **Local Development**: No external dependencies; works offline

**Trade-offs**:
- ✅ Easy data inspection and backup
- ✅ Version-controlled configuration
- ✅ Simple troubleshooting
- ❌ Slightly different from production deployment (acceptable for development)

#### 2. Client Implementation Approach

**Choice**: Custom HTTP client implementing KMIP 2.1 JSON TTLV protocol

**Alternatives Considered**:
1. **Use `cloudproof_js` library**: Cosmian's official JavaScript library
   - ❌ Focuses on encryption (CoverCrypt, Findex), not general KMS operations
   - ❌ Limited documentation for KMIP operations
   - ❌ Additional dependency with dual licensing (AGPL/Commercial)

2. **Use `ckms` CLI via child_process**:
   - ❌ Brittle parsing of CLI output
   - ❌ Performance overhead of spawning processes
   - ❌ Difficult error handling
   - ❌ No type safety

3. **Custom HTTP client** (chosen):
   - ✅ Direct control over KMIP protocol
   - ✅ Full TypeScript type safety
   - ✅ Easy to debug and test
   - ✅ No external dependencies beyond `fetch`
   - ✅ Can inspect actual JSON requests/responses

**Rationale**:
The KMIP 2.1 JSON TTLV protocol is well-documented and straightforward to implement. By creating a custom client, we gain:
- Complete type safety with TypeScript interfaces
- Direct control over retry logic and error handling
- Ability to optimize for our specific use cases
- Educational value - team understands the protocol

**Implementation Details**:
```typescript
// Type-safe KMIP request/response
interface KMIPRequest {
  tag: string;
  value: KMIPElement[];
}

// HTTP client with retry and timeout
class KMSClient {
  private async sendKMIPRequest(request: KMIPRequest): Promise<KMIPResponse>
}
```

#### 3. Error Handling Strategy

**Choice**: Smart retry logic with 4xx error fast-fail

**Implementation**:
- **Retry Attempts**: 3 attempts with exponential backoff (1s, 2s, 3s)
- **Timeout**: 30 seconds per request with AbortController
- **4xx Errors**: No retry (client errors won't be fixed by retrying)
- **5xx Errors**: Full retry (server errors might be transient)
- **Network Errors**: Full retry (connection issues might be temporary)

**Rationale**:
- Prevents retry storms on client errors (e.g., "Item_Not_Found")
- Recovers from transient network/server issues
- Configurable retry parameters for different environments
- Clear error messages for debugging

**Example**:
```typescript
if (response.status >= 400 && response.status < 500) {
  throw error; // Don't retry client errors
}
```

#### 4. Linked Key Handling

**Choice**: Operate only on private keys; let KMS auto-manage public keys

**Discovery**:
During testing, we discovered that Cosmian KMS automatically revokes/destroys linked public keys when the private key is revoked/destroyed. Initial implementation attempted to revoke/destroy both keys separately, causing spurious "Item_Not_Found" errors.

**Solution**:
```typescript
async destroyKeyPair(privateKeyId: string, publicKeyId: string): Promise<void> {
  // Only revoke private key - KMS auto-revokes public key
  await this.revokeKey(privateKeyId, "Key pair destroyed");

  // Only destroy private key - KMS auto-destroys public key
  await this.destroyKey(privateKeyId);

  logger.info({ privateKeyId, publicKeyId }, "Key pair destroyed");
}
```

**Rationale**:
- Cleaner code - no unnecessary operations
- No spurious error logs
- Leverages KMS built-in linking behavior
- Better test output clarity

#### 5. Audit Trail Integration

**Choice**: Service layer integration with existing audit_log table

**Implementation**:
- All KMS operations logged via `KMSService` wrapper
- Each operation generates unique operation ID
- Logs include: operation, entity type/ID, status (success/failure), details, timestamp
- Failures include error details for troubleshooting

**Structure**:
```typescript
class KMSService {
  private async logAudit(
    operation: string,
    entityType: string,
    entityId: string | null,
    status: "success" | "failure",
    details: Record<string, unknown>,
    kmsOperationId?: string
  ): Promise<void>
}
```

**Rationale**:
- Compliance requirement for key operations
- Troubleshooting and debugging
- Security audit trail
- Consistent with existing audit logging approach

#### 6. Singleton Pattern for Service

**Choice**: Singleton KMSService instance with factory function

**Implementation**:
```typescript
let kmsServiceInstance: KMSService | null = null;

export function getKMSService(): KMSService {
  if (!kmsServiceInstance) {
    kmsServiceInstance = new KMSService({
      kmsUrl: process.env.KMS_URL,
      kmsApiKey: process.env.KMS_API_KEY,
    });
  }
  return kmsServiceInstance;
}
```

**Rationale**:
- Single point of configuration
- Reuse HTTP connections
- Consistent audit logging
- Easy to mock in tests
- Follows existing patterns in codebase

### File Structure

```
backend/src/
├── kms/
│   ├── types.ts              # KMIP type definitions
│   ├── client.ts             # Low-level HTTP/KMIP client
│   ├── service.ts            # High-level service with audit
│   ├── index.ts              # Public API exports
│   ├── test-integration.ts   # Integration tests
│   └── test-persistence.ts   # Persistence tests
└── lib/
    └── logger.ts             # Shared pino logger

kms/
├── docker-compose.yml        # KMS container setup
├── kms.toml                  # KMS configuration
├── .env                      # Environment variables
├── data/                     # SQLite database (gitignored)
│   └── .gitignore
└── README.md                 # Setup documentation
```

### Testing Strategy

**Two-tier testing approach**:

1. **Integration Tests** (`test-integration.ts`):
   - Test all KMS operations (create, get, destroy)
   - Verify error handling
   - Quick feedback during development
   - Runtime: ~5 seconds

2. **Persistence Tests** (`test-persistence.ts`):
   - Verify data survives container restarts
   - Test docker compose down/up cycle
   - Critical for production confidence
   - Runtime: ~15 seconds (includes restart)

**Test Philosophy**:
- No mocks - test against real KMS
- Automatic cleanup after tests
- Clear pass/fail indicators
- Minimal log noise

## Consequences

### Positive

1. **Type Safety**: Full TypeScript coverage from client to service layer
2. **Testability**: All operations tested with real KMS instance
3. **Maintainability**: Clear separation of concerns (client/service/business logic)
4. **Performance**: Direct HTTP calls, no CLI overhead
5. **Debuggability**: Can inspect actual KMIP JSON requests/responses
6. **Audit Trail**: Complete logging of all operations
7. **Data Persistence**: Verified to survive container restarts
8. **Developer Experience**: Easy local setup with Docker Compose
9. **Clean Logs**: No spurious errors from linked key handling

### Negative

1. **Custom Protocol Implementation**: Team must maintain KMIP client code
   - Mitigation: Well-tested, straightforward protocol, good documentation
2. **No Official SDK Support**: Not using Cosmian's JavaScript library
   - Mitigation: Direct HTTP is more transparent and easier to debug
3. **Development/Production Divergence**: Different KMS deployment approaches
   - Mitigation: Docker Compose config can be adapted for production

### Future Considerations

1. **Authentication**: Currently no authentication; add JWT support when moving to production
2. **TLS**: Enable TLS for production deployments
3. **HA Setup**: Multiple KMS instances for high availability
4. **PostgreSQL Backend**: Replace SQLite in KMS for production scale
5. **Key Rotation**: Implement automated key rotation workflows
6. **Performance Monitoring**: Add metrics for KMS operation latency
7. **Certificate Operations**: Extend client to support full certificate lifecycle via KMS certify operation

## Related Decisions

- **decision-001**: PKI Manager Technology Stack - Selected Cosmian KMS as the KMS backend
- **task-005**: Implement Cosmian KMS client integration - Implementation task for this decision

## References

- [Cosmian KMS Documentation](https://docs.cosmian.com/key_management_system/)
- [KMIP 2.1 Specification](https://docs.oasis-open.org/kmip/kmip-spec/v2.1/os/kmip-spec-v2.1-os.html)
- [Cosmian KMS GitHub](https://github.com/Cosmian/kms)
- [KMIP JSON TTLV API](https://docs.cosmian.com/key_management_system/kmip/json_ttlv_api/)
