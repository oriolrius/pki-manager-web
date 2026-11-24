# SSH CA explainer

A short video series, a companion page and diagrams that explain how the SSH certificate
authority works and how to run it with PKI Manager. Audience: Linux sysadmins who have never
used SSH certificates. English only.

| Path | What |
|---|---|
| [`index.html`](index.html) | Companion page: every episode, its video, diagrams and commands |
| [`video/script.md`](video/script.md) | Series 1 script (episodes 01–10): narration + visual direction per scene |
| [`video/script-principals.md`](video/script-principals.md) | Series 2 script, *Principals in depth* (episodes 11–19), with product gaps and guide corrections |
| [`diagrams/`](diagrams/) | PlantUML sources (`*.puml`), shared theme [`theme-oriolrius.puml`](diagrams/theme-oriolrius.puml), rendered `svg/` |
| [`video/`](video/) | Self-contained build: vector scenes (`episodes/`), engine (`engine/`), see [`AUTHORING.md`](video/AUTHORING.md) |
| `media/` | Built videos (`ssh-ca-NN-*.mp4`) with `.srt`, `.vtt` and chapters |

## Build

Requirements: Node ≥ 20, ffmpeg, and a local
[VoiceStudio](https://github.com/debpalash/VoiceStudio) server with the narrator voice
profile `dbai24-narrator-vox48` (female, native English; default `http://localhost:3900`, override with `VOICESTUDIO_URL` / `VOICE_ID`).

```bash
# diagrams (rendered by https://plantuml.joor.net, see docs/diagrams/README.md)
node ../site/scripts/plantuml.mjs

# videos
cd video
npm install && npx playwright install chromium
npm run build                     # all episodes: voice (ASR-checked) + render -> ../media/
npm run build -- 03               # one episode
node engine/render.mjs 03 --stills 10,20   # review frames
open engine/player.html?ep=03&preview=1    # interactive preview with audio
```

Edit the narration in `video/script.md`; the voice is cached per sentence, so only changed
sentences are synthesised again. Spoken forms of acronyms live in `video/pronunciation.json`.

The public site renders this page at <https://oriolrius.github.io/pki-manager-web/ssh/videos/>, with the YouTube videos (`youtube.json`) in place of the local MP4 files.
