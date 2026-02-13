import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for PKI Manager Production Deployment
 *
 * Tests the complete OIDC authentication flow with runtime config.json
 * on the production deployment at pki.nexiona.io.
 *
 * Prerequisites:
 * - PKI Manager deployed at pki.nexiona.io
 * - Backend deployed at api.pki.nexiona.io
 * - Keycloak running at iam.nexiona.io with pki-manager realm
 * - Test user created: testuser / Test123!
 *
 * Environment variables:
 *   PROD_FRONTEND_URL - Frontend URL (default: https://pki.nexiona.io)
 *   PROD_KEYCLOAK_URL - Keycloak URL (default: https://iam.nexiona.io)
 *   PROD_TEST_USER - Test username (default: testuser)
 *   PROD_TEST_PASSWORD - Test password (default: Test123!)
 *
 * Usage:
 *   pnpm playwright test tests/e2e-production.spec.ts
 */

// Configuration from environment
const FRONTEND_URL = process.env.PROD_FRONTEND_URL || 'https://pki.nexiona.io';
const KEYCLOAK_URL = process.env.PROD_KEYCLOAK_URL || 'https://iam.nexiona.io';
const TEST_USER = process.env.PROD_TEST_USER || 'testuser';
const TEST_PASSWORD = process.env.PROD_TEST_PASSWORD || 'Test123!';

/**
 * Helper: Clear all authentication state
 */
async function clearAuthState(page: Page) {
  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'commit', timeout: 10000 });
  } catch {
    // Ignore navigation errors during cleanup
  }
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Helper: Perform Keycloak login
 */
async function keycloakLogin(page: Page, username: string, password: string) {
  // Wait for Keycloak login form
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
    timeout: 15000,
  });

  // Fill credentials
  await page.getByRole('textbox', { name: /username or email/i }).fill(username);
  await page.getByRole('textbox', { name: /password/i }).fill(password);

  // Click sign in
  await page.getByRole('button', { name: /sign in/i }).click();
}

/**
 * Helper: Wait for app dashboard to be loaded
 */
async function waitForDashboard(page: Page) {
  // Wait for navigation back to app
  await page.waitForFunction(
    () => !window.location.href.includes('iam.nexiona.io'),
    { timeout: 30000 }
  );

  // Wait for dashboard heading
  await expect(
    page.getByRole('heading', { name: /own your security infrastructure/i })
  ).toBeVisible({ timeout: 20000 });
}

test.describe('Production E2E Tests - Runtime OIDC Config', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
  });

  test('config.json is served correctly', async ({ page }) => {
    // Fetch config.json directly
    const response = await page.request.get(`${FRONTEND_URL}/config.json`);
    expect(response.ok()).toBe(true);

    const config = await response.json();
    expect(config.oidc).toBeDefined();
    expect(config.oidc.authority).toContain('iam.nexiona.io');
    expect(config.oidc.clientId).toBe('pki-web');
  });

  test('unauthenticated user is redirected to Keycloak', async ({ page }) => {
    await page.goto(FRONTEND_URL);

    // Should redirect to Keycloak
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, {
      timeout: 20000,
    });

    // Verify on Keycloak login page
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('successful login with runtime config', async ({ page }) => {
    // Navigate to app (will redirect to Keycloak)
    await page.goto(FRONTEND_URL);

    // Wait for Keycloak redirect
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, {
      timeout: 20000,
    });

    // Perform login
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);

    // Wait for redirect back to app
    await waitForDashboard(page);

    // Verify user is logged in
    await expect(page.getByRole('button', { name: /test user/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('API calls work with authenticated session', async ({ page }) => {
    // Login first
    await page.goto(FRONTEND_URL);
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForDashboard(page);

    // Wait for dashboard data to load
    await page.waitForTimeout(3000);

    // Verify dashboard stats load without errors
    // Should show numbers instead of "Err"
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Error loading');

    // Check for stat cards (Total CAs, Total Certs)
    await expect(page.locator('text=Total CAs')).toBeVisible();
    await expect(page.locator('text=Total Certs')).toBeVisible();
  });

  test('tokens are stored with runtime config storage key', async ({ page }) => {
    // Login
    await page.goto(FRONTEND_URL);
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForDashboard(page);

    // Check localStorage for tokens with correct storage key
    const tokenData = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      // Should be stored with runtime config authority and clientId
      const oidcKey = keys.find((key) =>
        key.includes('oidc.user:') &&
        key.includes('iam.nexiona.io') &&
        key.includes('pki-web')
      );
      if (!oidcKey) return null;
      const data = localStorage.getItem(oidcKey);
      return data ? JSON.parse(data) : null;
    });

    expect(tokenData).not.toBeNull();
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.id_token).toBeDefined();
    expect(tokenData.expires_at).toBeDefined();
  });

  test('page reload maintains authentication', async ({ page }) => {
    // Login
    await page.goto(FRONTEND_URL);
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForDashboard(page);

    // Verify logged in
    await expect(page.getByRole('button', { name: /test user/i })).toBeVisible();

    // Reload page
    await page.reload();
    await page.waitForTimeout(3000);

    // Should still be logged in (no redirect to Keycloak)
    const url = page.url();
    expect(url).not.toContain('iam.nexiona.io');
    await expect(page.getByRole('button', { name: /test user/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('navigation works when authenticated', async ({ page }) => {
    // Login
    await page.goto(FRONTEND_URL);
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForDashboard(page);

    // Navigate to Certificate Authorities
    await page.getByRole('link', { name: /certificate authorities/i }).click();
    await expect(page).toHaveURL(/\/cas$/);
    // CAs page shows table directly without heading - verify Create CA button is visible
    await expect(page.getByRole('button', { name: /create ca/i })).toBeVisible({
      timeout: 10000,
    });

    // Navigate to Certificates
    await page.getByRole('link', { name: /^certificates$/i }).click();
    await expect(page).toHaveURL(/\/certificates$/);

    // Navigate back to Dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('logout works correctly', async ({ page }) => {
    // Login
    await page.goto(FRONTEND_URL);
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForDashboard(page);

    // Open profile menu and logout
    await page.getByRole('button', { name: /test user/i }).click();
    await page.getByRole('button', { name: /logout/i }).click();

    // Should redirect to Keycloak logout
    await page.waitForURL(/.*protocol\/openid-connect\/logout/, {
      timeout: 15000,
    });

    // Confirm logout if prompted
    const logoutButton = page.getByRole('button', { name: /logout/i });
    if (await logoutButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logoutButton.click();
    }

    // Should redirect back to login
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, {
      timeout: 15000,
    });
  });
});

test.describe('Production E2E - Error Handling', () => {
  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });

    // Try login with invalid credentials
    await page.getByRole('textbox', { name: /username or email/i }).fill('invaliduser');
    await page.getByRole('textbox', { name: /password/i }).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show error on Keycloak
    await expect(page.getByText(/invalid username or password/i)).toBeVisible({
      timeout: 5000,
    });

    // Should still be on Keycloak
    expect(page.url()).toContain('iam.nexiona.io');
  });
});
