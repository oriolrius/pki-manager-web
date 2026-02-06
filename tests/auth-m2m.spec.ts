import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Machine-to-Machine (M2M) Authentication
 *
 * Tests OAuth2 Client Credentials flow with the pki-service client.
 * Verifies that the backend tRPC API accepts tokens from both pki-web (user)
 * and pki-service (M2M) clients.
 *
 * Prerequisites:
 * - Backend running with OIDC_AUDIENCE=pki-web,pki-service
 * - Keycloak running with pki-dev realm
 *
 * Environment variables:
 *   BACKEND_URL - Backend API URL (default: http://localhost:3000)
 *   KEYCLOAK_URL - Keycloak base URL (default: http://localhost:42997)
 *
 * Usage:
 *   BACKEND_URL=http://wsl.ymbihq.local:52081 \
 *   KEYCLOAK_URL=http://wsl.ymbihq.local:42997 \
 *   pnpm playwright test tests/auth-m2m.spec.ts
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:42997';
const REALM = 'pki-dev';

// Client credentials for M2M
const M2M_CLIENT_ID = 'pki-service';
const M2M_CLIENT_SECRET = 'pki-service-secret';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Get token using Client Credentials flow (M2M)
 */
async function getM2MToken(): Promise<string> {
  const tokenUrl = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get M2M token: ${response.status} - ${error}`);
  }

  const data: TokenResponse = await response.json();
  return data.access_token;
}

/**
 * Decode JWT payload
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1];
  return JSON.parse(Buffer.from(base64, 'base64').toString());
}

test.describe('M2M Authentication - Client Credentials Flow', () => {
  test('should obtain access token using client credentials', async () => {
    const token = await getM2MToken();

    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);

    // Verify token structure (JWT has 3 parts)
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  test('M2M token should have correct azp claim', async () => {
    const token = await getM2MToken();
    const payload = decodeJwtPayload(token);

    // M2M token should have azp = pki-service
    expect(payload.azp).toBe('pki-service');
  });

  test('M2M token should have service account subject', async () => {
    const token = await getM2MToken();
    const payload = decodeJwtPayload(token);

    // Service account tokens have a specific subject format
    expect(payload.sub).toBeDefined();
    // Keycloak service accounts typically have preferred_username like "service-account-pki-service"
    expect(payload.preferred_username).toContain('service-account');
  });

  test('should access health endpoint without auth', async () => {
    const response = await fetch(`${BACKEND_URL}/health`);

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('should access tRPC ca.list with M2M token', async () => {
    const token = await getM2MToken();

    const response = await fetch(`${BACKEND_URL}/trpc/ca.list`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.result).toBeDefined();
    expect(data.result.data).toBeDefined();
  });

  test('should access tRPC certificate.list with M2M token', async () => {
    const token = await getM2MToken();

    const response = await fetch(`${BACKEND_URL}/trpc/certificate.list`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.result).toBeDefined();
  });

  test('should reject tRPC requests without token', async () => {
    const response = await fetch(`${BACKEND_URL}/trpc/ca.list`);

    // tRPC returns 401 for unauthorized requests
    expect(response.status).toBe(401);
  });

  test('should reject tRPC requests with invalid token', async () => {
    const response = await fetch(`${BACKEND_URL}/trpc/ca.list`, {
      headers: {
        Authorization: 'Bearer invalid-token-here',
      },
    });

    expect(response.status).toBe(401);
  });

  test('should reject tRPC requests with expired token format', async () => {
    // Create a fake JWT with invalid signature
    const fakeToken =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiYXpwIjoicGtpLXNlcnZpY2UifQ.invalid-signature';

    const response = await fetch(`${BACKEND_URL}/trpc/ca.list`, {
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    });

    expect(response.status).toBe(401);
  });
});

test.describe('OpenAPI & Documentation Access', () => {
  test('should access Swagger UI documentation', async () => {
    const response = await fetch(`${BACKEND_URL}/api/docs`);

    expect(response.ok).toBe(true);
  });

  test('should access OpenAPI JSON spec', async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/openapi.json`);

    expect(response.ok).toBe(true);
    const spec = await response.json();
    expect(spec.openapi).toBeDefined();
    expect(spec.info.title).toBeDefined();
  });

  test('OpenAPI spec should have valid structure', async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/openapi.json`);
    const spec = await response.json();

    // Verify basic OpenAPI structure
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });
});

test.describe('REST API with M2M Token', () => {
  // REST API endpoints require authentication (same as tRPC)
  // These tests verify that M2M tokens work for REST API access

  test('should access REST API /api/v1/cas with M2M token', async () => {
    const token = await getM2MToken();

    const response = await fetch(`${BACKEND_URL}/api/v1/cas`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.items).toBeDefined();
  });

  test('should access REST API /api/v1/certificates with M2M token', async () => {
    const token = await getM2MToken();

    const response = await fetch(`${BACKEND_URL}/api/v1/certificates`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.items).toBeDefined();
  });

  test('should reject REST API /api/v1/cas without token', async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/cas`);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  test('should reject REST API /api/v1/certificates without token', async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/certificates`);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  test('should reject REST API with invalid token', async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/cas`, {
      headers: {
        Authorization: 'Bearer invalid-token-here',
      },
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  test('REST API /api/v1/health should be accessible without auth', async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/health`);

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});
