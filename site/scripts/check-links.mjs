// Fail the build when a page links to a site path (or #anchor) that does not exist in dist/.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const BASE = '/pki-manager-web';
const pages = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && pages.push(p); });
walk(DIST);
const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};
const bad = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    let [path, hash] = url.replace(/&amp;/g, '&').split('#');
    let target;
    if (path === '' && hash) target = page;
    else if (path.startsWith(BASE + '/') || path === BASE) {
      const rel = decodeURIComponent(path.slice(BASE.length).split('?')[0]);
      const f = join(DIST, rel);
      target = existsSync(f) && statSync(f).isFile() ? f : join(f, 'index.html');
      if (!existsSync(target)) { bad.push(`${relative(DIST, page)} -> ${url}`); continue; }
    } else continue;
    if (hash && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(hash))) bad.push(`${relative(DIST, page)} -> ${url} (no anchor)`);
  }
}
if (bad.length) { console.error(`check-links: ${bad.length} broken internal links\n` + [...new Set(bad)].join('\n')); process.exit(1); }
console.log(`check-links: ${pages.length} pages, no broken internal links`);
