// Full build: narration audio (checked) + MP4/SRT/VTT for the given episodes (default: all).
// Usage: npm run build [-- 03 04]
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseScript, ROOT } from './narration.mjs';

const want = process.argv.slice(2).filter((a) => /^\d\d$/.test(a));
const eps = want.length ? want : parseScript().map((e) => e.id);
const run = (args, env = {}) => {
  const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run([join('engine', 'voice.mjs'), ...eps], { VOICE_CHECK: process.env.VOICE_CHECK ?? '1' });
run([join('engine', 'render.mjs'), ...eps]);
