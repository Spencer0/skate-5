// Records the background skaters for the story opening (usage: node ghosts.mjs <out.bin> [line ...]).
// Needs the dev server on :5199 (npx vite --port 5199) and Playwright, like tools/promo.
// File: u32 header length, JSON header [{name, rider, frames, sfx}], padding to 4 bytes,
// then every clip's frames back to back (Float32, STRIDE floats per frame).
// Each line is a scripted player in Brazil Park; the in-game replay recorder
// samples it at 30 fps and the frames are packed into one file the opening
// plays back on extra riders (see src/opening.ts).
import fs from 'node:fs';
import { open } from '../promo/lib.mjs';
import { stat, leftStick, leftSet, flick, arc, tap } from '../promo/scenes.mjs';

const [out, ...only] = process.argv.slice(2);
const E = (k, d) => +(process.env[k] ?? d);
const BRAZIL = 0;
const OLLIE = [[0, -0.8], [0, -1], [0, 0.4], [0, 1.2]];
const KICKFLIP = [[0, -0.8], [0, -1.2], [-0.6, 0.6], [-1, 1.3]];
const HEEL = [[0, -0.8], [0, -1.2], [0.6, 0.6], [1, 1.3]];
const TRE = [[0, -1.2], ...arc(-90, 200, 8, 1.3)];

const place = (g, x, z, deg, v) => g.sk(([x, z, h, v]) => {
  const s = window.__skate;
  s.startRun(0, 'free');
  s.skater.spawn(x, z, h);
  s.skater.vel.set(Math.cos(h) * v, 0, Math.sin(h) * v);
  // startRun stops any recording, so the take starts here
  s.recorder.start();
}, [x, z, (deg * Math.PI) / 180, v]);

/** a flip trick: flick, then tap to catch it `ct` frames later */
async function flip(g, pts, ct = 11) {
  await flick(g, pts);
  for (let i = 0; i < ct; i++) await g.tick();
  await tap(g, 480, 880);
}

const LINES = {
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

// who rides each line: the pose is solved for that body, so playback must use the same rider
const RIDER = { rail: 'coral', kicker: 'brock', ramp: 'voss', stairs: 'brock', flat: 'coral' };
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
