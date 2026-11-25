// Build the site content from the repository. The repository files are the single source;
// everything this script writes is generated and gitignored.
//
//   docs/**/*.md              -> src/content/docs/<same path>     Starlight page, URL = path
//   EXTERNAL (docs.config)    -> src/content/docs/<to>.md         documents that live next to their code
//   backlog decisions + docs  -> src/content/docs/project/...     records, each with a "historical" note
//   PRODUCT (docs.config)     -> src/content/product/<same path>  product layout (src/pages)
//
// For a page:
// - the first "# Title" line becomes the frontmatter title and leaves the body
// - a relative link to another published file becomes a site link; to another repository file, a GitHub link
// - a relative image is copied to public/img/<repo path>
// - a broken relative link stops the build
// The build also stops when a Markdown file of the repository has no declared home (../docs.config.mjs).
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteVersion, changedIn } from './version.mjs';
import { PAGES, EXTERNAL, PRODUCT, RECORDS, NOT_PAGES, ALIASES, REPO_ONLY } from '../docs.config.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SITE, '..');
// The site is served at the root of its domain (astro.config.mjs base '/').
const BASE = '';
const GH = 'https://github.com/oriolrius/pki-manager-web';
const OUT_DOCS = join(SITE, 'src', 'content', 'docs');
const OUT_PRODUCT = join(SITE, 'src', 'content', 'product');
const IMAGE = /\.(png|jpe?g|gif|svg|webp|webm|mp4)$/i;

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const siteUrl = (slug, hash = '') => `${BASE}/${slug ? slug + '/' : ''}${hash}`;
const underPrefix = (path, table) => Object.keys(table).find((k) => (k.endsWith('/') ? path.startsWith(k) : path === k));
const docsSlug = (path) => path.replace(/^docs\//, '').replace(/\.md$/, '').replace(/(^|\/)index$/, '');
const recordOf = (path) => {
  const rec = RECORDS.find((r) => path.startsWith(r.dir + '/'));
  const m = rec && posix.basename(path).match(/^(decision|doc)-(\d+)/);
  return m ? { rec, id: `${m[1]}-${m[2]}`, num: m[2] } : null;
};

/** The one home of a Markdown file: { kind: 'page' | 'product' | 'record' | 'none', slug } or undefined. */
function homeOf(path) {
  if (EXTERNAL[path]) return { kind: 'page', slug: EXTERNAL[path].to };
  const r = recordOf(path);
  if (r) return { kind: 'record', slug: `${r.rec.to}/${r.id}`, ...r };
  if (!path.endsWith('.md')) return undefined;
  if (PRODUCT.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p))) return { kind: 'product', slug: docsSlug(path) };
  if (underPrefix(path, NOT_PAGES)) return { kind: 'none' };
  if (path.startsWith('docs/')) return { kind: 'page', slug: docsSlug(path) };
  if (underPrefix(path, REPO_ONLY)) return { kind: 'none' };
  return undefined;
}

// ── inventory: every Markdown file must have a home ───────────────────────────────────────────
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const markdown = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.mdx')
  .split('\0').filter((f) => f && existsSync(join(REPO, f)));
const homeless = markdown.filter((f) => !homeOf(f));
if (homeless.length) {
  throw new Error(`sync-docs: Markdown without a declared home:\n  ${homeless.join('\n  ')}\n` +
    'Put documentation under docs/ (it is then published at the URL of its path).\n' +
    'For a file that is not documentation, add it to REPO_ONLY in site/docs.config.mjs with the reason.');
}
for (const [name, table] of Object.entries({ EXTERNAL, NOT_PAGES, REPO_ONLY, ALIASES })) {
  for (const key of Object.keys(table)) {
    if (!existsSync(join(REPO, key))) throw new Error(`sync-docs: ${name} in docs.config.mjs names "${key}", which does not exist`);
  }
}

// ── links ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Rewrite one relative link target found in `srcRel`.
 * opts.keepImages: leave image paths relative and copy the file next to the page (product pages).
 * opts.lenient: return null for a missing file (the caller removes the link) instead of failing.
 */
