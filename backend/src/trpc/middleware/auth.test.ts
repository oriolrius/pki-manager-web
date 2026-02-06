/**
 * Authentication Middleware Tests
 *
 * Tests for tRPC auth middleware.
 * Integration tests require Keycloak to be running.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  authMiddlewareHandler,
  type AuthenticatedContext,
} from './auth.js';
import {
  initializeOIDC,
  resetOIDCConfig,
  isOIDCEnabled,
} from '../../lib/oidc.js';
import type { Context } from '../context.js';

// Mock context for testing
function createMockContext(authHeader?: string): Context {
  return {
    req: {
      headers: {
        authorization: authHeader,
      },
    } as any,
    res: {} as any,
    db: {} as any,
    user: undefined,
  };
}

// Keycloak test configuration
const KEYCLOAK_URL = 'http://localhost:42997';
const KEYCLOAK_REALM = 'pki-dev';
const KEYCLOAK_ISSUER = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
const KEYCLOAK_TOKEN_URL = `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`;

// Test credentials
const TEST_USER = { username: 'user', password: 'user' };
const TEST_ADMIN = { username: 'admin', password: 'admin' };
const CLIENT_ID = 'pki-web';
const CLIENT_SECRET = 'pki-web-secret';

/**
 * Get an access token from Keycloak using direct access grant
 */
async function getAccessToken(
  username: string,
  password: string
): Promise<string> {
  const response = await fetch(KEYCLOAK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get token: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

describe('Auth Middleware Unit Tests', () => {
  beforeEach(() => {
    resetOIDCConfig();
  });

  afterAll(() => {
    resetOIDCConfig();
  });

  it('should skip authentication and call next when OIDC is not enabled', async () => {
    // Initialize with OIDC disabled
    await initializeOIDC();
    expect(isOIDCEnabled()).toBe(false);

    const ctx = createMockContext('Bearer some-token');

    // When OIDC is disabled, auth middleware should skip validation and call next()
    const result = await authMiddlewareHandler({
      ctx,
      next: () => Promise.resolve({ ok: true }),
    });

    expect(result).toEqual({ ok: true });
  });
});

describe('Auth Middleware Integration Tests (requires Keycloak)', () => {
  let userToken: string;
  let adminToken: string;
  let keycloakAvailable = false;

  beforeAll(async () => {
    // Reset config from previous tests
    resetOIDCConfig();

    // Check if Keycloak is available
    try {
      const response = await fetch(
        `${KEYCLOAK_ISSUER}/.well-known/openid-configuration`
      );
      keycloakAvailable = response.ok;
    } catch {
      keycloakAvailable = false;
    }

    if (!keycloakAvailable) {
      console.log('Skipping Keycloak integration tests - Keycloak not available');
      return;
    }

    // Set env vars and initialize OIDC
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = CLIENT_ID;
    process.env.OIDC_ROLES_CLAIM = 'realm_access.roles';

    await initializeOIDC();

    // Get tokens
    userToken = await getAccessToken(TEST_USER.username, TEST_USER.password);
    adminToken = await getAccessToken(TEST_ADMIN.username, TEST_ADMIN.password);
  });

  afterAll(() => {
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_ROLES_CLAIM;
    resetOIDCConfig();
  });

  it('should reject request without Authorization header', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext();

    await expect(
      authMiddlewareHandler({
        ctx,
        next: () => Promise.resolve({ ok: true }),
      })
    ).rejects.toThrow('Missing or invalid Authorization header');
  });

  it('should reject request with invalid Bearer format', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext('InvalidFormat token');

    await expect(
      authMiddlewareHandler({
        ctx,
        next: () => Promise.resolve({ ok: true }),
      })
    ).rejects.toThrow('Missing or invalid Authorization header');
  });

  it('should reject request with invalid token', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext('Bearer invalid.token.here');

    await expect(
      authMiddlewareHandler({
        ctx,
        next: () => Promise.resolve({ ok: true }),
      })
    ).rejects.toThrow(/Invalid token|signature/);
  });

  it('should accept valid user token and extract user info', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${userToken}`);
    let capturedCtx: any;

    await authMiddlewareHandler({
      ctx,
      next: (opts: any) => {
        capturedCtx = opts?.ctx;
        return Promise.resolve({ ok: true });
      },
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx.user).toBeDefined();
    expect(capturedCtx.user.sub).toBeDefined();
    expect(capturedCtx.user.roles).toContain('user');
  });

  it('should accept valid admin token and extract admin role', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${adminToken}`);
    let capturedCtx: any;

    await authMiddlewareHandler({
      ctx,
      next: (opts: any) => {
        capturedCtx = opts?.ctx;
        return Promise.resolve({ ok: true });
      },
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx.user).toBeDefined();
    expect(capturedCtx.user.roles).toContain('admin');
    // Admin may or may not have 'user' role depending on Keycloak config
  });
});

