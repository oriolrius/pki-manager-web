// Copy the repo's Markdown docs into the Starlight content folder.
// The repo files stay the single source of truth; the copies are generated and gitignored.
// - first "# Title" becomes frontmatter, and is removed from the body
// - relative links to other mapped docs become site links; to other repo files, GitHub links
// - relative images are copied to public/img/<repo path>
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteVersion, changedIn } from './version.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SITE, '..', '..');
const BASE = '/pki-manager-web';
const GH = 'https://github.com/oriolrius/pki-manager-web/blob/main/';
const OUT = join(SITE, 'src', 'content', 'docs');

/** repo path -> [site slug, sidebar order] */
export const MAP = {
  'DEPLOYMENT.md': ['operations/deployment', 1],
  'docs/deployment/integrations-0010.md': ['operations/migration-0010', 5],
  'OIDC.md': ['operations/oidc', 2],
  'KEYCLOAK.md': ['operations/keycloak', 3],
  'docs/guides/private-ca.md': ['guides/private-ca', 1],
  'docs/guides/mqtt-mtls.md': ['guides/mqtt', 2],
  'docs/guides/k8s-issuer.md': ['guides/kubernetes', 3],
  'docs/guides/integrations.md': ['guides/automation', 4],
  'docs/private-root-ca-deployment.md': ['guides/private-root-ca', 5],
  'k8s/issuer/README.md': ['guides/k8s-issuer', 6],
  'k8s/issuer/docs/install.md': ['guides/k8s-issuer-install', 7],
  'docs/k8s-csr-signing.md': ['guides/k8s-csr-signing', 8],
  'docs/api/integrations.md': ['guides/integrations', 9],
  'CHANGELOG.md': ['operations/releases', 9],
  'docs/guides/get-started.md': ['get-started/install', 2],
  'docs/api/how-to.md': ['api/how-to', 2],
  'docs/ssh/concept.md': ['ssh/concept'],
  'docs/ssh/operator-quickstart.md': ['ssh/operator-quickstart'],
  'docs/ssh/setup.md': ['ssh/setup'],
  'docs/ssh/deploy-server-and-user.md': ['ssh/deploy-server-and-user'],
  'docs/ssh/principals-guide.md': ['ssh/principals-guide'],
  'docs/ssh/zones.md': ['ssh/zones'],
  'docs/ssh/host-blocks-runbook.md': ['ssh/host-blocks-runbook'],
  'docs/ssh-api-contract.md': ['ssh/api-contract'],
  'ansible/README.md': ['ssh/ansible-role'],
  // The companion page is rendered by src/pages/ssh/videos.astro
  'docs/ssh/explainer/index.html': ['ssh/videos'],
  'docs/ssh/explainer/README.md': ['ssh/videos'],
  'docs/ssh/explainer': ['ssh/videos'],
};
const LABELS = {"get-started/install": "Install and log in", "api/how-to": "Call the API (examples)", "operations/deployment": "Docker deployment", "operations/migration-0010": "Migration 0010 rollback", "operations/oidc": "OIDC login", "operations/keycloak": "Keycloak setup", "guides/private-ca": "Private CA and certificates", "guides/mqtt": "Client cert auth: Mosquitto", "guides/kubernetes": "Kubernetes with cert-manager", "guides/automation": "Automation, tokens and SCEP", "guides/private-root-ca": "Trust your root CA on devices", "guides/k8s-csr-signing": "Reference: how Kubernetes CSRs are signed", "guides/k8s-issuer": "Reference: issuer overview", "guides/k8s-issuer-install": "Reference: issuer install", "guides/integrations": "Reference: integration API", "ssh/concept": "How it works", "ssh/operator-quickstart": "Operator quickstart", "ssh/setup": "Host and client setup", "ssh/deploy-server-and-user": "Deploy a server and a user", "ssh/principals-guide": "Principals guide", "ssh/zones": "Zones", "ssh/host-blocks-runbook": "Per-host access blocks", "ssh/api-contract": "External API contract", "ssh/ansible-role": "Ansible role", "operations/releases": "Release notes"};
// Docs without a "# Title" line
const TITLES = { 'CHANGELOG.md': 'Release notes' };
const GENERATED_DIRS = ['operations', 'guides', 'ssh'];
const GENERATED_FILES = ['get-started/install.md', 'api/how-to.md'];

