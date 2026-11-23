// Narration audio: one TTS call per sentence (VoiceStudio, local), cached by content hash.
// Builds build/epNN/timeline.json (exact sentence timings) and build/epNN/narration.wav.
// Usage: node engine/voice.mjs [01 02 ...]   (default: all episodes)
// Env:   VOICESTUDIO_URL (default http://localhost:3900), VOICE_ID (default 72042960 = oriol-en),
//        VOICE_CHECK=1 to transcribe every new clip and flag mismatches.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript, ROOT, groups } from './narration.mjs';

const URL_BASE = process.env.VOICESTUDIO_URL ?? 'http://localhost:3900';
const VOICE = process.env.VOICE_ID ?? '72042960';
const CACHE = join(ROOT, 'cache', 'voice');

export const T = {
  intro: 3.0, // title card before the first sentence
  gap: 0.32, // between sentences of one scene
  sceneGap: 0.9, // between scenes
  outro: 2.5, // after the last sentence
};

// ---------- WAV helpers (PCM 16-bit) ----------
export function readWav(buf) {
  let off = 12;
  let fmt = null;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('only PCM 16-bit WAV is supported');
      const data = buf.subarray(off + 8, off + 8 + size);
      const samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
      // downmix to mono
      if (fmt.channels === 1) return { rate: fmt.rate, samples };
      const mono = new Int16Array(samples.length / fmt.channels);
      for (let i = 0; i < mono.length; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) s += samples[i * fmt.channels + c];
        mono[i] = s / fmt.channels;
      }
      return { rate: fmt.rate, samples: mono };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

export function writeWav(path, rate, samples) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + samples.length * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(samples.length * 2, 40);
  writeFileSync(path, Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)]));
}

/** Trim leading/trailing near-silence, keep 60 ms of air. */
function trim({ rate, samples }) {
  const thr = 400;
  const win = Math.floor(rate * 0.01);
  const loud = (i) => {
    let m = 0;
    for (let j = i; j < Math.min(i + win, samples.length); j++) m = Math.max(m, Math.abs(samples[j]));
    return m > thr;
  };
  let a = 0;
  while (a < samples.length && !loud(a)) a += win;
  let b = samples.length - win;
  while (b > a && !loud(b)) b -= win;
  const pad = Math.floor(rate * 0.06);
  return { rate, samples: samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + win + pad)) };
}

async function tts(say, attempt = 0) {
  const key = createHash('sha1').update(`${VOICE}|${say}${attempt ? `|${attempt}` : ''}`).digest('hex').slice(0, 16);
  const file = join(CACHE, `${key}.wav`);
  if (existsSync(file)) return { file, fresh: false };
  const res = await fetch(`${URL_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: VOICE, input: say, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { file, fresh: true };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
function wordErrorRate(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / Math.max(1, r.length);
}

async function transcribe(file) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'clip.wav');
  fd.append('model', 'whisper-1');
  fd.append('language', 'en');
  const res = await fetch(`${URL_BASE}/v1/audio/transcriptions`, { method: 'POST', body: fd });
  if (!res.ok) return null;
  return (await res.json()).text ?? null;
}

const CHOICE_FILE = join(CACHE, 'choice.json');
const CHOICE = existsSync(CHOICE_FILE) ? JSON.parse(readFileSync(CHOICE_FILE, 'utf8')) : {};
const refOf = (text) => text.replace(/`/g, '');

/** Synthesize one clip. With VOICE_CHECK, transcribe it and retry (max 4) while it does not match. */
async function clip(item) {
  const id = createHash('sha1').update(`${VOICE}|${item.say}`).digest('hex').slice(0, 16);
  if (CHOICE[id]) return { file: join(CACHE, CHOICE[id].file), check: CHOICE[id] };
  let best = null;
  const tries = process.env.VOICE_CHECK ? 4 : 1;
  for (let a = 0; a < tries; a++) {
    const { file } = await tts(item.say, a);
    if (!process.env.VOICE_CHECK) return { file, check: null };
    const heard = await transcribe(file);
    const wer = heard == null ? 1 : wordErrorRate(refOf(item.text), heard);
    if (!best || wer < best.wer) best = { file, heard, wer };
    if (wer <= 0.15) break;
  }
  CHOICE[id] = { file: best.file.split('/').pop(), heard: best.heard, wer: +best.wer.toFixed(3) };
  writeFileSync(CHOICE_FILE, JSON.stringify(CHOICE, null, 1));
  return { file: best.file, check: CHOICE[id] };
}

export async function buildEpisode(ep) {
  const dir = join(ROOT, 'build', `ep${ep.id}`);
  mkdirSync(dir, { recursive: true });
  let rate = null;
  const chunks = [];
  let t = T.intro;
  const scenes = [];
  const flagged = [];
  for (const [si, sc] of ep.scenes.entries()) {
    const scene = { id: sc.id, title: sc.title, start: si === 0 ? 0 : t, sentences: [] };
    const items = groups(sc.sentences);
    for (const [k, s] of items.entries()) {
      let file = null, check = null, wav;
      if (process.env.VOICE_DRY) {
        // Estimated timing (2.6 words/s), silent audio: for drawing scenes before the voice exists.
        wav = { rate: 24000, samples: new Int16Array(Math.round(24000 * s.text.split(/\s+/).length / 2.6)) };
      } else {
        ({ file, check } = await clip(s));
        wav = trim(readWav(readFileSync(file)));
      }
      rate ??= wav.rate;
      if (wav.rate !== rate) throw new Error('mixed sample rates');
      const dur = wav.samples.length / rate;
      chunks.push({ at: t, samples: wav.samples });
      scene.sentences.push({ start: +t.toFixed(3), end: +(t + dur).toFixed(3), text: s.text });
      if (check && check.wer > 0.15) flagged.push({ scene: sc.id, text: s.text, heard: check.heard, wer: check.wer });
      t += dur + (k < items.length - 1 ? T.gap : 0);
    }
    t += si < ep.scenes.length - 1 ? T.sceneGap : T.outro;
    scene.end = +t.toFixed(3);
    scenes.push(scene);
    process.stdout.write(`  ${sc.id} ${scene.end.toFixed(1)}s\n`);
  }
  if (process.env.VOICE_CACHE_ONLY) return { timeline: { duration: t }, flagged };
  const total = Math.ceil(t * rate);
  const mix = new Int16Array(total);
  for (const c of chunks) mix.set(c.samples, Math.round(c.at * rate));
  writeWav(join(dir, 'narration.wav'), rate, mix);
  const timeline = { episode: ep.id, title: ep.title, dry: !!process.env.VOICE_DRY, duration: +t.toFixed(3), fps: 30, scenes };
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  writeFileSync(join(dir, 'timeline.js'), `window.TIMELINE = ${JSON.stringify(timeline)};\n`);
  writeFileSync(join(dir, 'voice-check.json'), JSON.stringify(flagged, null, 2));
  return { timeline, flagged };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(CACHE, { recursive: true });
  const want = process.argv.slice(2);
  for (const ep of parseScript()) {
    if (want.length && !want.includes(ep.id)) continue;
    console.log(`Episode ${ep.id} — ${ep.title}`);
    const { timeline, flagged } = await buildEpisode(ep);
    console.log(`  => ${timeline.duration.toFixed(1)} s${flagged.length ? `, ${flagged.length} clip(s) flagged (voice-check.json)` : ''}`);
  }
}
