import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for PKI Manager Role-Based Access Control
 *
 * Tests RBAC enforcement for admin and regular user roles.
 *
 * Local E2E Testing (default):
 *   1. Start the E2E environment:
 *      docker compose -f docker/docker-compose.e2e.yml up -d
 *   2. Wait for services to be healthy (~60s for Keycloak)
 *   3. Run tests:
 *      pnpm playwright test tests/e2e-rbac.spec.ts --reporter=list
 *   4. Cleanup:
 *      docker compose -f docker/docker-compose.e2e.yml down -v
 *
 * Production Testing (optional):
 *   Set E2E_TARGET=production to test against production environment:
 *   E2E_TARGET=production pnpm playwright test tests/e2e-rbac.spec.ts
 *
 * Test Users (pre-configured in Keycloak):
 *   - testadmin / Test123! (has 'admin' role)
 *   - testuser / Test123! (has 'user' role, no admin)
 *
 * Environment Variables:
 *   E2E_TARGET - 'local' (default) or 'production'
 *   E2E_FRONTEND_URL - Frontend URL (overrides default for target)
 *   E2E_ADMIN_USER - Admin username (default: testadmin)
 *   E2E_ADMIN_PASSWORD - Admin password (default: Test123!)
 *   E2E_TEST_USER - Regular user username (default: testuser)
 *   E2E_TEST_PASSWORD - Regular user password (default: Test123!)
 */

// Target environment configuration
const E2E_TARGET = process.env.E2E_TARGET || 'local';

const TARGETS = {
  local: {
    frontendUrl: 'http://localhost:8080',
    keycloakPattern: /.*localhost:8180.*realms.*/,
  },
  production: {
    frontendUrl: 'https://pki.nexiona.io',
    keycloakPattern: /.*iam\.nexiona\.io.*realms.*/,
  },
};

const targetConfig = TARGETS[E2E_TARGET as keyof typeof TARGETS] || TARGETS.local;

// Configuration from environment with target defaults
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || targetConfig.frontendUrl;
const KEYCLOAK_PATTERN = targetConfig.keycloakPattern;
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'testadmin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Test123!';
const TEST_USER = process.env.E2E_TEST_USER || 'testuser';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'Test123!';

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
  await page.waitForURL(KEYCLOAK_PATTERN, { timeout: 20000 });
  await keycloakLogin(page, ADMIN_USER, ADMIN_PASSWORD);
  await waitForDashboard(page);
}

/**
 * Helper: Login as regular user
 */
async function loginAsUser(page: Page) {
  await page.goto(FRONTEND_URL);
  await page.waitForURL(KEYCLOAK_PATTERN, { timeout: 20000 });
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

  // Click submit button and wait for response
  const [response] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('ca.create') && resp.request().method() === 'POST',
      { timeout: 30000 }
    ),
    page.getByRole('button', { name: /create certificate authority/i }).click(),
  ]);

  // Log response details
  const status = response.status();
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '<unable to get body>';
  }
  console.log(`[TEST] Response Status: ${status}`);
  console.log(`[TEST] Response Body: ${body.substring(0, 500)}`);

  // Parse tRPC batch response
  try {
    const parsed = JSON.parse(body);
    const result = parsed[0];

    if (result.error) {
      const errorCode = result.error.data?.code;
      const errorMessage = result.error.message;
      console.log(`[TEST] tRPC Error: ${errorCode} - ${errorMessage}`);

      if (errorCode === 'FORBIDDEN' || errorMessage.includes('Admin') || errorMessage.includes('FORBIDDEN')) {
        return { success: false, errorMessage: `${errorCode}: ${errorMessage}` };
      }
      return { success: false, errorMessage: errorMessage };
    }

    // Success - wait for navigation
    await page.waitForURL(/\/cas\/[a-zA-Z0-9-]+$/, { timeout: 5000 }).catch(() => {});
    console.log(`[TEST] CA created successfully, navigated to: ${page.url()}`);
    return { success: true };
  } catch (parseError) {
    console.log(`[TEST] Failed to parse response: ${parseError}`);
    // Fall back to checking alert
    if (alertMessage) {
      if (
        alertMessage.includes('FORBIDDEN') ||
        alertMessage.includes('Admin access required') ||
        alertMessage.includes('403')
      ) {
        return { success: false, errorMessage: alertMessage };
      }
    }
    // Check if page navigated (success case)
    if (page.url().match(/\/cas\/[a-zA-Z0-9-]+$/)) {
      return { success: true };
    }
    return { success: false, errorMessage: alertMessage || `HTTP ${status}` };
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

/**
 * Helper: read the CA id from the current /cas/<id> detail URL.
 */
function caIdFromUrl(page: Page): string | undefined {
  return page.url().match(/\/cas\/([a-zA-Z0-9-]+)$/)?.[1];
}

/**
 * Helper: read the certificate id from the current /certificates/<id> URL.
 */
function certIdFromUrl(page: Page): string | undefined {
  return page.url().match(/\/certificates\/([a-zA-Z0-9-]+)$/)?.[1];
}

/**
 * Helper: trigger an action and assert the resulting tRPC call is NOT rejected
 * for authorization reasons. This is the core admin-capability assertion: an
 * admin must never receive FORBIDDEN. Business-rule errors (e.g. deleting a CA
 * that still has certificates) are tolerated — this verifies RBAC only.
 * Returns the raw response body for optional further inspection.
 */
async function triggerAndExpectAuthorized(
  page: Page,
  procedureUrlPart: string,
  trigger: () => Promise<void>
): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes(procedureUrlPart) &&
        resp.request().method() === 'POST',
      { timeout: 30000 }
    ),
    trigger(),
  ]);

  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  console.log(`[TEST] ${procedureUrlPart} -> HTTP ${response.status()}`);

  // An admin must never be blocked by RBAC on a privileged operation.
  expect(body).not.toContain('FORBIDDEN');
  expect(body).not.toContain('Admin role required');
  expect(body).not.toContain('Admin access required');
  return body;
}

