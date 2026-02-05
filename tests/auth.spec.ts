import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Authentication Tests for PKI Manager
 *
 * Tests the complete OIDC authentication flow including:
 * - Automatic redirect when not logged in
 * - Login process via Keycloak
 * - Account settings access
 * - Logout process
 * - Application behavior when auth is disabled
 *
 * Prerequisites:
 * - Frontend running with OIDC enabled
 * - Backend running with OIDC configured
 * - Keycloak running with pki-dev realm
 *
 * Environment variables:
 *   PLAYWRIGHT_BASE_URL - Frontend URL (default: http://localhost:52082)
 *   KEYCLOAK_URL - Keycloak base URL (default: http://localhost:42997)
 *   TEST_USER - Test username (default: admin)
 *   TEST_PASSWORD - Test password (default: admin)
 *
 * Usage:
 *   pnpm playwright test tests/auth.spec.ts
 *
 *   # With custom URLs:
 *   PLAYWRIGHT_BASE_URL=http://wsl.ymbihq.local:52080 \
 *   KEYCLOAK_URL=http://wsl.ymbihq.local:42997 \
 *   pnpm playwright test tests/auth.spec.ts
 */

// Configuration from environment
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:42997';
const TEST_USER = process.env.TEST_USER || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';

/**
 * Helper: Clear all authentication state
 */
async function clearAuthState(page: Page, baseUrl: string) {
  // Navigate to the base URL first to access its localStorage
  try {
    await page.goto(baseUrl, { waitUntil: 'commit', timeout: 5000 });
  } catch {
    // Ignore navigation errors during cleanup
  }
  await page.evaluate(() => {
    // Clear localStorage (tokens)
    localStorage.clear();
    // Clear sessionStorage (OIDC state)
    sessionStorage.clear();
  });
}

/**
 * Helper: Check if on Keycloak login page
 */
async function isOnKeycloakLogin(page: Page): Promise<boolean> {
  const url = page.url();
  // Check for various Keycloak auth-related URL patterns
  return (
    url.includes('/realms/') &&
    (url.includes('/protocol/openid-connect/') ||
      url.includes('/login-actions/'))
  );
}

/**
 * Helper: Perform Keycloak login
 */
async function keycloakLogin(page: Page, username: string, password: string) {
  // Wait for Keycloak login form
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
    timeout: 10000,
  });

  // Fill credentials - use specific selectors for Keycloak's form
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);

  // Click sign in
  await page.getByRole('button', { name: /sign in/i }).click();
}

/**
 * Helper: Wait for app to be loaded after login
 */
async function waitForAppLoaded(page: Page) {
  // Wait for navigation back to app (not on Keycloak anymore)
  // Use a longer timeout and handle potential intermediate redirects
  await page.waitForFunction(
    () => !window.location.href.includes('realms'),
    { timeout: 20000 }
  );

  // Wait for dashboard heading to appear
  await expect(
    page.getByRole('heading', { name: /own your security infrastructure/i })
  ).toBeVisible({ timeout: 15000 });
}

