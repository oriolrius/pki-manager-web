import { test } from '@playwright/test';
import { login, shooter, USERS } from './helpers';

const shot = shooter('get-started');

test('login and tour', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL(/localhost:47381/);
  await shot(page, '01-login');
  await login(page, USERS.admin);
  await shot(page, '02-dashboard');
  for (const menu of ['PKI', 'Operations']) {
    await page.getByText(menu, { exact: true }).first().click();
    await page.waitForTimeout(300);
    console.log(menu, await page.getByRole('navigation').ariaSnapshot());
    await shot(page, `03-menu-${menu.toLowerCase()}`, { clip: { x: 0, y: 0, width: 1440, height: 420 } });
    await page.keyboard.press('Escape');
  }
});
