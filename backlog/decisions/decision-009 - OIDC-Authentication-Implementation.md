---
id: decision-009
title: 009 - OIDC Authentication Implementation
date: '2025-02-05'
status: proposed
---

## Context

The PKI Manager requires authentication and authorization to protect certificate management operations. Users should be authenticated via an external Identity Provider (IdP) using OpenID Connect (OIDC), the industry standard for identity federation.

### Requirements

1. **Provider-Agnostic**: Must work with any OIDC-compliant provider (Keycloak, Auth0, Okta, Azure AD, Google)
2. **No Custom Login UI**: Redirect to provider's login page (no embedded login forms)
3. **No Custom Profile Management**: Use provider's account management pages
4. **No Custom Logout Implementation**: Redirect to provider's logout endpoint
5. **Role-Based Access Control**: Extract roles from token claims for authorization
6. **Stateless Backend**: JWT validation without server-side sessions
7. **Development Environment**: Use Keycloak for local development and testing

### Technology Constraints

- Backend: Fastify 5.2 + tRPC 11.0
- Frontend: React 19 + TanStack Router
- Development IdP: Keycloak 26.5.2 (pre-configured in `keycloak/` folder)
- Protocol: OAuth 2.0 + OpenID Connect 1.0

### Current State

- Keycloak is configured with `pki-dev` realm, two OAuth2 clients, and test users
- Backend has no authentication (all tRPC procedures are public)
- Frontend has no auth state management or protected routes

## Decision

### Architecture Overview

```
┌─────────────────┐                      ┌──────────────────┐
│   Frontend      │◄────── Redirect ────►│   OIDC Provider  │
│   (React SPA)   │       (Login/Logout) │   (Keycloak)     │
└────────┬────────┘                      └────────┬─────────┘
         │                                        │
         │ Bearer Token                           │ JWKS
         ▼                                        ▼
┌─────────────────┐                      ┌──────────────────┐
│   Backend       │◄───── Validate ──────│   /.well-known/  │
│   (Fastify)     │       JWT via JWKS   │   openid-config  │
└─────────────────┘                      └──────────────────┘
```

**Flow Summary:**
1. User clicks "Login" → Frontend redirects to OIDC provider's authorization endpoint
2. User authenticates at provider → Provider redirects back with authorization code
3. Frontend exchanges code for tokens → Stores access token in memory
4. Frontend attaches Bearer token to all API requests
5. Backend validates JWT signature using JWKS from provider
6. Backend extracts user info and roles from token claims
7. User clicks "Logout" → Frontend redirects to provider's end session endpoint

### Key Design Decisions

#### 1. OIDC Flow: Authorization Code with PKCE

**Choice**: Authorization Code flow with PKCE (Proof Key for Code Exchange)

**Rationale**:
- **Security**: PKCE prevents authorization code interception attacks
- **Standard**: Recommended flow for SPAs by OAuth 2.0 Security Best Current Practice
- **No Client Secret**: Frontend doesn't need to store secrets (public client)
- **Provider Support**: All major providers support PKCE

**Flow Steps**:
```
1. Frontend generates code_verifier (random string)
2. Frontend computes code_challenge = SHA256(code_verifier)
3. Frontend redirects to /authorize with code_challenge
4. User authenticates at provider
5. Provider redirects to callback with authorization code
6. Frontend exchanges code + code_verifier for tokens
7. Provider validates code_challenge matches
8. Frontend receives access_token, id_token, refresh_token
```

#### 2. Token Storage: In-Memory Only

**Choice**: Store tokens in memory (JavaScript variables), never in localStorage/sessionStorage

**Rationale**:
- **XSS Protection**: Tokens not accessible via `document.cookie` or Storage API
- **Library Default**: `oidc-client-ts` stores tokens in memory by default
- **Trade-off**: Tokens lost on page refresh (user must re-authenticate)
- **Mitigation**: Use `silent_renew` with hidden iframe to restore session

**Implementation**:
```typescript
// oidc-client-ts UserManager with in-memory storage
const userManager = new UserManager({
  userStore: new WebStorageStateStore({ store: window.sessionStorage }), // For state only
  // Tokens stored in memory by library
});
```

**Session Restoration**:
- On page load, attempt silent sign-in via hidden iframe
- If user has active session at provider, tokens are restored without redirect
- If no session, user sees unauthenticated state

#### 3. Backend JWT Validation: JWKS-Based

