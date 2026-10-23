// Renders the story opening frame by frame (usage: node preview.mjs <out dir> [scale] [every] [from] [to]).
// Same virtual clock as tools/promo: frames are exact 30 fps, however slow the
// software renderer is. `every` keeps one frame in N (quick looks); `from`/`to`
// limit the seconds rendered. With every = 1 the frames plus public/story/opening.mp3
// make the preview video: ffmpeg -framerate 30 -i f%05d.jpg ...
import fs from 'node:fs';
import path from 'node:path';
import { open } from '../promo/lib.mjs';

const [outDir, scaleArg = '1', everyArg = '1', fromArg = '0', toArg = '99'] = process.argv.slice(2);
const every = +everyArg;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// no sound in the capture: the dialogue then runs on the opening's own (virtual) clock
const quiet = () => {
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
};
// CLEAN=1 also hides the Skip button, for a video to post
const clean = () => {
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
  addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '.op-skip{display:none!important}' })));
};
const init = process.env.CLEAN ? clean : quiet;
const g = await open({ w: +(process.env.W ?? 540), h: +(process.env.H ?? 960), scale: +scaleArg, init, state: { 'skate5.tutorial': '1', 'skate5.career.v1': { rider: 'coral' } } });
await g.tick();
await g.sk(() => window.__skate.playOpening(() => (window.__done = true)));
await g.page.waitForFunction(() => window.__skate.opening.active, null, { timeout: 120000, polling: 250 });
let n = 0;
for (let f = 0; f < 30 * 30; f++) {
  const t = f / 30;
  const done = await g.sk(() => !!window.__done);
  if (done || t > +toArg) break;
  const keep = t >= +fromArg && f % every === 0;
  await g.page.evaluate((draw) => { window.__step(1000 / 60, false); window.__step(1000 / 60, draw); }, keep);
  if (keep) await g.page.screenshot({ path: path.join(outDir, `f${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
}
console.log('frames', n);
await g.close();
