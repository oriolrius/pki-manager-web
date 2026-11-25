import { test, expect, type BrowserContext, type Page, type Response } from '@playwright/test';

// Browser check of the frontend CSP with a real OIDC login (demo stack: demo/demo.sh up).
//   demo/demo.sh check                                  the demo UI, http://localhost:47380
//   BASE_URL=http://localhost:47392 demo/demo.sh check  another origin, for example an edge proxy
// It checks: login, the pages load with no CSP violation, the token renewal with the refresh
// token, the token renewal in the hidden iframe (silent-renew.html), and logout.
// It changes the demo realm for the run (short access tokens, the BASE_URL origin, no refresh
// token for the iframe test) and puts the settings back at the end.
const BASE = process.env.BASE_URL ?? 'http://localhost:47380';
const KC = 'http://localhost:47381';
const REALM = 'pki-demo';
const AUTHORITY = `${KC}/realms/${REALM}`;
const STORE_KEY = `oidc.user:${AUTHORITY}:pki-web`;
const PASSWORD = 'Demo-Pass-1';
const LIFESPAN = 90; // seconds. The UI renews 60 s before the end: about 30 s after login.

test.describe.configure({ mode: 'serial' });

type Json = Record<string, unknown>;
let realmBefore: Json;
let clientBefore: Json & { id: string; redirectUris: string[]; webOrigins: string[]; attributes: Record<string, string> };