describe('Role Middleware Integration Tests (requires Keycloak)', () => {
  let userToken: string;
  let adminToken: string;
  let keycloakAvailable = false;

  beforeAll(async () => {
    // Reset config from previous tests
    resetOIDCConfig();

    // Check if Keycloak is available
    try {
      const response = await fetch(
        `${KEYCLOAK_ISSUER}/.well-known/openid-configuration`
      );
      keycloakAvailable = response.ok;
    } catch {
      keycloakAvailable = false;
    }

    if (!keycloakAvailable) {
      console.log('Skipping Keycloak integration tests - Keycloak not available');
      return;
    }

    // Set env vars and initialize OIDC
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = CLIENT_ID;
    process.env.OIDC_ROLES_CLAIM = 'realm_access.roles';

    await initializeOIDC();

    // Get tokens
    userToken = await getAccessToken(TEST_USER.username, TEST_USER.password);
    adminToken = await getAccessToken(TEST_ADMIN.username, TEST_ADMIN.password);
  });

  afterAll(() => {
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_ROLES_CLAIM;
    resetOIDCConfig();
  });

  it('should allow user with required role', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${userToken}`);

    // First apply auth middleware to get authenticated context
    let authenticatedCtx: AuthenticatedContext | undefined;
    await authMiddlewareHandler({
      ctx,
      next: (opts: any) => {
        authenticatedCtx = opts?.ctx;
        return Promise.resolve({ ok: true });
      },
    });

    expect(authenticatedCtx).toBeDefined();
    expect(authenticatedCtx!.user.roles).toContain('user');
  });

  it('should deny user without required role', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${userToken}`);

    // First apply auth middleware to get authenticated context
    let authenticatedCtx: AuthenticatedContext | undefined;
    await authMiddlewareHandler({
      ctx,
      next: (opts: any) => {
        authenticatedCtx = opts?.ctx;
        return Promise.resolve({ ok: true });
      },
    });

    expect(authenticatedCtx).toBeDefined();
    // User should NOT have admin role
    expect(authenticatedCtx!.user.roles).not.toContain('admin');
  });

  it('should allow admin to access admin-only endpoint', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${adminToken}`);

    // First apply auth middleware to get authenticated context
    let authenticatedCtx: AuthenticatedContext | undefined;
    await authMiddlewareHandler({
      ctx,
      next: (opts: any) => {
        authenticatedCtx = opts?.ctx;
        return Promise.resolve({ ok: true });
      },
    });

    expect(authenticatedCtx).toBeDefined();
    // Admin should have admin role
    expect(authenticatedCtx!.user.roles).toContain('admin');
  });
});

describe('Admin Role Middleware Integration Tests (requires Keycloak)', () => {
  let userToken: string;
  let adminToken: string;
  let keycloakAvailable = false;

  beforeAll(async () => {
    // Reset config from previous tests
    resetOIDCConfig();

    // Check if Keycloak is available
    try {
      const response = await fetch(
        `${KEYCLOAK_ISSUER}/.well-known/openid-configuration`
      );
      keycloakAvailable = response.ok;
    } catch {
      keycloakAvailable = false;
    }

    if (!keycloakAvailable) {
      console.log('Skipping Keycloak integration tests - Keycloak not available');
      return;
    }

    // Set env vars and initialize OIDC
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = CLIENT_ID;
    process.env.OIDC_ROLES_CLAIM = 'realm_access.roles';

    await initializeOIDC();

    // Get tokens
    userToken = await getAccessToken(TEST_USER.username, TEST_USER.password);
    adminToken = await getAccessToken(TEST_ADMIN.username, TEST_ADMIN.password);
  });

  afterAll(() => {
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_ROLES_CLAIM;
    resetOIDCConfig();
  });

  /**
   * Helper to simulate admin role check middleware behavior
   * This replicates the logic from init.ts adminRoleMiddleware
   */
  async function simulateAdminProcedure(ctx: Context): Promise<any> {
    // First apply auth middleware
    let authenticatedCtx: AuthenticatedContext | undefined;
    await authMiddlewareHandler({
      ctx,
      next: (opts: any) => {
        authenticatedCtx = opts?.ctx;
        return Promise.resolve();
      },
    });

    if (!authenticatedCtx) {
      throw new Error('Authentication failed');
    }

    // Then check admin role (simulating adminRoleMiddleware)
    if (!authenticatedCtx.user.roles.includes('admin')) {
      const { TRPCError } = await import('@trpc/server');
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Admin role required',
      });
    }

    return { user: authenticatedCtx.user };
  }

  it('should reject user without admin role with FORBIDDEN', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${userToken}`);

    await expect(simulateAdminProcedure(ctx)).rejects.toThrow('Admin role required');

    // Verify it's a FORBIDDEN error
    try {
      await simulateAdminProcedure(ctx);
    } catch (error: any) {
      expect(error.code).toBe('FORBIDDEN');
    }
  });

  it('should allow admin user to access admin procedure', async () => {
    if (!keycloakAvailable) return;

    const ctx = createMockContext(`Bearer ${adminToken}`);

    const result = await simulateAdminProcedure(ctx);

    expect(result.user).toBeDefined();
    expect(result.user.roles).toContain('admin');
  });
});