**Choice**: Validate JWTs using provider's JWKS (JSON Web Key Set) endpoint

**Rationale**:
- **No Shared Secrets**: Backend doesn't need client secrets
- **Key Rotation**: Automatically handles provider key rotation
- **Standard**: All OIDC providers expose JWKS endpoint
- **Caching**: Cache JWKS with configurable TTL for performance

**Implementation with `jose` library**:
```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Create JWKS client (caches keys automatically)
const JWKS = createRemoteJWKSet(
  new URL(`${issuer}/.well-known/jwks.json`)
);

// Validate token
const { payload } = await jwtVerify(token, JWKS, {
  issuer: expectedIssuer,
  audience: expectedAudience,
});
```

**Discovery-Based Configuration**:
```typescript
// Fetch OIDC configuration dynamically
const config = await fetch(`${issuer}/.well-known/openid-configuration`).then(r => r.json());
const jwksUri = config.jwks_uri;
const JWKS = createRemoteJWKSet(new URL(jwksUri));
```

#### 4. Role Extraction: Configurable Claim Path

**Choice**: Make role claim path configurable to support different providers

**Problem**: Each OIDC provider stores roles in different token claims:

| Provider | Roles Claim Path | Example |
|----------|-----------------|---------|
| Keycloak | `realm_access.roles` | `["admin", "user"]` |
| Auth0 | `permissions` or custom namespace | `["read:certs", "write:certs"]` |
| Okta | `groups` | `["Admins", "Users"]` |
| Azure AD | `roles` | `["Admin", "User"]` |
| Google | N/A | No roles claim |

**Solution**: Environment variable for claim path with lodash-style accessor:

```typescript
// Configuration
OIDC_ROLES_CLAIM=realm_access.roles  // Keycloak
OIDC_ROLES_CLAIM=permissions         // Auth0
OIDC_ROLES_CLAIM=groups              // Okta

// Implementation
function extractRoles(payload: JWTPayload, claimPath: string): string[] {
  const parts = claimPath.split('.');
  let value: unknown = payload;
  for (const part of parts) {
    value = (value as Record<string, unknown>)?.[part];
  }
  return Array.isArray(value) ? value : [];
}
```

**Role Mapping (Optional)**:
```typescript
// Map provider-specific roles to application roles
OIDC_ROLE_MAPPING={"Admins":"admin","Users":"user"}
```

#### 5. Frontend Library: oidc-client-ts + react-oidc-context

**Choice**: Use `oidc-client-ts` with `react-oidc-context` wrapper

**Alternatives Considered**:

| Library | Pros | Cons |
|---------|------|------|
| `keycloak-js` | Official Keycloak adapter | Provider lock-in |
| `oidc-client-ts` | Standards-compliant, provider-agnostic | More configuration |
| `@auth0/auth0-react` | Easy Auth0 setup | Provider lock-in |
| `@azure/msal-react` | Easy Azure AD setup | Provider lock-in |

**Rationale**:
- **Provider-Agnostic**: Works with any OIDC-compliant provider
- **Standards-Compliant**: Implements OAuth 2.0 and OIDC specifications
- **Active Maintenance**: Fork of abandoned `oidc-client-js`, actively maintained
- **React Integration**: `react-oidc-context` provides hooks and context
- **PKCE Support**: Built-in PKCE support for secure SPA flow

**Installation**:
```bash
cd frontend && npm install oidc-client-ts react-oidc-context
```

#### 6. Backend Library: jose

**Choice**: Use `jose` library for JWT validation

**Alternatives Considered**:

| Library | Pros | Cons |
|---------|------|------|
| `jsonwebtoken` | Popular, simple API | No JWKS support, sync only |
| `jose` | JWKS support, async, Web Crypto | Slightly more complex |
| `@fastify/jwt` | Fastify integration | Less flexible for OIDC |
| `openid-client` | Full OIDC client | Overkill for validation only |

**Rationale**:
- **JWKS Support**: `createRemoteJWKSet` handles key fetching and caching
- **Async/Await**: Non-blocking validation
- **Web Crypto**: Uses native crypto APIs
- **No Dependencies**: Zero external dependencies
- **Standards-Compliant**: Implements JOSE standards (JWS, JWE, JWK, JWT)

**Installation**:
```bash
cd backend && pnpm add jose
```

#### 7. Protected Procedures: tRPC Middleware