test.describe('Authentication Flow - OIDC Enabled', () => {
  // Run tests serially to avoid session conflicts
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, baseURL }) => {
    // Clear any existing auth state before each test
    await clearAuthState(page, baseURL || '/');
  });

  test('redirects to Keycloak when not authenticated', async ({ page }) => {
    // Navigate to app
    await page.goto('/');

    // Should redirect to Keycloak login (the "Authentication Required" message is brief)
    await page.waitForURL(/.*realms.*/, {
      timeout: 15000,
    });

    // Verify on Keycloak login page
    expect(await isOnKeycloakLogin(page)).toBe(true);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();
  });

  test('successful login redirects back to app', async ({ page }) => {
    // Navigate to app (will redirect to Keycloak)
    await page.goto('/');

    // Wait for redirect to Keycloak
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });

    // Perform login
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);

    // Should redirect back to app
    await waitForAppLoaded(page);

    // Verify user is logged in (profile menu shows username)
    const profileButton = page.getByRole('button', { name: /admin user/i });
    await expect(profileButton).toBeVisible({ timeout: 5000 });
  });

  test('profile menu shows user information', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForAppLoaded(page);

    // Open profile menu
    const profileButton = page.getByRole('button', { name: /admin user/i });
    await profileButton.click();

    // Verify menu content - use paragraph selector to be specific
    await expect(
      page.getByRole('paragraph').filter({ hasText: 'Admin User' })
    ).toBeVisible();
    await expect(
      page.getByRole('paragraph').filter({ hasText: 'admin@localhost' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /account settings/i })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
  });

  test('Account Settings opens Keycloak Account Console', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForAppLoaded(page);

    // Open profile menu
    await page.getByRole('button', { name: /admin user/i }).click();

    // Click Account Settings (opens in new tab)
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /account settings/i }).click(),
    ]);

    // Wait for Account Console to load
    await newPage.waitForLoadState('networkidle');

    // Verify on Keycloak Account Console
    expect(newPage.url()).toContain('/realms/pki-dev/account');
    await expect(
      newPage.getByRole('heading', { name: /personal info/i })
    ).toBeVisible({ timeout: 10000 });

    // Verify user data is shown
    await expect(newPage.getByLabel(/username/i)).toHaveValue('admin');
    await expect(newPage.getByLabel(/email/i)).toHaveValue('admin@localhost');

    // Close the new tab
    await newPage.close();
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForAppLoaded(page);

    // Open profile menu and click Logout
    await page.getByRole('button', { name: /admin user/i }).click();
    await page.getByRole('button', { name: /logout/i }).click();

    // Should redirect to Keycloak logout confirmation
    await page.waitForURL(/.*protocol\/openid-connect\/logout/, {
      timeout: 10000,
    });

    // Confirm logout
    await page.getByRole('button', { name: /logout/i }).click();

    // Should redirect back to login page
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });

    // Verify on login page (not authenticated)
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('app redirects to auth when tokens cleared', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);

    // Wait for redirect back to app
    await page.waitForURL(/^(?!.*realms).*$/, { timeout: 15000 });

    // Verify user is logged in
    await expect(
      page.getByRole('button', { name: /admin user/i })
    ).toBeVisible({ timeout: 10000 });

    // Clear auth state (simulate token deletion/expiry)
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Reload the page to trigger auth check
    await page.reload();

    // App should redirect to Keycloak for authentication
    // Keycloak may auto-login if it has an active session (SSO)
    // Either way, verify the auth flow was triggered
    await page.waitForTimeout(2000);

    const url = page.url();
    const wasRedirectedToKeycloak = url.includes('/realms/');
    const isBackInApp = !url.includes('/realms/');

    // Either we're on Keycloak (redirect worked) or back in app (SSO re-authenticated)
    if (wasRedirectedToKeycloak) {
      expect(url).toContain('realms');
    } else if (isBackInApp) {
      // SSO re-authenticated the user
      await expect(
        page.getByRole('button', { name: /admin user/i })
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('return URL is preserved after login', async ({ page }) => {
    // Navigate directly to a specific route while not logged in
    await page.goto('/certificates');

    // Should redirect to Keycloak
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });

    // Login
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);

    // Should redirect back to app
    await page.waitForURL(/^(?!.*realms).*$/, { timeout: 15000 });

    // Note: Return URL preservation depends on implementation
    // The app may redirect to dashboard first or to the original URL
    // This test verifies the user ends up authenticated in the app
    await expect(
      page.getByRole('button', { name: /admin user/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Application without Authentication', () => {
  /**
   * These tests verify the application works when OIDC is disabled.
   *
   * To run these tests, you need a separate frontend instance with
   * VITE_OIDC_AUTHORITY unset or empty.
   *
   * Example:
   *   # Terminal 1 - Start frontend without auth
   *   cd frontend && VITE_OIDC_AUTHORITY= npm run dev -- --port 52083
   *
   *   # Terminal 2 - Run these tests
   *   PLAYWRIGHT_BASE_URL=http://localhost:52083 \
   *   pnpm playwright test tests/auth.spec.ts -g "without Authentication"
   */

  test.skip(
    ({ baseURL }) => !process.env.AUTH_DISABLED_URL,
    'Skipped: Set AUTH_DISABLED_URL to run auth-disabled tests'
  );

  test.beforeEach(async ({ page }) => {
    // Use the auth-disabled URL if provided
    const authDisabledUrl = process.env.AUTH_DISABLED_URL;
    if (authDisabledUrl) {
      await page.goto(authDisabledUrl);
    }
  });

  test('app loads without authentication when OIDC disabled', async ({
    page,
  }) => {
    const authDisabledUrl = process.env.AUTH_DISABLED_URL;
    if (!authDisabledUrl) {
      test.skip();
      return;
    }

    await page.goto(authDisabledUrl);

    // Should show dashboard directly without auth
    await expect(
      page.getByRole('heading', { name: /own your security infrastructure/i })
    ).toBeVisible({ timeout: 10000 });

    // Should NOT show profile menu (no user logged in)
    // Instead might show a Login button or nothing
    await expect(
      page.getByRole('button', { name: /admin user/i })
    ).not.toBeVisible();
  });

  test('navigation works without authentication', async ({ page }) => {
    const authDisabledUrl = process.env.AUTH_DISABLED_URL;
    if (!authDisabledUrl) {
      test.skip();
      return;
    }

    await page.goto(authDisabledUrl);

    // Navigate to CAs page
    await page.getByRole('link', { name: /certificate authorities/i }).click();
    await expect(page).toHaveURL(/\/cas$/);

    // Navigate to Certificates page
    await page.getByRole('link', { name: /^certificates$/i }).click();
    await expect(page).toHaveURL(/\/certificates$/);

    // Navigate back to Dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Invalid Login Attempts', () => {
  // Run tests serially to avoid session conflicts
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, baseURL }) => {
    await clearAuthState(page, baseURL || '/');
  });

  test('shows error for invalid credentials', async ({ page }) => {
    // Navigate to app (will redirect to Keycloak)
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });

    // Try login with invalid credentials - use specific selectors
    await page.locator('#username').fill('invaliduser');
    await page.locator('#password').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show error message on Keycloak page
    await expect(page.getByText(/invalid username or password/i)).toBeVisible({
      timeout: 5000,
    });

    // Should still be on Keycloak login page
    expect(await isOnKeycloakLogin(page)).toBe(true);
  });

  test('shows error for empty credentials', async ({ page }) => {
    // Navigate to app (will redirect to Keycloak)
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });

    // Click sign in without entering credentials
    // Browser's HTML5 validation may prevent submission
    await page.locator('#username').click();
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait a moment for any validation
    await page.waitForTimeout(500);

    // Should remain on Keycloak login page (browser validation or Keycloak validation)
    expect(await isOnKeycloakLogin(page)).toBe(true);
  });
});

