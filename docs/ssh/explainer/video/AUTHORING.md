# Authoring episode scenes

The video is drawn in code: every frame is an SVG built by a pure function of time.
`script.md` is the single source for narration and for what each scene must show.

## Files

| File | Role |
|---|---|
| `script.md` | Narration (spoken word for word) + **Visual** direction per scene |
| `pronunciation.json` | Written form → spoken form for the voice only |
| `engine/narration.mjs` | Parses `script.md`. `node engine/narration.mjs --items 03` lists the narration items of episode 03 with their index `s(k)` |
| `engine/voice.mjs` | Builds `build/epNN/timeline.json|.js` + `narration.wav` (VoiceStudio). `VOICE_DRY=1` = estimated timings and silence (no voice needed) |
| `engine/anim.js` | Drawing kit (`window.A`) |
| `engine/player.html` | Frame: header, progress bar, title card, scene fades. `?ep=03&preview=1` plays it with audio in a browser |
| `episodes/epNN.js` | One function per scene |
| `engine/render.mjs` | `--stills 5,12.5` PNGs to `build/epNN/stills/`, or the full MP4 to `../media/` |

## Scene function

```js
EPISODES['03'] = { scenes: {
  '03.1': ({ t, s, e, dur, n }) => { let o = A.heading('Title'); /* … */ return o; },
}};
```

- `t` = seconds since the scene started. `s(k)` / `e(k)` = start / end of narration item `k`
  (scene-local seconds). Items = sentences; a sentence under 4 words is merged into the next.
  **Key every visual to `s(k)`** (plus small offsets), never to absolute seconds: the real voice
  changes the timings.
- Return one SVG string. The canvas is 1920×1080; the header uses y < 95, the progress bar
  y > 1030. Put content in x 100–1820, y 120–1000. `A.heading()` takes the top-left (y 120–250).
- Things appear and stay. Use `A.show(svg, { at, from })` to fade/slide in; `out` to fade out.
- Keep it readable from a phone: text ≥ 22 px, body 26–32 px, few elements per scene.

## Kit (`A.*`) — all return SVG strings

- Time: `A.now()`, `A.prog(at, d)` (0..1), `A.ease(p)`, `A.on(at)`, `A.clamp`, `A.lerp`.
- `show(svg, { at, d, from: 'up'|'down'|'left'|'right'|'pop'|'none', dist, out, cx, cy })`
  (`pop` scales around `cx,cy`). `move(svg, { at, d, dx, dy })`.
- Text: `text(x, y, str, { size, weight, fill, anchor, mono })` (y = middle), `lines(x, y, [..])`.
- Boxes: `rect(x,y,w,h,{fill,stroke,sw,r,dash})`, `card({x,y,w,h,kind,title,body,size,align})`,
  `chip(x, y, label, { kind, size, anchor })`.
- Code: `code({ x, y, w, title, lines, size, hl: [{ line, at, color }], lineAt: [..] })` →
  `{ svg, h }`; `terminal({ x, y, w, items: [{ t: '$ cmd', at }, { t: 'output', out: true, at, color }], title, size })` → `{ svg, h }` (commands type themselves).
- Links: `arrow({ x1, y1, x2, y2, at, d, color, width, dashed, curve, label, head })` (draws itself).
- Icons: `server(cx, cy, { s, label, sub, state: 'ok'|'bad' })`, `laptop(cx, cy, { s, label })`,
  `person(cx, cy, { s, label, sub })`, `ca(cx, cy, { r, kind: 'user'|'host', label, sub })`,
  `keyCard(x, y, { w, h, label, sub, kind })`, `lock(cx, cy, { s, color })`,
  `stamp(cx, cy, { at, kind, r, label })`, `gate(cx, cy, { state: 'pending'|'ok'|'bad', label })`,
  `mark(cx, cy, '✓', { r, color })`, `table({ x, y, cols, rows, colW, size, colors })`.
- Page parts: `heading(title, { sub })`, `caption(text, { at, kind })`, `nextCard(label, at)`.
- Colours `A.C`: `orange` (User CA, user certs), `green` (Host CA, host certs), `navy`
  (machines), `slate`/`mist` (files), `red` (errors, revocation only), `amber` (warnings/stale).
  Card kinds: `user`, `host`, `machine`, `file`, `pki`, `danger`, `plain`, `warn`, `good`, `ghost`.

## UI redraws

PKI Manager screens are **vector redraws**, not screenshots: a simple window
(`rect` + a title bar + fields as labelled boxes + buttons as chips). Use the exact labels
given in `script.md` (they match the real UI).

## Check your work

```bash
VOICE_DRY=1 node engine/voice.mjs 03          # timings without voice
node engine/render.mjs 03 --stills 4,10,20    # look at the PNGs
```

Look at a still near the end of every narration item of every scene: nothing may overlap or
leave the safe area, and every element named in the script **Visual** must be on screen.
