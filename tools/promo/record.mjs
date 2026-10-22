// Records the four promo shots (usage: node record.mjs <outdir> [scale] [shot ...]).
// Each shot is a scripted player; the events it reports (pop, grab, landing...)
// are written next to the frames so compose.py can line the voice up with them.
import fs from 'node:fs';
import path from 'node:path';
import { open, recordTo } from './lib.mjs';
import { stat, leftStick, leftSet, leftUp, flick, arc, tap } from './scenes.mjs';

const [outDir, scaleArg = '2', ...only] = process.argv.slice(2);
const scale = +scaleArg;

const CAM = { chase: 0, classic: 1, overhead: 2, filmer: 3 };
const state = (rider, cam) => ({ 'skate5.tutorial': '1', 'skate5.career.v1': { rider }, 'skate5.options': { camera: CAM[cam] } });
const MEGA = 4;
const BRAZIL = 0;

const place = (g, park, x, z, deg, v) => g.sk(([park, x, z, h, v]) => {
  const s = window.__skate;
  s.startRun(park, 'free');
  s.skater.spawn(x, z, h);
  s.skater.vel.set(Math.cos(h) * v, 0, Math.sin(h) * v);
}, [park, x, z, (deg * Math.PI) / 180, v]);

const MEGACAM = { anchor: 0.85, gh: 1.2, d0: 4, h0: 1.3, side: 3, k: 0.22, hk: 0.12, fov: 54, lookUp: 0.9, maxD: 7, ...JSON.parse(process.env.MEGACAM ?? '{}') };

const marks_bail = (mark) => mark.get('bail');
const SHOTS = {
  // 1. the scientist: ollie onto the 100 m flat rail and grind
  async grind(g, mark) {
    await place(g, MEGA, 24, 79, -90, 6);
    await g.ticks(2);
    await leftStick(g, 0, true);
    let popped = false;
    for (let i = 0; i < 140; i++) {
      const st = await stat(g);
      if (!popped && st.z < 74.4) {
        popped = true;
        mark('pop');
        await flick(g, [[0, -0.8], [0, -1], [0, 0.4], [0, 1.2]]);
        continue;
      }
      if (st.m === 'grind' && !mark.has('grind')) mark('grind');
      await g.tick();
    }
  },

  // 2. the girl: ramp, then a laser flip with a 540 spin
  async laser(g, mark) {
    await g.director({ anchor: 0.7, gh: 1.2, d0: 3.6, h0: 1.6, side: 3.5, k: 0.5, hk: 0.15, fov: 58, lookUp: 0.8, maxD: 9 });
    await place(g, BRAZIL, 0, -40, -90, +(process.env.LV ?? 12.5));
    await g.ticks(2);
    await leftStick(g, 0, true);
    let pop = -1;
    for (let i = 0; i < 140; i++) {
      const st = await stat(g);
      if (pop < 0 && st.m === 'air') {
        mark('flick');
        await flick(g, [[0, -1.2], ...arc(-90, 200, 10, 1.3)]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && g.frame === pop + 1) await leftSet(g, 1, false);
      if (pop >= 0 && g.frame === pop + 16) { mark('catch'); await tap(g); }
      if (pop >= 0 && g.frame === pop + 42) await leftSet(g, 0, false);
      await g.tick();
    }
  },

  // 3. big air off the mega ramp, grabbing the board
  async mega(g, mark) {
    await g.director(MEGACAM);
    await place(g, MEGA, 0, 90, -90, 3);
    for (let i = 0; i < 300 && (await stat(g)).z > 66; i++) await g.sim(1);
    g.rec();
    let pop = -1, grabbed = false;
    for (let i = 0; i < 200; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z < 41.6) {
        await flick(g, [[0, -0.8], [0, -1], [0, 0.4], [0, 1.2]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && !grabbed && g.frame === pop + 12) {
        grabbed = true;
        const z = await g.sk(() => { const z = window.__skate.input.grabZone; return z && z.spot(2); });
        mark('grab');
        if (z) await g.touch('pointerdown', 4, z.x, z.y);
      }
      if (grabbed && g.frame === pop + 56) await g.touch('pointerup', 4, 0, 0);
      await g.tick();
    }
  },

  // 4. same jump, big trick, never catches it
  async bail(g, mark) {
    await g.director(MEGACAM);
    await place(g, MEGA, 0, 90, -90, 3);
    for (let i = 0; i < 300 && (await stat(g)).z > 66; i++) await g.sim(1);
    g.rec();
    let pop = -1;
    for (let i = 0; i < 260; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z < 41.6) {
        await flick(g, [[0, -0.8], [0, -1.2], [-0.6, 0.6], [-1, 1.3]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (st.m === 'bail' && !mark.has('bail')) mark('bail');
      if (mark.has('bail') && g.frame > marks_bail(mark) + 70) break;
      await g.tick();
    }
  },
};

SHOTS.mega.late = SHOTS.bail.late = true;

const riders = { grind: 'voss', laser: 'coral', mega: 'brock', bail: 'voss' };
const cams = { grind: 'chase', laser: 'classic', mega: 'filmer', bail: 'classic', ...JSON.parse(process.env.CAMS ?? '{}') };
fs.mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const g = await open({ w: 540, h: 960, scale, state: state(riders[name], cams[name]) });
  await g.tick();
  const marks = {};
  const mark = (k) => { marks[k] = g.frame; };
  mark.has = (k) => k in marks;
  mark.get = (k) => marks[k];
  await g.sk(() => { const k = window.__skate.skater; window.__ev = []; const o = k.events.push.bind(k.events); k.events.push = (...a) => { window.__ev.push(a); return o(...a); }; });
  g.rec = () => recordTo(g, path.join(outDir, name));
  if (!SHOTS[name].late) g.rec();
  const t0 = Date.now();
  await SHOTS[name](g, mark);
  fs.writeFileSync(path.join(outDir, name, 'marks.json'), JSON.stringify({ frames: g.frame, marks }));
  if (process.env.EV) console.log((await g.sk(() => window.__ev.map((e) => JSON.stringify(e[0])).join('\n'))));
  console.log(name, g.frame, 'frames', JSON.stringify(marks), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  await g.close();
}
