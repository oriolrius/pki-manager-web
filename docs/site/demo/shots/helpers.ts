import { expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const API = 'http://localhost:47300';
export const KEYCLOAK = 'http://localhost:47381/realms/pki-demo';
export const USERS = { admin: 'alex', user: 'uma' } as const;
export const PASSWORD = 'Demo-Pass-1';

/** Screenshot helper: files go to docs/guides/img/<guide>/<name>.png (committed, used by the guides). */
export function shooter(guide: string) {
  const dir = join(REPO, 'docs', 'guides', 'img', guide);
  mkdirSync(dir, { recursive: true });
  return async (page: Page, name: string, opts: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}) => {
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: join(dir, `${name}.png`), ...opts });
  };
}

/** Log in through Keycloak (the real OIDC login). */
export async function login(page: Page, user: string = USERS.admin) {
  await page.goto('/');
  await page.waitForURL(/localhost:47381/, { timeout: 30_000 });
  await page.getByRole('textbox', { name: /username or email/i }).fill(user);
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/localhost:47380/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /admin|user/i }).first()).toBeVisible({ timeout: 30_000 });
}

/** Access token for the REST API (password grant on the demo realm only). */
export async function token(user: string = USERS.admin): Promise<string> {
  const res = await fetch(`${KEYCLOAK}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'pki-web', username: user, password: PASSWORD, scope: 'openid' }),
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * Record a short screencast (WebM, no audio) of `fn` into docs/guides/video/<name>.webm.
 * Keep each one under 60 s.
 */
export async function screencast(browser: Browser, name: string, fn: (page: Page, ctx: BrowserContext) => Promise<void>) {
  const dir = join(REPO, 'docs', 'guides', 'video');
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    baseURL: 'http://localhost:47380', viewport: { width: 1280, height: 720 }, colorScheme: 'light',
    recordVideo: { dir: join(dir, '.tmp'), size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await fn(page, ctx);
  await page.waitForTimeout(800);
  const video = page.video();
  await ctx.close();
  const secs = (Date.now() - t0) / 1000;
  if (secs > 60) throw new Error(`screencast ${name}: ${secs.toFixed(0)} s (limit 60 s)`);
  renameSync(await video!.path(), join(dir, `${name}.webm`));
}

/** Per-run working files (ids, downloads). demo.sh up empties it; gitignored. */
export const RUN_DIR = join(REPO, 'docs', 'site', 'demo', '.run');
for (const d of ['private-ca', 'k8s', 'integrations']) mkdirSync(join(RUN_DIR, d), { recursive: true });
