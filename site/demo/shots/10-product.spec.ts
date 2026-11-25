import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { login, shooter, token, API, RUN_DIR } from './helpers';

// Screenshots of the product pages (docs/features/*.md, docs/index.md): docs/features/img/<name>.png.
// Run it alone on a clean demo stack of the release that the site documents:
//   IMAGE_TAG=3.17.0 site/demo/demo.sh up
//   cd site/demo && ../../node_modules/.bin/playwright test --config playwright.config.ts shots/10-product.spec.ts
// The data is made through the API (the same calls as docs/api/how-to.md), then each page is opened.
// To take the screenshots again on a stack that already has the data, add: -g screenshots
const shot = shooter('', join('docs', 'features', 'img'));
const WORK = join(RUN_DIR, 'product');
test.describe.configure({ mode: 'serial' });

let bearer = '';
const ids: Record<string, string> = {};

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function trpc(proc: string, input: unknown) {
  const res = await fetch(`${API}/trpc/${proc}`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${proc}: HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.result.data;
}
function sshKey(name: string, type: 'ecdsa' | 'ed25519') {
  const file = join(WORK, name);
  execFileSync('ssh-keygen', ['-q', '-t', type, ...(type === 'ecdsa' ? ['-b', '256'] : []), '-N', '', '-C', name, '-f', file]);
  return readFileSync(`${file}.pub`, 'utf8').trim();
}
const acme = { organization: 'Acme Example Ltd', country: 'ES' };

/**
 * Open a page, wait until loading is over, and take a screenshot that ends where the content ends.
 * maxHeight cuts a long page. fromText starts the image at the row that holds that text.
 */
async function snap(page: Page, path: string, name: string, opts: { maxHeight?: number; fromText?: string } = {}) {
  await page.setViewportSize({ width: 1440, height: 400 });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await page.waitForTimeout(400);
  const content = await page.evaluate(() => document.documentElement.scrollHeight);
  const height = Math.min(content, opts.maxHeight ?? 1400);
  await page.setViewportSize({ width: 1440, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (opts.fromText) {
    const box = await page.getByText(opts.fromText, { exact: true }).first().boundingBox();
    const y = Math.max(0, Math.round(box!.y) - 40);
    clip = { x: 80, y, width: 1280, height: height - y };
  }
  await shot(page, name, clip ? { clip } : {});
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** The ids of the seeded objects, read back from the API: the screenshots can then run again on a seeded stack. */
async function findIds() {
  bearer = bearer || (await token());
  const cas = (await rest('GET', '/cas/?limit=100')).items as { id: string }[];
  const certs = (await rest('GET', '/certificates/?limit=100')).items as { id: string }[];
  const byText = (items: { id: string }[], text: string) => items.find((i) => JSON.stringify(i).includes(text))?.id ?? '';
  ids.ca = byText(cas, 'Acme Internal Root CA');
  ids.portal = byText(certs, 'CN=portal.acme.example');
  ids.old = byText(certs, 'CN=old-portal.acme.example');
  const res = await fetch(`${API}/trpc/ssh.host.list?input=%7B%7D`, { headers: { Authorization: `Bearer ${bearer}` } });
  const hosts = (await res.json()).result.data as { id: string; fqdn: string }[];
  ids.sshHost = hosts.find((h) => h.fqdn === 'web-01.acme.example')?.id ?? '';
  for (const k of ['ca', 'portal', 'old', 'sshHost']) if (!ids[k]) throw new Error(`screenshots: "${k}" not found; seed the demo stack first`);
}

test('seed: CAs, certificates, integrations', async () => {
  bearer = await token();
  const cert = async (caId: string, type: string, cn: string, extra: object = {}) =>
    (await rest('POST', '/certificates/', { caId, subject: { commonName: cn, ...acme }, certificateType: type, keyAlgorithm: 'ECDSA-P256', validityDays: 365, ...extra })).id;

  ids.ca = (await rest('POST', '/cas/', { subject: { commonName: 'Acme Internal Root CA', organizationalUnit: 'IT Security', ...acme }, keyAlgorithm: 'RSA-4096', validityYears: 10 })).id;
  ids.devCa = (await rest('POST', '/cas/', { subject: { commonName: 'Acme Devices Root CA', organizationalUnit: 'Factory', ...acme }, keyAlgorithm: 'RSA-2048', validityYears: 5 })).id;

  ids.portal = await cert(ids.ca, 'server', 'portal.acme.example', { sanDns: ['portal.acme.example', 'www.portal.acme.example'], sanIp: ['192.0.2.10'] });
  await cert(ids.ca, 'server', 'git.acme.example', { sanDns: ['git.acme.example'], validityDays: 90 });
  await cert(ids.ca, 'server', 'wiki.acme.example', { sanDns: ['wiki.acme.example'], validityDays: 20 });
  await cert(ids.ca, 'server', 'vpn.acme.example', { sanDns: ['vpn.acme.example'], validityDays: 5 });
  await cert(ids.ca, 'client', 'maria.puig', { keyAlgorithm: 'RSA-2048' });
  await cert(ids.ca, 'client', 'jordi.soler', { keyAlgorithm: 'RSA-2048', validityDays: 180 });
  await cert(ids.devCa, 'client', 'sensor-01', { validityDays: 90 });
  await cert(ids.devCa, 'client', 'sensor-02', { validityDays: 90 });
  ids.old = await cert(ids.ca, 'server', 'old-portal.acme.example', { sanDns: ['old-portal.acme.example'] });
  await rest('POST', `/certificates/${ids.old}/revoke`, { reason: 'superseded', generateCrl: true });

  const k8s = await trpc('integration.register', { name: 'k8s-production', description: 'cert-manager issuer of the production cluster', caId: ids.ca, kind: 'kubernetes' });
  await trpc('integration.register', { name: 'ci-pipeline', description: 'Signs the certificates of the test environments', caId: ids.ca, kind: 'generic' });
  await trpc('integration.register', { name: 'factory-scep', description: 'SCEP gateway for the factory devices', caId: ids.devCa, kind: 'scep' });
  // one call with the token, so that the list shows it as active
  await fetch(`${API}/api/v1/external/health`, { headers: { Authorization: `Bearer ${k8s.token}` } });
});

test('seed: SSH CAs, hosts, people, certificates', async () => {
  const userCa = (await trpc('ssh.ca.create', { caType: 'user', label: 'Acme User CA' })).id;
  const hostCa = (await trpc('ssh.ca.create', { caType: 'host', label: 'Acme Host CA' })).id;
  const principal: Record<string, string> = {};
  for (const [name, description] of [['webadmin', 'Web server admins'], ['dba', 'Database admins'], ['deploy', 'Application deployment'], ['monitoring', 'Read-only monitoring']]) {
    principal[name] = (await trpc('ssh.principal.create', { name, description })).id;
  }
  const person: Record<string, string> = {};
  for (const subject of ['alice', 'bob', 'carol', 'dave']) {
    person[subject] = (await trpc('ssh.user.createIdentity', { subject, email: `${subject}@acme.example` })).id;
  }
  const host: Record<string, string> = {};
  for (const [fqdn, address] of [['web-01.acme.example', '192.0.2.11'], ['web-02.acme.example', '192.0.2.12'], ['db-01.acme.example', '192.0.2.21'], ['bastion.acme.example', '192.0.2.5']]) {
    host[fqdn] = (await trpc('ssh.host.register', { fqdn, displayName: fqdn, addresses: [address], opensshHostPubkey: sshKey(`host-${fqdn}`, 'ecdsa') })).id;
  }
  ids.sshHost = host['web-01.acme.example'];
  const grant = (who: string, what: string) => trpc('ssh.principal.grant', { identityId: person[who], principalId: principal[what] });
  const map = (fqdn: string, what: string, localAccount: string) => trpc('ssh.principal.map', { hostId: host[fqdn], principalId: principal[what], localAccount });
  await grant('alice', 'webadmin'); await grant('alice', 'deploy'); await grant('bob', 'dba');
  await grant('carol', 'deploy'); await grant('carol', 'monitoring'); await grant('dave', 'monitoring');
  await map('web-01.acme.example', 'webadmin', 'www-admin'); await map('web-01.acme.example', 'deploy', 'deploy');
  await map('web-02.acme.example', 'webadmin', 'www-admin'); await map('db-01.acme.example', 'dba', 'postgres');

  const day = 24 * 3600;
  const userCert = (who: string, principals: string[], days: number) => trpc('ssh.user.issue', {
    identityId: person[who], caId: userCa, sshPublicKey: sshKey(`user-${who}-${days}`, 'ed25519'), principals, validForSeconds: days * day, extensions: ['permit-pty'],
  });
  await userCert('alice', ['webadmin', 'deploy'], 30);
  await userCert('bob', ['dba'], 7);
  await userCert('carol', ['deploy', 'monitoring'], 30);
  await userCert('dave', ['monitoring'], 1);
  for (const fqdn of Object.keys(host)) await trpc('ssh.host.issue', { hostId: host[fqdn], caId: hostCa, validForSeconds: 365 * day });
  await trpc('ssh.block.block', { hostId: host['db-01.acme.example'], identityId: person.carol, reason: 'Left the database rotation' });
});

test('screenshots', async ({ page }) => {
  await findIds();
  await login(page);
  // The dashboard starts at the counters: the banner above them is an introduction, not data.
  await snap(page, '/', 'dashboard', { fromText: 'Total CAs' });
  await snap(page, `/cas/${ids.ca}`, 'ca-detail', { maxHeight: 1160 });
  await snap(page, '/certificates', 'certificates');
  await snap(page, `/certificates/${ids.portal}`, 'certificate-detail', { maxHeight: 1500 });
  await snap(page, `/certificates/${ids.old}`, 'certificate-revoked', { maxHeight: 1100 });
  await snap(page, '/certificates/bulk', 'bulk', { maxHeight: 1000 });
  await snap(page, '/integrations', 'integrations');
  await snap(page, `/ssh/hosts/${ids.sshHost}`, 'ssh-host-detail', { maxHeight: 1240 });
  await snap(page, '/ssh/principals', 'ssh-principals');
  await snap(page, '/ssh/krl', 'ssh-krl');
  // The API page: the list of operations, not the introduction above it.
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/api-docs');
  await page.waitForLoadState('networkidle');
  const firstTag = page.locator('.opblock-tag-section').first();
  await firstTag.waitFor({ timeout: 30_000 });
  await firstTag.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24));
  await page.waitForTimeout(600);
  await shot(page, 'api-docs');
});
