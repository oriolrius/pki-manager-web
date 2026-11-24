import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { login, shooter, RUN_DIR } from './helpers';

// Guide: docs/guides/mqtt-mtls.md. Acme runs a Mosquitto broker (mqtt.acme.example) with mutual TLS.
// The guide is run in phases, with the broker steps (shell) between them:
//   PHASE=issue      CA, server certificate, client certificate, downloads
//   PHASE=bootstrap  issue and revoke a spare certificate: the CA has no CRL until its first revocation
//   PHASE=revoke     revoke the client certificate (after the broker accepted it)
const shot = shooter('mqtt');
const WORK = join(RUN_DIR, 'mqtt');
mkdirSync(WORK, { recursive: true });
const STATE = join(WORK, 'state.json');
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (o: object) => writeFileSync(STATE, JSON.stringify({ ...load(), ...o }, null, 2));
const PHASE = process.env.PHASE ?? 'issue';
const CA = 'Acme MQTT Root CA';
test.describe.configure({ mode: 'serial' });

async function snap(page: Page, name: string, height = 900) {
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shot(page, name);
  await page.setViewportSize({ width: 1440, height: 900 });
}
const idFromUrl = (page: Page) => page.url().split('/').pop()!;

async function issueCert(page: Page, o: { type: string; cn: string; ou: string; dns?: string[]; days?: number }) {
  await page.goto('/certificates/new');
  await page.waitForLoadState('networkidle');
  const selects = page.locator('select');
  await selects.nth(0).selectOption({ label: CA });
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
}
async function submitIssue(page: Page, key: string) {
  await page.getByRole('button', { name: 'Issue Certificate' }).click();
  await page.waitForURL(/\/certificates\/[0-9a-f-]{36}/, { timeout: 120_000 });
  save({ [key]: idFromUrl(page) });
  await expect(page.locator('h1')).toBeVisible();
}
/** Download a certificate; with `noPassword` the private-key bundle is not encrypted. */
async function grab(page: Page, format: string, file: string, opts: { pw?: string; shotName?: string } = {}) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.locator('#format').selectOption(format);
  if (opts.pw) {
    if (await page.locator('#encryptKey').count()) await page.locator('#encryptKey').check();
    await page.locator('#export-password').fill(opts.pw);
  } else if (await page.locator('#encryptKey').count()) {
    await page.locator('#encryptKey').uncheck();
  }
  if (opts.shotName) await snap(page, opts.shotName);
  const p = page.waitForEvent('download');
  await page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true }).click();
  const warn = page.getByRole('button', { name: 'I Understand, Download' });
  if (await warn.isVisible().catch(() => false)) await warn.click();
  const dl = await p;
  await dl.saveAs(join(WORK, file));
  console.log(format, '->', dl.suggestedFilename());
  const ok = page.getByRole('button', { name: /^(Close|Got it|OK|Done)/i });
  if (await ok.count()) await ok.first().click().catch(() => {});
}

test('1 create the root CA', async ({ page }) => {
  test.skip(PHASE !== 'issue');
  await login(page);
  await page.goto('/cas/new');
  await page.getByPlaceholder('Acme Corp Root CA').fill(CA);
  await page.getByPlaceholder('Acme Corporation').fill('Acme Example Ltd');
  await page.getByPlaceholder('PKI Division').fill('IT Security');
  await page.getByPlaceholder('US', { exact: true }).fill('ES');
  await page.getByPlaceholder('California').fill('Barcelona');
  await page.getByPlaceholder('San Francisco').fill('Barcelona');
  await page.locator('input[type=number]').fill('10');
  await snap(page, '01-ca-form', 1320);
  await page.getByRole('button', { name: 'Create Certificate Authority' }).click();
  await page.waitForURL(/\/cas\/[0-9a-f-]{36}/, { timeout: 120_000 });
  save({ caId: idFromUrl(page) });
  await expect(page.locator('h1')).toBeVisible();
  await snap(page, '02-ca-detail', 1100);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
  await dl.saveAs(join(WORK, 'ca.pem'));
});

test('2 server certificate', async ({ page }) => {
  test.skip(PHASE !== 'issue');
  await login(page);
  await issueCert(page, { type: 'server', cn: 'mqtt.acme.example', ou: 'Messaging', dns: ['mqtt.acme.example'], days: 365 });
  await snap(page, '03-server-form', 1900);
  await submitIssue(page, 'serverId');
  await snap(page, '04-server-detail', 1500);
  await grab(page, 'pem', 'server.pem');
  await grab(page, 'pem-key', 'server-key.zip', { shotName: '05-download-key-bundle' });
});

test('3 client certificate', async ({ page }) => {
  test.skip(PHASE !== 'issue');
  await login(page);
  await issueCert(page, { type: 'client', cn: 'sensor-01', ou: 'Factory Sensors', days: 365 });
  await snap(page, '06-client-form', 1500);
  await submitIssue(page, 'clientId');
  await snap(page, '07-client-detail', 1300);
  await grab(page, 'pem', 'client.pem');
  await grab(page, 'pem-key', 'client-key.zip');
  await grab(page, 'pkcs12', 'client.p12', { pw: 'Acme-Export-1' });
});

test('4 spare certificate, revoked to create the first CRL', async ({ page }) => {
  test.skip(PHASE !== 'bootstrap');
  await login(page);
  await issueCert(page, { type: 'client', cn: 'sensor-spare', ou: 'Factory Sensors', days: 365 });
  await submitIssue(page, 'spareId');
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.locator('#reason').selectOption('superseded');
  await page.locator('textarea').fill('Spare certificate, revoked to create the first CRL');
  await page.getByRole('button', { name: 'Revoke Certificate' }).click();
  await expect(page.getByText('REVOKED', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
});

test('5 revoke the client certificate', async ({ page }) => {
  test.skip(PHASE !== 'revoke');
  await login(page);
  await page.goto(`/certificates/${load().clientId}`);
  await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.locator('#reason').selectOption('keyCompromise');
  await page.locator('textarea').fill('Sensor stolen from the factory floor');
  await snap(page, '08-revoke-dialog');
  await page.getByRole('button', { name: 'Revoke Certificate' }).click();
  await expect(page.getByText('REVOKED', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await snap(page, '09-revoked-detail', 1300);
});

// PHASE=csr: a service token for the "send a CSR" path (the key is made on the device, not in PKI Manager).
test('6 integration token for CSR signing', async ({ page }) => {
  test.skip(PHASE !== 'csr');
  await login(page);
  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await page.getByRole('button', { name: 'Add Integration' }).click();
  await page.getByLabel('Type').selectOption({ label: 'Generic' });
  await page.getByLabel('Name').fill('Acme MQTT Sensors');
  await page.getByLabel('Description').fill('Signs CSRs made on the sensors');
  const ca = page.getByLabel('Bound CA');
  await ca.selectOption((await ca.locator('option', { hasText: CA }).first().getAttribute('value')) as string);
  await shot(page, '10-add-integration');
  await page.getByRole('button', { name: 'Create Integration' }).click();
  const pre = page.locator('pre').first();
  await expect(pre).toContainText('pkimg_');
  writeFileSync(join(WORK, 'token-sensors'), (await pre.innerText()).trim());
  await page.getByRole('button', { name: 'I have saved the token' }).click();
});
