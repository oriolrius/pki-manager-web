# OIDC Authentication in PKI Manager

This document explains how OpenID Connect (OIDC) authentication works between PKI Manager and identity providers like Keycloak.

## Table of Contents

- [Overview](#overview)
- [Public vs Confidential Clients](#public-vs-confidential-clients)
- [The Authentication Flow](#the-authentication-flow)
- [PKCE: The Secret Replacement](#pkce-the-secret-replacement)
- [Token Validation](#token-validation)
- [Role-Based Access Control](#role-based-access-control)
- [Docker Networking Considerations](#docker-networking-considerations)
- [Machine-to-Machine Authentication](#machine-to-machine-authentication)
- [Configuration Reference](#configuration-reference)
- [See Also](#see-also)

## Overview

PKI Manager uses OIDC for authentication with a **public client** architecture. This means:

- The frontend (React SPA) handles user login via the browser
- No client secret is used (secrets cannot be secured in browser code)
- PKCE (Proof Key for Code Exchange) provides security instead
- The backend only validates tokens - it never authenticates to Keycloak

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PKI Manager Architecture                         │
│                                                                          │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐     │
│  │   Frontend   │         │   Backend    │         │   Keycloak   │     │
│  │   (React)    │         │   (Node.js)  │         │   (OIDC)     │     │
│  └──────┬───────┘         └──────┬───────┘         └──────┬───────┘     │
│         │                        │                        │             │
│         │  Login Flow            │                        │             │
│         │  (PKCE)                │                        │             │
│         │<──────────────────────────────────────────────>│             │
│         │                        │                        │             │
│         │  API Calls             │  Token Validation      │             │
│         │  (Bearer Token)        │  (JWKS Public Keys)    │             │
│         │───────────────────────>│<──────────────────────>│             │
│         │                        │                        │             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Public vs Confidential Clients

### Why No Client Secret?

A common question is: "Why don't we use a client ID and client secret to identify the app?"

The answer lies in the nature of browser-based applications:

| Client Type | Where Code Runs | Can Store Secrets? | Authentication Method |
|-------------|-----------------|--------------------|-----------------------|
| **Public** (SPA, mobile) | Browser/device | No - code is visible | PKCE |
| **Confidential** (server) | Server | Yes - code is private | Client Secret |

**PKI Manager's frontend is a public client** because:

1. All JavaScript code is downloaded to and runs in the user's browser
2. Anyone can view the source code (DevTools → Sources)
3. Any "secret" embedded in the code would be exposed
4. Therefore, we cannot use a client secret

Instead, we use **PKCE** - a cryptographic proof that the same browser session that started the login is the one completing it.

### Keycloak Client Configuration

```json
{
  "clientId": "pki-web",
  "publicClient": true,
  "standardFlowEnabled": true,
  "attributes": {
    "pkce.code.challenge.method": "S256"
  }
}
```

- `publicClient: true` - No secret required
- `standardFlowEnabled: true` - Authorization Code Flow
- `pkce.code.challenge.method: S256` - Require PKCE with SHA-256

## The Authentication Flow

Here's the complete flow when a user logs into PKI Manager:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │     │   Frontend   │     │   Keycloak   │     │   Backend    │
│   (User)     │     │   (React)    │     │   (OIDC)     │     │   (API)      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │  1. Click Login    │                    │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │                    │  2. Generate PKCE  │                    │
       │                    │  code_verifier +   │                    │
       │                    │  code_challenge    │                    │
       │                    │                    │                    │
       │  3. Redirect to Keycloak               │                    │
       │<───────────────────│                    │                    │
       │    /authorize?client_id=pki-web        │                    │
       │    &code_challenge=abc123              │                    │
       │    &code_challenge_method=S256         │                    │
       │                    │                    │                    │
       │  4. Login form     │                    │                    │
       │<───────────────────────────────────────│                    │
       │                    │                    │                    │
       │  5. Enter credentials                  │                    │
       │───────────────────────────────────────>│                    │
       │                    │                    │                    │
       │  6. Redirect back with authorization code                   │
       │<───────────────────────────────────────│                    │
       │    /callback?code=xyz789               │                    │
       │                    │                    │                    │
       │                    │  7. Exchange code  │                    │
       │                    │  for tokens        │                    │
       │                    │  (includes         │                    │
       │                    │  code_verifier)    │                    │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │  8. Access token   │                    │
       │                    │  + Refresh token   │                    │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │                    │  9. API call with Bearer token          │
       │                    │────────────────────────────────────────>│
       │                    │                    │                    │
       │                    │                    │  10. Validate token│
       │                    │                    │  - Fetch JWKS     │
       │                    │                    │<───────────────────│
       │                    │                    │  - Verify signature│
       │                    │                    │  - Check issuer   │
       │                    │                    │  - Check audience │
       │                    │                    │  - Extract roles  │
       │                    │                    │                    │
       │                    │  11. API response                       │
       │                    │<────────────────────────────────────────│
```

### Step-by-Step Breakdown

1. **User clicks Login** - Frontend initiates authentication
2. **Generate PKCE** - Frontend creates a random `code_verifier` and its SHA-256 hash (`code_challenge`)
3. **Redirect to Keycloak** - Browser goes to Keycloak with `code_challenge` (not the verifier!)
4. **Login form** - Keycloak shows the login page
5. **Enter credentials** - User authenticates with username/password
6. **Authorization code** - Keycloak redirects back with a temporary code
7. **Exchange code** - Frontend sends code + `code_verifier` to get tokens
8. **Receive tokens** - Keycloak returns access token, refresh token, ID token
9. **API calls** - Frontend includes `Authorization: Bearer <token>` in requests
10. **Validate token** - Backend verifies signature using Keycloak's public keys
11. **Authorized response** - Backend returns data based on user's roles

## PKCE: The Secret Replacement

PKCE (pronounced "pixy") replaces the client secret with a **one-time cryptographic proof**.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            PKCE Flow                                     │
│                                                                          │
│  1. Frontend generates random code_verifier (43-128 characters)         │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" │     │
│     └─────────────────────────────────────────────────────────────┘     │
│                              │                                           │
│                              ▼                                           │
│  2. Frontend computes SHA-256 hash (code_challenge)                     │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ code_challenge = base64url(sha256(code_verifier))            │     │
│     │                = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"│     │
│     └─────────────────────────────────────────────────────────────┘     │
│                              │                                           │
│                              ▼                                           │
│  3. Authorization request includes code_challenge (NOT verifier)        │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ GET /authorize?code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8U│     │
│     │                &code_challenge_method=S256                   │     │
│     └─────────────────────────────────────────────────────────────┘     │
│                              │                                           │
│                              ▼                                           │
│  4. Token request includes code_verifier                                │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ POST /token                                                  │     │
│     │   code=xyz789                                                │     │
│     │   code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk  │     │
│     └─────────────────────────────────────────────────────────────┘     │
│                              │                                           │
│                              ▼                                           │
│  5. Keycloak verifies: sha256(code_verifier) === stored code_challenge  │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ ✓ Match! Issue tokens to this client                        │     │
│     └─────────────────────────────────────────────────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why PKCE Is Secure

| Attack Scenario | Protection |
|-----------------|------------|
| Attacker intercepts authorization code | Cannot use it without `code_verifier` |
| Attacker tries to guess `code_verifier` | 256-bit entropy (impossible) |
| Attacker intercepts `code_challenge` | Cannot reverse SHA-256 hash |
| Replay attack | Each login uses new random `code_verifier` |

The `code_verifier` only leaves the browser memory once - when exchanging the code for tokens. By that point, it's sent over HTTPS directly to Keycloak.

## Token Validation

The backend **never authenticates to Keycloak**. It only validates tokens using public key cryptography.

### What the Backend Does

```typescript
// backend/src/lib/oidc.ts

// 1. At startup: Fetch OIDC discovery document
const discovery = await fetch(
  'http://keycloak:8080/realms/pki-e2e/.well-known/openid-configuration'
);
// Returns: { issuer, jwks_uri, token_endpoint, ... }

// 2. Get public keys (JWKS - JSON Web Key Set)
const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));

// 3. For each request: Validate the token
const { payload } = await jwtVerify(token, jwks, {
  issuer: 'http://localhost:58180/realms/pki-e2e',
  audience: 'pki-web',
});

// 4. Extract user info from token payload
const userId = payload.sub;
const email = payload.email;
const roles = payload.realm_access?.roles; // ['admin'] or ['user']
```

### Token Structure

A JWT (JSON Web Token) has three parts:

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgxODAvcmVhbG1zL3BraS1lMmUiLCJhdWQiOiJwa2ktd2ViIiwic3ViIjoiMTIzNDU2Nzg5MCIsInJlYWxtX2FjY2VzcyI6eyJyb2xlcyI6WyJhZG1pbiJdfX0.signature
│                              │                                                                                                                    │
└──────── Header ──────────────┴──────────────────────────────────── Payload ───────────────────────────────────────────────────────────────────────┴── Signature ──
```

**Decoded payload:**
```json
{
  "iss": "http://localhost:58180/realms/pki-e2e",
  "aud": "pki-web",
  "sub": "user-uuid-here",
  "email": "testadmin@example.com",
  "realm_access": {
    "roles": ["admin", "user"]
  },
  "exp": 1739456789,
  "iat": 1739453189
}
```

### Validation Steps

1. **Signature verification** - Using Keycloak's public RSA key
2. **Issuer check** - `iss` must match configured `OIDC_ISSUER`
3. **Audience check** - `aud` must include configured `OIDC_AUDIENCE`
4. **Expiration check** - `exp` must be in the future
5. **Not-before check** - `iat` must be in the past

## Role-Based Access Control

PKI Manager uses Keycloak realm roles for authorization:

| Role | Permissions |
|------|-------------|
| `user` | View CAs and certificates, issue certificates, download |
| `admin` | All user permissions + create/revoke/delete CAs and certificates |

### How Roles Flow Through the System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Role-Based Access Control                        │
│                                                                          │
│  Keycloak User Config          Token Payload           Backend Check    │
│  ┌─────────────────┐           ┌─────────────────┐     ┌─────────────┐  │
│  │ testadmin       │           │ realm_access:   │     │ adminProc:  │  │
│  │ Roles: [admin]  │ ────────> │   roles:        │ ──> │ roles.has   │  │
│  │                 │           │     - admin     │     │ ('admin')   │  │
│  └─────────────────┘           └─────────────────┘     └─────────────┘  │
│                                                               │          │
│  ┌─────────────────┐           ┌─────────────────┐           ▼          │
│  │ testuser        │           │ realm_access:   │     ┌─────────────┐  │
│  │ Roles: [user]   │ ────────> │   roles:        │ ──> │ ✓ Allow     │  │
│  │                 │           │     - user      │     │ ✗ Forbidden │  │
│  └─────────────────┘           └─────────────────┘     └─────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Backend Middleware

```typescript
// backend/src/trpc/middleware/auth.ts

// Protected procedure - any authenticated user
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { user: ctx.user } });
});

// Admin procedure - requires 'admin' role
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.roles.includes('admin')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin role required'
    });
  }
  return next({ ctx });
});
```

## Docker Networking Considerations

When running in Docker, there's a networking challenge:

- **Browser** accesses Keycloak at `localhost:58180`
- **Backend container** cannot reach `localhost:58180` (it refers to itself)
- **Tokens** have `iss: http://localhost:58180/realms/pki-e2e`

### Solution: OIDC_DISCOVERY_BASE_URL

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Docker OIDC Networking                               │
│                                                                          │
│  Browser                                    Docker Network               │
│  ┌─────────────────┐                       ┌─────────────────┐          │
│  │ localhost:58180  │ ◄─── Port mapping ───►│ keycloak:8080   │          │
│  └─────────────────┘                       └─────────────────┘          │
│         │                                          ▲                    │
│         │ Token issued with                        │                    │
│         │ iss=localhost:58180                       │                    │
│         ▼                                          │                    │
│  ┌─────────────────┐    OIDC_DISCOVERY_BASE_URL    │                    │
│  │ Backend         │ ──────────────────────────────┘                    │
│  │ Validates:      │   Fetches from: keycloak:8080                      │
│  │ iss=localhost   │   Validates:    localhost:58180                     │
│  └─────────────────┘                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Configuration:**
```yaml
# docker-compose.e2e.yml
backend:
  environment:
    # What's in tokens (for validation)
    - OIDC_ISSUER=http://localhost:58180/realms/pki-e2e
    # Where to fetch OIDC config (Docker network)
    - OIDC_DISCOVERY_BASE_URL=http://keycloak:8080/realms/pki-e2e
```

## Machine-to-Machine Authentication

For server-to-server communication without user interaction, use a **confidential client**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Client Credentials Flow (M2M)                         │
│                                                                          │
│  ┌─────────────────┐                           ┌─────────────────┐      │
│  │ Automated       │                           │   Keycloak      │      │
│  │ Service         │                           │                 │      │
│  └────────┬────────┘                           └────────┬────────┘      │
│           │                                             │               │
│           │  POST /token                                │               │
│           │  grant_type=client_credentials              │               │
│           │  client_id=pki-service                      │               │
│           │  client_secret=super-secret-key             │               │
│           │────────────────────────────────────────────>│               │
│           │                                             │               │
│           │  { access_token: "..." }                    │               │
│           │<────────────────────────────────────────────│               │
│           │                                             │               │
│           │  Use token to call PKI Manager API          │               │
│           │                                             │               │
└─────────────────────────────────────────────────────────────────────────┘
```

**When to use this:**
- CI/CD pipelines issuing certificates
- Automated certificate renewal services
- Integration with other systems

**Keycloak setup:**
1. Create client `pki-service` with `publicClient: false`
2. Enable "Service accounts roles"
3. Assign appropriate roles
4. Get client secret from Credentials tab

## Configuration Reference

### Backend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OIDC_ISSUER` | Yes | Token issuer URL (must match `iss` claim) |
| `OIDC_AUDIENCE` | Yes | Expected audience(s), comma-separated |
| `OIDC_ROLES_CLAIM` | No | Path to roles in token (default: `realm_access.roles`) |
| `OIDC_DISCOVERY_BASE_URL` | No | Override URL for fetching OIDC config |

### Frontend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_OIDC_AUTHORITY` | Yes | OIDC provider URL (same as `OIDC_ISSUER`) |
| `VITE_OIDC_CLIENT_ID` | Yes | Public client ID (e.g., `pki-web`) |
| `VITE_OIDC_SCOPE` | No | OAuth scopes (default: `openid profile email`) |

### Example Configuration

```bash
# Backend
OIDC_ISSUER=https://keycloak.example.com/realms/pki
OIDC_AUDIENCE=pki-web,pki-service
OIDC_ROLES_CLAIM=realm_access.roles

# Frontend (build-time or runtime config.json)
VITE_OIDC_AUTHORITY=https://keycloak.example.com/realms/pki
VITE_OIDC_CLIENT_ID=pki-web
```

## Comparison Summary

| Aspect | Public Client (pki-web) | Confidential Client (pki-service) |
|--------|-------------------------|-----------------------------------|
| **Use case** | Browser SPA | Server-side automation |
| **Secret** | None (uses PKCE) | Required |
| **User interaction** | Yes (login form) | No |
| **Token exchange** | Browser → Keycloak | Server → Keycloak |
| **Security mechanism** | PKCE cryptographic proof | Shared secret |
| **Grant type** | Authorization Code + PKCE | Client Credentials |

## See Also

- **[KEYCLOAK.md](KEYCLOAK.md)** - Step-by-step Keycloak configuration with screenshots
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Docker deployment including OIDC configuration
- **[DEPLOYMENT.md#e2e-testing](DEPLOYMENT.md#e2e-testing)** - E2E testing with pre-configured Keycloak

### External Resources

- [OAuth 2.0 for Browser-Based Apps (RFC)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
- [PKCE (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