const siteUrl = (slug, hash = '') => `${BASE}/${slug}/${hash}`;

function rewriteTarget(target, srcRel) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [path, hash = ''] = target.split('#');
  const abs = posix.normalize(posix.join(posix.dirname(srcRel), decodeURI(path))).replace(/\/$/, '');
  const h = hash ? `#${hash}` : '';
  if (MAP[abs]) return siteUrl(MAP[abs][0], h);
  if (/\.(png|jpe?g|gif|svg|webp|webm|mp4)$/i.test(abs) && existsSync(join(REPO, abs))) {
    const dest = join(SITE, 'public', 'img', abs);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(REPO, abs), dest);
    return `${BASE}/img/${abs}`;
  }
  if (!existsSync(join(REPO, abs))) throw new Error(`${srcRel}: broken link to ${target}`);
  return GH + abs + h;
}

function convert(srcRel, [slug, order]) {
  let md = readFileSync(join(REPO, srcRel), 'utf8');
  let title = TITLES[srcRel];
  if (!title) {
    const m = md.match(/^#\s+(.+)$/m);
    if (!m) throw new Error(`${srcRel}: no "# Title" line`);
    title = m[1].replace(/`/g, '').trim();
    md = md.replace(m[0], '');
  }
  // <!-- tested-with: X.Y.Z --> in a doc: the release its steps were run against
  const tested = md.match(/<!--\s*tested-with:\s*(\d+\.\d+\.\d+)\s*-->/)?.[1];
  // Markdown links and images outside code: [text](target) / ![alt](target)
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  md = parts.map((p, i) => (i % 2 ? p : p
    .replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (_, a, t, b) => a + rewriteTarget(t, srcRel) + b)
    .replace(/(<(?:img|video|source)[^>]*\ssrc=")([^"]+)(")/g, (_, a, t, b) => a + rewriteTarget(t, srcRel) + b)
    .replace(/^\[([^\]]+)\]:\s*(\S+)/gm, (_, k, t) => `[${k}]: ${rewriteTarget(t, srcRel)}`))).join('');
  const fm = ['---', `title: ${JSON.stringify(title)}`,
    `sidebar:\n  label: ${JSON.stringify(LABELS[slug] ?? title)}` + (order ? `\n  order: ${order}` : ''),
    `editUrl: ${JSON.stringify('https://github.com/oriolrius/pki-manager-web/edit/main/' + srcRel)}`,
    `pki:\n  changedIn: ${JSON.stringify(changedIn(srcRel))}` + (tested ? `\n  testedWith: ${JSON.stringify(tested)}` : ''),
    '---', '', `> Source: [\`${srcRel}\`](${GH}${srcRel})`, ''].filter((l) => l !== null).join('\n');
  const dest = join(OUT, `${slug}.md`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, fm + md);
}

// Site version (SiteTitle, PageTitle components)
writeFileSync(join(SITE, 'src', 'version.json'), JSON.stringify(siteVersion(), null, 1) + '\n');
for (const d of [...GENERATED_DIRS, ...GENERATED_FILES]) rmSync(join(OUT, d), { recursive: true, force: true });
rmSync(join(SITE, 'public', 'img'), { recursive: true, force: true });
let n = 0;
for (const [src, v] of Object.entries(MAP)) {
  if (!src.endsWith('.md') || v[0] === 'ssh/videos') continue;
  convert(src, v);
  n++;
}
// Ubuntu fonts (Ubuntu Font Licence) are kept once in the repo, under the video engine.
const fonts = join(REPO, 'docs/ssh/explainer/video/engine/fonts');
mkdirSync(join(SITE, 'public', 'fonts'), { recursive: true });
for (const f of readdirSync(fonts)) copyFileSync(join(fonts, f), join(SITE, 'public', 'fonts', f));
console.log(`sync-docs: ${n} docs -> src/content/docs, PKI Manager ${siteVersion().version}`);
