// Render every PlantUML diagram of the docs with the house PlantUML server (plantuml.joor.net)
// and the oriolrius.me theme (docs/ssh/explainer/diagrams/theme-oriolrius.puml).
//
//   <dir>/NN-name.puml  ->  <dir>/svg/NN-name.svg   (committed, so GitHub shows them too)
//
// `!include` lines are inlined here, because the server cannot read local files.
// A diagram with a syntax error fails the build. Server: $PLANTUML_API (default below).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(SITE, '..', 'docs');
const API = (process.env.PLANTUML_API ?? 'https://plantuml.joor.net').replace(/\/$/, '');
export const DIRS = [join(DOCS, 'ssh', 'explainer', 'diagrams'), join(DOCS, 'diagrams')];

function inline(file, seen = new Set()) {
  if (seen.has(file)) throw new Error(`include loop: ${file}`);
  seen.add(file);
  return readFileSync(file, 'utf8').replace(/^\s*!include\s+(\S+)\s*$/gm, (_, inc) => inline(resolve(dirname(file), inc), seen));
}

async function render(file) {
  const source = inline(file);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}/api/v1/render`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, format: 'svg' }),
    });
    const body = await res.text();
    if (res.ok && !/Syntax Error\?|An error has occured|Cannot include/.test(body)) return body;
    if (res.status >= 500 && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    throw new Error(`${file}: HTTP ${res.status} ${res.ok ? '(PlantUML error in the SVG)' : body.slice(0, 300)}`);
  }
}

let n = 0;
for (const dir of DIRS) {
  const files = readdirSync(dir).filter((f) => /^\d\d-.*\.puml$/.test(f));
  mkdirSync(join(dir, 'svg'), { recursive: true });
  // 4 at a time: fast enough, and gentle with the server.
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(files.slice(i, i + 4).map(async (f) => {
      writeFileSync(join(dir, 'svg', f.replace(/\.puml$/, '.svg')), await render(join(dir, f)));
      n++;
    }));
  }
}
// The SSH video page reads the explainer diagrams from /ssh/diagrams/.
const pub = join(SITE, 'public', 'ssh', 'diagrams');
rmSync(pub, { recursive: true, force: true });
cpSync(join(DIRS[0], 'svg'), pub, { recursive: true });
// Hand-written site pages use the shared diagrams from /diagrams/.
rmSync(join(SITE, 'public', 'diagrams'), { recursive: true, force: true });
cpSync(join(DIRS[1], 'svg'), join(SITE, 'public', 'diagrams'), { recursive: true });
console.log(`plantuml: ${n} diagrams rendered by ${API}`);