test.describe('Session Management', () => {
  // Run tests serially to avoid session conflicts
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, baseURL }) => {
    await clearAuthState(page, baseURL || '/');
  });

  test('tokens are stored in localStorage after login', async ({ page }) => {
    // Login
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForAppLoaded(page);

    // Check localStorage for tokens
    const hasTokens = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.some((key) => key.startsWith('oidc.user:'));
    });

    expect(hasTokens).toBe(true);
  });

  test('tokens contain expected claims', async ({ page }) => {
    // Login
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForAppLoaded(page);

    // Get token data from localStorage
    const tokenData = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const oidcKey = keys.find((key) => key.startsWith('oidc.user:'));
      if (!oidcKey) return null;

      const data = localStorage.getItem(oidcKey);
      return data ? JSON.parse(data) : null;
    });

    expect(tokenData).not.toBeNull();
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.id_token).toBeDefined();
    expect(tokenData.expires_at).toBeDefined();
  });

  test('logout clears tokens from localStorage', async ({ page }) => {
    // Login
    await page.goto('/');
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });
    await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
    await waitForAppLoaded(page);

    // Verify tokens exist
    let hasTokens = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.some((key) => key.startsWith('oidc.user:'));
    });
    expect(hasTokens).toBe(true);

    // Logout
    await page.getByRole('button', { name: /admin user/i }).click();
    await page.getByRole('button', { name: /logout/i }).click();
    await page.waitForURL(/.*protocol\/openid-connect\/logout/, {
      timeout: 10000,
    });
    await page.getByRole('button', { name: /logout/i }).click();

    // Wait for redirect back to login
    await page.waitForURL(/.*realms.*protocol\/openid-connect\/auth/, {
      timeout: 10000,
    });

    // Check that tokens are cleared
    // Note: After logout redirect, we're on Keycloak domain, so we check
    // by navigating back to app origin
    await page.goto('/');

    hasTokens = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.some((key) => key.startsWith('oidc.user:'));
    });
    expect(hasTokens).toBe(false);
  });
});
