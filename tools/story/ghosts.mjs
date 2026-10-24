// Records the skaters for a story scene (usage: [SCENE=plaza] node ghosts.mjs <out.bin> [line ...]).
// SCENE=opening (the default) is the opening's background park; SCENE=plaza is
// Chapter 2's "film this" skater. Needs the dev server on :5199 (npx vite --port 5199)
// and Playwright, like tools/promo.
// File: u32 header length, JSON header [{name, rider, frames, sfx}], padding to 4 bytes,
// then every clip's frames back to back (Float32, STRIDE floats per frame).
// Each line is a scripted player in Brazil Park; the in-game replay recorder
// samples it at 30 fps and the frames are packed into one file the opening
// plays back on extra riders (see src/opening.ts).
import fs from 'node:fs';
import { open } from '../promo/lib.mjs';
import { stat, leftStick, leftSet, leftUp, flick, arc, tap } from '../promo/scenes.mjs';

const [out, ...only] = process.argv.slice(2);
const E = (k, d) => +(process.env[k] ?? d);
const SCENE = process.env.SCENE ?? 'opening';
const LEVEL = { opening: 0, plaza: 1 }[SCENE];
const OLLIE = [[0, -0.8], [0, -1], [0, 0.4], [0, 1.2]];
const KICKFLIP = [[0, -0.8], [0, -1.2], [-0.6, 0.6], [-1, 1.3]];
const HEEL = [[0, -0.8], [0, -1.2], [0.6, 0.6], [1, 1.3]];
const TRE = [[0, -1.2], ...arc(-90, 200, 8, 1.3)];

const place = (g, x, z, deg, v) => g.sk(([x, z, h, v, lv]) => {
  const s = window.__skate;
  s.startRun(lv, 'free');
  s.skater.spawn(x, z, h);
  s.skater.vel.set(Math.cos(h) * v, 0, Math.sin(h) * v);
  // startRun stops any recording, so the take starts here
  s.recorder.start();
}, [x, z, (deg * Math.PI) / 180, v, LEVEL]);

/** a flip trick: flick, then tap to catch it `ct` frames later */
async function flip(g, pts, ct = 11) {
  await flick(g, pts);
  for (let i = 0; i < ct; i++) await g.tick();
  await tap(g, 480, 880);
}

const OPENING = {
  // 50-50 down the long flat rail, kickflip out
  async rail(g, log) {
    await place(g, 14, E('RZ0', 46), -90, E('RV', 7.5));
    await leftStick(g, 0, true);
    let popped = false, out = false;
    for (let i = 0; i < 240; i++) {
      const st = await stat(g);
      log(st);
      if (!popped && st.z < E('RP', 33.2)) { popped = true; await flick(g, OLLIE); continue; }
      if (popped && !out && st.m === 'grind' && st.z < E('RO', 19)) { out = true; await flip(g, KICKFLIP); continue; }
      if (out && st.m === 'ground' && i > 150) break;
      await g.tick();
    }
  },
  // kickflip over the jump box
  async kicker(g, log) {
    await place(g, -34, E('KZ0', 46), -90, E('KV', 9));
    await leftStick(g, 0, true);
    let popped = false;
    for (let i = 0; i < 200; i++) {
      const st = await stat(g);
      log(st);
      if (!popped && st.z < E('KP', 30.4)) { popped = true; await flip(g, process.env.KT === 'kf' ? KICKFLIP : TRE, E('KC', 12)); continue; }
      if (popped && st.m === 'ground' && i > 120) break;
      await g.tick();
    }
  },
  // straight up the big south quarter pipe, a flip trick in the air above the coping, back in
  async ramp(g, log) {
    await place(g, E('MX', 45), E('MZ0', 52), 90, E('MV', 10));
    await leftStick(g, 0, true);
    let flipped = false, wasAir = false;
    for (let i = 0; i < 240; i++) {
      const st = await stat(g);
      log(st);
      if (!flipped && st.m === 'ground' && st.y > E('MY', 1.7)) { flipped = true; await flip(g, process.env.MT === 'tre' ? TRE : KICKFLIP, E('MC', 12)); continue; }
      if (st.m === 'air') wasAir = true;
      // end on the roll-away, before the fakie roll meets the banks behind
      if (wasAir && i > 150) break;
      await g.tick();
    }
  },
  // kickflip the 6-stair, caught and rolled away
  async stairs(g, log) {
    await place(g, E('SX', 41), -60, 90, E('SV', 12));
    await leftStick(g, 0, true);
    let popped = false;
    for (let i = 0; i < 200; i++) {
      const st = await stat(g);
      log(st);
      if (!popped && st.z > E('SP', -42.2)) { popped = true; await flip(g, KICKFLIP, E('SC', 11)); continue; }
      if (popped && st.m === 'ground' && i > 110) break;
      await g.tick();
    }
  },
  // flat ground: kickflip then heelflip rolling across the front of the park
  async flat(g, log) {
    await place(g, E('FX0', -22), E('FZ', 33), 0, E('FV', 7));
    await leftStick(g, 0, true);
    let n = 0;
    for (let i = 0; i < 240; i++) {
      const st = await stat(g);
      log(st);
      if (n === 0 && st.x > -12) { n++; await flip(g, KICKFLIP); continue; }
      if (n === 1 && st.x > -2 && st.m === 'ground') { n++; await flip(g, HEEL); continue; }
      if (n === 2 && st.x > 8 && st.m === 'ground') { n++; await flip(g, TRE); continue; }
      await g.tick();
    }
  },
};

