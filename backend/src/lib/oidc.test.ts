/**
 * OIDC Configuration Module Tests
 *
 * Tests for provider-agnostic OIDC configuration.
 * Integration tests require Keycloak to be running.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initializeOIDC,
  getOIDCConfig,
  getJWKS,
  extractRoles,
  isOIDCEnabled,
  resetOIDCConfig,
} from './oidc.js';

describe('OIDC Configuration Module', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module state before each test
    resetOIDCConfig();
    // Clear OIDC env vars
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_ROLES_CLAIM;
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
    resetOIDCConfig();
  });

  describe('initializeOIDC', () => {
    it('should disable OIDC when no env vars are set', async () => {
      const config = await initializeOIDC();

      expect(config.enabled).toBe(false);
      expect(config.issuer).toBe('');
      expect(isOIDCEnabled()).toBe(false);
    });

    it('should throw error when only OIDC_ISSUER is set', async () => {
      process.env.OIDC_ISSUER = 'http://localhost:42997/realms/pki-dev';

      await expect(initializeOIDC()).rejects.toThrow('OIDC_AUDIENCE environment variable is required');
    });

    it('should throw error when only OIDC_AUDIENCE is set', async () => {
      process.env.OIDC_AUDIENCE = 'pki-web';

      await expect(initializeOIDC()).rejects.toThrow('OIDC_ISSUER environment variable is required');
    });
  });

  describe('extractRoles', () => {
    beforeEach(async () => {
      // Initialize with disabled OIDC for role extraction tests
      await initializeOIDC();
    });

    it('should return empty array when OIDC is disabled', () => {
      const payload = { realm_access: { roles: ['admin', 'user'] } };
      const roles = extractRoles(payload);

      expect(roles).toEqual([]);
    });
  });

  describe('getOIDCConfig', () => {
    it('should throw error when not initialized', () => {
      expect(() => getOIDCConfig()).toThrow('OIDC not initialized');
    });

    it('should return config after initialization', async () => {
      await initializeOIDC();
      const config = getOIDCConfig();

      expect(config).toBeDefined();
      expect(config.enabled).toBe(false);
    });
  });

  describe('getJWKS', () => {
    it('should throw error when OIDC is disabled', async () => {
      await initializeOIDC();

      expect(() => getJWKS()).toThrow('OIDC is not enabled');
    });
  });
});

describe('OIDC Integration Tests (requires Keycloak)', () => {
  const KEYCLOAK_ISSUER = 'http://localhost:42997/realms/pki-dev';
  const KEYCLOAK_AUDIENCE = 'pki-web';

  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetOIDCConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetOIDCConfig();
  });

  it('should initialize with Keycloak discovery endpoint', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = KEYCLOAK_AUDIENCE;

    // This will fail if Keycloak is not running
    let config;
    try {
      config = await initializeOIDC();
    } catch (error) {
      // Skip test if Keycloak is not available
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    expect(config.enabled).toBe(true);
    expect(config.issuer).toBe(KEYCLOAK_ISSUER);
    expect(config.audiences).toContain(KEYCLOAK_AUDIENCE);
    expect(config.rolesClaimPath).toBe('realm_access.roles');
    expect(config.jwksUri).toContain('/protocol/openid-connect/certs');
  });

  it('should support multiple audiences (comma-separated)', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = 'pki-web, pki-service';

    let config;
    try {
      config = await initializeOIDC();
    } catch (error) {
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    expect(config.audiences).toHaveLength(2);
    expect(config.audiences).toContain('pki-web');
    expect(config.audiences).toContain('pki-service');
  });

  it('should use custom roles claim path', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = KEYCLOAK_AUDIENCE;
    process.env.OIDC_ROLES_CLAIM = 'custom.roles.path';

    let config;
    try {
      config = await initializeOIDC();
    } catch (error) {
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    expect(config.rolesClaimPath).toBe('custom.roles.path');
  });

  it('should create JWKS client when enabled', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = KEYCLOAK_AUDIENCE;

    try {
      await initializeOIDC();
    } catch (error) {
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    const jwks = getJWKS();
    expect(jwks).toBeDefined();
    expect(typeof jwks).toBe('function');
  });

  it('should extract roles from Keycloak-style payload', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = KEYCLOAK_AUDIENCE;

    try {
      await initializeOIDC();
    } catch (error) {
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    const payload = {
      realm_access: {
        roles: ['admin', 'user', 'offline_access'],
      },
    };

    const roles = extractRoles(payload);
    expect(roles).toContain('admin');
    expect(roles).toContain('user');
    expect(roles).toHaveLength(3);
  });

  it('should handle missing roles in payload', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = KEYCLOAK_AUDIENCE;

    try {
      await initializeOIDC();
    } catch (error) {
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    const payload = {
      sub: 'user-123',
      email: 'user@example.com',
    };

    const roles = extractRoles(payload);
    expect(roles).toEqual([]);
  });

  it('should handle Auth0-style payload with custom claim path', async () => {
    process.env.OIDC_ISSUER = KEYCLOAK_ISSUER;
    process.env.OIDC_AUDIENCE = KEYCLOAK_AUDIENCE;
    process.env.OIDC_ROLES_CLAIM = 'permissions';

    try {
      await initializeOIDC();
    } catch (error) {
      console.log('Skipping Keycloak integration test - Keycloak not available');
      return;
    }

    const payload = {
      permissions: ['read:certs', 'write:certs', 'admin:certs'],
    };

    const roles = extractRoles(payload);
    expect(roles).toContain('read:certs');
    expect(roles).toContain('write:certs');
    expect(roles).toHaveLength(3);
  });
});
