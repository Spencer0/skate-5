// Records the four promo shots (usage: node record.mjs <outdir> [scale] [shot ...]).
// Each shot is a scripted player; the events it reports (pop, grab, landing...)
// are written next to the frames so compose.py can line the voice up with them.
import fs from 'node:fs';
import path from 'node:path';
import { open, recordTo } from './lib.mjs';
import { stat, leftStick, leftSet, leftUp, flick, arc, tap, grabPoint } from './scenes.mjs';

const [outDir, scaleArg = '2', ...only] = process.argv.slice(2);
const scale = +scaleArg;

const CAM = { chase: 0, classic: 1, overhead: 2, filmer: 3 };
const state = (rider, cam) => ({ 'skate5.tutorial': '1', 'skate5.career.v1': { rider }, 'skate5.options': { camera: CAM[cam] } });
const MEGA = 4;
const BRAZIL = 0;
const PLAZA = 1;

const place = (g, park, x, z, deg, v) => g.sk(([park, x, z, h, v]) => {
  const s = window.__skate;
  s.startRun(park, 'free');
  s.skater.spawn(x, z, h);
  s.skater.vel.set(Math.cos(h) * v, 0, Math.sin(h) * v);
}, [park, x, z, (deg * Math.PI) / 180, v]);

const MEGACAM = { anchor: 0.85, gh: 1.2, d0: 3.6, h0: 1.3, side: 2.6, k: 0.1, hk: 0.1, fov: 50, lookUp: 0.9, maxD: 5.2, ...JSON.parse(process.env.MEGACAM ?? '{}') };

const marks_bail = (mark) => mark.get('bail');
const SHOTS = {
  // 1. the scientist: kickflip 180 into a slide on the stair rail, laser flip out
  async grind(g, mark) {
    await g.director({ d0: 3.3, h0: 2.0, side: 1.2, k: 0.25, hk: 0.12, fov: 60, lookUp: 0.8, maxD: 6, anchor: 0.3, gh: 1.5 });
    await place(g, MEGA, 82, -60.5, 90, +(process.env.GV ?? 8));
    await g.sim(1);
    g.rec();
    await leftStick(g, 0, true);
    const E = (k, d) => +(process.env[k] ?? d);
    let pop = -1, outAt = -1, outPop = -1;
    for (let i = 0; i < 260; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z > E('GZ', -54.6)) {
        mark('flick');
        await flick(g, [[0, -1.2], [-0.6, 0.6], [-1, 1.3]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && g.frame === pop + E('KS', 1)) await leftSet(g, E('KD', 1), false);
      if (pop >= 0 && g.frame === pop + E('KS', 1) + E('KL', 7)) await leftSet(g, 0, false);
      if (pop >= 0 && g.frame === pop + E('KC', 11)) { mark('catch'); await tap(g, 480, 880); }
      if (st.m === 'grind' && !mark.has('grind')) { mark('grind'); outAt = g.frame + E('OUT', 30); }
      if (outAt > 0 && g.frame === outAt) {
        await flick(g, [[0, -1.2], ...arc(-90, 200, 8, 1.3)]);
        outPop = g.frame;
        mark('out');
        outAt = -2;
        continue;
      }
      if (outPop >= 0 && g.frame === outPop + E('OC', 12)) { mark('ocatch'); await tap(g, 480, 880); }
      if (outPop >= 0 && st.m === 'ground' && g.frame > outPop + 6 && !mark.has('land')) mark('land');
      if (mark.has('land') && g.frame > mark.get('land') + 20) break;
      await g.tick();
    }
  },

  // 2. the girl: laser flip with a 360 spin off the kicker over the Plaza fountain
  async laser(g, mark) {
    await g.director({ d0: 3.4, h0: 1.5, side: 3, k: 0.5, hk: 0.12, fov: 58, lookUp: 0.8, maxD: 7, anchor: 0.5, gh: 1.2 });
    await place(g, PLAZA, 0, +(process.env.LZ0 ?? 26), -90, +(process.env.LV ?? 10));
    await g.sim(1);
    g.rec();
    await leftStick(g, 0, true);
    const start = +(process.env.LS ?? 7.0);
    let pop = -1;
    for (let i = 0; i < 160; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z < start) {
        mark('flick');
        await flick(g, [[0, -1.2], ...arc(-90, 200, 10, 1.3)]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && g.frame === pop + +(process.env.SP ?? 1)) await leftSet(g, 1, false);
      if (pop >= 0 && g.frame === pop + +(process.env.CT ?? 13)) { mark('catch'); await tap(g, 480, 880); }
      if (pop >= 0 && g.frame === pop + +(process.env.SE ?? 26)) await leftSet(g, 0, false);
      if (pop >= 0 && st.m === 'ground' && g.frame > pop + 8 && !mark.has('land')) mark('land');
      if (mark.has('land') && g.frame > mark.get('land') + 25) break;
      await g.tick();
    }
  },

  // 3. tabletop jump: tap and HOLD the board to grab
  async mega(g, mark) {
    await g.director(MEGACAM);
    const E = (k, d) => +(process.env[k] ?? d);
    await place(g, MEGA, E('MX', 29), E('MZ', 16), 0, E('MV', 12));
    await g.sim(1);
    g.rec();
    let pop = -1, grabbed = false;
    for (let i = 0; i < 220; i++) {
      const st = await stat(g);
      if (pop < 0 && st.x > E('MP', 41)) {
        await flick(g, [[0, -0.8], [0, -1], [0, 0.4], [0, 1.2]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (pop >= 0 && !grabbed && g.frame === pop + E('MG', 6)) {
        const z = await grabPoint(g, +(process.env.GRAB ?? 7));
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

  // 4. down the 6-stair at speed, kickflip never caught: the slam
  async bail(g, mark) {
    await g.director({ d0: 3.4, h0: 1.7, side: 2.6, k: 0.2, hk: 0.1, fov: 56, lookUp: 0.8, maxD: 5, anchor: 0.4, gh: 1.2 });
    const E = (k, d) => +(process.env[k] ?? d);
    await place(g, BRAZIL, E('BX', 41), E('BZ', -60), 90, E('BV', 14));
    await g.sim(1);
    g.rec();
    let pop = -1;
    for (let i = 0; i < 260; i++) {
      const st = await stat(g);
      if (pop < 0 && st.z > E('BT', -47.2)) {
        await flick(g, [[0, -0.8], [0, -1.2], [-0.6, 0.6], [-1, 1.3]]);
        pop = g.frame;
        mark('pop');
        continue;
      }
      if (st.m === 'bail' && !mark.has('bail')) mark('bail');
      if (mark.has('bail') && g.frame > mark.get('bail') + 60) break;
      await g.tick();
    }
  },
};

SHOTS.bail.late = true;
SHOTS.grind.late = SHOTS.laser.late = SHOTS.mega.late = true;

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