const LASER = [[0, -1.2], ...arc(-90, 200, 10, 1.3)];
const TREFLIP = [[0, -1.2], ...arc(-90, -380, 8, 1.3)];

const bodySpin = (g) => g.sk(() => window.__skate.skater.bodySpin);

/**
 * Spin the body `deg` degrees in the air (+ = 'd'), holding the steer key until the
 * skater's own count says it's there. Call every air frame; returns true once done.
 */
async function spin(g, st, deg, state) {
  if (!deg || st.m !== 'air') return;
  const done = Math.abs(await bodySpin(g)) >= (Math.abs(deg) * Math.PI) / 180 - 0.12;
  const key = deg > 0 ? 'd' : 'a';
  if (!done && !state.held) { await g.key('keydown', key); state.held = true; }
  if (done && state.held) { await g.key('keyup', key); state.held = false; }
}

/**
 * A kickflip rolling west past the filmer at speed v, popping as it passes x = pop.
 * `spin`: body rotation in the air, degrees. `double`: a higher pop and a faster
 * board, caught after two turns (a flat-ground pop is too short for one otherwise).
 */
async function kickflip(g, log, o) {
  await place(g, E('KX0', 9), o.z ?? 13.6, 180, o.v);
  let popped = false, caught = !o.double;
  const st8 = { held: false };
  for (let i = 0; i < 140; i++) {
    const st = await stat(g);
    log(st);
    await spin(g, st, o.spin, st8);
    if (!popped && st.x < o.pop) {
      popped = true;
      if (o.double) {
        await flick(g, o.flick);
        await g.sk(([up, k]) => { const s = window.__skate.skater; s.vel.y += up; s.trick.flipRate *= k; }, [E('DU', 0.85), E('DK', 1.35)]);
      } else await flip(g, o.flick, o.catch);
      continue;
    }
    if (!caught && (await g.sk(() => window.__skate.skater.trick.flip)) >= 2 * 2 * Math.PI - E('DC', 0.9)) { caught = true; await tap(g, 480, 880); }
    if (popped && st.m === 'ground' && i > 70) break;
    await g.tick();
  }
  if (st8.held) await g.key('keyup', o.spin > 0 ? 'd' : 'a');
}

