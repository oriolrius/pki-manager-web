// Generate the OpenAPI document from the backend SOURCE (not from a deployed instance):
// start backend/src/server.ts for a moment with an empty temporary database and no OIDC/KMS,
// read /api/v1/openapi.json, stop it. Output: src/openapi/openapi.json (gitignored).
// $OPENAPI_FILE: use this file instead (no backend run), e.g. when the backend is not installed.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(SITE, '..', '..', 'backend');
const OUT = join(SITE, 'src', 'openapi', 'openapi.json');
mkdirSync(dirname(OUT), { recursive: true });

async function fromSource() {
  const tsx = join(BACKEND, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) throw new Error('backend not installed: run `pnpm install` in the repo root (or set OPENAPI_FILE)');
  const tmp = mkdtempSync(join(tmpdir(), 'pki-openapi-'));
  const port = 47000 + Math.floor(Math.random() * 900);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1',
    DATABASE_PATH: join(tmp, 'pki.db'), LOG_LEVEL: 'warn' };
  const child = spawn(tsx, ['src/server.ts'], { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(`backend exited (${child.exitCode}):\n${log.slice(-2000)}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/openapi.json`);
        if (res.ok) return await res.json();
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`backend did not answer in 60 s:\n${log.slice(-2000)}`);
  } finally {
    child.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  }
}

const spec = process.env.OPENAPI_FILE ? JSON.parse(readFileSync(process.env.OPENAPI_FILE, 'utf8')) : await fromSource();
// Instance-specific server URLs make no sense on a public site: document paths relative to your instance.
spec.servers = [{ url: 'https://pki.example.com/api/v1', description: 'Your PKI Manager instance' }];
writeFileSync(OUT, JSON.stringify(spec, null, 1));
const ops = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);
console.log(`openapi: ${spec.info.title} ${spec.info.version}, ${Object.keys(spec.paths).length} paths, ${ops} operations`);
