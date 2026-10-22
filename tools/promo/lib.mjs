// Deterministic gameplay capture for promo videos.
//
// The page runs on a virtual clock: nothing moves until `step()` is called, so
// a slow software renderer still produces smooth, repeatable footage. The game
// is stepped at 60 Hz (it lowers its render resolution below 48 fps) and every
// other step skips its draw calls, giving 30 fps frames.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/opt/node-tools/');
const { chromium } = require('playwright');

const INIT = () => {
  let vt = 1000;
  let cbs = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => cbs.push(cb);
  let skip = false;
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const orig = C.prototype[fn];
      if (orig) C.prototype[fn] = function (...a) { if (!skip) return orig.apply(this, a); };
    }
  }
  window.__pre = null;
  window.__step = (ms, draw) => {
    skip = !draw;
    vt += ms;
    window.__pre?.(ms / 1000);
    const list = cbs;
    cbs = [];
    for (const cb of list) cb(vt);
    for (const a of document.getAnimations()) {
      try { a.pause(); a.currentTime = (a.currentTime || 0) + ms; } catch { /* ignore */ }
    }
  };
};

export async function open({ w = 540, h = 960, scale = 2, state = {} } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await ctx.addInitScript(INIT);
  await ctx.addInitScript((st) => {
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, state);
  await page.goto(process.env.URL ?? 'http://127.0.0.1:5199/');
  const g = {
    page,
    browser,
    frame: 0,
    out: null,
    /** advance one 30 fps frame (two 60 Hz game steps) */
    async tick() {
      await page.evaluate(() => { window.__step(1000 / 60, false); window.__step(1000 / 60, true); });
      g.frame++;
      if (g.out) {
        const f = path.join(g.out, `f${String(g.frame).padStart(5, '0')}.jpg`);
        await page.screenshot({ path: f, type: 'jpeg', quality: 93 });
      }
    },
    /** run n frames without drawing or capturing (fast-forward to a start point) */
    async sim(n) {
      for (let i = 0; i < n; i++) await page.evaluate(() => { window.__step(1000 / 60, false); window.__step(1000 / 60, false); });
    },
    async ticks(n, each) {
      for (let i = 0; i < n; i++) {
        if (each) await each(i);
        await g.tick();
      }
    },
    sk: (fn, arg) => page.evaluate(fn, arg),
    /** touch events on the game's overlay canvas */
    async touch(type, id, x, y) {
      await page.evaluate(([type, id, x, y]) => {
        const el = document.querySelector('canvas.touch-layer');
        el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1 }));
      }, [type, id, x, y]);
    },
    async key(type, k) {
      await page.evaluate(([type, k]) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })), [type, k]);
    },
    /**
     * Take the camera from the game and fly it ourselves: a smoothed follow cam
     * that backs off and climbs with the rider's height, so big air stays in frame.
     */
    async director(cfg) {
      await page.evaluate((cfg) => {
        const S = window.__skate;
        S.debug.freeCam = true;
        const C = { anchor: 0, gh: 1.5, d0: 3, h0: 2, side: 0, k: 0.6, hk: 0.25, maxD: 16, fov: 62, lookUp: 0.8, yawRate: 3, posRate: 7, ...cfg };
        const st = { init: false, yaw: 0, fy: 0, p: [0, 0, 0], l: [0, 0, 0] };
        window.__pre = (dt) => {
          const k = S.skater;
          const f = k.mode === 'bail' ? k.bpos : k.pos;
          const vh = Math.hypot(k.vel.x, k.vel.z);
          let ty = st.yaw;
          if (k.mode === 'grind' && k.grind) ty = Math.atan2(k.grind.rail.dir.z * Math.sign(k.grind.spd || 1), k.grind.rail.dir.x * Math.sign(k.grind.spd || 1));
          else if (vh > 1.5 && k.mode !== 'bail') ty = Math.atan2(k.vel.z, k.vel.x);
          if (!st.init) st.yaw = ty;
          let d = ty - st.yaw;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          st.yaw += d * Math.min(1, dt * C.yawRate);
          const gy = S.terrain.height(f.x, f.z);
          const air = Math.max(0, f.y - gy);
          if (!st.init) st.fy = f.y;
          st.fy += (f.y - st.fy) * Math.min(1, dt * 5);
          const dist = Math.min(C.maxD, C.d0 + C.k * air);
          const h = C.h0 + C.hk * air;
          const fx = Math.cos(st.yaw), fz = Math.sin(st.yaw);
          // in the air the camera stays low and looks up, so height reads as height
          const a = C.anchor * Math.min(1, air / 2.5);
          const want = [f.x - fx * dist - fz * C.side, (1 - a) * (st.fy + h) + a * (gy + C.gh), f.z - fz * dist + fx * C.side];
          const gc = S.terrain.height(want[0], want[2]);
          if (want[1] < gc + 0.5) want[1] = gc + 0.5;
          const look = [f.x + fx * 0.8, f.y + C.lookUp, f.z + fz * 0.8];
          if (!st.init) { st.p = want; st.l = look; st.init = true; }
          const ka = Math.min(1, dt * C.posRate), b = Math.min(1, dt * C.posRate * 1.3);
          for (let i = 0; i < 3; i++) { st.p[i] += (want[i] - st.p[i]) * ka; st.l[i] += (look[i] - st.l[i]) * b; }
          const cam = S.camera;
          cam.position.set(st.p[0], st.p[1], st.p[2]);
          cam.lookAt(st.l[0], st.l[1], st.l[2]);
          if (cam.fov !== C.fov) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
        };
      }, cfg);
    },
    async close() { await browser.close(); },
  };
  return g;
}

export function recordTo(g, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  g.out = dir;
  g.frame = 0;
}
