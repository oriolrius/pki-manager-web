import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { login, shooter, screencast, RUN_DIR } from './helpers';

// Guide: docs/guides/private-ca.md. Acme runs internal HTTPS services and wants its own root CA.
// Phases run in order (serial): ca -> renew -> revoke -> bulk. State goes to a scratch JSON file.
const shot = shooter('private-ca');
const WORK = join(RUN_DIR, 'private-ca');
mkdirSync(WORK, { recursive: true });
const STATE = join(WORK, 'state.json');
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (o: object) => writeFileSync(STATE, JSON.stringify({ ...load(), ...o }, null, 2));
const EXPORT_PW = 'Acme-Export-1';
test.describe.configure({ mode: 'serial' });

/** Wait until loading is over, resize for tall pages, take the screenshot. */
async function snap(page: Page, name: string, height = 900) {
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shot(page, name);
  await page.setViewportSize({ width: 1440, height: 900 });
}
const idFromUrl = (page: Page) => page.url().split('/').pop()!;

async function issueCert(page: Page, o: { ca: string; type: string; cn: string; ou: string; dns?: string[]; ip?: string[]; days?: number }) {
  await page.goto('/certificates/new');
  await page.waitForLoadState('networkidle');
  const selects = page.locator('select');
  await selects.nth(0).selectOption({ label: o.ca });
  await selects.nth(1).selectOption(o.type);
  await page.getByPlaceholder(/example\.com or|username or client-id/).fill(o.cn);
  await page.getByPlaceholder('Acme Corporation').fill('Acme Example Ltd');
  await page.getByPlaceholder('IT Department').fill(o.ou);
  await page.getByPlaceholder('US', { exact: true }).fill('ES');
  await page.getByPlaceholder('California').fill('Barcelona');
  await page.getByPlaceholder('San Francisco').fill('Barcelona');
  if (o.days) await page.locator('input[type=number]').fill(String(o.days));
  for (const [i, d] of (o.dns ?? []).entries()) {
    if (i > 0) await page.getByRole('button', { name: '+ Add DNS Name' }).click();
    await page.getByPlaceholder('example.com', { exact: true }).nth(i).fill(d);
  }
  for (const [i, d] of (o.ip ?? []).entries()) {
    if (i > 0) await page.getByRole('button', { name: '+ Add IP Address' }).click();
    await page.getByPlaceholder('192.168.1.1').nth(i).fill(d);
  }
}

test('1 create the root CA', async ({ page }) => {
  await login(page);
  await page.goto('/cas');
  await page.waitForLoadState('networkidle');
  await shot(page, '01-ca-list', { clip: { x: 0, y: 0, width: 1440, height: 330 } });
  await page.getByRole('button', { name: 'Create CA' }).click();
  await page.waitForURL(/\/cas\/new/);
  await page.getByPlaceholder('Acme Corp Root CA').fill('Acme Internal Root CA');
  await page.getByPlaceholder('Acme Corporation').fill('Acme Example Ltd');
  await page.getByPlaceholder('PKI Division').fill('IT Security');
  await page.getByPlaceholder('US', { exact: true }).fill('ES');
  await page.getByPlaceholder('California').fill('Barcelona');
  await page.getByPlaceholder('San Francisco').fill('Barcelona');
  await page.locator('input[type=number]').fill('10');
  await snap(page, '02-ca-form', 1320);
  if (!load().caId) {
    await page.getByRole('button', { name: 'Create Certificate Authority' }).click();
    await page.waitForURL(/\/cas\/[0-9a-f-]{36}/, { timeout: 120_000 });
    save({ caId: idFromUrl(page) });
  } else {
    await page.goto(`/cas/${load().caId}`);
  }
  await expect(page.locator('h1')).toBeVisible();
  await snap(page, '03-ca-detail', 1100);
  // download the CA certificate as PEM
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
  await dl.saveAs(join(WORK, 'ca.pem'));
  console.log('CA download name:', dl.suggestedFilename());
});

