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

test.describe('PKI Manager Screenshots', () => {
  test.beforeEach(async ({ page }) => {
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
});
