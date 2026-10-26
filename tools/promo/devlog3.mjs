// Records the Dev Log #3 shots (usage: node devlog3.mjs <outdir> [scale] [shot ...]).
// DRY=1 runs the shots without capturing frames and prints the game's events,
// for tuning the timings. compose_devlog3.py cuts the result.
import fs from 'node:fs';
import path from 'node:path';
import { open, recordTo } from './lib.mjs';
import { stat, leftStick, leftSet, leftUp, flick, arc, tap, grabPoint } from './scenes.mjs';

const [outDir, scaleArg = '2', ...only] = process.argv.slice(2);
const scale = +scaleArg;
const DRY = !!process.env.DRY;
const E = (k, d) => +(process.env[k] ?? d);

const CAM = { chase: 0, classic: 1, overhead: 2, filmer: 3 };
const MAXED = { speed: 10, ollie: 10, spin: 10, flip: 10, balance: 10 };
const state = (rider, cam, special) => ({ 'skate5.tutorial': '1', 'skate5.career.v1': { rider, special, stats: MAXED }, 'skate5.options': { camera: CAM[cam] } });
const MEGA = 4, BRAZIL = 0, PLAZA = 1;

const place = (g, park, x, z, deg, v) => g.sk(([park, x, z, h, v]) => {
  const s = window.__skate;
  s.startRun(park, 'free');
  s.skater.spawn(x, z, h);
  s.skater.vel.set(Math.cos(h) * v, 0, Math.sin(h) * v);
}, [park, x, z, (deg * Math.PI) / 180, v]);

// the game's sound, rendered offline on the virtual clock (see tools/story/preview.mjs):
// every game step moves the audio clock with it
const offlineAudio = () => {
  window.AudioContext = class extends OfflineAudioContext {
    constructor() {
      super(2, 48000 * 90, 48000);
      window.__offline = this;
    }
  };
  window.__gt = 0;
  addEventListener('DOMContentLoaded', () => {
    const step = window.__step;
    window.__step = (ms, draw) => {
      window.__gt += ms / 1000;
      const a = window.__skate?.audio;
      if (a) a.at = window.__gt;
      step(ms, draw);
    };
  });
};