test('2 server certificate', async ({ page }) => {
  await login(page);
  await issueCert(page, { ca: 'Acme Internal Root CA', type: 'server', cn: 'portal.acme.example', ou: 'Web Platform', dns: ['portal.acme.example', 'www.portal.acme.example'], ip: ['127.0.0.1'], days: 365 });
  await snap(page, '04-server-form', 1900);
  if (!load().serverId) {
    await page.getByRole('button', { name: 'Issue Certificate' }).click();
    await page.waitForURL(/\/certificates\/[0-9a-f-]{36}/, { timeout: 120_000 });
    save({ serverId: idFromUrl(page) });
  } else {
    await page.goto(`/certificates/${load().serverId}`);
  }
  await expect(page.locator('h1')).toBeVisible();
  await snap(page, '05-server-detail', 1500);
});

test('3 client certificate', async ({ page }) => {
  await login(page);
  await issueCert(page, { ca: 'Acme Internal Root CA', type: 'client', cn: 'maria.puig', ou: 'Finance', days: 365 });
  await snap(page, '06-client-form', 1500);
  if (!load().clientId) {
    await page.getByRole('button', { name: 'Issue Certificate' }).click();
    await page.waitForURL(/\/certificates\/[0-9a-f-]{36}/, { timeout: 120_000 });
    save({ clientId: idFromUrl(page) });
  } else {
    await page.goto(`/certificates/${load().clientId}`);
  }
  await expect(page.locator('h1')).toBeVisible();
  await snap(page, '07-client-detail', 1300);
});

test('4 download formats', async ({ page }) => {
  await login(page);
  const { serverId } = load();
  await page.goto(`/certificates/${serverId}`);
  await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.waitForTimeout(300);
  console.log(await page.locator('#format').evaluate((s: HTMLSelectElement) => [...s.options].map((o) => o.value + ' | ' + o.text).join('\n')));
  await snap(page, '08-download-dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const grab = async (format: string, file: string, pw = false) => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.locator('#format').selectOption(format);
    if (pw) {
      if (await page.locator('#encryptKey').count()) await page.locator('#encryptKey').check();
      await page.locator('#export-password').fill(EXPORT_PW);
    }
    if (format === 'pkcs12') await snap(page, '09-download-pkcs12');
    const p = page.waitForEvent('download');
    await page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true }).click();
    const warn = page.getByRole('button', { name: 'I Understand, Download' });
    if (await warn.isVisible().catch(() => false)) await warn.click();
    const dl = await p;
    await dl.saveAs(join(WORK, file));
    console.log(format, '->', dl.suggestedFilename());
    const ok = page.getByRole('button', { name: /^(Close|Got it|OK|Done)/i });
    if (await ok.count()) await ok.first().click().catch(() => {});
  };
  await grab('pem', 'portal.pem');
  await grab('pem-chain', 'portal-chain.pem');
  await grab('pkcs12', 'portal.p12', true);
  await grab('pem-key', 'portal-key.zip', true);
  await grab('jks-keystore', 'portal.jks', true);
  await snap(page, '10-after-jks');
});

test('5 renew', async ({ page }) => {
  await login(page);
  if (load().renewedId) return;
  await page.goto(`/certificates/${load().serverId}`);
  await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Renew', exact: true }).click();
  await page.waitForTimeout(500);
  console.log(await page.locator('body').ariaSnapshot().then((t) => t.split('\n').filter((l) => /dialog|Renew|Cancel/.test(l)).join('\n')));
  await snap(page, '11-renew-confirm');
  await page.getByRole('button', { name: 'Renew', exact: true }).last().click();
  await page.waitForURL((u) => /\/certificates\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.endsWith(load().serverId), { timeout: 120_000 });
  save({ renewedId: idFromUrl(page) });
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForTimeout(1000);
  await snap(page, '12-renewed-detail', 1000);
  // download the renewed certificate (PEM) and the key bundle (ZIP, encrypted)
  const grab = async (format: string, file: string, pw = false) => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.locator('#format').selectOption(format);
    if (pw) await page.locator('#export-password').fill(EXPORT_PW);
    const p = page.waitForEvent('download');
    await page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true }).click();
    const warn = page.getByRole('button', { name: 'I Understand, Download' });
    if (await warn.isVisible().catch(() => false)) await warn.click();
    await (await p).saveAs(join(WORK, file));
  };
  await grab('pem', 'portal2.pem');
  await grab('pem-key', 'portal2-key.zip', true);
});

