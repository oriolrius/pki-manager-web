// Parse script.md into episodes -> scenes -> sentences (single source of truth).
// Usage: node engine/narration.mjs  -> build/narration.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PRON = JSON.parse(readFileSync(join(ROOT, 'pronunciation.json'), 'utf8'));

/** Written form -> spoken form, for the TTS input only. */
export function spoken(text) {
  let out = text.replace(/`/g, '');
  const keys = Object.keys(PRON).filter((k) => !k.startsWith('_')).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'g'), PRON[k]);
  }
  return out;
}

/** Split a paragraph into sentences (keeps quotes with their sentence). */
export function sentences(paragraph) {
  const parts = paragraph.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["”)]?(\s|$)|[^.!?]+$/g) ?? [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Very short sentences (< 4 words) are merged with the next one: TTS invents words on tiny inputs. */
export function groups(sentences) {
  const out = [];
  let cur = null;
  for (const s of sentences) {
    if (cur) { cur = { text: `${cur.text} ${s.text}`, say: `${cur.say} ${s.say}` }; }
    else cur = { ...s };
    if (cur.text.split(/\s+/).length >= 4) { out.push(cur); cur = null; }
  }
  if (cur) { if (out.length) { const l = out.pop(); out.push({ text: `${l.text} ${cur.text}`, say: `${l.say} ${cur.say}` }); } else out.push(cur); }
  return out;
}

export function parseScript(md = readFileSync(join(ROOT, 'script.md'), 'utf8')) {
  const episodes = [];
  let ep = null;
  let scene = null;
  let mode = null;
  let buf = [];
  const flush = () => {
    if (scene && mode === 'narration') scene.text = buf.join(' ').trim();
    buf = [];
  };
  for (const line of md.split('\n')) {
    const e = line.match(/^## Episode (\d+) — (.+)$/);
    const s = line.match(/^### (\d+)\.(\d+) — (.+)$/);
    if (e) {
      flush(); mode = null;
      ep = { id: e[1], title: e[2].trim(), scenes: [] };
      episodes.push(ep);
      continue;
    }
    if (s && ep) {
      flush(); mode = null;
      scene = { id: `${s[1]}.${s[2]}`, title: s[3].trim(), text: '' };
      ep.scenes.push(scene);
      continue;
    }
    const n = line.match(/^\*\*Narration:\*\*\s*(.*)$/);
    if (n) { flush(); mode = 'narration'; buf.push(n[1]); continue; }
    if (/^\*\*Visual:\*\*/.test(line) || /^---\s*$/.test(line)) { flush(); mode = null; continue; }
    if (mode === 'narration') {
      if (line.trim() === '') { flush(); mode = null; } else buf.push(line.trim());
    }
  }
  flush();
  for (const ep of episodes) {
    for (const sc of ep.scenes) {
      sc.sentences = sentences(sc.text).map((t) => ({ text: t.replace(/`/g, ''), say: spoken(t) }));
    }
  }
  return episodes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eps = parseScript();
  mkdirSync(join(ROOT, 'build'), { recursive: true });
  writeFileSync(join(ROOT, 'build', 'narration.json'), JSON.stringify(eps, null, 2));
  const want = process.argv.slice(2).filter((a) => /^\d\d$/.test(a));
  if (process.argv.includes('--items')) {
    for (const ep of eps.filter((e) => !want.length || want.includes(e.id))) {
      console.log(`## Episode ${ep.id} — ${ep.title}`);
      for (const sc of ep.scenes) {
        console.log(`  ${sc.id} ${sc.title}`);
        groups(sc.sentences).forEach((g, k) => console.log(`    s(${k}) ${g.text}`));
      }
    }
    process.exit(0);
  }
  for (const ep of eps) {
    const words = ep.scenes.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
    console.log(`${ep.id} ${ep.title}: ${ep.scenes.length} scenes, ${words} words (~${(words / 150).toFixed(1)} min)`);
  }
}
