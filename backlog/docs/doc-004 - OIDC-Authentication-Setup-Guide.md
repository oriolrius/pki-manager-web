---
id: doc-004
title: OIDC Authentication Setup Guide
type: other
created_date: '2026-02-05 17:25'
---
# Authentication Guide

PKI Manager uses OpenID Connect (OIDC) for authentication, supporting any compliant identity provider including Keycloak, Auth0, Okta, and Azure AD.

## Overview

The authentication system implements:
- **Authorization Code Flow with PKCE** - Secure authentication without client secrets
- **JWT Validation** - Stateless backend using JWKS for token verification
- **Role-Based Access Control** - Configurable role extraction from token claims
- **Silent Token Renewal** - Seamless session maintenance without user interaction

```
┌─────────────────┐                      ┌──────────────────┐
│   Frontend      │◄────── Redirect ────►│   OIDC Provider  │
│   (React SPA)   │       (Login/Logout) │   (Any Provider) │
└────────┬────────┘                      └────────┬─────────┘
         │                                        │
         │ Bearer Token                           │ JWKS
         ▼                                        ▼
┌─────────────────┐                      ┌──────────────────┐
│   Backend       │◄───── Validate ──────│   /.well-known/  │
│   (Fastify)     │       JWT via JWKS   │   openid-config  │
└─────────────────┘                      └──────────────────┘
```

## Quick Start with Keycloak

For local development, PKI Manager includes a pre-configured Keycloak environment.

### 1. Start Keycloak

```bash
cd keycloak
docker compose up -d
```

Wait for Keycloak to start (check `docker compose logs -f keycloak`).

### 2. Configure Environment

Backend `.env`:
```env
OIDC_ISSUER=http://localhost:42997/realms/pki-dev
OIDC_AUDIENCE=pki-web
OIDC_ROLES_CLAIM=realm_access.roles
```

Frontend `.env`:
```env
VITE_OIDC_AUTHORITY=http://localhost:42997/realms/pki-dev
VITE_OIDC_CLIENT_ID=pki-web
```

### 3. Test Users

| Username | Password | Role | Access Level |
|----------|----------|------|--------------|
| `admin` | `admin` | admin | Full access |
| `user` | `user` | user | Read-only access |

### 4. Start Application

```bash
pnpm dev
```

Navigate to http://localhost:5173 and click "Login".

## Environment Variables

### Backend Configuration

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `OIDC_ISSUER` | Yes* | OIDC provider issuer URL | `http://localhost:42997/realms/pki-dev` |
| `OIDC_AUDIENCE` | Yes* | Expected audience claim | `pki-web` |
| `OIDC_ROLES_CLAIM` | No | Path to roles in JWT | `realm_access.roles` |

*Leave `OIDC_ISSUER` unset to disable authentication (all endpoints become public).

### Frontend Configuration

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_OIDC_AUTHORITY` | Yes* | OIDC provider authority URL | `http://localhost:42997/realms/pki-dev` |
| `VITE_OIDC_CLIENT_ID` | Yes* | Public client ID | `pki-web` |
| `VITE_OIDC_SCOPE` | No | OAuth2 scopes | `openid profile email` |

*Leave `VITE_OIDC_AUTHORITY` unset to disable authentication.

## Provider Configuration

### Keycloak (Default)

Pre-configured in `keycloak/` directory.

```env
# Backend
OIDC_ISSUER=http://localhost:42997/realms/pki-dev
OIDC_AUDIENCE=pki-web
OIDC_ROLES_CLAIM=realm_access.roles

# Frontend
VITE_OIDC_AUTHORITY=http://localhost:42997/realms/pki-dev
VITE_OIDC_CLIENT_ID=pki-web
```

### Auth0

1. Create a Single Page Application in Auth0 Dashboard
2. Enable PKCE (Authorization Code with PKCE)
3. Configure Allowed Callback URLs: `http://localhost:5173/callback`
4. Configure Allowed Logout URLs: `http://localhost:5173`
5. Note: Auth0 uses `permissions` instead of roles

```env
# Backend
OIDC_ISSUER=https://your-tenant.auth0.com
OIDC_AUDIENCE=https://pki-manager-api
OIDC_ROLES_CLAIM=permissions

# Frontend
VITE_OIDC_AUTHORITY=https://your-tenant.auth0.com
VITE_OIDC_CLIENT_ID=your-client-id
```

