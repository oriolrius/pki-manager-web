---
id: doc-005
title: API Authentication Guide
type: other
created_date: '2026-02-06 07:37'
updated_date: '2026-02-06 07:59'
---
# API Authentication Guide

This document describes how the PKI Manager API endpoints are protected and how to authenticate requests.

## Overview

The PKI Manager backend supports two authentication methods:

| Method | Client | Use Case |
|--------|--------|----------|
| Authorization Code Flow | `pki-web` | Web application (SPA) user login |
| Client Credentials Flow | `pki-service` | Machine-to-machine (M2M) API access |

## Endpoint Protection

### Protected Endpoints (Authentication Required)

Both tRPC and REST API endpoints require a valid JWT Bearer token:

| API | Path | Authentication |
|-----|------|----------------|
| tRPC | `/trpc/*` | ✅ Required |
| REST | `/api/v1/*` | ✅ Required |

```bash
# Without token - FAILS (401 Unauthorized)
curl http://localhost:52081/trpc/ca.list
curl http://localhost:52081/api/v1/cas

# With token - WORKS
curl -H "Authorization: Bearer $TOKEN" http://localhost:52081/trpc/ca.list
curl -H "Authorization: Bearer $TOKEN" http://localhost:52081/api/v1/cas
```

### Public Endpoints (No Authentication)

The following endpoints do **not** require authentication:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/v1/health` | REST API health check |
| `GET /api/docs` | Swagger UI documentation |
| `GET /api/v1/openapi.json` | OpenAPI specification |
| `GET /cas/:caId.pem` | Download CA certificate (public) |
| `GET /crl/:caId.crl` | Download CRL (public) |

## Authentication Methods

### 1. User Authentication (Web App)

For the web application, users authenticate via the browser using the Authorization Code flow with PKCE.

**Client Configuration:**
- Client ID: `pki-web`
- Type: Public client (no secret)
- Flow: Authorization Code with PKCE

The frontend handles this automatically via `react-oidc-context`.

### 2. Machine-to-Machine (M2M) Authentication

For programmatic API access, use the Client Credentials flow.

**Client Configuration:**
- Client ID: `pki-service`
- Client Secret: `pki-service-secret` (change in production!)
- Type: Confidential client
- Flow: Client Credentials

#### Getting an Access Token

```bash
# Request token from Keycloak
curl -X POST "http://localhost:42997/realms/pki-dev/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=pki-service" \
  -d "client_secret=pki-service-secret"
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "token_type": "Bearer",
  "scope": "profile email"
}
```

#### Using the Token

Include the token in the `Authorization` header:

```bash
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

# tRPC API
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:52081/trpc/ca.list

# REST API
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:52081/api/v1/certificates
```

#### Complete Example Script

```bash
#!/bin/bash
# m2m-api-example.sh

KEYCLOAK_URL="http://localhost:42997"
BACKEND_URL="http://localhost:52081"
REALM="pki-dev"
CLIENT_ID="pki-service"
CLIENT_SECRET="pki-service-secret"

# Get access token
TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/$REALM/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" | jq -r '.access_token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Failed to get token"
  exit 1
fi

echo "Token obtained successfully"

# List Certificate Authorities (tRPC)
echo -e "\n--- Certificate Authorities (tRPC) ---"
curl -s -H "Authorization: Bearer $TOKEN" "$BACKEND_URL/trpc/ca.list" | jq '.result.data'

# List Certificate Authorities (REST)
echo -e "\n--- Certificate Authorities (REST) ---"
curl -s -H "Authorization: Bearer $TOKEN" "$BACKEND_URL/api/v1/cas" | jq '.items'

# List Certificates
echo -e "\n--- Certificates ---"
curl -s -H "Authorization: Bearer $TOKEN" "$BACKEND_URL/trpc/certificate.list" | jq '.result.data | length'
echo "certificates found"
```

## Token Validation

The backend validates tokens by checking:

1. **Signature**: Verified against Keycloak's JWKS
2. **Issuer**: Must match `OIDC_ISSUER` environment variable
3. **Audience/Authorized Party**: Must match one of the values in `OIDC_AUDIENCE`
4. **Expiration**: Token must not be expired

### Backend Configuration

```bash
# backend/.env
OIDC_ISSUER=http://localhost:42997/realms/pki-dev
OIDC_AUDIENCE=pki-web,pki-service
OIDC_ROLES_CLAIM=realm_access.roles
```

The `OIDC_AUDIENCE` accepts comma-separated values to support both user and M2M tokens.

## Token Claims

### User Token (pki-web)

```json
{
  "sub": "user-uuid",
  "preferred_username": "admin",
  "email": "admin@localhost",
  "azp": "pki-web",
  "realm_access": {
    "roles": ["admin", "user"]
  }
}
```

### M2M Token (pki-service)

```json
{
  "sub": "service-account-uuid",
  "preferred_username": "service-account-pki-service",
  "azp": "pki-service",
  "realm_access": {
    "roles": []
  }
}
```

## Error Responses

| Status | Error | Cause |
|--------|-------|-------|
| 401 | Missing or invalid Authorization header | No token provided |
| 401 | Token has expired | Token past expiration |
| 401 | Token not intended for this audience | Wrong client/audience |
| 401 | Token signature invalid | Tampered or wrong issuer |
| 401 | Invalid token | Malformed JWT |

## Security Best Practices

1. **Never commit secrets**: Store `pki-service-secret` in environment variables
2. **Rotate secrets regularly**: Change client secrets periodically
3. **Use short token lifetimes**: Default is 5 minutes (300s)
4. **HTTPS in production**: Always use TLS for token exchange
5. **Validate on every request**: Tokens are validated server-side on each API call

## Testing Authentication

Run the E2E authentication tests:

```bash
# User authentication flow
PLAYWRIGHT_BASE_URL=http://localhost:52080 \
KEYCLOAK_URL=http://localhost:42997 \
pnpm playwright test tests/auth.spec.ts

# M2M authentication flow
BACKEND_URL=http://localhost:52081 \
KEYCLOAK_URL=http://localhost:42997 \
pnpm playwright test tests/auth-m2m.spec.ts
```
