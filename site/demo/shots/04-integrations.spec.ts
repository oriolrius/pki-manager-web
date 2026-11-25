import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { login, shooter, token, API, USERS, RUN_DIR } from './helpers';

const shot = shooter('integrations');
const SCRATCH = process.env.INTEGRATIONS_SCRATCH ?? join(RUN_DIR, 'integrations');
const CA = 'CN=Integrations Demo Issuing CA';
const SCEP_CA = 'CN=Integrations Demo Device CA';

/** Screenshots show only this guide's rows: hide the rest of the table (other guides, other demo data). */
async function onlyMine(page: Page, keep: RegExp) {
  await page.evaluate((src) => {
    const re = new RegExp(src);
    document.querySelectorAll('tbody tr').forEach((tr) => { if (!re.test(tr.textContent ?? '')) tr.remove(); });
  }, keep.source);
}

/** Create an integration in the UI; the token (shown once) goes to a scratch file, never to the guide. */
async function addIntegration(page: Page, o: { name: string; kind: string; ca: string; description?: string; file: string; shots?: [string, string, string] }) {
  await page.getByRole('button', { name: 'Add Integration' }).click();
  await page.getByLabel('Type').selectOption({ label: o.kind });
  await page.getByLabel('Name').fill(o.name);
  if (o.description) await page.getByLabel('Description').fill(o.description);
  const ca = page.getByLabel('Bound CA');
  await ca.selectOption(await ca.locator('option', { hasText: o.ca }).first().getAttribute('value') as string);
  if (o.shots) await shot(page, o.shots[0]);
  await page.getByRole('button', { name: 'Create Integration' }).click();
  const pre = page.locator('pre').first();
  await expect(pre).toContainText('pkimg_');
  const token = (await pre.innerText()).trim();
  writeFileSync(`${SCRATCH}/${o.file}`, token);
  if (o.shots) await shot(page, o.shots[1], { clip: { x: 400, y: 330, width: 640, height: 240 } });
  await page.getByRole('button', { name: 'I have saved the token' }).click();
  if (o.shots) { await onlyMine(page, new RegExp(token.slice(0, 12))); await shot(page, o.shots[2]); }
}


/** Create this guide's two CAs through the REST API when they do not exist (clean stack). */
test.beforeAll(async () => {
  const auth = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const have = await (await fetch(`${API}/api/v1/cas/?limit=100`, { headers: auth })).json();
  for (const cn of [CA, SCEP_CA].map((c) => c.replace(/^CN=/, ''))) {
    if (have.items.some((c: { subject: string }) => c.subject.includes(cn))) continue;
    const res = await fetch(`${API}/api/v1/cas/`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ subject: { commonName: cn, organization: 'Example Corp', country: 'ES' }, keyAlgorithm: 'RSA-4096', validityYears: 10 }),
    });
    if (!res.ok) throw new Error(`create CA ${cn}: HTTP ${res.status} ${await res.text()}`);
  }
});

/** Use the CI token once, as the guide does (step 2): sign a CSR for app.example.internal. */
async function signWithCiToken() {
  const key = `${SCRATCH}/app.key`, csr = `${SCRATCH}/app.csr`;
  execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr,
    '-subj', '/CN=app.example.internal/O=Example Corp/C=ES', '-addext', 'subjectAltName=DNS:app.example.internal',
    '-addext', 'extendedKeyUsage=serverAuth', '-addext', 'keyUsage=digitalSignature,keyEncipherment'], { stdio: 'ignore' });
  const res = await fetch(`${API}/api/v1/external/sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readFileSync(`${SCRATCH}/token-ci`, 'utf8').trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csrPem: readFileSync(csr, 'utf8'), requestUid: 'ci-build-1001', durationDays: 30, certificateType: 'server' }),
  });
  if (!res.ok) throw new Error(`external sign: HTTP ${res.status} ${await res.text()}`);
}

// Run order matters (later steps use tokens and CAs from earlier ones). Needs two CAs created first,
// named as in CA / SCEP_CA, and the SCEP gateway (compose.scep-demo.yml) for the SCEP shots.
test('A: create the CI integration', async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await shot(page, '01-integrations-empty');
  await addIntegration(page, {
    name: 'Integrations Demo CI', kind: 'Generic', ca: CA, description: 'Signs CSRs from the CI pipeline', file: 'token-ci',
    shots: ['02-add-integration', '03-service-token', '04-integration-list'],
  });
});

test('B: create the SCEP integration', async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await addIntegration(page, {
    name: 'Integrations Demo SCEP', kind: 'SCEP / MDM', ca: SCEP_CA, description: 'SCEP gateway for devices', file: 'token-scep',
    shots: ['10-add-scep-integration', '11-scep-token', '12-integration-list-scep'],
  });
});

test('C1: integration after use', async ({ page }) => {
  await signWithCiToken();
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await expect(page.getByRole('row', { name: /Integrations Demo CI/ })).toBeVisible();
  await onlyMine(page, /Integrations Demo CI/);
  await shot(page, '05-integration-used');
});

test('C2: rotate, step 1: a new integration with a new token', async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await addIntegration(page, { name: 'Integrations Demo CI v2', kind: 'Generic', ca: CA, description: 'Replaces Integrations Demo CI', file: 'token-ci-v2' });
  await onlyMine(page, /Integrations Demo CI/);
  await shot(page, '06-two-integrations');
});

test('C3: rotate, step 2: revoke the old token', async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await page.getByRole('row', { name: /^Integrations Demo CI Generic/ }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Token will stop working immediately.')).toBeVisible();
  await page.waitForTimeout(600); // dialog fade-in
  await shot(page, '07-revoke-confirm', { clip: { x: 470, y: 350, width: 500, height: 200 } });
  await page.getByRole('button', { name: 'Revoke', exact: true }).last().click();
  await expect(page.getByText('Service token revoked')).toBeVisible();
  await page.waitForTimeout(600);
  await onlyMine(page, /Integrations Demo CI/); // the clip shows the first rows: other guides add rows above
  await shot(page, '08-revoked', { clip: { x: 90, y: 150, width: 1260, height: 125 } });
});

test('D: SCEP integration and device certificate', async ({ page }) => {
  // Needs the SCEP gateway (compose.scep-demo.yml) and one enrolled device; see the guide.
  const gw = await fetch('http://localhost:47385/scep?operation=GetCACaps').then((r) => r.ok, () => false);
  test.skip(!gw, 'SCEP gateway not running: start compose.scep-demo.yml and enroll a device first');
  await login(page, USERS.admin);
  await page.goto('/integrations');
  await expect(page.getByRole('row', { name: /Integrations Demo SCEP/ })).toBeVisible();
  await onlyMine(page, /Integrations Demo SCEP/);
  await shot(page, '13-scep-active');
  await page.goto('/certificates');
  await page.getByRole('combobox').first().selectOption({ label: 'Integrations Demo Device CA' });
  await page.waitForTimeout(500);
  await shot(page, '14-device-certificates');
  await page.getByRole('combobox').first().selectOption({ index: 0 });
  await page.getByPlaceholder('Search by subject, SAN or serial...').fill('app.example.internal');
  await page.waitForTimeout(800);
  await shot(page, '15-ci-certificate');
});