function rewriteTarget(target, srcRel, opts = {}) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return target;
  const [path, hash = ''] = target.split('#');
  const abs = posix.normalize(posix.join(posix.dirname(srcRel), decodeURI(path))).replace(/\/$/, '');
  const h = hash ? `#${hash}` : '';
  if (abs.startsWith('..')) throw new Error(`${srcRel}: link leaves the repository: ${target}`);
  if (ALIASES[abs]) return siteUrl(ALIASES[abs], h);
  const exists = existsSync(join(REPO, abs));
  if (exists && IMAGE.test(abs)) {
    if (opts.keepImages && !abs.endsWith('.svg')) {
      const dest = join(opts.keepImages, posix.relative(posix.dirname(srcRel), abs));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(REPO, abs), dest);
      return target;
    }
    const dest = join(SITE, 'public', 'img', abs);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(REPO, abs), dest);
    return `${BASE}/img/${abs}`;
  }
  const home = exists ? homeOf(abs) : undefined;
  if (home && home.kind !== 'none') return siteUrl(home.slug, h);
  if (!exists) {
    if (opts.lenient) return null;
    throw new Error(`${srcRel}: broken link to ${target}`);
  }
  const view = statSync(join(REPO, abs)).isDirectory() ? 'tree' : 'blob';
  return `${GH}/${view}/main/${encodeURI(abs)}${h}`;
}

/** Rewrite the links of a Markdown body. Code blocks and code spans are left alone. */
function rewriteBody(md, srcRel, opts = {}) {
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts.map((p, i) => (i % 2 ? p : p
    .replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (all, a, t, b) => {
      const to = rewriteTarget(t, srcRel, opts);
      return to === null ? a.slice(a.startsWith('!') ? 2 : 1, -2) : a + to + b;
    })
    .replace(/(<(?:img|video|source)[^>]*\ssrc=")([^"]+)(")/g, (_, a, t, b) => a + (rewriteTarget(t, srcRel, opts) ?? t) + b)
    .replace(/^\[([^\]]+)\]:\s*(\S+)/gm, (_, k, t) => `[${k}]: ${rewriteTarget(t, srcRel, opts) ?? t}`))).join('');
}

/** Split "---\nyaml\n---\n" from the body. Only flat `key: value` pairs are read here. */
function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, yaml: '', body: raw };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, yaml: m[1], body: raw.slice(m[0].length) };
}

