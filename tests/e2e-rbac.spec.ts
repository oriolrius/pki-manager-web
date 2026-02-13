import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for PKI Manager Role-Based Access Control
 *
 * Tests RBAC enforcement for admin and regular user roles.
 *
 * Prerequisites:
 * - PKI Manager deployed at pki.nexiona.io
 * - Backend deployed at api.pki.nexiona.io
 * - Keycloak running at iam.nexiona.io with pki-manager realm
 * - Test users created:
 *   - testadmin / Test123! (has admin role)
 *   - testuser / Test123! (regular user, no admin role)
 *
 * Environment variables:
 *   PROD_FRONTEND_URL - Frontend URL (default: https://pki.nexiona.io)
 *   PROD_KEYCLOAK_URL - Keycloak URL (default: https://iam.nexiona.io)
 *   PROD_ADMIN_USER - Admin username (default: testadmin)
 *   PROD_ADMIN_PASSWORD - Admin password (default: Test123!)
 *   PROD_TEST_USER - Regular user username (default: testuser)
 *   PROD_TEST_PASSWORD - Regular user password (default: Test123!)
 *
 * Usage:
 *   pnpm playwright test tests/e2e-rbac.spec.ts --reporter=list
 */

// Configuration from environment
const FRONTEND_URL = process.env.PROD_FRONTEND_URL || 'https://pki.nexiona.io';
const ADMIN_USER = process.env.PROD_ADMIN_USER || 'testadmin';
const ADMIN_PASSWORD = process.env.PROD_ADMIN_PASSWORD || 'Test123!';
const TEST_USER = process.env.PROD_TEST_USER || 'testuser';
const TEST_PASSWORD = process.env.PROD_TEST_PASSWORD || 'Test123!';

// Test data identifiers (unique per run)
const TEST_SUFFIX = Date.now().toString(36);

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

/**
 * Helper: Login as admin user
 */
async function loginAsAdmin(page: Page) {
  await page.goto(FRONTEND_URL);
  await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
  await keycloakLogin(page, ADMIN_USER, ADMIN_PASSWORD);
  await waitForDashboard(page);
}

/**
 * Helper: Login as regular user
 */
async function loginAsUser(page: Page) {
  await page.goto(FRONTEND_URL);
  await page.waitForURL(/.*iam\.nexiona\.io.*realms.*/, { timeout: 20000 });
  await keycloakLogin(page, TEST_USER, TEST_PASSWORD);
  await waitForDashboard(page);
}

/**
 * Helper: Navigate to CAs page
 */
async function navigateToCAs(page: Page) {
  await page.getByRole('link', { name: /certificate authorities/i }).click();
  await expect(page).toHaveURL(/\/cas$/);
  await expect(page.getByRole('button', { name: /create ca/i })).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Helper: Navigate to Certificates page
 */
async function navigateToCertificates(page: Page) {
  await page.getByRole('link', { name: /^certificates$/i }).click();
  await expect(page).toHaveURL(/\/certificates$/);
}

/**
 * Helper: Navigate to Create CA page
 */
async function navigateToCreateCA(page: Page) {
  await navigateToCAs(page);
  await page.getByRole('button', { name: /create ca/i }).click();
  // Wait for navigation to /cas/new
  await expect(page).toHaveURL(/\/cas\/new$/, { timeout: 5000 });
  // Wait for form heading
  await expect(
    page.getByRole('heading', { name: /create new root certificate authority/i })
  ).toBeVisible({ timeout: 5000 });
}

/**
 * Helper: Fill CA creation form
 * Uses placeholder text since labels don't have htmlFor associations
 */
async function fillCAForm(page: Page, caName: string) {
  // Use placeholder text to find inputs since labels aren't associated via htmlFor
  await page.getByPlaceholder('Acme Corp Root CA').fill(caName);
  await page.getByPlaceholder('Acme Corporation').fill('RBAC Test Organization');
  await page.getByPlaceholder('US').fill('ES');
}

/**
 * Helper: Submit CA form and check result
 * Returns true if CA was created successfully, false if operation was forbidden
 */
async function submitCAFormAndCheck(
  page: Page,
  caName: string
): Promise<{ success: boolean; errorMessage?: string }> {
  // Set up dialog handler to capture alert messages
  let alertMessage = '';
  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.dismiss();
  });

  // Click submit button
  await page.getByRole('button', { name: /create certificate authority/i }).click();

  // Wait for either navigation (success) or alert (error)
  try {
    // Success: navigates to the new CA detail page
    await page.waitForURL(/\/cas\/[a-zA-Z0-9-]+$/, { timeout: 10000 });
    return { success: true };
  } catch {
    // Check if we got a forbidden error in the alert
    if (
      alertMessage.includes('FORBIDDEN') ||
      alertMessage.includes('Admin access required') ||
      alertMessage.includes('403')
    ) {
      return { success: false, errorMessage: alertMessage };
    }
    // Other error
    return { success: false, errorMessage: alertMessage || 'Unknown error' };
  }
}

/**
 * Helper: Check if an operation results in 403 Forbidden
 */
async function expectForbidden(page: Page): Promise<boolean> {
  // Look for forbidden error indicators
  const bodyText = await page.textContent('body');
  return (
    bodyText?.includes('FORBIDDEN') ||
    bodyText?.includes('Admin access required') ||
    bodyText?.includes('403') ||
    false
  );
}

/**
 * Helper: Wait for toast/notification with specific text
 */
async function waitForToast(page: Page, textPattern: RegExp, timeout = 5000) {
  await expect(page.getByText(textPattern)).toBeVisible({ timeout });
}

// ============================================================================
// Admin Role Tests
// ============================================================================

test.describe('Production E2E - Admin Role Tests', () => {
  test.describe.configure({ mode: 'serial' });

  let createdCaId: string | undefined;
  let createdCertId: string | undefined;

  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
  });

  test('Admin can login and access dashboard', async ({ page }) => {
    await loginAsAdmin(page);

    // Verify admin is logged in
    await expect(
      page.getByRole('button', { name: /test admin/i }).or(
        page.getByRole('button', { name: /testadmin/i })
      )
    ).toBeVisible({ timeout: 10000 });

    // Verify dashboard loads without errors
    await expect(page.locator('text=Total CAs')).toBeVisible();
    await expect(page.locator('text=Total Certs')).toBeVisible();
  });

  test('Admin can create a new CA', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToCreateCA(page);

    const caName = `RBAC Test CA Admin ${TEST_SUFFIX}`;
    await fillCAForm(page, caName);

    // Submit form
    const result = await submitCAFormAndCheck(page, caName);

    // Admin should succeed
    expect(result.success).toBe(true);

    // Verify we're on the CA detail page
    await expect(page).toHaveURL(/\/cas\/[a-zA-Z0-9-]+$/);
  });

  test('Admin can view CA list and details', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToCAs(page);

    // Verify CA list loads
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Click on first CA row to view details (if any exist)
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      // Should navigate to CA detail page
      await page.waitForTimeout(1000);
    }
  });

  test('Admin can navigate to certificates page', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToCertificates(page);

    // Verify certificates page loads
    await expect(
      page.getByRole('button', { name: /issue certificate/i }).or(
        page.locator('table')
      )
    ).toBeVisible({ timeout: 10000 });
  });

  test('Admin can access bulk operations', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToCertificates(page);

    // Look for bulk action controls
    // This depends on UI implementation - check for bulk action buttons or checkboxes
    await page.waitForTimeout(2000);
    // Verify page loaded without errors
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('FORBIDDEN');
  });

  test('Admin can access audit logs', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to audit logs if link exists
    const auditLink = page.getByRole('link', { name: /audit/i });
    if (await auditLink.isVisible()) {
      await auditLink.click();
      await page.waitForTimeout(2000);
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain('FORBIDDEN');
    }
  });
});