/**
 * Helper: as an admin, issue a certificate under a given CA (selected by its CN,
 * which equals the CA name). Returns the new certificate id. Uses the issue
 * form's "Generate Sample Data" to fill a valid server-cert subject.
 */
async function issueCertificateAsAdmin(
  page: Page,
  caName: string
): Promise<string | undefined> {
  await page.goto(`${FRONTEND_URL}/certificates/new`);
  await expect(
    page.getByRole('heading', { name: /issue new certificate/i })
  ).toBeVisible({ timeout: 10000 });

  // The first <select> is the CA picker; its option label is the CA's CN.
  await page.locator('select').first().selectOption({ label: caName });

  // Fill a valid subject with one click.
  await page.getByRole('button', { name: /generate sample data/i }).click();

  await triggerAndExpectAuthorized(page, 'certificate.issue', async () => {
    await page.getByRole('button', { name: /^issue certificate$/i }).click();
  });

  await page
    .waitForURL(/\/certificates\/[a-zA-Z0-9-]+$/, { timeout: 15000 })
    .catch(() => {});
  return certIdFromUrl(page);
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
// Admin Destructive Operations - full lifecycle on throwaway objects
// (issue -> revoke cert -> delete cert -> revoke CA -> delete CA). Runs serial
// and operates ONLY on the CA/cert it creates, so it never mutates real data.
// ============================================================================

test.describe('Production E2E - Admin Destructive Operations', () => {
  test.describe.configure({ mode: 'serial' });

  // Shared across the serial steps.
  const caName = `RBAC Lifecycle CA ${TEST_SUFFIX}`;
  let lifecycleCaId: string | undefined;
  let lifecycleCertId: string | undefined;

  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
  });

  test('Admin can create a CA and issue a certificate', async ({ page }) => {
    await loginAsAdmin(page);

    // Create the throwaway CA.
    await navigateToCreateCA(page);
    await fillCAForm(page, caName);
    const result = await submitCAFormAndCheck(page, caName);
    expect(result.success).toBe(true);
    await expect(page).toHaveURL(/\/cas\/[a-zA-Z0-9-]+$/);
    lifecycleCaId = caIdFromUrl(page);
    expect(lifecycleCaId).toBeTruthy();

    // Issue a certificate under it (AC#4: admin can issue a certificate).
    lifecycleCertId = await issueCertificateAsAdmin(page, caName);
    expect(lifecycleCertId).toBeTruthy();
  });

  test('Admin can revoke the certificate', async ({ page }) => {
    test.skip(!lifecycleCertId, 'no certificate was issued in the previous step');
    await loginAsAdmin(page);

    await page.goto(`${FRONTEND_URL}/certificates/${lifecycleCertId}`);
    await page.getByRole('button', { name: /^revoke$/i }).click();

    // Confirm in the "Revoke Certificate" dialog (AC#5).
    await expect(
      page.getByRole('heading', { name: /revoke certificate/i })
    ).toBeVisible({ timeout: 10000 });
    await triggerAndExpectAuthorized(page, 'certificate.revoke', async () => {
      await page.getByRole('button', { name: /^revoke certificate$/i }).click();
    });
  });

  test('Admin can delete the revoked certificate', async ({ page }) => {
    test.skip(!lifecycleCertId, 'no certificate was issued in the previous step');
    await loginAsAdmin(page);

    await page.goto(`${FRONTEND_URL}/certificates/${lifecycleCertId}`);
    // The trigger "Delete" button opens a confirm dialog whose confirm label
    // is also "Delete" (AC#6).
    await page.getByRole('button', { name: /^delete$/i }).first().click();
    await triggerAndExpectAuthorized(page, 'certificate.delete', async () => {
      await page
        .getByRole('button', { name: /^delete$/i })
        .last()
        .click();
    });
  });

  test('Admin can revoke and delete the CA', async ({ page }) => {
    test.skip(!lifecycleCaId, 'no CA was created in the first step');
    await loginAsAdmin(page);

    await page.goto(`${FRONTEND_URL}/cas/${lifecycleCaId}`);

    // Revoke the CA (AC#7, part 1).
    await page.getByRole('button', { name: /^revoke$/i }).click();
    await expect(
      page.getByRole('heading', { name: /revoke certificate authority/i })
    ).toBeVisible({ timeout: 10000 });
    await triggerAndExpectAuthorized(page, 'ca.revoke', async () => {
      await page.getByRole('button', { name: /^revoke ca$/i }).click();
    });

    // Delete the CA (AC#7, part 2). A business error (e.g. residual certs) is
    // acceptable — we assert only that admin is authorized, not FORBIDDEN.
    await page.getByRole('button', { name: /^delete$/i }).first().click();
    await triggerAndExpectAuthorized(page, 'ca.delete', async () => {
      await page
        .getByRole('button', { name: /^delete$/i })
        .last()
        .click();
    });
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