**Choice**: Create authentication middleware for tRPC procedures

**Implementation**:
```typescript
// backend/src/trpc/middleware/auth.ts

import { TRPCError } from '@trpc/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context } from '../context';

interface AuthConfig {
  issuer: string;
  audience: string;
  rolesClaimPath?: string;
}

export function createAuthMiddleware(config: AuthConfig) {
  const JWKS = createRemoteJWKSet(
    new URL(`${config.issuer}/protocol/openid-connect/certs`)
  );

  return t.middleware(async ({ ctx, next }) => {
    const authHeader = ctx.req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: config.issuer,
        audience: config.audience,
      });

      const roles = extractRoles(payload, config.rolesClaimPath);

      return next({
        ctx: {
          ...ctx,
          user: {
            sub: payload.sub!,
            email: payload.email as string | undefined,
            name: payload.name as string | undefined,
            roles,
          },
        },
      });
    } catch (error) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid token' });
    }
  });
}
```

**Procedure Types**:
```typescript
// backend/src/trpc/init.ts

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(authMiddleware);

export const adminProcedure = protectedProcedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user.roles.includes('admin')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin role required' });
    }
    return next();
  })
);
```

#### 8. Login/Logout: Provider Redirects

**Choice**: Redirect to provider for all authentication operations

**Login Flow**:
```typescript
// Frontend: Trigger login redirect
const { signinRedirect } = useAuth();

const handleLogin = () => {
  signinRedirect(); // Redirects to provider's /authorize endpoint
};
```

**Logout Flow**:
```typescript
// Frontend: Trigger logout redirect
const { signoutRedirect } = useAuth();

const handleLogout = () => {
  signoutRedirect(); // Redirects to provider's /logout endpoint
};
```

**Account Management**:
```typescript
// Link to provider's account management page
const accountUrl = `${authority}/account`;
// For Keycloak: http://localhost:42997/realms/pki-dev/account
```

**No Custom UI**: The application never renders login forms, password fields, or profile editors. All authentication UI is handled by the OIDC provider.

#### 9. Callback Handling: Dedicated Route

**Choice**: Create `/callback` route for OIDC redirect handling

**Implementation**:
```typescript
// frontend/src/routes/callback.tsx

import { useAuth } from 'react-oidc-context';
import { useNavigate } from '@tanstack/react-router';

export function CallbackRoute() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.isAuthenticated) {
      // Redirect to original destination or home
      const returnUrl = sessionStorage.getItem('returnUrl') || '/';
      sessionStorage.removeItem('returnUrl');
      navigate({ to: returnUrl });
    }
  }, [auth.isAuthenticated]);

  if (auth.isLoading) {
    return <div>Completing sign-in...</div>;
  }

  if (auth.error) {
    return <div>Authentication error: {auth.error.message}</div>;
  }

  return <div>Redirecting...</div>;
}
```

#### 10. Protected Routes: Router Guards

**Choice**: Use TanStack Router's `beforeLoad` for route protection

**Implementation**:
```typescript
// frontend/src/routes/_authenticated.tsx

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    if (!context.auth.isAuthenticated) {
      // Store intended destination
      sessionStorage.setItem('returnUrl', window.location.pathname);

      // Trigger login redirect
      await context.auth.signinRedirect();

      // Throw to prevent route rendering
      throw redirect({ to: '/' });
    }
  },
});
```

**Route Structure**:
```
frontend/src/routes/
├── __root.tsx           # Root layout with AuthProvider
├── index.tsx            # Public home page
├── callback.tsx         # OIDC callback handler
├── _authenticated.tsx   # Protected route layout
├── _authenticated/
│   ├── cas.tsx          # Protected: CA management
│   ├── certificates.tsx # Protected: Certificate management
│   └── audit.tsx        # Protected: Audit logs
└── api-docs.tsx         # Public: API documentation
```

#### 11. Token Refresh: Silent Renewal

**Choice**: Use silent renewal via hidden iframe

**Implementation**:
```typescript
// OIDC client configuration
const oidcConfig = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,

  // Silent renewal configuration
  automaticSilentRenew: true,
  silent_redirect_uri: `${window.location.origin}/silent-renew.html`,

  // Refresh token 60 seconds before expiry
  accessTokenExpiringNotificationTimeInSeconds: 60,
};
```

