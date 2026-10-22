// Records the Claude Skate tutorial as a phone-sized video driven by real touch gestures.
// Software GL is far too slow for live capture, so this steps Chromium's virtual clock
// 1/FPS s at a time and screenshots after each step: the game, CSS animations and
// input timestamps all follow that clock, so the footage plays at true speed.
//
// Usage: node promo/record.mjs <outDir> [maxSeconds] [scale=1.5] [fps=30]   (dev server on :5173: `npx vite --port 5173`)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const out = process.argv[2] || 'frames';
const MAX = Number(process.argv[3] || 60);
const SCALE = Number(process.argv[4] || 1.5); // device scale factor
const FPS = Number(process.argv[5] || 30);
const DT = 1000 / FPS;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const W = 540, H = 960;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
// The game takes its time step from the requestAnimationFrame timestamp, which the virtual clock
// doesn't govern. So the page gets a manual frame loop: each captured frame runs exactly one game
// frame at a timestamp we choose (performance.now follows it, so gesture timing matches).
await p.addInitScript(() => {
  let T = 0, id = 0, q = new Map();
  performance.now = () => T;
  window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
  window.cancelAnimationFrame = (i) => q.delete(i);
  window.__step = (dt) => { T += dt; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(T); };
});
await p.goto('http://127.0.0.1:5173/');
await p.waitForTimeout(2500);
const cdp = await ctx.newCDPSession(p);

let n = 0;
let clock = 0; // virtual ms since recording began
await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
async function frame() {
  const expired = new Promise((r) => cdp.once('Emulation.virtualTimeBudgetExpired', r));
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: DT });
  // a missed budget event would stall the run forever: give up after 15s and carry on
  await Promise.race([expired, new Promise((r) => setTimeout(r, 15000))]);
  await p.evaluate((dt) => window.__step(dt), DT);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  fs.writeFileSync(`${out}/f${String(n++).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
  clock += DT;
}
async function wait(ms) { for (const end = clock + ms; clock < end - 1; ) await frame(); }
const touch = (type, x, y, id = 1) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id }] });
// path sampled evenly over ms, one touchMove per frame
async function drag(path, ms) {
  await touch('touchStart', ...path[0]);
  const steps = Math.max(1, Math.round(ms / DT));
  for (let i = 1; i <= steps; i++) {
    const k = (i / steps) * (path.length - 1);
    const a = Math.floor(Math.min(k, path.length - 2));
    const f = k - a;
    await touch('touchMove', path[a][0] + (path[a + 1][0] - path[a][0]) * f, path[a][1] + (path[a + 1][1] - path[a][1]) * f);
    await frame();
  }
  await touch('touchEnd');
}
const tap = async (x, y, hold = 90) => { await touch('touchStart', x, y); await wait(hold); await touch('touchEnd'); };
const state = () => p.evaluate(() => ({
  title: document.querySelector('.tut-title')?.textContent || '',
  done: document.querySelector('.tut-done.on') !== null,
  count: document.querySelector('.tut-progress')?.textContent || '',
}));
const stamp = [];

await wait(1000);
const tb = await p.locator('button', { hasText: 'Tutorial' }).first().boundingBox();
stamp.push(['menu', clock / 1000]);
await tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
await wait(1500);

let last = '';
while (clock / 1000 < MAX) {
  const s = await state();
  if (s.done) break;
  if (s.title !== last) { last = s.title; stamp.push([s.title, clock / 1000]); console.log(s.title, (clock / 1000).toFixed(1)); }
  if (s.title === 'Roll forward') { await tap(130, 720); await wait(450); }
  else if (s.title === 'Steer') {
    await touch('touchStart', 200, 720);
    for (const dir of [1, -1, 1, -1]) {
      for (let i = 1; i <= 14; i++) { await touch('touchMove', 200 + dir * 75 * Math.sin((i / 14) * Math.PI / 2), 720); await frame(); }
      for (let i = 1; i <= 14; i++) { await touch('touchMove', 200 + dir * 75 * Math.cos((i / 14) * Math.PI / 2), 720); await frame(); }
      if ((await state()).title !== 'Steer') break;
    }
    await touch('touchEnd');
  }
  else if (s.title === 'Ollie') { await drag([[420, 640], [420, 700], [420, 700], [420, 540]], 330); await wait(500); await tap(300, 500); await wait(1500); }
  else if (s.title === 'Kickflip') { await drag([[420, 640], [420, 700], [420, 700], [325, 600]], 300); await wait(470); await tap(300, 500); await wait(1500); }
  else if (s.title === 'Catch it!') { await tap(300, 500); await wait(600); }
  else await wait(200);
}
await wait(3000);
fs.writeFileSync(`${out}/stamps.json`, JSON.stringify({ fps: FPS, frames: n, stamp }));
console.log('frames', n, 'seconds', (clock / 1000).toFixed(1));
await b.close();