**Auth0 Role Configuration:**
- Create an API in Auth0 with identifier `https://pki-manager-api`
- Define permissions: `admin`, `user`
- Assign permissions to users via Roles or directly

### Okta

1. Create an OIDC - Single Page Application
2. Grant type: Authorization Code with PKCE
3. Login redirect URI: `http://localhost:5173/callback`
4. Logout redirect URI: `http://localhost:5173`
5. Create groups and assign users

```env
# Backend
OIDC_ISSUER=https://your-org.okta.com
OIDC_AUDIENCE=your-client-id
OIDC_ROLES_CLAIM=groups

# Frontend
VITE_OIDC_AUTHORITY=https://your-org.okta.com
VITE_OIDC_CLIENT_ID=your-client-id
```

**Okta Group Configuration:**
- Create groups: `admin`, `user`
- Assign users to groups
- Add "groups" claim to ID token in Authorization Server

### Azure AD (Entra ID)

1. Register an application in Azure Portal
2. Add a SPA platform with redirect URI: `http://localhost:5173/callback`
3. Enable "Access tokens" and "ID tokens" under Authentication
4. Create App Roles: `admin`, `user`

```env
# Backend
OIDC_ISSUER=https://login.microsoftonline.com/{tenant-id}/v2.0
OIDC_AUDIENCE=api://{application-id}
OIDC_ROLES_CLAIM=roles

# Frontend
VITE_OIDC_AUTHORITY=https://login.microsoftonline.com/{tenant-id}/v2.0
VITE_OIDC_CLIENT_ID={application-id}
```

**Azure AD Role Configuration:**
- Go to App registrations > Your app > App roles
- Create roles with values: `admin`, `user`
- Assign users to roles in Enterprise Applications

### Google Identity

Google does not support custom roles in tokens. Use with read-only access or implement custom authorization.

```env
# Backend
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=your-client-id.apps.googleusercontent.com
# Leave OIDC_ROLES_CLAIM unset - all authenticated users get same access

# Frontend
VITE_OIDC_AUTHORITY=https://accounts.google.com
VITE_OIDC_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

## Procedure Protection Levels

PKI Manager uses three procedure types:

| Procedure Type | Authentication | Role Required | Use Case |
|----------------|---------------|---------------|----------|
| `publicProcedure` | None | None | Health checks, public info |
| `protectedProcedure` | JWT Required | Any authenticated user | Read operations |
| `adminProcedure` | JWT Required | `admin` role | Write operations, management |

### Current Endpoint Protection

| Endpoint Category | Procedure Type | Description |
|-------------------|----------------|-------------|
| `health` | public | Health check |
| `dashboard.*` | protected | Dashboard statistics |
| `ca.list`, `ca.getById` | protected | View CAs |
| `ca.create`, `ca.revoke`, `ca.delete` | admin | Manage CAs |
| `certificate.list`, `certificate.getById` | protected | View certificates |
| `certificate.issue`, `certificate.revoke` | admin | Manage certificates |
| `audit.*` | admin | Audit logs |

## Development Workflow

### Starting Keycloak

```bash
# Start Keycloak
cd keycloak && docker compose up -d

# View logs
docker compose logs -f keycloak

# Stop Keycloak
docker compose down