// ============================================================================
// User Role Tests - Verifying Restrictions
// ============================================================================

test.describe('Production E2E - User Role Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
  });

  test('User can login and access dashboard', async ({ page }) => {
    await loginAsUser(page);

    // Verify user is logged in
    await expect(page.getByRole('button', { name: /test user/i })).toBeVisible({
      timeout: 10000,
    });

    // Verify dashboard loads without errors
    await expect(page.locator('text=Total CAs')).toBeVisible();
    await expect(page.locator('text=Total Certs')).toBeVisible();
  });

  test('User can view CA list', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCAs(page);

    // Verify CA list loads
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
  });

  test('User CANNOT create CA (requires admin)', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCreateCA(page);

    const caName = `RBAC Test CA User ${TEST_SUFFIX}`;
    await fillCAForm(page, caName);

    // Submit form - should fail with forbidden
    const result = await submitCAFormAndCheck(page, caName);

    // User should be forbidden
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/FORBIDDEN|Admin access required/i);
  });

  test('User can view certificates list', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCertificates(page);

    // Verify certificates page loads without forbidden error
    await page.waitForTimeout(2000);
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('FORBIDDEN');
  });

  test('User CANNOT revoke CA (requires admin)', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCAs(page);

    // Try to find and click on a CA to access revoke action
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(1000);

      // Look for revoke button
      const revokeButton = page.getByRole('button', { name: /revoke/i });
      if (await revokeButton.isVisible()) {
        await revokeButton.click();

        // If there's a confirmation dialog, confirm it
        const confirmButton = page.getByRole('button', { name: /confirm/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForTimeout(2000);

        // Should get forbidden
        const isForbidden = await expectForbidden(page);
        expect(isForbidden).toBe(true);
      }
    }
  });

  test('User CANNOT delete CA (requires admin)', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCAs(page);

    // Try to find and click on a CA to access delete action
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(1000);

      // Look for delete button
      const deleteButton = page.getByRole('button', { name: /delete/i });
      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        // If there's a confirmation dialog, confirm it
        const confirmButton = page.getByRole('button', { name: /confirm/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForTimeout(2000);

        // Should get forbidden
        const isForbidden = await expectForbidden(page);
        expect(isForbidden).toBe(true);
      }
    }
  });

  test('User can access audit logs (view only)', async ({ page }) => {
    await loginAsUser(page);

    // Navigate to audit logs if link exists
    const auditLink = page.getByRole('link', { name: /audit/i });
    if (await auditLink.isVisible()) {
      await auditLink.click();
      await page.waitForTimeout(2000);
      // Should be able to view audit logs
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain('FORBIDDEN');
    }
  });

  test('User can use global search', async ({ page }) => {
    await loginAsUser(page);

    // Look for search input
    const searchInput = page.getByRole('searchbox').or(
      page.getByPlaceholder(/search/i)
    );
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(2000);
      // Should not get forbidden
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain('FORBIDDEN');
    }
  });
});