async function saveAudio(g, file) {
  const b64 = await g.sk(async () => {
    if (!window.__offline) return '';
    const buf = await window.__offline.startRendering();
    const len = Math.min(buf.length, Math.ceil((window.__gt + 1) * buf.sampleRate));
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const out = new DataView(new ArrayBuffer(44 + len * 4));
    const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + len * 4, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true);
    out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, len * 4, true);
    for (let i = 0; i < len; i++) {
      out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    let s = '';
    const u8 = new Uint8Array(out.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  else console.log('no audio context: nothing saved');
}

/** every special unlocked, `id` equipped, the meter at `fill` */
const specials = (g, id, fill) => g.sk(([id, fill]) => {
  const s = window.__skate;
  s.career.totalDone = () => 99;
  s.career.data.special = id;
  s.special = fill;
}, [id, fill]);

/** press the ★ with a fingertip on it */
async function star(g, hold = 4) {
  const r = await g.sk(() => { const b = document.querySelector('.star-btn').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; });
  if (!r.w) return false;
  await g.finger(true, r.x, r.y);
  await g.sk(() => document.querySelector('.star-btn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })));
  for (let i = 0; i < hold; i++) await g.tick();
  await g.finger(false);
  return true;
}

const SHOTS = {
  // hook: double kickflip into a boardslide down the stair rail, laser flip out (slowed)
  async hook(g, mark) {
    await g.director({ d0: 3.3, h0: 2.0, side: 1.2, k: 0.25, hk: 0.12, fov: 60, lookUp: 0.8, maxD: 6, anchor: 0.3, gh: 1.5 });
    await place(g, MEGA, 82, -60.5, 90, E('GV', 8));
    await g.sim(1);
    g.rec();
    await leftStick(g, 0, true);
    const SLOW = E('SLOW', 3);
    let pop = -1, outAt = -1, outPop = -1, slow = false;
    for (let i = 0; i < 400; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z > E('GZ', -56.5)) {
        mark('flick');
        await flick(g, process.env.FAST ? [[0, -1.2], [-1, 1.3]] : [[0, -1.2], [-0.6, 0.6], [-1, 1.3]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && g.frame === pop + E('KS', 1)) await leftSet(g, E('KD', 1), false);
      if (pop >= 0 && g.frame === pop + E('KS', 1) + E('KL', 5)) await leftSet(g, 0, false);
      if (pop >= 0 && !mark.has('catch') && g.frame === pop + E('KC', 15)) { mark('catch'); await tap(g, 480, 880); }
      if (st.m === 'grind' && !mark.has('grind')) { mark('grind'); outAt = g.frame + E('OUT', 30); }
      if (outAt > 0 && g.frame === outAt) {
        mark('out');
        slow = true;
        await flick(g, [[0, -1.2], ...arc(-90, 200, 8, 1.3)]);
        outPop = g.frame;
        outAt = -2;
        continue;
      }
      if (outPop >= 0 && !mark.has('ocatch') && g.frame >= outPop + E('OC', 11) * (slow ? SLOW : 1)) { mark('ocatch'); await tap(g, 480, 880); }
      if (outPop >= 0 && st.m === 'ground' && g.frame > outPop + 6 && !mark.has('land')) { mark('land'); }
      if (mark.has('land') && g.frame > mark.get('land') + SLOW * 6) slow = false;
      if (mark.has('land') && g.frame > mark.get('land') + 30) break;
      if (slow) await g.tickSlow(SLOW);
      else await g.tick();
    }
  },

  // "harder than I thought": a kickflip on the flick stick, slowed so the pad's
  // down-then-up trail reads, and no catch: the slam
  async miss(g, mark) {
    const SLOW = E('SLOW', 4);
    await g.director({ d0: 2.4, h0: 1.25, side: 1.1, k: 0.3, hk: 0.1, fov: 56, lookUp: 0.7, maxD: 4, anchor: 0.3, gh: 1.1 });
    await place(g, BRAZIL, -22, 33, 0, 7);
    await g.sim(1);
    g.rec();
    await leftStick(g, 0, true);
    let pop = -1;
    for (let i = 0; i < 300; i++) {
      const st = await stat(g);
      if (pop < 0 && st.x > E('FP', -16)) {
        mark('flick');
        await leftUp(g);
        // the stick: touch, pull down, then up and to the left, one point per slowed frame
        const pts = [[0, -0.4], [0, -0.8], [0, -1.2], [0, -1.2], [-0.3, -0.3], [-0.6, 0.6], [-1, 1.3]];
        const r = 56, R = { x: 410, y: 700 };
        await g.touch('pointerdown', 2, R.x, R.y);
        for (let k = 0; k < 4; k++) await g.tickSlow(SLOW);
        for (const [x, y] of pts) {
          await g.touch('pointermove', 2, R.x + x * r, R.y - y * r);
          await g.tickSlow(SLOW);
        }
        await g.touch('pointerup', 2, R.x + pts.at(-1)[0] * r, R.y - pts.at(-1)[1] * r);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (st.m === 'bail' && !mark.has('bail')) mark('bail');
      if (mark.has('bail') && g.frame > mark.get('bail') + 45) break;
      if (pop >= 0 && g.frame < pop + SLOW * 6) await g.tickSlow(SLOW);
      else await g.tick();
    }
  },

  // the meter: one kickflip tops it up, the ★ lights, the thumb hits it: Samba Flip
  async meter(g, mark) {
    await specialShot(g, mark, 'samba', { fill: E('FILL', 0.9), pre: true });
  },
  async bullet(g, mark) {
    await specialShot(g, mark, 'bullet', {});
  },
  async world(g, mark) {
    await specialShot(g, mark, 'world', {});
  },
  // the same trick from the chase angle, for a second look
  async world2(g, mark) {
    await specialShot(g, mark, 'world', { side: true, at: E('C_WORLD2', 18) });
  },
  async southern(g, mark) {
    await specialShot(g, mark, 'southern', {});
  },
  // thrown and never caught: the slam empties the meter
  async drop(g, mark) {
    await specialShot(g, mark, 'southern', { nocatch: true });
  },

  // b-roll for "why a button" (as in record.mjs): a 360 laser flip over the Plaza fountain
  async laser(g, mark) {
    await g.director({ d0: 3.4, h0: 1.5, side: 3, k: 0.5, hk: 0.12, fov: 58, lookUp: 0.8, maxD: 7, anchor: 0.5, gh: 1.2 });
    await place(g, PLAZA, 0, 26, -90, 10);
    await g.sim(1);
    g.rec();
    await leftStick(g, 0, true);
    let pop = -1;
    for (let i = 0; i < 160; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z < 7.0) {
        mark('flick');
        await flick(g, [[0, -1.2], ...arc(-90, 200, 10, 1.3)]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && g.frame === pop + 1) await leftSet(g, 1, false);
      if (pop >= 0 && g.frame === pop + 13) { mark('catch'); await tap(g, 480, 880); }
      if (pop >= 0 && g.frame === pop + 26) await leftSet(g, 0, false);
      if (pop >= 0 && st.m === 'ground' && g.frame > pop + 8 && !mark.has('land')) mark('land');
      if (mark.has('land') && g.frame > mark.get('land') + 25) break;
      await g.tick();
    }
  },
  // and a held grab over the Mega Park tabletop, the fingertip on screen
  async mega(g, mark) {
    await g.director({ anchor: 0.85, gh: 1.2, d0: 3.6, h0: 1.3, side: 2.6, k: 0.1, hk: 0.1, fov: 50, lookUp: 0.9, maxD: 5.2 });
    await place(g, MEGA, 29, 16, 0, 12);
    await g.sim(1);
    g.rec();
    let pop = -1, grabbed = false;
    for (let i = 0; i < 220; i++) {
      const st = await stat(g);
      if (pop < 0 && st.x > 41) {
        await flick(g, [[0, -0.8], [0, -1], [0, 0.4], [0, 1.2]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && !grabbed && g.frame === pop + 6) {
        const z = await grabPoint(g, 7);
        if (z) {
          grabbed = true;
          mark('grab');
          await g.finger(true, z.x, z.y);
          await g.touch('pointerdown', 4, z.x, z.y);
        }
      }
      if (grabbed && st.m !== 'air' && g.frame > mark.get('grab') + 6) {
        await g.touch('pointerup', 4, 0, 0);
        await g.finger(false);
        grabbed = false;
        mark('land');
      }
      if (mark.has('land') && g.frame > mark.get('land') + 20) break;
      await g.tick();
    }
  },

  // Career > Skater > Specials, some still locked
  async menu(g, mark) {
    await g.sk(() => {
      const s = window.__skate;
      s.career.totalDone = () => 12;
      s.career.data.special = 'bullet';
      s.ui.showSkater('specials', () => {});
    });
    g.rec();
    for (let i = 0; i < 20; i++) await g.tick();
    mark('end');
  },
};
for (const k in SHOTS) SHOTS[k].late = true;
for (const k of ['meter', 'bullet', 'world', 'world2', 'southern', 'drop']) SHOTS[k].cfg = { special: k === 'meter' ? 'samba' : k === 'drop' ? 'southern' : k === 'world2' ? 'world' : k };

/** catch frame (after the press) per special, tuned with DRY=1 */
const CATCH = { samba: E('C_SAMBA', 10), bullet: E('C_BULLET', 22), world: E('C_WORLD', 16), southern: E('C_SOUTHERN', 14) };

async function specialShot(g, mark, id, { fill = 1, pre = false, nocatch = false, side = false, at = CATCH[id] }) {
  // Around the World is shot from the rider's front, where the hands are
  const front = id === 'world' && !side;
  await g.director({ d0: front ? E('WD', 1.2) : 3.0, h0: 1.4, side: front ? E('WS', 2.6) : 1.6, k: 0.4, hk: 0.12, fov: 56, lookUp: 0.9, maxD: 5, anchor: 0.4, gh: 1.2 });
  await place(g, BRAZIL, -30, 33, 0, 7);
  await g.specials(id, fill);
  await g.sim(1);
  g.rec();
  await leftStick(g, 0, true);
  let pop = -1, fired = -1, landed = -1;
  for (let i = 0; i < 300; i++) {
    const st = await stat(g);
    // the meter shot first lands a kickflip that fills it
    if (pre && pop < 0 && st.x > E('PX', -24)) {
      await flick(g, [[0, -1.2], [-0.6, 0.6], [-1, 1.3]]);
      pop = g.frame;
      mark('kpop');
      continue;
    }
    if (pre && pop >= 0 && !mark.has('kcatch') && g.frame === pop + E('KC', 11)) { mark('kcatch'); await tap(g, 480, 880); }
    if (pre && mark.has('kcatch') && st.m === 'ground' && landed < 0) { landed = g.frame; mark('kland'); }
    const go = pre ? landed >= 0 && g.frame >= landed + E('WAIT', 24) : st.x > E('SX', -24);
    if (fired < 0 && go) {
      leftUp(g);
      mark('star');
      await g.star(3);
      fired = g.frame - 3;
      continue;
    }
    if (fired >= 0 && !nocatch && !mark.has('catch') && g.frame >= fired + at) { mark('catch'); await tap(g, 480, 880); }
    if (fired >= 0 && st.m === 'ground' && g.frame > fired + 6 && !mark.has('land')) mark('land');
    if (st.m === 'bail' && !mark.has('bail')) mark('bail');
    if ((mark.has('land') || mark.has('bail')) && g.frame > (mark.get('land') ?? mark.get('bail')) + (mark.has('bail') ? 50 : 26)) break;
    await g.tick();
  }
}

const riders = { hook: process.env.RIDER ?? 'voss', miss: 'coral', meter: 'brock', bullet: 'coral', world: 'voss', world2: 'coral', southern: 'brock', drop: 'coral', laser: 'coral', mega: 'brock' };
const cams = { hook: 'chase', miss: 'classic', laser: 'classic', mega: 'filmer' };
fs.mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const cfg = SHOTS[name].cfg ?? {};
  const g = await open({ w: 540, h: 960, scale, init: DRY ? null : offlineAudio, state: state(riders[name] ?? 'coral', cams[name] ?? 'chase', cfg.special ?? null) });
  // each captured frame's game-clock time, so the game's sound can be laid under the frames
  // (slowed stretches get it slowed down too)
  const times = [];
  if (!DRY) {
    const tick = g.tick;
    const stamp = async () => { if (g.out) times[g.frame] = await g.sk(() => window.__gt); };
    g.tick = async () => { await tick(); await stamp(); };
    // one slowed game frame = k captured frames of 1/(30k) s each
    g.tickSlow = async (k) => {
      for (let i = 0; i < k; i++) {
        await g.page.evaluate((ms) => { window.__step(ms, true); }, 1000 / 30 / k);
        g.frame++;
        if (g.out) await g.page.screenshot({ path: path.join(g.out, `f${String(g.frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
        await stamp();
      }
    };
  }
  if (DRY) {
    // no frames: screenshots off, the game still steps exactly the same
    const t = g.tick;
    g.tick = async () => { await g.page.evaluate(() => { window.__step(1000 / 60, false); window.__step(1000 / 60, false); }); g.frame++; };
    g.tickSlow = async (k) => { for (let i = 0; i < k; i++) { await g.page.evaluate((ms) => window.__step(ms, false), 1000 / 30 / k); g.frame++; } };
    void t;
  }
  await g.tick();
  const marks = {};
  const mark = (k) => { marks[k] = g.frame; };
  mark.has = (k) => k in marks;
  mark.get = (k) => marks[k];
  g.star = (h) => star(g, h);
  g.specials = (id, f) => specials(g, id, f);
  await g.sk(() => { const k = window.__skate.skater; window.__ev = []; const o = k.events.push.bind(k.events); k.events.push = (...a) => { window.__ev.push(a); return o(...a); }; });
  g.rec = () => { if (!DRY) recordTo(g, path.join(outDir, name)); else g.frame = 0; };
  const t0 = Date.now();
  await SHOTS[name](g, mark);
  if (!DRY) {
    fs.writeFileSync(path.join(outDir, name, 'marks.json'), JSON.stringify({ frames: g.frame, marks, times }));
    await saveAudio(g, path.join(outDir, name, 'audio.wav'));
  }
  if (DRY || process.env.EV) console.log((await g.sk(() => window.__ev.map((e) => { const x = e[0]; return x.type + (x.name ? ':' + x.name : '') + (x.reason ? ':' + x.reason : '') + (x.quality ? ':' + x.quality : '') + (x.tricks ? ' [' + x.tricks.map((t) => t.name).join(' | ') + ']' : '') + (x.record ? ' [' + x.record.name + ']' : ''); }).join('\n'))));
  console.log(name, g.frame, 'frames', JSON.stringify(marks), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  await g.close();
}
