import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1.6 });
await p.goto(pathToFileURL(join(here, 'playlist-square.html')).href); await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: join(here, 'playlist-square.png') }); await b.close(); console.log('ok');