# Reset data (start fresh)
docker compose down && rm -rf data/* && docker compose up -d
```

### Accessing Keycloak Admin Console

1. Navigate to http://localhost:42997
2. Login with `admin` / `admin`
3. Select "pki-dev" realm to manage users and clients

### Getting Test Tokens (CLI)

```bash
# Get user token
curl -X POST http://localhost:42997/realms/pki-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=pki-web" \
  -d "client_secret=pki-web-secret" \
  -d "username=user" \
  -d "password=user"

# Get admin token
curl -X POST http://localhost:42997/realms/pki-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=pki-web" \
  -d "client_secret=pki-web-secret" \
  -d "username=admin" \
  -d "password=admin"
```

### Testing Protected Endpoints

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:42997/realms/pki-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=pki-web&client_secret=pki-web-secret&username=admin&password=admin" \
  | jq -r '.access_token')

# Call protected endpoint
curl http://localhost:3000/trpc/dashboard.stats \
  -H "Authorization: Bearer $TOKEN"
```

### Disabling Authentication (Development)

To disable authentication temporarily, unset the OIDC environment variables:

```env
# Backend .env - Comment out or remove:
# OIDC_ISSUER=...
# OIDC_AUDIENCE=...

# Frontend .env - Comment out or remove:
# VITE_OIDC_AUTHORITY=...
# VITE_OIDC_CLIENT_ID=...
```

All endpoints will become public when OIDC is disabled.

## Troubleshooting

### "Authentication is not configured"

**Cause**: Backend OIDC environment variables not set or Keycloak not reachable.

**Solution**:
1. Verify `OIDC_ISSUER` and `OIDC_AUDIENCE` are set in backend `.env`
2. Check Keycloak is running: `curl http://localhost:42997/health/ready`
3. Verify discovery endpoint: `curl http://localhost:42997/realms/pki-dev/.well-known/openid-configuration`

### "Missing or invalid Authorization header"

**Cause**: Request doesn't include Bearer token.

**Solution**:
1. Login via the frontend to obtain a token
2. For CLI testing, use the token retrieval commands above
3. Ensure frontend is configured with matching OIDC settings

### "Token has expired"

**Cause**: JWT access token has expired (default: 5 minutes).

**Solution**:
1. Frontend handles automatic renewal via silent refresh
2. For CLI testing, obtain a fresh token
3. In Keycloak, access token lifespan can be adjusted in Realm Settings > Tokens

### "Token issuer mismatch"

**Cause**: Token was issued by a different provider than expected.

**Solution**:
1. Verify `OIDC_ISSUER` matches the token's `iss` claim
2. Check for trailing slashes in URL configuration
3. Ensure frontend and backend use the same issuer URL

### "Token audience mismatch"

**Cause**: Token's `aud` or `azp` claim doesn't match expected audience.

**Solution**:
1. Verify `OIDC_AUDIENCE` matches your client ID
2. In Keycloak, check client settings for audience configuration
3. For Auth0, ensure API audience is correctly configured

### "Admin role required"

**Cause**: User doesn't have the `admin` role.

**Solution**:
1. Assign admin role to user in your OIDC provider
2. In Keycloak: Users > Select user > Role Mappings > Add "admin"
3. Verify `OIDC_ROLES_CLAIM` path matches your provider's token structure

### "Invalid token" / Signature verification failed

**Cause**: Token signature couldn't be verified against JWKS.

**Solution**:
1. Check JWKS endpoint is accessible: `curl {OIDC_ISSUER}/protocol/openid-connect/certs`
2. Verify token hasn't been tampered with
3. Check for clock skew between server and provider
4. Restart backend to refresh JWKS cache

### Frontend shows "Loading..." indefinitely

**Cause**: Silent renewal failed or OIDC configuration mismatch.

**Solution**:
1. Check browser console for errors
2. Verify `VITE_OIDC_AUTHORITY` matches backend `OIDC_ISSUER`
3. Ensure callback URL is registered in OIDC provider
4. Clear browser storage and try logging in fresh

### CORS errors in browser

**Cause**: Backend doesn't allow requests from frontend origin.

**Solution**:
1. Verify `FRONTEND_URL` in backend `.env` matches frontend URL
2. For development, ensure it's `http://localhost:5173`
3. Check OIDC provider's web origins configuration

## Security Best Practices

### Production Deployment

1. **Use HTTPS**: All OIDC traffic must be encrypted
2. **Change Secrets**: Replace all default passwords and client secrets
3. **Restrict Redirect URIs**: Only allow production URLs
4. **Enable CSP Headers**: Prevent XSS attacks
5. **Review Token Lifetimes**: Balance security vs. user experience
6. **Audit Logging**: Enable provider-side audit logs
7. **Regular Key Rotation**: OIDC providers should rotate signing keys

### Token Security

- Tokens are stored in memory only (never localStorage)
- Silent renewal maintains session without exposing tokens
- Short access token lifetime limits exposure window
- Refresh tokens are handled by the OIDC library securely

## Related Documentation

- [Keycloak Development Setup](../keycloak/README.md) - Local Keycloak configuration
- [Decision 009](decisions/decision-009%20-%20OIDC-Authentication-Implementation.md) - Architecture decision record
- [DEVELOPMENT.md](../DEVELOPMENT.md) - Development environment setup
