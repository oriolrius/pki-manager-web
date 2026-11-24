// Render episodes to MP4 (H.264 + AAC, soft English subtitles, chapters) + SRT/VTT.
// Usage:
//   node engine/render.mjs 01 02            full render -> ../media/
//   node engine/render.mjs 01 --stills 5,12.5   PNG stills -> build/ep01/stills/
//   node engine/render.mjs 01 --from 20 --to 40 clip -> build/ep01/clip.mp4 (fast review)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from './narration.mjs';

const MEDIA = join(ROOT, '..', 'media');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const eps = args.filter((a, i) => /^\d\d$/.test(a) && !['--stills', '--from', '--to'].includes(args[i - 1]));

const slug = (s) => s.toLowerCase().replace(/["“”?:,]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ts = (t, sep = ',') => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

/** Wrap a cue to max 2 lines of ~60 chars; split longer text into several cues by word share. */
function cues(tl) {
  const out = [];
  for (const sc of tl.scenes) for (const s of sc.sentences) {
    const words = s.text.split(' ');
    const chunks = [];
    let cur = [];
    for (const w of words) {
      if ([...cur, w].join(' ').length > 110 && cur.length) { chunks.push(cur.join(' ')); cur = []; }
      cur.push(w);
    }
    if (cur.length) chunks.push(cur.join(' '));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let t = s.start;
    for (const c of chunks) {
      const d = (s.end - s.start) * (c.length / total);
      out.push({ start: t, end: t + d, text: wrap(c) });
      t += d;
    }
  }
  return out;
}
function wrap(s) {
  if (s.length <= 58) return s;
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? s : `${s.slice(0, best)}\n${s.slice(best + 1)}`;
}
function writeSubs(tl, base) {
  const c = cues(tl);
  writeFileSync(`${base}.srt`, c.map((q, i) => `${i + 1}\n${ts(q.start)} --> ${ts(q.end)}\n${q.text}\n`).join('\n'));
  writeFileSync(`${base}.vtt`, 'WEBVTT\n\n' + c.map((q) => `${ts(q.start, '.')} --> ${ts(q.end, '.')}\n${q.text}\n`).join('\n'));
  const ch = tl.scenes.map((s) => ({ start: s.start, end: s.end, title: `${s.id} ${s.title}` }));
  writeFileSync(`${base}.chapters.vtt`, 'WEBVTT\n\n' + ch.map((q) => `${ts(q.start, '.')} --> ${ts(q.end, '.')}\n${q.title}\n`).join('\n'));
  const meta = ';FFMETADATA1\n' + `title=SSH certificates with PKI Manager — ${tl.episode} ${tl.title}\nartist=Oriol Rius\nlanguage=eng\n` +
    ch.map((q) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(q.start * 1000)}\nEND=${Math.round(q.end * 1000)}\ntitle=${q.title}\n`).join('');
  return meta;
}

async function openPage(browser, ep) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(pathToFileURL(join(ROOT, 'engine', 'player.html')).href + `?ep=${ep}`);
  await page.evaluate(() => window.whenReady());
  return page;
}

async function stills(browser, ep, times) {
  const page = await openPage(browser, ep);
  const dir = join(ROOT, 'build', `ep${ep}`, 'stills');
  mkdirSync(dir, { recursive: true });
  for (const t of times) {
    await page.evaluate((x) => window.seek(x), t);
    const f = join(dir, `t${t.toFixed(1).padStart(6, '0')}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  }
  await page.close();
}

async function render(browser, ep, { from = 0, to = null } = {}) {
  const tl = JSON.parse(readFileSync(join(ROOT, 'build', `ep${ep}`, 'timeline.json'), 'utf8'));
  const fps = tl.fps ?? 30;
  const end = to ?? tl.duration;
  const isClip = from > 0 || to != null;
  mkdirSync(MEDIA, { recursive: true });
  const base = isClip ? join(ROOT, 'build', `ep${ep}`, 'clip') : join(MEDIA, `ssh-ca-${ep}-${slug(tl.title)}`);
  const meta = writeSubs(tl, base);
  const metaFile = join(ROOT, 'build', `ep${ep}`, 'ffmeta.txt');
  writeFileSync(metaFile, meta);
  const audio = join(ROOT, 'build', `ep${ep}`, 'narration.wav');
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-ss', String(from), '-t', String(end - from), '-i', audio,
    ...(isClip ? [] : ['-i', `${base}.srt`, '-i', metaFile]),
    '-map', '0:v', '-map', '1:a', ...(isClip ? [] : ['-map', '2:s', '-map_metadata', '3', '-map_chapters', '3']),
    '-af', 'aformat=channel_layouts=mono,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000',
    '-c:v', 'libx264', '-preset', 'medium', '-tune', 'animation', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '160k',
    ...(isClip ? [] : ['-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng']),
    '-movflags', '+faststart', '-t', String(end - from), '-f', 'mp4', `${base}.mp4.part`,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.stdin.on('error', (e) => console.error('ffmpeg input closed:', e.code));
  const page = await openPage(browser, ep);
  const n = Math.ceil((end - from) * fps);
  let last = null, shots = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = from + i / fps;
    const changed = await page.evaluate((x) => window.seek(x), t);
    if (changed || !last) { last = await page.screenshot({ type: 'jpeg', quality: 94 }); shots++; }
    if (!ff.stdin.write(last)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (fps * 10) === 0) process.stdout.write(`\r  ep${ep} ${t.toFixed(0)}/${end.toFixed(0)} s (${shots} shots)`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg exit ${c}`)))));
  // Verify the streams really cover the episode, then publish atomically.
  const probe = (sel) => Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'stream=duration', '-of', 'csv=p=0', `${base}.mp4.part`]).toString().trim());
  const want = end - from;
  const [vd, ad] = [probe('v:0'), probe('a:0')];
  if (Math.abs(vd - want) > 0.2 || Math.abs(ad - want) > 0.2) throw new Error(`ep${ep}: streams too short (video ${vd}s, audio ${ad}s, want ${want.toFixed(2)}s)`);
  renameSync(`${base}.mp4.part`, `${base}.mp4`);
  await page.close();
  console.log(`\r  ep${ep} -> ${base}.mp4 (${n} frames, ${shots} unique, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const browser = await chromium.launch();
try {
  for (const ep of eps) {
    if (!existsSync(join(ROOT, 'build', `ep${ep}`, 'timeline.json'))) throw new Error(`run voice first: node engine/voice.mjs ${ep}`);
    const st = opt('--stills');
    if (st) await stills(browser, ep, st.split(',').map(Number));
    else await render(browser, ep, { from: Number(opt('--from') ?? 0), to: opt('--to') != null ? Number(opt('--to')) : null });
  }
} finally {
  await browser.close();
}