**Silent Renew HTML** (`public/silent-renew.html`):
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/oidc-client-ts/dist/browser/oidc-client-ts.min.js"></script>
</head>
<body>
  <script>
    new oidc.UserManager({ response_mode: 'query' }).signinSilentCallback();
  </script>
</body>
</html>
```

#### 12. Configuration: Environment-Driven

**Choice**: All OIDC settings via environment variables

**Backend Configuration** (`.env`):
```env
# OIDC Provider Configuration
OIDC_ISSUER=http://localhost:42997/realms/pki-dev
OIDC_AUDIENCE=pki-web
OIDC_ROLES_CLAIM=realm_access.roles

# Optional: Role mapping for non-standard providers
# OIDC_ROLE_MAPPING={"Admins":"admin","Users":"user"}

# Optional: Skip validation in development (NOT for production)
# OIDC_SKIP_VALIDATION=false
```

**Frontend Configuration** (`.env`):
```env
# OIDC Provider Configuration
VITE_OIDC_AUTHORITY=http://localhost:42997/realms/pki-dev
VITE_OIDC_CLIENT_ID=pki-web
VITE_OIDC_SCOPE=openid profile email

# Optional: Account management URL
VITE_OIDC_ACCOUNT_URL=http://localhost:42997/realms/pki-dev/account
```

**Runtime Configuration** (`public/config.json`):
```json
{
  "apiUrl": "http://localhost:3000/trpc",
  "oidc": {
    "authority": "http://localhost:42997/realms/pki-dev",
    "clientId": "pki-web",
    "scope": "openid profile email"
  }
}
```

**Switching Providers**: Only requires changing configuration:
```env
# Switch to Auth0
OIDC_ISSUER=https://your-tenant.auth0.com
OIDC_AUDIENCE=https://pki-manager-api
OIDC_ROLES_CLAIM=permissions
```

### File Structure

**Backend Changes**:
```
backend/src/
├── lib/
│   └── oidc.ts                    # OIDC configuration and JWKS client
├── trpc/
│   ├── context.ts                 # Add user to context type (modify)
│   ├── init.ts                    # Add protected/admin procedures (modify)
│   └── middleware/
│       └── auth.ts                # JWT validation middleware (new)
└── .env                           # Add OIDC variables (modify)
```

**Frontend Changes**:
```
frontend/src/
├── lib/
│   └── auth/
│       ├── config.ts              # OIDC configuration (new)
│       ├── AuthProvider.tsx       # React context provider (new)
│       └── useAuth.ts             # Re-export from react-oidc-context (new)
├── components/
│   └── UserMenu.tsx               # Login/logout/account buttons (new)
├── routes/
│   ├── __root.tsx                 # Wrap with AuthProvider (modify)
│   ├── callback.tsx               # OIDC callback handler (new)
│   ├── _authenticated.tsx         # Protected route layout (new)
│   └── _authenticated/
│       └── ...                    # Move protected routes here
├── public/
│   └── silent-renew.html          # Silent renewal handler (new)
└── .env                           # Add OIDC variables (modify)
```

### Keycloak Development Configuration

The existing `keycloak/` folder provides a pre-configured development environment:

**Realm**: `pki-dev`
- Access token lifespan: 5 minutes
- SSO session idle: 30 minutes
- SSO session max: 10 hours

**Clients**:

| Client | Type | Use |
|--------|------|-----|
| `pki-web` | Public (PKCE) | Frontend SPA |
| `pki-service` | Confidential | Backend-to-backend (future) |

**Test Users**:

| Username | Password | Roles |
|----------|----------|-------|
| `admin` | `admin` | `admin`, `user` |
| `user` | `user` | `user` |

**Endpoints**:
```
Authorization: http://localhost:42997/realms/pki-dev/protocol/openid-connect/auth
Token:         http://localhost:42997/realms/pki-dev/protocol/openid-connect/token
UserInfo:      http://localhost:42997/realms/pki-dev/protocol/openid-connect/userinfo
JWKS:          http://localhost:42997/realms/pki-dev/protocol/openid-connect/certs
End Session:   http://localhost:42997/realms/pki-dev/protocol/openid-connect/logout
Account:       http://localhost:42997/realms/pki-dev/account
```

### Testing Strategy

**Unit Tests**:
- JWT validation with mock JWKS
- Role extraction from different claim paths
- Auth middleware error handling

**Integration Tests**:
- Full login/logout flow with Keycloak
- Token refresh via silent renewal
- Protected route access

**Manual Testing Checklist**:
1. [ ] Login redirects to Keycloak
2. [ ] Successful login returns to app with user info
3. [ ] Protected routes require authentication
4. [ ] Logout redirects to Keycloak and clears session
5. [ ] Token refresh works before expiry
6. [ ] Admin routes require admin role
7. [ ] Account link opens Keycloak account page

### Migration Path

**Phase 1: Backend Authentication**
1. Add `jose` dependency
2. Create auth middleware
3. Add `protectedProcedure` and `adminProcedure`
4. Update context with user type
5. Keep all procedures as `publicProcedure` initially

**Phase 2: Frontend Authentication**
1. Add `oidc-client-ts` and `react-oidc-context`
2. Create AuthProvider and configuration
3. Add callback route
4. Add UserMenu component
5. Inject Bearer token in tRPC client

**Phase 3: Route Protection**
1. Create `_authenticated` layout route
2. Move protected routes under `_authenticated/`
3. Add route guards

**Phase 4: Procedure Protection**
1. Change procedures from `publicProcedure` to `protectedProcedure`
2. Add role checks where needed
3. Update audit logging with user info

## Consequences

### Positive

1. **Provider-Agnostic**: Switch providers by changing environment variables
2. **No Custom Auth UI**: Reduced development effort and security responsibility
3. **Standards-Compliant**: Uses OAuth 2.0 + OIDC, works with any compliant provider
4. **Secure Token Storage**: In-memory storage protects against XSS
5. **Stateless Backend**: No server-side sessions, horizontally scalable
6. **Type Safety**: Full TypeScript coverage for auth context
7. **Silent Renewal**: Seamless token refresh without user interaction
8. **Audit Trail Integration**: User identity available for all operations

### Negative

1. **Page Refresh Clears Session**: User must re-authenticate after page refresh
   - Mitigation: Silent renewal restores session if provider session exists
2. **Provider Dependency**: Requires OIDC provider to be available
   - Mitigation: Keycloak runs locally for development
3. **Complex Initial Setup**: More configuration than simple password auth
   - Mitigation: Pre-configured Keycloak realm for development
4. **Role Claim Differences**: Each provider uses different claim paths
   - Mitigation: Configurable claim path with optional mapping

### Security Considerations

1. **PKCE Required**: Prevents authorization code interception
2. **HTTPS in Production**: All OIDC traffic must be encrypted
3. **Audience Validation**: Backend verifies token is intended for this API
4. **Issuer Validation**: Backend verifies token is from expected provider
5. **No localStorage**: Tokens never stored in browser storage
6. **CORS Configuration**: Restrict allowed origins in production

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Provider outage | Keycloak can run locally; tokens valid until expiry |
| Token theft via XSS | In-memory storage; CSP headers; input sanitization |
| Key rotation breaks validation | JWKS client auto-refreshes keys |
| Clock skew causes validation failures | Configure acceptable clock tolerance |

## Implementation Tasks

The following tasks should be created in the backlog:

1. **Add OIDC dependencies to backend** - Install `jose` library
2. **Create backend auth middleware** - JWT validation with JWKS
3. **Add protected procedure types** - `protectedProcedure`, `adminProcedure`
4. **Update backend environment** - Add OIDC configuration variables
5. **Add OIDC dependencies to frontend** - Install `oidc-client-ts`, `react-oidc-context`
6. **Create frontend AuthProvider** - OIDC configuration and context
7. **Add callback route** - Handle OIDC redirects
8. **Create UserMenu component** - Login/logout/account buttons
9. **Add silent renewal** - Token refresh via hidden iframe
10. **Create protected route layout** - `_authenticated` route with guards
11. **Inject auth header in tRPC** - Bearer token in all requests
12. **Migrate procedures to protected** - Change from public to protected
13. **Add integration tests** - Full auth flow with Keycloak
14. **Update documentation** - Auth setup and provider switching guide

## Related Decisions

- **decision-001**: PKI Manager Technology Stack - Defines Fastify + tRPC + React architecture
- **decision-005**: Frontend Architecture - Defines TanStack Router file-based routing

## References

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
- [oidc-client-ts Documentation](https://authts.github.io/oidc-client-ts/)
- [react-oidc-context Documentation](https://github.com/authts/react-oidc-context)
- [jose Library Documentation](https://github.com/panva/jose)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
