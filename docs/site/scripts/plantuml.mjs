// Render the SSH explainer PlantUML diagrams to SVG at build time.
// Jar: $PLANTUML_JAR, else ~/.local/share/plantuml/plantuml.jar (CI downloads a pinned release).
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(SITE, '..', 'ssh', 'explainer', 'diagrams');
const OUT = join(SITE, 'public', 'ssh', 'diagrams');
const JAR = process.env.PLANTUML_JAR ?? join(homedir(), '.local/share/plantuml/plantuml.jar');
if (!existsSync(JAR)) throw new Error(`PlantUML jar not found: ${JAR} (set PLANTUML_JAR)`);

const files = readdirSync(SRC).filter((f) => /^\d\d-.*\.puml$/.test(f)).map((f) => join(SRC, f));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
// -failfast2: stop on the first syntax error, so a broken diagram fails the build.
execFileSync('java', ['-Djava.awt.headless=true', '-jar', JAR, '-failfast2', '-tsvg', '-o', OUT, ...files], { stdio: 'inherit' });
const n = readdirSync(OUT).filter((f) => f.endsWith('.svg')).length;
if (n !== files.length) throw new Error(`plantuml: ${files.length} diagrams, ${n} SVGs`);
console.log(`plantuml: ${n} diagrams -> public/ssh/diagrams`);