// ============================================================================
// Cross-Role Verification Tests
// ============================================================================

test.describe('Production E2E - RBAC Boundary Tests', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
  });

  test('Admin role is properly recognized after login', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToCreateCA(page);

    const caName = `Admin Role Test ${TEST_SUFFIX}`;
    await fillCAForm(page, caName);

    // Submit form - admin should succeed
    const result = await submitCAFormAndCheck(page, caName);

    // Should succeed (admin role recognized)
    expect(result.success).toBe(true);
  });

  test('Regular user role prevents admin operations', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCreateCA(page);

    const caName = `User Role Test ${TEST_SUFFIX}`;
    await fillCAForm(page, caName);

    // Submit form - should fail with forbidden
    const result = await submitCAFormAndCheck(page, caName);

    // Should fail with forbidden (user role prevents admin operations)
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/FORBIDDEN|Admin access required/i);
  });
});

// ============================================================================
// Certificate Operations RBAC Tests
// ============================================================================

test.describe('Production E2E - Certificate RBAC Tests', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
  });

  test('User can issue certificate (protectedProcedure)', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCertificates(page);

    // Look for Issue Certificate button
    const issueButton = page.getByRole('button', { name: /issue certificate/i });
    if (await issueButton.isVisible()) {
      await issueButton.click();
      await page.waitForTimeout(2000);
      // Should not be forbidden (issuing is allowed for any authenticated user)
      const bodyText = await page.textContent('body');
      // Just verify we can access the form, not that we get forbidden
      expect(bodyText).not.toContain('FORBIDDEN');
    }
  });

  test('User CANNOT revoke certificate (adminProcedure)', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCertificates(page);

    // Find a certificate row and try to revoke
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(1000);

      // Look for revoke button
      const revokeButton = page.getByRole('button', { name: /revoke/i });
      if (await revokeButton.isVisible()) {
        await revokeButton.click();

        // Handle confirmation if present
        const confirmButton = page.getByRole('button', { name: /confirm/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForTimeout(2000);
        const isForbidden = await expectForbidden(page);
        expect(isForbidden).toBe(true);
      }
    }
  });

  test('User CANNOT delete certificate (adminProcedure)', async ({ page }) => {
    await loginAsUser(page);
    await navigateToCertificates(page);

    // Find a certificate row and try to delete
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(1000);

      // Look for delete button
      const deleteButton = page.getByRole('button', { name: /delete/i });
      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        // Handle confirmation if present
        const confirmButton = page.getByRole('button', { name: /confirm/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForTimeout(2000);
        const isForbidden = await expectForbidden(page);
        expect(isForbidden).toBe(true);
      }
    }
  });
});