async function kcAdmin(method: string, path: string, body?: unknown): Promise<unknown> {
  const login = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  });
  if (!login.ok) throw new Error(`Keycloak admin login: HTTP ${login.status}`);
  const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method,
    headers: { Authorization: `Bearer ${(await login.json()).access_token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Keycloak ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const setClient = (attributes: Record<string, string>) =>
  kcAdmin('PUT', `/clients/${clientBefore.id}`, {
    ...clientBefore,
    redirectUris: [...new Set([...clientBefore.redirectUris, `${BASE}/*`])],
    webOrigins: [...new Set([...clientBefore.webOrigins, BASE])],
    attributes: { ...clientBefore.attributes, ...attributes },
  });

test.beforeAll(async () => {
  realmBefore = (await kcAdmin('GET', '')) as Json;
  clientBefore = ((await kcAdmin('GET', '/clients?clientId=pki-web')) as (typeof clientBefore)[])[0];
  await kcAdmin('PUT', '', { ...realmBefore, accessTokenLifespan: LIFESPAN });
  await setClient({ 'use.refresh.tokens': 'true' });
});
test.afterAll(async () => {
  await kcAdmin('PUT', '', realmBefore);
  await kcAdmin('PUT', `/clients/${clientBefore.id}`, clientBefore);
});

/** Collect every CSP violation of the UI origin: the browser event and the console message. */
async function watchCsp(context: BrowserContext, page: Page): Promise<string[]> {
  const found: string[] = [];
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP-VIOLATION ${e.documentURI} ${e.violatedDirective} blocked=${e.blockedURI}`);
    });
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (/CSP-VIOLATION|Content Security Policy|Refused to (load|frame|connect|execute|apply)/i.test(text)) {
      found.push(`${msg.location().url || page.url()}: ${text}`);
    }
  });
  return found;
}
const ofUi = (violations: string[]) => violations.filter((v) => v.includes(BASE));

async function login(page: Page, user = 'alex') {
  await page.goto(`${BASE}/`);
  await page.waitForURL((u) => u.origin === KC, { timeout: 30_000 });
  await page.getByRole('textbox', { name: /username or email/i }).fill(user);
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => u.origin === BASE && !u.pathname.startsWith('/callback'), { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /admin|user/i }).first()).toBeVisible({ timeout: 30_000 });
}
const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as { access_token: string; refresh_token?: string } | null, STORE_KEY);
const tokenCall = (grant: string) => (r: Response) =>
  r.url().endsWith('/protocol/openid-connect/token') && (r.request().postData() ?? '').includes(`grant_type=${grant}`);
const securityHeaders = async (r: Response) => {
  const h = await r.allHeaders();
  return { status: r.status(), 'x-frame-options': h['x-frame-options'], 'content-security-policy': h['content-security-policy'] };
};

test('login, pages, renewal with the refresh token, logout', async ({ context, page }) => {
  test.setTimeout(240_000);
  const violations = await watchCsp(context, page);
  const document = page.waitForResponse((r) => r.url() === `${BASE}/`);
  await page.goto(`${BASE}/`);
  console.log('UI document headers:', JSON.stringify(await securityHeaders(await document)));
  await login(page);
  const first = await stored(page);
  expect(first?.refresh_token, 'Keycloak gave a refresh token').toBeTruthy();

  // The automatic renewal: a refresh_token grant, about 30 s after login.
  const renewal = page.waitForResponse(tokenCall('refresh_token'), { timeout: 120_000 });
  for (const path of ['/cas', '/certificates', '/certificates/new', '/ssh/hosts', '/integrations', '/api-docs']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /admin|user/i }).first()).toBeVisible();
  }
  await expect(page.locator('.swagger-ui .info .title')).toBeVisible({ timeout: 30_000 });
  expect((await renewal).status(), 'token endpoint, refresh_token grant').toBe(200);
  await expect.poll(async () => (await stored(page))?.access_token, { timeout: 15_000 }).not.toBe(first!.access_token);
  // The new token works on the API.
  await page.goto(`${BASE}/cas`);
  await expect(page.getByRole('button', { name: 'Create CA' })).toBeVisible();

  // Logout: Keycloak ends the session and sends the browser back; the UI then asks for a login.
  await page.getByRole('button', { name: /admin|user/i }).first().click();
  const logout = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/logout'));
  await page.getByRole('button', { name: 'Logout' }).click();
  await logout;
  await page.waitForURL((u) => u.origin === KC && u.pathname.endsWith('/protocol/openid-connect/auth'), { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: /username or email/i })).toBeVisible();
  await page.goto(`${BASE}/config.json`); // a page of the UI origin that starts no login
  expect(await stored(page), 'no user in localStorage after logout').toBeNull();

  expect(ofUi(violations), 'CSP violations of the UI').toEqual([]);

  // The detector works: a fetch to an origin that the CSP does not allow is reported.
  await page.evaluate(() => fetch('http://127.0.0.1:9/').catch(() => null));
  await expect.poll(() => ofUi(violations).length, { message: 'a blocked fetch is reported' }).toBeGreaterThan(0);
});

test('renewal in the hidden iframe (silent-renew.html)', async ({ context, page }) => {
  test.setTimeout(240_000);
  // With no refresh token, oidc-client-ts renews in an iframe: Keycloak (prompt=none) -> /silent-renew.html.
  await setClient({ 'use.refresh.tokens': 'false' });
  const violations = await watchCsp(context, page);
  await login(page);
  const first = await stored(page);
  expect(first?.refresh_token, 'no refresh token: the iframe is the only renewal path').toBeFalsy();

  const inFrame = (r: Response) => r.frame() !== page.mainFrame();
  const authInFrame = page.waitForResponse((r) => inFrame(r) && r.url().includes('/protocol/openid-connect/auth') && r.url().includes('prompt=none'), { timeout: 120_000 });
  const pageInFrame = page.waitForResponse((r) => inFrame(r) && r.url().startsWith(`${BASE}/silent-renew.html`), { timeout: 120_000 });
  const exchange = page.waitForResponse(tokenCall('authorization_code'), { timeout: 120_000 });

  console.log('Keycloak response in the iframe:', JSON.stringify(await securityHeaders(await authInFrame)));
  const silent = await pageInFrame;
  expect(new URL(silent.url()).searchParams.get('code'), 'silent-renew.html gets an authorization code').toBeTruthy();
  console.log('silent-renew.html in the iframe:', JSON.stringify(await securityHeaders(silent)));
  expect((await exchange).status(), 'token endpoint, authorization_code grant of the renewal').toBe(200);
  await expect.poll(async () => (await stored(page))?.access_token, { timeout: 15_000 }).not.toBe(first!.access_token);

  await page.goto(`${BASE}/cas`);
  await expect(page.getByRole('button', { name: 'Create CA' })).toBeVisible();
  expect(ofUi(violations), 'CSP violations of the UI').toEqual([]);
});