test('6 revoke', async ({ page }) => {
  await login(page);
  if (load().revoked) return;
  await page.goto(`/certificates/${load().renewedId}`);
  await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.locator('#reason').selectOption('superseded');
  await page.locator('textarea').fill('Replaced by a new portal certificate');
  await snap(page, '13-revoke-dialog');
  await page.getByRole('button', { name: 'Revoke Certificate' }).click();
  await expect(page.getByText('REVOKED', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await snap(page, '14-revoked-detail', 1300);
  save({ revoked: true });
});

test('7 bulk issuance', async ({ page }) => {
  await login(page);
  test.skip(!!load().bulk, 'bulk rows already issued (re-running would add duplicates)');
  await page.goto('/certificates/bulk');
  await expect(page.locator('h1')).toBeVisible();
  await page.locator('select').selectOption({ label: 'Acme Internal Root CA (active)' });
  await page.locator('textarea').fill([
    'server,crm.acme.example,Acme Example Ltd,ES,crm.acme.example;10.20.0.17,365',
    'server,helpdesk.acme.example,Acme Example Ltd,ES,helpdesk.acme.example,90',
    'client,anna.ferrer,Acme Example Ltd,ES,,365',
    'email,marc.vidal@acme.example,Acme Example Ltd,ES,marc.vidal@acme.example,365',
    'server,bad.acme.example,Acme Example Ltd,ESP,bad.acme.example,365',
  ].join('\n'));
  await snap(page, '15-bulk-form', 1000);
  await page.getByRole('button', { name: 'Issue Certificates' }).click();
  await expect(page.getByText('Results')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(800);
  // the results list scrolls inside a box: unclip it so every row shows
  await page.getByText('Row 5').evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 4 && getComputedStyle(n).overflowY !== 'visible') { n.style.maxHeight = 'none'; n.style.overflow = 'visible'; }
    }
  });
  await snap(page, '16-bulk-results', 1700);
  save({ bulk: true });
});

test('8 short-lived certificate, dashboard and list', async ({ page }) => {
  await login(page);
  if (!load().vpnId) {
    await issueCert(page, { ca: 'Acme Internal Root CA', type: 'server', cn: 'vpn.acme.example', ou: 'Network', dns: ['vpn.acme.example'], days: 14 });
    await page.getByRole('button', { name: 'Issue Certificate' }).click();
    await page.waitForURL(/\/certificates\/[0-9a-f-]{36}/, { timeout: 120_000 });
    save({ vpnId: idFromUrl(page) });
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Expiring Soon' })).toBeVisible();
  await expect(page.getByText('vpn.acme.example').first()).toBeVisible();
  await snap(page, '17-dashboard', 1300);
  await page.goto('/certificates');
  await expect(page.getByPlaceholder('Filter by CN or SAN...')).toBeVisible();
  await page.getByPlaceholder('Filter by CN or SAN...').fill('acme.example');
  await page.locator('select').nth(0).selectOption({ label: 'Acme Internal Root CA' });
  await page.waitForTimeout(1200);
  await snap(page, '18-certificate-list', 1000);
  await page.locator('select').nth(1).selectOption('Revoked');
  await page.waitForTimeout(1200);
  await snap(page, '19-list-revoked', 600);
});

test('9 screencast: issue a server certificate', async ({ browser }) => {
  test.setTimeout(120_000);
  await screencast(browser, 'private-ca-issue-server', async (page) => {
    await login(page);
    await page.goto('/certificates');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Issue Certificate' }).click();
    await page.waitForURL(/\/certificates\/new/);
    await page.waitForTimeout(800);
    const type = (ph: string | RegExp, v: string, i = 0) => page.getByPlaceholder(ph, { exact: typeof ph === 'string' }).nth(i).pressSequentially(v, { delay: 45 });
    await page.locator('select').nth(0).selectOption({ label: 'Acme Internal Root CA' });
    await page.waitForTimeout(500);
    await type(/example\.com or/, 'intranet.acme.example');
    await type('Acme Corporation', 'Acme Example Ltd');
    await type('IT Department', 'Web Platform');
    await type('US', 'ES');
    await type('California', 'Barcelona');
    await type('San Francisco', 'Barcelona');
    await type('example.com', 'intranet.acme.example');
    await page.getByRole('button', { name: '+ Add DNS Name' }).click();
    await type('example.com', 'www.intranet.acme.example', 1);
    await type('192.168.1.1', '10.20.0.30');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Issue Certificate' }).click();
    await page.waitForURL(/\/certificates\/[0-9a-f-]{36}/, { timeout: 120_000 });
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(3500);
  });
});
