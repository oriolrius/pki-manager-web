import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Screenshot Test Suite for PKI Manager
 *
 * This test suite captures screenshots of all major pages in the PKI Manager application
 * for documentation purposes. Screenshots are saved to the assets/ directory.
 *
 * Prerequisites:
 * - Backend server running on http://localhost:3000
 * - Frontend server running on http://localhost:52082 (or configured baseURL)
 *
 * Usage:
 *   pnpm playwright test tests/screenshots.spec.ts
 */

const screenshotsDir = path.join(process.cwd(), 'assets');

/**
 * Wait for a page to be visually stable before capturing:
 * settle the network and let any async "Loading…" placeholder resolve to
 * real content (SSH/cluster pages fetch their data via tRPC after mount).
 */
async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page
    .waitForFunction(() => !document.body.innerText.includes('Loading...'), null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(600);
}

test.describe('PKI Manager Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Hide the dev-only TanStack Router devtools badge on every navigation so
    // it never leaks into documentation screenshots.
    await page.addInitScript(() => {
      const inject = () => {
        const style = document.createElement('style');
        style.textContent =
          '[class*="TanStackRouterDevtools"],[aria-label="Open TanStack Router Devtools"]{display:none !important;}';
        (document.head || document.documentElement).appendChild(style);
      };
      // At document_start there is no <head> yet; defer until the DOM exists.
      // The rule is global, so it also hides the badge React mounts later.
      if (document.head) inject();
      else document.addEventListener('DOMContentLoaded', inject);
    });

    // Navigate to the application
    await page.goto('/');

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Add a small delay to ensure everything is rendered
    await page.waitForTimeout(500);
  });

  test('01 - Dashboard Overview (Light Mode)', async ({ page }) => {
    // Ensure we're on the dashboard
    await expect(page.getByText(/own your security infrastructure/i)).toBeVisible();

    // Wait for statistics to load
    await page.waitForTimeout(1000);

    // Take full-page screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, '01-dashboard-light.png'),
      fullPage: true,
    });
  });

  test('02 - Dashboard Overview (Dark Mode)', async ({ page }) => {
    // Click theme toggle to open dropdown
    const themeToggle = page.locator('button[aria-label="Toggle theme"]');
    await themeToggle.click();
    await page.waitForTimeout(300);

    // Click "Dark" option
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(screenshotsDir, '02-dashboard-dark.png'),
      fullPage: true,
    });
  });

  test('03 - Certificate Authorities List', async ({ page }) => {
    // Navigate to CAs page
    await page.getByRole('link', { name: /certificate authorities/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotsDir, '03-cas-list.png'),
      fullPage: true,
    });
  });

  test('04 - Create New CA Form', async ({ page }) => {
    // Navigate directly to Create CA page
    await page.goto('/cas/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotsDir, '04-create-ca-form.png'),
      fullPage: true,
    });
  });

  test('05 - Create CA Form with Sample Data', async ({ page }) => {
    // Navigate directly to Create CA page
    await page.goto('/cas/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click "Generate Sample Data" button
    const sampleButton = page.getByRole('button', { name: /generate.*sample/i });
    if (await sampleButton.isVisible()) {
      await sampleButton.click();
      await page.waitForTimeout(500);
    }

    await page.screenshot({
      path: path.join(screenshotsDir, '05-create-ca-sample-data.png'),
      fullPage: true,
    });
  });

  test('06 - Certificates List', async ({ page }) => {
    // Navigate directly to Certificates page
    await page.goto('/certificates');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotsDir, '06-certificates-list.png'),
      fullPage: true,
    });
  });

  test('07 - Issue New Certificate Form', async ({ page }) => {
    // Navigate directly to Issue Certificate page
    await page.goto('/certificates/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotsDir, '07-issue-certificate-form.png'),
      fullPage: true,
    });
  });

  test('08 - Issue Certificate with SANs', async ({ page }) => {
    // Navigate directly to Issue Certificate page
    await page.goto('/certificates/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click "Generate Sample Data" if available
    const sampleButton = page.getByRole('button', { name: /generate.*sample/i });
    if (await sampleButton.isVisible()) {
      await sampleButton.click();
      await page.waitForTimeout(500);
    }

    // Scroll to SANs section
    const sansSection = page.getByText(/subject alternative names/i).first();
    if (await sansSection.isVisible()) {
      await sansSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await page.screenshot({
      path: path.join(screenshotsDir, '08-issue-certificate-sans.png'),
      fullPage: true,
    });
  });

  test('09 - Bulk Certificates Creation', async ({ page }) => {
    // Navigate directly to Bulk Certificates page
    await page.goto('/certificates/bulk');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotsDir, '09-bulk-certificates.png'),
      fullPage: true,
    });
  });

  test('10 - CA Detail View', async ({ page }) => {
    // Navigate to CAs list
    await page.getByRole('link', { name: /certificate authorities/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Click on first CA if available
    const firstCaRow = page.locator('table tbody tr').first();
    if (await firstCaRow.isVisible()) {
      await firstCaRow.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      await page.screenshot({
        path: path.join(screenshotsDir, '10-ca-detail.png'),
        fullPage: true,
      });
    }
  });

  test('11 - Certificate Detail View', async ({ page }) => {
    // Navigate to Certificates list
    await page.getByRole('link', { name: /^certificates$/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Click on first certificate if available
    const firstCertRow = page.locator('table tbody tr').first();
    if (await firstCertRow.isVisible()) {
      await firstCertRow.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      await page.screenshot({
        path: path.join(screenshotsDir, '11-certificate-detail.png'),
        fullPage: true,
      });
    }
  });

  test('12 - Certificate Filters and Search', async ({ page }) => {
    // Navigate to Certificates list
    await page.getByRole('link', { name: /^certificates$/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Show the filters area if collapsed
    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible()) {
      await searchInput.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await page.screenshot({
      path: path.join(screenshotsDir, '12-certificate-filters.png'),
      fullPage: true,
    });
  });

  test('13 - Bulk Certificate Selection', async ({ page }) => {
    // Navigate to Certificates list
    await page.getByRole('link', { name: /^certificates$/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Select first two certificates if available
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();

    if (count > 1) {
      // Select first checkbox (might be select-all)
      await checkboxes.nth(1).check();
      await page.waitForTimeout(300);

      if (count > 2) {
        await checkboxes.nth(2).check();
        await page.waitForTimeout(300);
      }

      await page.screenshot({
        path: path.join(screenshotsDir, '13-bulk-selection.png'),
        fullPage: true,
      });
    }
  });

  // --- New feature areas -----------------------------------------------------

  test('14 - Kubernetes Clusters (cert-manager issuer)', async ({ page }) => {
    // Clusters management page: mint/manage cluster tokens for the external issuer
    await page.goto('/clusters');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /k8s clusters/i })).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '14-clusters.png'),
      fullPage: true,
    });
  });

  test('15 - SSH Certificate Manager (overview)', async ({ page }) => {
    await page.goto('/ssh');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /ssh certificate manager/i })).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '15-ssh-overview.png'),
      fullPage: true,
    });
  });

  test('16 - SSH Certificate Authorities', async ({ page }) => {
    await page.goto('/ssh/cas');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/ssh certificate authorities/i).first()).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '16-ssh-cas.png'),
      fullPage: true,
    });
  });

  test('17 - SSH Hosts', async ({ page }) => {
    await page.goto('/ssh/hosts');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/ssh hosts/i).first()).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '17-ssh-hosts.png'),
      fullPage: true,
    });
  });

  test('18 - SSH User Identities & Per-Host Access Blocks', async ({ page }) => {
    await page.goto('/ssh/users');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/ssh user identities/i).first()).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '18-ssh-users.png'),
      fullPage: true,
    });
  });

  test('19 - SSH Key Revocation Lists (KRL)', async ({ page }) => {
    await page.goto('/ssh/krl');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/key revocation lists/i).first()).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '19-ssh-krl.png'),
      fullPage: true,
    });
  });

  test('20 - SSH Principals & Host Mapping', async ({ page }) => {
    await page.goto('/ssh/principals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/principal catalog/i).first()).toBeVisible();
    await settle(page);

    await page.screenshot({
      path: path.join(screenshotsDir, '20-ssh-principals.png'),
      fullPage: true,
    });
  });

  test('21 - REST / OpenAPI Documentation (Swagger)', async ({ page }) => {
    // Embedded Swagger UI for the REST API surface
    await page.goto('/api-docs');
    await page.waitForLoadState('networkidle');

    // Swagger UI renders asynchronously from the backend spec; wait for it.
    await page.locator('.swagger-ui').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: path.join(screenshotsDir, '21-api-docs.png'),
      fullPage: true,
    });
  });
});
