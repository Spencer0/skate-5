// Renders a story scene frame by frame (usage: [STORY=plaza] node preview.mjs <out dir> [scale] [every] [from] [to]).
// STORY=opening (the default) is the career opening, STORY=plaza chapter 2's "film this" cold open.
// Same virtual clock as tools/promo: frames are exact 30 fps, however slow the
// software renderer is. `every` keeps one frame in N (quick looks); `from`/`to`
// limit the seconds rendered. With every = 1 the frames plus public/story/<scene>.mp3
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
// AUDIO=1: the game's own sound (voice, wheels, pops, whooshes) rendered offline on the
// virtual clock, written to <out dir>/audio.wav to lay under the frames
const offline = () => {
  window.AudioContext = class extends OfflineAudioContext {
    constructor() {
      super(2, 48000 * 40, 48000);
      window.__offline = this;
    }
  };
};
const offlineClean = () => {
  window.AudioContext = class extends OfflineAudioContext {
    constructor() {
      super(2, 48000 * 40, 48000);
      window.__offline = this;
    }
  };
  addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '.op-skip{display:none!important}' })));
};
const AUDIO = !!process.env.AUDIO;
const init = AUDIO ? (process.env.CLEAN ? offlineClean : offline) : process.env.CLEAN ? clean : quiet;
const g = await open({ w: +(process.env.W ?? 540), h: +(process.env.H ?? 960), scale: +scaleArg, init, state: { 'skate5.tutorial': '1', 'skate5.career.v1': { rider: 'coral' } } });
await g.tick();
const [play, scene] = process.env.STORY === 'plaza' ? ['playFilmThis', 'filmThis'] : ['playOpening', 'opening'];
await g.sk((play) => window.__skate[play](() => (window.__done = true)), play);
await g.page.waitForFunction((scene) => window.__skate[scene].active, scene, { timeout: 120000, polling: 250 });
let n = 0;
const t0 = AUDIO ? await g.sk(() => window.__skate.audio.time) : 0;
let f = 0;
for (; f < 30 * 30; f++) {
  const t = f / 30;
  if (AUDIO) await g.sk((at) => (window.__skate.audio.at = at), t0 + t + 0.02);
  const done = await g.sk(() => !!window.__done);
  if (done || t > +toArg) break;
  const keep = t >= +fromArg && f % every === 0;
  await g.page.evaluate((draw) => { window.__step(1000 / 60, false); window.__step(1000 / 60, draw); }, keep);
  if (keep) await g.page.screenshot({ path: path.join(outDir, `f${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
}
console.log('frames', n);
if (AUDIO) {
  // render, trim to the frames and save as 16-bit WAV
  const b64 = await g.sk(async ([t0, secs]) => {
    const buf = await window.__offline.startRendering();
    const sr = buf.sampleRate;
    const a = Math.floor(t0 * sr);
    const len = Math.min(buf.length - a, Math.ceil(secs * sr));
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const out = new DataView(new ArrayBuffer(44 + len * 4));
    const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + len * 4, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true);
    out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, len * 4, true);
    for (let i = 0; i < len; i++) {
      out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[a + i])) * 32767, true);
      out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[a + i])) * 32767, true);
    }
    let s = '';
    const u8 = new Uint8Array(out.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, [t0, f / 30]);
  fs.writeFileSync(path.join(outDir, 'audio.wav'), Buffer.from(b64, 'base64'));
  console.log('audio', path.join(outDir, 'audio.wav'));
}
await g.close();
