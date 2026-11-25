import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { login, shooter, token, USERS, RUN_DIR } from './helpers';

// Guide: docs/guides/kubernetes.md. Needs a kind cluster; the token/CA id are handed to the shell steps via STATE.
// STEP=1 creates the CA + integration (before the cluster work); STEP=2 shoots the issued certificates (after).
const STATE = join(RUN_DIR, 'k8s/state.json');
const shot = shooter('k8s-issuer');
const STEP = process.env.STEP ?? '1';

test('step 1: CA and Kubernetes integration', async ({ page }) => {
  test.skip(STEP !== '1');
  await login(page, USERS.admin);

  await page.goto('/cas/new');
  await page.getByPlaceholder('Acme Corp Root CA').fill('K8s Demo Root CA');
  await page.getByPlaceholder('Acme Corporation').fill('Acme Demo');
  await page.getByPlaceholder('PKI Division').fill('Platform');
  await page.getByPlaceholder('US').fill('ES');
  await shot(page, '01-new-ca-form', { fullPage: true });
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForURL(/\/cas\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const caId = page.url().match(/\/cas\/([0-9a-f-]{36})/)![1];
  await expect(page.getByRole('heading').first()).toBeVisible();
  await shot(page, '02-ca-detail', { clip: { x: 0, y: 270, width: 1440, height: 630 } });

  await page.goto('/integrations');
  await page.getByRole('button', { name: 'Add Integration' }).click();
  await page.locator('#integration-kind').selectOption('kubernetes');
  await page.locator('#integration-name').fill('k8s-demo-kind');
  await page.locator('#integration-description').fill('kind cluster pki-docs');
  await page.locator('#integration-ca').selectOption({ value: caId });
  await shot(page, '03-add-integration');
  await page.getByRole('button', { name: 'Create Integration' }).click();
  const pre = page.locator('pre');
  await expect(pre).toBeVisible({ timeout: 30_000 });
  const tok = (await pre.innerText()).trim();
  writeFileSync(STATE, JSON.stringify({ caId, token: tok }));
  // Screenshot with the token masked (it is a one-time secret of a throw-away demo stack, but never publish a live token).
  await pre.evaluate((el) => { el.textContent = el.textContent!.slice(0, 12) + '… (hidden)'; });
  await shot(page, '04-service-token');
  await page.getByRole('button', { name: 'I have saved the token' }).click();
  await expect(page.getByRole('cell', { name: 'k8s-demo-kind' })).toBeVisible();
  await shot(page, '05-integration-list');
});

test('step 2: issued certificates in PKI Manager', async ({ page }) => {
  test.skip(STEP !== '2');
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await expect(page.getByRole('cell', { name: 'k8s-demo-kind' })).toBeVisible();
  await shot(page, '06-integration-issued');

  await page.goto('/certificates');
  await page.getByText('app.acme.example').first().waitFor({ timeout: 30_000 });
  console.log(await page.getByRole('row', { name: /app\.acme\.example/ }).count());
  await page.getByPlaceholder('Filter by CN or SAN...').fill('acme.example');
  await page.getByRole('combobox').first().selectOption({ label: 'K8s Demo Root CA' });
  await page.waitForTimeout(800);
  await shot(page, '07-certificates-list');
  // Open the renewed certificate by its serial (SERIAL = serial printed by openssl in the guide, any case).
  const t = await token(USERS.admin);
  const list = await (await fetch('http://localhost:47300/api/v1/certificates?limit=100&caId=' + JSON.parse(readFileSync(STATE, 'utf8')).caId, { headers: { Authorization: `Bearer ${t}` } })).json();
  const cert = list.items.find((c: { serialNumber: string }) => c.serialNumber.toLowerCase() === (process.env.SERIAL ?? '').toLowerCase());
  expect(cert, 'certificate with SERIAL not found').toBeTruthy();
  await page.goto(`/certificates/${cert.id}`);
  await expect(page.getByRole('heading', { name: 'app.acme.example' })).toBeVisible({ timeout: 30_000 });
  await shot(page, '08-certificate-detail', { fullPage: true });
});