/** Take the "# Title" that opens the body (after blank lines and comments). */
function takeTitle(body) {
  const m = body.match(/^(?:\s*<!--[\s\S]*?-->)*\s*#\s+(.+)\n?/);
  return m ? { title: m[1].replace(/`/g, '').trim(), body: body.slice(m[0].length) } : { title: null, body };
}

function writePage(slug, title, body, srcRel, extra = {}) {
  const [label, order] = PAGES[slug] ?? [];
  const sidebar = { label: extra.label ?? label ?? title, ...(extra.order ?? order ? { order: extra.order ?? order } : {}) };
  // The marker is the line after the title. An example of it lower in a page is not a marker.
  const tested = body.split('\n').slice(0, 4).join('\n').match(/<!--\s*tested-with:\s*(\d+\.\d+\.\d+(?:\+[0-9a-f]{7,40})?)\s*-->/)?.[1];
  const fm = ['---', `title: ${JSON.stringify(title)}`,
    'sidebar:', `  label: ${JSON.stringify(sidebar.label)}`, ...(sidebar.order ? [`  order: ${sidebar.order}`] : []),
    `editUrl: ${JSON.stringify(`${GH}/edit/main/${encodeURI(srcRel)}`)}`,
    'pki:', `  changedIn: ${JSON.stringify(changedIn(srcRel))}`, ...(tested ? [`  testedWith: ${JSON.stringify(tested)}`] : []),
    '---', '', `> Source: [\`${srcRel}\`](${GH}/blob/main/${encodeURI(srcRel)})`, ''].join('\n');
  // docs/x/index.md is the page /x/: it must be x/index.md so that the sidebar lists it inside x.
  const dest = join(OUT_DOCS, /(^|\/)index\.md$/.test(srcRel) && srcRel.startsWith('docs/') ? `${slug}/index.md` : `${slug}.md`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, fm + (extra.before ?? '') + body);
}

// ── generate ──────────────────────────────────────────────────────────────────────────────────
for (const dir of [OUT_DOCS, OUT_PRODUCT, join(SITE, 'public', 'img')]) rmSync(dir, { recursive: true, force: true });
writeFileSync(join(SITE, 'src', 'version.json'), JSON.stringify(siteVersion(), null, 1) + '\n');

const count = { page: 0, record: 0, product: 0 };
const records = new Map(RECORDS.map((r) => [r.to, []]));
for (const srcRel of [...markdown].sort()) {
  const home = homeOf(srcRel);
  if (home.kind === 'none') continue;
  const { data, yaml, body: raw } = frontmatter(read(srcRel));

  if (home.kind === 'product') {
    const dest = join(OUT_PRODUCT, srcRel.replace(/^docs\//, ''));
    const keepImages = dirname(dest);
    mkdirSync(keepImages, { recursive: true });
    // Frontmatter: `href:` to another document becomes a site link; `image:` is copied next to the page.
    const fm = yaml
      .replace(/^(\s*(?:-\s*)?href:\s*)(["']?)(.+?)\2\s*$/gm, (_, a, _q, t) => a + JSON.stringify(rewriteTarget(t, srcRel)))
      .replace(/^(\s*(?:-\s*)?image:\s*)(["']?)(.+?)\2\s*$/gm, (_, a, _q, t) => a + JSON.stringify(rewriteTarget(t, srcRel, { keepImages })));
    writeFileSync(dest, `---\n${fm}\nsource: ${JSON.stringify(srcRel)}\n---\n` + rewriteBody(raw, srcRel, { keepImages }));
    count.product++;
    continue;
  }

  if (home.kind === 'record') {
    const head = takeTitle(raw);
    const bullet = (name) => raw.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'm'))?.[1]?.trim();
    const title = (data.title ?? head.title ?? home.id).replace(/^\d+\s*-\s*/, '').replace(/^Decision \d+\s*[—–-]\s*/, '');
    const date = (data.date ?? data.created_date ?? bullet('Date') ?? '').slice(0, 10);
    const status = (data.status ?? bullet('Status') ?? '').replace(/^./, (c) => c.toUpperCase());
    const facts = [date && `written ${date}`, status && `status: ${status.toLowerCase()}`].filter(Boolean).join(', ');
    const note = `:::note[${home.rec.kind} ${home.num}${facts ? ` (${facts})` : ''}]\n` +
      'This page is a record, not a manual. It shows what was decided or planned at that date, and why. ' +
      `The product can be different now: for the current behaviour, read the [documentation](${siteUrl('get-started')}).\n:::\n\n`;
    writePage(home.slug, title, rewriteBody(head.body, srcRel, { lenient: true }), srcRel,
      { label: `${home.num} · ${title}`, order: Number(home.num), before: note });
    records.get(home.rec.to).push({ num: home.num, slug: home.slug, title, date, status });
    count.record++;
    continue;
  }

  const head = takeTitle(raw);
  const title = EXTERNAL[srcRel]?.title ?? head.title;
  if (!title) throw new Error(`${srcRel}: the file must start with a "# Title" line`);
  writePage(home.slug, title, rewriteBody(EXTERNAL[srcRel]?.title ? raw : head.body, srcRel), srcRel);
  count.page++;
}

// One index page per kind of record: what it is, and the list.
for (const rec of RECORDS) {
  const rows = records.get(rec.to).sort((a, b) => Number(a.num) - Number(b.num));
  const table = rows.length === 0 ? (rec.empty ?? 'There is no record now.') : ['| No. | Title | Written | Status |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.num} | [${r.title.replace(/\|/g, '\\|')}](${siteUrl(r.slug)}) | ${r.date} | ${r.status} |`)].join('\n');
  const dest = join(OUT_DOCS, rec.to, 'index.md');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, ['---', `title: ${JSON.stringify(rec.title)}`, 'sidebar:', '  label: "Overview"', '  order: 0', 'editUrl: false', '---', '',
    rec.intro, '', `Source: [\`${rec.dir}/\`](${GH}/tree/main/${rec.dir}) in the repository.`, '', table, ''].join('\n'));
}

// Ubuntu fonts (Ubuntu Font Licence) are kept once in the repo, under the video engine.
const fonts = join(REPO, 'docs/ssh/explainer/video/engine/fonts');
mkdirSync(join(SITE, 'public', 'fonts'), { recursive: true });
for (const f of readdirSync(fonts)) copyFileSync(join(fonts, f), join(SITE, 'public', 'fonts', f));
console.log(`sync-docs: ${count.page} pages, ${count.record} records, ${count.product} product pages; ` +
  `${markdown.length} Markdown files have a home; PKI Manager ${siteVersion().version}`);