const PLAZA = {
  // rolls in from the west, coasting, and powerslides to a stop by the filmer
  async rollin(g, log) {
    await place(g, E('IX0', -9), E('IZ', 14.2), 0, E('IV', 5.6));
    let braking = false, still = 0;
    for (let i = 0; i < 150; i++) {
      const st = await stat(g);
      log(st);
      if (!braking && st.x > E('IB', -0.6)) { braking = true; await g.touch('pointerdown', 1, 130, 760); await g.touch('pointermove', 1, 130, 760 + 60); }
      if (braking && st.v < 0.3 && ++still > 12) break;
      await g.tick();
    }
    await leftUp(g);
  },
  // four flat-ground kickflips rolling east to west past the filmer, one per take: the same
  // trick every time, each a little different (pace, pop, flick, a later, sloppier catch)
  // a touch of body twist, a kickflip 180, a twist the other way, then the double that's "too creative"
  kf1: (g, log) => kickflip(g, log, { v: 6.4, pop: 2.2, catch: 11, flick: KICKFLIP, spin: E('S1', 10) }),
  kf2: (g, log) => kickflip(g, log, { v: 6.9, pop: 2.6, catch: 10, flick: [[0, -0.8], [0, -1.2], [-0.5, 0.7], [-0.9, 1.35]], spin: E('S2', 180) }),
  kf3: (g, log) => kickflip(g, log, { v: 6.0, pop: 1.9, catch: 13, flick: [[0, -0.8], [0, -1.2], [-0.7, 0.5], [-1.1, 1.2]], z: 13.75, spin: E('S3', -15) }),
  kf4: (g, log) => kickflip(g, log, { v: 6.6, pop: 2.6, flick: [[0, -0.9], [0, -1.3], [-0.55, 0.65], [-0.95, 1.3]], z: 13.45, double: true }),
  // storms off: from a standstill where he argued, pushing hard away west (back the way he came
  // in), flicks an angry kickflip, never catches it, and slams
  async leave(g, log) {
    await place(g, E('LX0', 2.3), E('LZ', 14.25), 180, E('LV0', 4.2));
    await leftStick(g, 0, true);
    let pop = -1, bail = -1;
    for (let i = 0; i < 150; i++) {
      const st = await stat(g);
      log(st);
      if (pop < 0 && i >= E('LP', 28)) { await leftUp(g); await flick(g, KICKFLIP); pop = i; continue; }
      if (bail < 0 && st.m === 'bail') bail = i;
      if (bail >= 0 && i > bail + E('LB', 40)) break;
      await g.tick();
    }
    await leftUp(g);
  },
  // the big one: 360 laser flip over the fountain, then a 360 flip rolling away
  async final(g, log) {
    await place(g, 0, E('LZ0', 26), -90, E('LV', 10));
    await leftStick(g, 0, true);
    let pop = -1, landed = -1, tre = -1;
    const fs = { held: false };
    for (let i = 0; i < 200; i++) {
      const st = await stat(g);
      log(st);
      if (pop < 0 && st.z < E('LS', 7)) { await flick(g, LASER); pop = g.frame; continue; }
      if (pop === g.frame - 1) await leftUp(g);
      if (pop >= 0 && landed < 0) await spin(g, st, E('FS', 360), fs);
      if (pop >= 0 && g.frame === pop + E('CT', 13)) await tap(g, 480, 880);
      if (pop >= 0 && landed < 0 && st.m === 'ground' && g.frame > pop + 8) {
        landed = g.frame;
        if (fs.held) { await g.key('keyup', 'd'); fs.held = false; }
      }
      if (landed >= 0 && tre < 0 && g.frame > landed + E('TW', 8)) { await flip(g, TREFLIP, E('TC', 12)); tre = g.frame; continue; }
      if (tre >= 0 && st.m === 'ground' && g.frame > tre + 30) break;
      await g.tick();
    }
    await leftUp(g);
  },
};

const LINES = { opening: OPENING, plaza: PLAZA }[SCENE];
// who rides each line: the pose is solved for that body, so playback must use the same rider
const RIDER = { rail: 'coral', kicker: 'brock', ramp: 'voss', stairs: 'brock', flat: 'coral', rollin: 'brock', kf1: 'brock', kf2: 'brock', kf3: 'brock', kf4: 'brock', final: 'brock', leave: 'brock' };
const clips = [];
for (const name of Object.keys(LINES)) {
  if (only.length && !only.includes(name)) continue;
  const g = await open({ w: 540, h: 960, scale: 0.5, state: { 'skate5.tutorial': '1', 'skate5.career.v1': { rider: RIDER[name] } } });
  // let the rider model load before the take starts
  await g.page.waitForFunction(() => window.__skate?.rider?.ready === true, null, { timeout: 60000, polling: 250 });
  await g.tick();
  await g.sk(() => { const k = window.__skate.skater; window.__ev = []; const o = k.events.push.bind(k.events); k.events.push = (...a) => { window.__ev.push(a[0]?.type === 'land' ? 'land ' + (a[0].tricks ?? []).map((t) => t.name).join('+') : a[0]?.type); return o(...a); }; });
  const modes = [];
  const log = (st) => { if (modes[modes.length - 1]?.m !== st.m) modes.push({ f: g.frame, m: st.m, x: st.x, y: st.y, z: st.z }); };
  await LINES[name](g, log);
  const res = await g.sk(() => {
    const r = window.__skate.recorder;
    const n = r.frames;
    return { frames: n, sfx: r.sfx.filter((x) => x.t < n / 30), data: Array.from(r.stop()), ev: window.__ev.filter((e) => e && !/^(push|roll)/.test(e)) };
  });
  console.log(name, res.frames, 'frames', JSON.stringify(modes.map((m) => `${m.f}:${m.m}@${m.x},${m.y},${m.z}`)), res.ev.join(' | '));
  clips.push({ name, rider: RIDER[name], frames: res.frames, sfx: res.sfx, data: res.data });
  await g.close();
}
if (out) {
  const total = clips.reduce((n, c) => n + c.data.length, 0);
  const body = new Float32Array(total);
  let o = 0;
  for (const c of clips) { body.set(c.data, o); o += c.data.length; }
  const head = Buffer.from(JSON.stringify(clips.map((c) => ({ name: c.name, rider: c.rider, frames: c.frames, sfx: c.sfx }))));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length);
  const pad = Buffer.alloc((4 - ((4 + head.length) % 4)) % 4, 32);
  fs.writeFileSync(out, Buffer.concat([len, head, pad, Buffer.from(body.buffer)]));
  console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
}
