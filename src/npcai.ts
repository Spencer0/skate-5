import * as THREE from 'three';
import { Skater, SkaterInput, TUNE } from './skater';
import type { Terrain, Rail, Element } from './terrain';
import type { LevelData } from './levels/common';
import { GRABS, TrickSpec } from './tricks';
import type { GrindMod } from './tricks';
import { SPECIALS } from './career';

/**
 * The brains of the park locals: THPS-style bots that ride the real physics.
 *
 * Every NPC is an ordinary Skater driven by a synthesized SkaterInput plus the
 * same flick / catch / grab calls the touch controls make, so they ride the
 * real terrain, lock onto real rails and land or slam by the same rules as the
 * player. Nothing here touches the scene, the HUD or the score.
 *
 * The level is boiled down to a list of Features (a kicker or launch bank, a
 * quarter pipe, a rail or ledge entry, a gap or stair set, a pipe / bowl /
 * mini ramp to session, the mega ramp), each with a straight run-up line and,
 * where the start is up on a deck, an access route up a bank or a lift ride.
 * A bot picks a feature it can get to without much turning (so one line flows
 * into the next), rides to the run-up, lines up, holds its speed, then pops on
 * cue and plans a trick that fits the air it's about to get: flips (doubles
 * and triples with the air for them), spins up to 900s, grabs, late flips,
 * the odd special when the player is watching. Rails get flip-ins, every
 * grind and slide the sim knows, mid-grind switches, transfers and flip-outs.
 *
 * Each bot has a style (street, vert, tech) that weights which features it
 * likes and which tricks it throws, plus its own skill and slam rate. Features
 * that keep failing (a run-up that clips a wall, a landing into a box) are
 * dropped for the rest of the level.
 *
 * Cheap by construction: thinking runs at 10 Hz (staggered per bot), the
 * ballistic look-ahead runs once per pop, and nothing allocates per step.
 */

export type Rand = () => number;

/** Small seeded PRNG (mulberry32). */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FeatureKind = 'kicker' | 'qp' | 'rail' | 'gap' | 'pipe' | 'mega';

/** A pipe, mini ramp or bowl: somewhere to carve wall to wall. */
export interface Session {
  bowl: boolean;
  /** pipe: a point on the centre line at the start of the overlap, the axis, the across direction */
  ox: number;
  oz: number;
  ax: number;
  az: number;
  nx: number;
  nz: number;
  /** pipe: half the flat's width, the axis length */
  half: number;
  len: number;
  /** bowl: centre, rim radius, flat-bottom radius */
  cx: number;
  cz: number;
  rad: number;
  flat: number;
  /** floor height, wall height above it */
  y0: number;
  H: number;
  /** low enough to carry out over the coping when you're done (else: slip away once nobody's looking) */
  exit: boolean;
}

export interface Lift {
  area: { x0: number; z0: number; x1: number; z1: number };
  to: { x: number; z: number; heading: number };
}

export interface Feature {
  id: number;
  kind: FeatureKind;
  /** what it is, for the stats: kicker, bank, funbox, qp, spine, rail, ledge, gap, stairs, pipe, bowl, miniramp, megaramp */
  tag: string;
  /** run-up start */
  sx: number;
  sz: number;
  /** unit heading of the run-up line */
  dx: number;
  dz: number;
  /** along-line distance from the start to the feature (kicker lip, rail entry, gap edge, QP toe, rim) */
  at: number;
  /** half-width the line can be shifted sideways for variety */
  spread: number;
  /** approach speed */
  speed: number;
  /** ground height on the run-up */
  y0: number;
  /** QP: lip height above y0; rail: rail height above y0 */
  h: number;
  rail: Rail | null;
  /** usable length of the rail (following kinks) */
  railLen: number;
  /** way up to a raised run-up: ride to (x0,z0) on the ground, then straight up a bank to (x1,z1) */
  via: number[] | null;
  /** take one of these lifts to the start */
  lifts: Lift[] | null;
  session: Session | null;
  /** mega ramp: along-line distance to the giant quarter's toe, and its height */
  at2: number;
  h2: number;
  tries: number;
  wins: number;
  off: boolean;
  user: number;
  /** scratch: selection weight */
  w: number;
}

const TAU = Math.PI * 2;
const UPV = new THREE.Vector3(0, 1, 0);

function wrapPi(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** How far out the bots may ride: the level's bounds, or its perimeter walls when those are further out. */
export function npcLimit(t: Terrain) {
  let wall = Infinity;
  let n = 0;
  for (const e of t.elements) {
    if (e.mat !== 'wall' || Math.max(e.hx, e.hz) < 50) continue;
    const inner = e.hx > e.hz ? Math.abs(e.cz) - e.hz : Math.abs(e.cx) - e.hx;
    wall = Math.min(wall, inner);
    n++;
  }
  return n >= 4 && isFinite(wall) ? Math.max(t.bounds, wall) : t.bounds;
}

const LATS = [-0.35, 0, 0.35];

/** A clear, flat run-up from (x,z) along (dx,dz) for `len` metres at height y0 (no walls, no rails in the way). */
function clearRun(t: Terrain, lim: number, x: number, z: number, dx: number, dz: number, len: number, y0: number, skip: Rail | null) {
  const px = -dz;
  const pz = dx;
  for (let d = 0; d <= len; d += 0.5) {
    for (const lat of LATS) {
      const h = t.height(x + dx * d + px * lat, z + dz * d + pz * lat);
      if (Math.abs(h - y0) > 0.03) return false;
    }
  }
  const ex = x + dx * len;
  const ez = z + dz * len;
  for (const r of t.rails) {
    if (r === skip || r.kind !== 'rail') continue;
    if (segHit(x, z, ex, ez, r.a.x, r.a.z, r.b.x, r.b.z, 0.4)) return false;
  }
  return Math.abs(x) < lim - 3 && Math.abs(z) < lim - 3 && !wet(t, x, z);
}

/** Can you roll straight from A to B (ramps up are fine, walls and big drops aren't)? */
function rideLine(t: Terrain, x0: number, z0: number, x1: number, z1: number) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(L / 0.3));
  let prev = t.height(x0, z0);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const x = x0 + (x1 - x0) * k;
    const z = z0 + (z1 - z0) * k;
    const h = t.height(x, z);
    if (h - prev > 0.08 || prev - h > 0.3 || wet(t, x, z)) return false;
    prev = h;
  }
  for (const r of t.rails) {
    if (r.kind !== 'rail') continue;
    if (segHit(x0, z0, x1, z1, r.a.x, r.a.z, r.b.x, r.b.z, 0.4)) return false;
  }
  return true;
}

/** Would you be in the water here? */
export function wet(t: Terrain, x: number, z: number) {
  const w = t.waterAt(x, z);
  return w !== null && t.height(x, z) < w;
}

function ptSeg(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1e-9;
  const s = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(ax + vx * s - px, az + vz * s - pz);
}

/** Do 2D segments p0p1 and q0q1 come within `pad` of each other (approximately)? */
function segHit(p0x: number, p0z: number, p1x: number, p1z: number, q0x: number, q0z: number, q1x: number, q1z: number, pad: number) {
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const c1 = cross(p0x, p0z, p1x, p1z, q0x, q0z);
  const c2 = cross(p0x, p0z, p1x, p1z, q1x, q1z);
  const c3 = cross(q0x, q0z, q1x, q1z, p0x, p0z);
  const c4 = cross(q0x, q0z, q1x, q1z, p1x, p1z);
  if (c1 * c2 < 0 && c3 * c4 < 0) return true;
  return Math.min(ptSeg(p0x, p0z, p1x, p1z, q0x, q0z), ptSeg(p0x, p0z, p1x, p1z, q1x, q1z), ptSeg(q0x, q0z, q1x, q1z, p0x, p0z), ptSeg(q0x, q0z, q1x, q1z, p1x, p1z)) < pad;
}

const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) < 0.0025;

/** Rail length from `start` along `r`, following kinks onto continuing rails (negative: it runs on uphill, where you'd stall). */
function chainLength(rails: Rail[], r: Rail, fromA: boolean) {
  let len = 0;
  let uphill = false;
  let cur = r;
  let a = fromA;
  for (let i = 0; i < 8; i++) {
    len += cur.len;
    const end = a ? cur.b : cur.a;
    const dir = a ? cur.dir : cur.dir.clone().negate();
    let next: Rail | null = null;
    for (const q of rails) {
      if (q === cur) continue;
      // (an uphill continuation is where you'd stall: the usable rail ends there)
      if (near(q.a, end) && q.dir.dot(dir) > 0.5 && q.dir.y < 0.02) {
        next = q;
        a = true;
        break;
      }
      if (near(q.b, end) && -q.dir.dot(dir) > 0.5 && -q.dir.y < 0.02) {
        next = q;
        a = false;
        break;
      }
    }
    if (!next) {
      for (const q of rails) if (q !== cur && (near(q.a, end) || near(q.b, end)) && (near(q.a, end) ? q.dir : q.dir.clone().negate()).dot(dir) > 0.5) uphill = true;
      break;
    }
    cur = next;
  }
  return uphill ? -len : len;
}

/** Highest rail the bots will try to ollie onto (m above the run-up). */
export function maxRailHeight() {
  const pv = TUNE.popSpeed * RAIL_POP;
  return (pv * pv) / (2 * TUNE.gravity) - 0.1;
}
/** pop speed factor of a snappy (speed 1.2) flick, which the bots use for the tall rails */
const RAIL_POP = 0.94 + 0.1 * ((1.2 - 0.85) / 0.35);

/** Top speed you can push to on the flat. */
const PUSH_TOP = TUNE.pushMaxSpeed - 0.3;

/** Walk up a ramp from its toe along (dx,dz): where the rise stops (lip), how high, and how steep it is there. */
function profile(t: Terrain, x: number, z: number, dx: number, dz: number, max: number) {
  const y0 = t.height(x - dx * 0.3, z - dz * 0.3);
  let prev = t.height(x, z);
  let lip = -1;
  for (let s = 0.05; s < max; s += 0.05) {
    const h = t.height(x + dx * s, z + dz * s);
    if (h - prev > 0.3) break; // a wall
    if (h <= prev + 1e-4 && s > 0.3) {
      lip = s - 0.05;
      break;
    }
    prev = h;
  }
  if (lip < 0) return null;
  const H = t.height(x + dx * lip, z + dz * lip) - y0;
  const slope = (H + y0 - t.height(x + dx * (lip - 0.05), z + dz * (lip - 0.05))) / 0.05;
  return { lip, H, y0, ny: 1 / Math.sqrt(1 + slope * slope) };
}

/** Everything in a level a bot can session, with a clear straight run-up to each. */
export function buildFeatures(t: Terrain, data: LevelData): Feature[] {
  const lim = npcLimit(t);
  const out: Feature[] = [];
  type New = Pick<Feature, 'kind' | 'tag' | 'sx' | 'sz' | 'dx' | 'dz' | 'at' | 'speed' | 'y0'> & Partial<Feature>;
  const add = (f: New) => {
    // one feature per lift-fed start, reachable from every lift that goes there
    if (f.lifts) {
      const same = out.find((q) => q.lifts && q.kind === f.kind && Math.hypot(q.sx - f.sx, q.sz - f.sz) < 1);
      if (same) {
        same.lifts!.push(...f.lifts);
        return same;
      }
    }
    const full: Feature = { spread: 0, h: 0, rail: null, railLen: 0, via: null, lifts: null, session: null, at2: -1, h2: 0, ...f, id: out.length, tries: 0, wins: 0, off: false, user: -1, w: 0 };
    out.push(full);
    return full;
  };
  const runUp = (x: number, z: number, dx: number, dz: number, y0: number, skip: Rail | null, runs: number[]) => {
    for (const run of runs) {
      const sx = x - dx * run;
      const sz = z - dz * run;
      if (clearRun(t, lim, sx, sz, dx, dz, run - 0.4, y0, skip)) return run;
    }
    return -1;
  };

  /** How far the run-up line can be shifted sideways and stay clear (rails, boxes, the ramp's own edge). */
  function clearSpread(x: number, z: number, dx: number, dz: number, run: number, y0: number, max: number) {
    for (let sp = max; sp > 0.25; sp -= 0.5) {
      let ok = true;
      for (const k of [-1, -0.5, 0.5, 1]) {
        const ox = -dz * sp * k;
        const oz = dx * sp * k;
        // the toe has to be on the ramp there too
        if (Math.abs(t.height(x + ox + dx * 0.5, z + oz + dz * 0.5) - y0) < 0.003 || !clearRun(t, lim, x + ox - dx * run, z + oz - dz * run, dx, dz, run - 0.4, y0, null)) {
          ok = false;
          break;
        }
      }
      if (ok) return sp;
    }
    return 0;
  }

  /* --- launch ramps: kickers, banks, funbox sides; quarter pipes --- */
  for (const e of t.elements) {
    if (e.kind === 'kicker' || e.kind === 'bank' || e.kind === 'qp') {
      const toeX = e.cx - e.c * e.hx;
      const toeZ = e.cz - e.s * e.hx;
      ramp(e, toeX, toeZ, e.c, e.s, e.hz);
    } else if (e.kind === 'funbox') {
      for (let k = 0; k < 4; k++) {
        const a = e.rot + (k * Math.PI) / 2;
        const dx = -Math.cos(a);
        const dz = -Math.sin(a);
        const ext = k % 2 === 0 ? e.hx : e.hz;
        const w = k % 2 === 0 ? e.hz : e.hx;
        ramp(e, e.cx - dx * ext, e.cz - dz * ext, dx, dz, w * 0.6);
      }
    }
  }
  function ramp(e: Element, toeX: number, toeZ: number, dx: number, dz: number, halfW: number) {
    const p = profile(t, toeX, toeZ, dx, dz, 16);
    if (!p) return;
    const y0 = p.y0;
    if (Math.abs(t.height(toeX + dx * 0.02, toeZ + dz * 0.02) - y0) > 0.06) return; // toe isn't at ground level
    let spread = Math.max(0, halfW - 1.1) * 0.7;
    const lipX = toeX + dx * p.lip;
    const lipZ = toeZ + dz * p.lip;
    if (e.kind === 'qp') {
      // only what you can reach pushing on the flat; the big ones are pipe / mega ramp business
      if (p.H > 2.5 || p.H < 0.6) return;
      const behind = t.height(lipX + dx * 0.6, lipZ + dz * 0.6);
      const spine = behind < p.H + y0 - 0.35;
      const vert = p.ny < 0.72;
      const run = runUp(toeX, toeZ, dx, dz, y0, null, [10, 8, 6.5]);
      if (run < 0) return;
      // vert lips send you straight back down: go fast. Mellow ones you'd fly off: just get there.
      const speed = vert || spine ? PUSH_TOP : Math.min(PUSH_TOP, Math.sqrt(2 * TUNE.gravity * (p.H + 0.6)));
      spread = clearSpread(toeX, toeZ, dx, dz, run, y0, spread);
      add({ kind: 'qp', tag: spine ? 'spine' : 'qp', sx: toeX - dx * run, sz: toeZ - dz * run, dx, dz, at: run, spread, speed, y0, h: p.H });
      return;
    }
    if (p.H < 0.35 || p.H > 1.7) return;
    // what's past the lip: a wall is no good; a deck or a drop is a launch
    for (const d of [0.5, 1.5, 3, 4.5, 6]) {
      if (t.height(lipX + dx * d, lipZ + dz * d) > p.H + y0 + 0.12) return;
    }
    const run = runUp(toeX, toeZ, dx, dz, y0, null, [10, 8, 6.5]);
    if (run < 0) return;
    const tag = e.kind === 'kicker' ? 'kicker' : e.kind === 'funbox' ? 'funbox' : 'bank';
    spread = clearSpread(toeX, toeZ, dx, dz, run, y0, spread);
    add({ kind: 'kicker', tag, sx: toeX - dx * run, sz: toeZ - dz * run, dx, dz, at: run + p.lip, spread, speed: Math.min(PUSH_TOP, 6.6 + p.H * 0.8), y0, h: p.H });
  }

  /* --- rails and ledges --- */
  const maxH = maxRailHeight();
  for (const r of t.rails) {
    for (const fromA of [true, false]) {
      const E = fromA ? r.a : r.b;
      const O = fromA ? r.b : r.a;
      let dx = O.x - E.x;
      let dz = O.z - E.z;
      const hl = Math.hypot(dx, dz);
      if (hl < 0.5) continue;
      dx /= hl;
      dz /= hl;
      if ((O.y - E.y) / hl > 0.02) continue; // uphill
      // mid-chain joints of kinked rails aren't entries
      if (t.rails.some((q) => q !== r && (near(q.a, E) || near(q.b, E)))) continue;
      const len = chainLength(t.rails, r, fromA);
      if (len < 2.4) continue; // short, or it runs on up a hubba / stair rail
      const y0 = t.height(E.x - dx * 0.7, E.z - dz * 0.7);
      const h = E.y - y0;
      if (h < 0.1 || h > maxH) continue;
      const run = runUp(E.x, E.z, dx, dz, y0, r, [9, 7, 5.5]);
      if (run < 0) continue;
      add({ kind: 'rail', tag: r.kind, sx: E.x - dx * run, sz: E.z - dz * run, dx, dz, at: run, speed: Math.min(6.2, 4.4 + len * 0.12), y0, h, rail: r, railLen: len });
    }
  }

  /* --- gaps and stair sets: pop off an edge --- */
  const edges: { x: number; z: number; dx: number; dz: number }[] = [];
  const edge = (ex: number, ez: number, dx: number, dz: number, tag: string, lats: number[], speed: number) => {
    const px = -dz;
    const pz = dx;
    for (const lat of lats) {
      const x = ex + px * lat;
      const z = ez + pz * lat;
      if (edges.some((q) => Math.hypot(q.x - x, q.z - z) < 2.5 && q.dx * dx + q.dz * dz > 0.9)) return;
      const y0 = t.height(x - dx * 0.3, z - dz * 0.3);
      // there has to be a drop (or a gap) out front
      if (t.height(x + dx * 1.2, z + dz * 1.2) > y0 - 0.25) continue;
      const run = runUp(x, z, dx, dz, y0, null, [9, 7]);
      if (run < 0) continue;
      edges.push({ x, z, dx, dz });
      add({ kind: 'gap', tag, sx: x - dx * run, sz: z - dz * run, dx, dz, at: run, speed, y0 });
      return;
    }
  };
  for (const e of t.elements) {
    if (e.kind !== 'stairs') continue;
    // stairs descend along +u from the top edge at u = -hx
    edge(e.cx - e.c * e.hx, e.cz - e.s * e.hx, e.c, e.s, 'stairs', [0, 1.8, -1.8, 3.2, -3.2].filter((l) => Math.abs(l) < e.hz - 0.8), 7.6);
  }
  const seen = new Set<string>();
  for (const g of data.gaps) {
    if (seen.has(g.id)) continue;
    const fx = (g.from.x0 + g.from.x1) / 2;
    const fz = (g.from.z0 + g.from.z1) / 2;
    let dx = (g.to.x0 + g.to.x1) / 2 - fx;
    let dz = (g.to.z0 + g.to.z1) / 2 - fz;
    const l = Math.hypot(dx, dz);
    if (l < 1) continue;
    dx /= l;
    dz /= l;
    // where the line leaves the take-off zone
    let exit = 0;
    while (exit < 40 && fx + dx * exit >= g.from.x0 && fx + dx * exit <= g.from.x1 && fz + dz * exit >= g.from.z0 && fz + dz * exit <= g.from.z1) exit += 0.1;
    const n = out.length;
    edge(fx + dx * exit, fz + dz * exit, dx, dz, 'gap', [0, 1.5, -1.5, 3, -3], 7.2);
    if (out.length > n) seen.add(g.id);
  }

  /* --- pipes, mini ramps and bowls to session --- */
  const qps = t.elements.filter((e) => e.kind === 'qp');
  for (let i = 0; i < qps.length; i++) {
    for (let j = i + 1; j < qps.length; j++) {
      const A = qps[i];
      const B = qps[j];
      if (A.c * B.c + A.s * B.s > -0.99) continue;
      const tAx = A.cx - A.c * A.hx;
      const tAz = A.cz - A.s * A.hx;
      const tBx = B.cx - B.c * B.hx;
      const tBz = B.cz - B.s * B.hx;
      const w = -((tBx - tAx) * A.c + (tBz - tAz) * A.s);
      if (w < 3 || w > 20) continue; // facing away from each other, a rideable flat between (spines rise toward each other)
      // A on the + side of the across direction, so session walls are B (-) and A (+)
      const nx = A.c;
      const nz = A.s;
      const ax = -nz;
      const az = nx;
      const pa = tAx * ax + tAz * az;
      const pb = tBx * ax + tBz * az;
      const lo = Math.max(pa - A.hz, pb - B.hz);
      const hi = Math.min(pa + A.hz, pb + B.hz);
      if (hi - lo < 12) continue;
      const mx = (tAx + tBx) / 2;
      const mz = (tAz + tBz) / 2;
      // centre line point at axis position lo
      const k = lo - (mx * ax + mz * az);
      const ox = mx + ax * k;
      const oz = mz + az * k;
      const y0 = t.height(ox + ax * (hi - lo) * 0.5, oz + az * (hi - lo) * 0.5);
      const HA = A.h(A.hx - 0.01, 0) - y0;
      const HB = B.h(B.hx - 0.01, 0) - y0;
      const ses: Session = { bowl: false, ox, oz, ax, az, nx, nz, half: w / 2, len: hi - lo, cx: 0, cz: 0, rad: 0, flat: 0, y0, H: Math.min(HA, HB), exit: Math.min(HA, HB) < 2.6 };
      if (ses.H < 1) continue;
      const tag = ses.H > 4 ? 'pipe' : 'miniramp';
      // a drop-in at one end, fed by a lift
      for (const e of t.elements) {
        if (e.kind !== 'rollin') continue;
        const ddx = -e.c;
        const ddz = -e.s;
        const along = ddx * ax + ddz * az;
        if (Math.abs(along) < 0.98) continue;
        const toeX = e.cx - e.c * e.hx;
        const toeZ = e.cz - e.s * e.hx;
        const ta = (toeX - ox) * ax + (toeZ - oz) * az;
        const tn = (toeX - ox) * nx + (toeZ - oz) * nz;
        if (Math.abs(tn) > ses.half || ta < -3 || ta > ses.len + 3) continue;
        for (const L of data.lifts ?? []) {
          const lx = L.to.x - e.cx;
          const lz = L.to.z - e.cz;
          if (Math.abs(lx * e.c + lz * e.s) > e.hx + 8 || Math.abs(-lx * e.s + lz * e.c) > e.hz) continue;
          const at = (L.to.x - toeX) * -ddx + (L.to.z - toeZ) * -ddz;
          add({ kind: 'pipe', tag, sx: L.to.x, sz: L.to.z, dx: ddx, dz: ddz, at, speed: 4, y0: t.height(L.to.x, L.to.z), h: ses.H, lifts: [{ area: L.area, to: L.to }], session: ses });
        }
      }
      // in from an open end, if you can push fast enough for the walls
      if (ses.H <= 2.4) {
        for (const end of [0, 1]) {
          const sg = end === 0 ? 1 : -1;
          const ex = ox + ax * (end === 0 ? 0 : ses.len);
          const ez = oz + az * (end === 0 ? 0 : ses.len);
          const run = runUp(ex, ez, ax * sg, az * sg, y0, null, [9, 7]);
          if (run < 0) continue;
          add({ kind: 'pipe', tag, sx: ex - ax * sg * run, sz: ez - az * sg * run, dx: ax * sg, dz: az * sg, at: run, speed: PUSH_TOP, y0, h: ses.H, session: ses });
        }
      }
    }
  }
  for (const b of t.bowls) {
    // a bowl you can't pump up to the coping is just a hole you'd be stuck in
    if (b.depth > 4 || b.flat > 7.5) continue;
    const ses: Session = { bowl: true, ox: 0, oz: 0, ax: 0, az: 0, nx: 0, nz: 0, half: 0, len: 0, cx: b.cx, cz: b.cz, rad: b.radius, flat: b.flat, y0: -b.depth, H: b.depth, exit: true };
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const dx = -Math.cos(a);
      const dz = -Math.sin(a);
      const rx = b.cx - dx * b.radius;
      const rz = b.cz - dz * b.radius;
      const y0 = t.height(rx - dx * 0.5, rz - dz * 0.5);
      if (Math.abs(y0) > 0.02) continue;
      const run = runUp(rx, rz, dx, dz, y0, null, [8, 6]);
      if (run < 0) continue;
      add({ kind: 'pipe', tag: 'bowl', sx: rx - dx * run, sz: rz - dz * run, dx, dz, at: run, speed: 5.5, y0, h: b.depth, session: ses });
    }
  }

  /* --- the mega ramp: lift to the tower, roll in, kicker, gap, giant quarter --- */
  for (const e of t.elements) {
    if (e.kind !== 'rollin' || e.h(e.hx - 0.01, 0) < 15) continue;
    const dx = -e.c;
    const dz = -e.s;
    for (const L of data.lifts ?? []) {
      const lx = L.to.x - e.cx;
      const lz = L.to.z - e.cz;
      if (Math.abs(-lx * e.s + lz * e.c) > e.hz || lx * e.c + lz * e.s < e.hx - 1) continue;
      let at = -1;
      let at2 = -1;
      let h2 = 0;
      for (const k of t.elements) {
        const along = (k.cx - L.to.x) * dx + (k.cz - L.to.z) * dz;
        const lat = Math.abs(-(k.cx - L.to.x) * dz + (k.cz - L.to.z) * dx);
        if (lat > 2 || along < 0 || k.c * dx + k.s * dz < 0.98) continue;
        if (k.kind === 'kicker' && at < 0) at = along + k.hx;
        if (k.kind === 'qp' && (at2 < 0 || along - k.hx < at2)) {
          at2 = along - k.hx;
          h2 = k.h(k.hx - 0.01, 0) - t.height(k.cx - k.c * (k.hx + 0.5), k.cz - k.s * (k.hx + 0.5));
        }
      }
      if (at < 0) continue;
      add({ kind: 'mega', tag: 'megaramp', sx: L.to.x, sz: L.to.z, dx, dz, at, speed: 4, y0: t.height(L.to.x, L.to.z), h: 0, lifts: [{ area: L.area, to: L.to }], at2, h2, spread: 1 });
    }
  }

  transfersFor(t);

  /* --- raised run-ups: find the bank up onto the deck --- */
  for (const f of out) {
    if (f.lifts || f.y0 < t.floor + 0.3) continue;
    f.via = accessRoute(t, f);
  }
  return out;
}

/** A bank from the ground up onto the deck a raised run-up starts on, and the line up it. */
function accessRoute(t: Terrain, f: Feature): number[] | null {
  let best: number[] | null = null;
  let bestD = Infinity;
  for (const e of t.elements) {
    if (e.kind !== 'bank' && e.kind !== 'rollin') continue;
    const top = e.h(e.hx - 0.01, 0);
    if (Math.abs(top - f.y0) > 0.06) continue;
    const toeX = e.cx - e.c * e.hx;
    const toeZ = e.cz - e.s * e.hx;
    const p = profile(t, toeX, toeZ, e.c, e.s, 2 * e.hx + 1);
    if (!p || p.ny < 0.94) continue; // too steep to push up
    if (e.hz < 1.5) continue;
    for (const v of [0, -(e.hz - 1.5) * 0.5, (e.hz - 1.5) * 0.5, 1.5 - e.hz, e.hz - 1.5]) {
      const bx = toeX - e.s * v;
      const bz = toeZ + e.c * v;
      const x0 = bx - e.c * 4;
      const z0 = bz - e.s * 4;
      const x1 = bx + e.c * (p.lip + 1.5);
      const z1 = bz + e.s * (p.lip + 1.5);
      const g0 = t.height(toeX - e.c * 0.3, toeZ - e.s * 0.3);
      if (g0 > f.y0 - 0.3 || Math.abs(t.height(x0, z0) - g0) > 0.03 || Math.abs(t.height(x1, z1) - f.y0) > 0.03) continue;
      const d = Math.hypot(f.sx - x1, f.sz - z1);
      if (d > bestD || !rideLine(t, x0, z0, x1, z1)) continue;
      if (rideLine(t, x1, z1, f.sx, f.sz)) {
        bestD = d;
        best = [x0, z0, x1, z1];
        continue;
      }
      // something on the deck in the way: carry on straight a bit first
      for (const k of [3, 6, 9]) {
        const x2 = x1 + e.c * k;
        const z2 = z1 + e.s * k;
        if (Math.abs(t.height(x2, z2) - f.y0) > 0.03 || !rideLine(t, x1, z1, x2, z2) || !rideLine(t, x2, z2, f.sx, f.sz)) continue;
        bestD = d + k;
        best = [x0, z0, x1, z1, x2, z2];
        break;
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

export type StyleId = 'street' | 'vert' | 'tech';

interface Style {
  id: StyleId;
  /** how much it likes each kind of feature */
  like: Record<FeatureKind, number>;
  /** seconds between flatground tricks while cruising */
  flat: [number, number];
  /** chance a flat trick is followed straight away by another (a flatground line) */
  flatLine: number;
  /** air-trick tastes, 0..1 */
  spin: number;
  flip: number;
  grab: number;
  late: number;
  /** grinds: angled / slide lock-ins, nose/tail mods, switching mods, flip-ins, transfers */
  angled: number;
  slide: number;
  mods: number;
  switchMod: number;
  flipIn: number;
  transfer: number;
  /** flip pool */
  flips: [TrickSpec, number][];
  /** how big it goes */
  risk: number;
  /** walls per pipe / bowl session */
  hits: [number, number];
}

const sp = (flip: number, shove: number, wrap: number, label: string, nollie = false): TrickSpec => ({ flip, shove, wrap, nollie, speed: 1, label });
const OLLIE = sp(0, 0, 0, 'Ollie');
const OLLIE_N = sp(0, 0, 0, 'Nollie', true);
const KICK = sp(1, 0, 0, 'Kickflip');
const HEEL = sp(-1, 0, 0, 'Heelflip');
const SHOVE = sp(0, -1, 0, 'Pop Shove-it');
const FS_SHOVE = sp(0, 1, 0, 'FS Pop Shove-it');
const VARIAL = sp(1, -1, 0, 'Varial Kickflip');
const VARIAL_H = sp(-1, 1, 0, 'Varial Heelflip');
const HARD = sp(1, 1, 0, 'Hardflip');
const INWARD = sp(-1, -1, 0, 'Inward Heelflip');
const TRE = sp(1, -2, 0, '360 Flip');
const LASER = sp(-1, 2, 0, 'Laser Flip');
const SHOVE360 = sp(0, -2, 0, '360 Shove-it');
const IMPOSSIBLE = sp(0, 0, 1, 'Impossible');
const N_KICK = sp(1, 0, 0, 'Nollie Kickflip', true);
const N_HEEL = sp(-1, 0, 0, 'Nollie Heelflip', true);
const N_SHOVE = sp(0, 1, 0, 'Nollie Shove-it', true);
const N_TRE = sp(1, -2, 0, 'Nollie 360 Flip', true);

const STYLES: Record<StyleId, Style> = {
  street: {
    id: 'street',
    like: { kicker: 1.0, qp: 0.5, rail: 2.2, gap: 1.7, pipe: 0.3, mega: 0.7 },
    flat: [2.5, 5],
    flatLine: 0.2,
    spin: 0.3,
    flip: 0.8,
    grab: 0.25,
    late: 0.25,
    angled: 0.3,
    slide: 0.35,
    mods: 0.55,
    switchMod: 0.35,
    flipIn: 0.4,
    transfer: 0.6,
    flips: [
      [KICK, 5],
      [HEEL, 3],
      [SHOVE, 2],
      [FS_SHOVE, 2],
      [VARIAL, 2],
      [TRE, 2.5],
      [HARD, 1.5],
      [INWARD, 1],
      [VARIAL_H, 1],
      [N_KICK, 1.2],
      [N_SHOVE, 1],
      [SHOVE360, 1],
    ],
    risk: 1,
    hits: [2, 3],
  },
  vert: {
    id: 'vert',
    like: { kicker: 1.2, qp: 2.4, rail: 0.5, gap: 0.6, pipe: 3.2, mega: 3.4 },
    flat: [4, 8],
    flatLine: 0.05,
    spin: 0.75,
    flip: 0.45,
    grab: 0.8,
    late: 0.3,
    angled: 0.25,
    slide: 0.3,
    mods: 0.3,
    switchMod: 0.15,
    flipIn: 0.15,
    transfer: 0.2,
    flips: [
      [KICK, 4],
      [HEEL, 3],
      [VARIAL, 2],
      [TRE, 1.5],
      [SHOVE, 1],
      [IMPOSSIBLE, 1.5],
      [HARD, 1],
      [VARIAL_H, 1],
    ],
    risk: 1.15,
    hits: [4, 8],
  },
  tech: {
    id: 'tech',
    like: { kicker: 1.3, qp: 0.8, rail: 1.5, gap: 1.1, pipe: 0.8, mega: 1.0 },
    flat: [1.2, 3],
    flatLine: 0.5,
    spin: 0.4,
    flip: 0.95,
    grab: 0.3,
    late: 0.55,
    angled: 0.4,
    slide: 0.3,
    mods: 0.7,
    switchMod: 0.6,
    flipIn: 0.6,
    transfer: 0.4,
    flips: [
      [KICK, 2],
      [HEEL, 2],
      [TRE, 3],
      [LASER, 1.5],
      [HARD, 2],
      [INWARD, 2],
      [VARIAL, 1.5],
      [VARIAL_H, 1.5],
      [SHOVE360, 1.5],
      [IMPOSSIBLE, 1],
      [N_KICK, 1.2],
      [N_HEEL, 1],
      [N_TRE, 1],
      [N_SHOVE, 1],
      [FS_SHOVE, 1],
    ],
    risk: 0.95,
    hits: [2, 4],
  },
};
export const STYLE_IDS: StyleId[] = ['street', 'vert', 'tech'];

/** single quick flips for late tricks and grind exits */
const QUICK: [TrickSpec, number][] = [
  [SHOVE, 3],
  [FS_SHOVE, 2],
  [KICK, 3],
  [HEEL, 2],
  [VARIAL, 1],
  [TRE, 1],
  [SHOVE360, 0.8],
];
const FLIP_INS: [TrickSpec, number][] = [
  [KICK, 4],
  [HEEL, 2],
  [SHOVE, 2],
  [FS_SHOVE, 2],
  [VARIAL, 1],
  [TRE, 0.6],
];

function pickWeighted<T>(r: Rand, list: [T, number][]): T {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let x = r() * sum;
  for (const [v, w] of list) {
    x -= w;
    if (x <= 0) return v;
  }
  return list[list.length - 1][0];
}

/** Specs at a flick speed, made once (no allocation when a bot pops). */
const SPEEDS = [1, 1.1, 1.2];
const specCache = new Map<TrickSpec, TrickSpec[]>();
function atSpeed(s: TrickSpec, k: number) {
  let arr = specCache.get(s);
  if (!arr) specCache.set(s, (arr = SPEEDS.map((v) => ({ ...s, speed: v }))));
  return arr[k];
}
const SPECIAL_SPECS: TrickSpec[] = SPECIALS.map((s) => ({ flip: s.flip, shove: s.shove, wrap: s.wrap, nollie: false, speed: 1.5, label: s.name, special: s.name }));

/** Where the air is coming from: shapes which tricks fit. */
type AirCtx = 'flat' | 'ramp' | 'vert' | 'grind' | 'drop' | 'big';

/** What the bot will do with the air it's about to get. */
interface AirPlan {
  spec: TrickSpec;
  /** airTime to catch at (-1: never: a planned slam) */
  catchAt: number;
  grab: number;
  grabFrom: number;
  grabUntil: number;
  /** body spin target (rad, signed like Skater.bodySpin) */
  spin: number;
  /** stop the spin short (a planned sideways slam) */
  spinFail: boolean;
  /** a second flip later in the same air */
  late: TrickSpec | null;
  lateAt: number;
  lateCatch: number;
  /** we're in the catch window of the late flip */
  lateOn: boolean;
}

function resetPlan(p: AirPlan): AirPlan {
  p.spec = OLLIE;
  p.catchAt = 0;
  p.grab = -1;
  p.grabFrom = 0;
  p.grabUntil = 0;
  p.spin = 0;
  p.spinFail = false;
  p.late = null;
  p.lateAt = 0;
  p.lateCatch = 0;
  p.lateOn = false;
  return p;
}

/* ------------------------------------------------------------------ */
/* Rail transfers                                                      */
/* ------------------------------------------------------------------ */

interface Transfer {
  to: Rail;
  /** which side of the rail it's on (sign along the rail's horizontal left normal) */
  side: number;
  /** lateral distance */
  lat: number;
  /** along-rail range (from r.a, metres) where the other rail runs alongside */
  s0: number;
  s1: number;
}
const transfers = new WeakMap<Terrain, Map<Rail, Transfer[]>>();

/** Rails (and ledge edges) running alongside each rail a hop away: grind-to-grind transfers. */
function transfersFor(t: Terrain) {
  let m = transfers.get(t);
  if (m) return m;
  m = new Map();
  for (const r of t.rails) {
    const hl = Math.hypot(r.dir.x, r.dir.z);
    if (hl < 0.5 || r.len < 1.5) continue;
    const ux = r.dir.x / hl;
    const uz = r.dir.z / hl;
    const lr = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    for (const q of t.rails) {
      if (q === r) continue;
      const ql = Math.hypot(q.dir.x, q.dir.z);
      if (ql < 0.5 || Math.abs((q.dir.x * ux + q.dir.z * uz) / ql) < 0.985) continue;
      const la = -(q.a.x - r.a.x) * uz + (q.a.z - r.a.z) * ux;
      const lb = -(q.b.x - r.a.x) * uz + (q.b.z - r.a.z) * ux;
      if (Math.abs(la - lb) > 0.1) continue;
      const lat = Math.abs(la);
      if (lat < 0.6 || lat > 1.15) continue;
      const sa = (q.a.x - r.a.x) * ux + (q.a.z - r.a.z) * uz;
      const sb = (q.b.x - r.a.x) * ux + (q.b.z - r.a.z) * uz;
      const s0 = Math.max(0, Math.min(sa, sb));
      const s1 = Math.min(lr, Math.max(sa, sb));
      if (s1 - s0 < 1.5) continue;
      // same height where they run side by side (or a little lower)
      const ry = r.a.y + (r.b.y - r.a.y) * ((s0 + s1) / 2 / lr);
      const qy = q.a.y + (q.b.y - q.a.y) * (((s0 + s1) / 2 - sa) / (sb - sa || 1));
      if (qy > ry + 0.05 || qy < ry - 0.35) continue;
      let arr = m.get(r);
      if (!arr) m.set(r, (arr = []));
      arr.push({ to: q, side: Math.sign(la), lat, s0, s1 });
    }
  }
  transfers.set(t, m);
  return m;
}

/* ------------------------------------------------------------------ */
/* The brain                                                           */
/* ------------------------------------------------------------------ */

/** Anything the bots should steer clear of (the player, each other). */
export interface Obstacle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export interface WorldView {
  /** others to keep away from */
  others: Obstacle[];
  /** the player (bots don't session lines the player is on) */
  player: THREE.Vector3 | null;
  /** can the camera see this spot? bots only respawn where nobody's looking */
  visible(x: number, y: number, z: number): boolean;
}

export interface NpcStats {
  pops: number;
  lands: number;
  bails: number;
  grinds: number;
  tricks: number;
  respawns: number;
  attempts: number;
  /** lip airs in pipes, bowls and off the giant quarter */
  vert: number;
  /** rides down the mega ramp roll-in, and how many cleared the gap */
  megas: number;
  megaGaps: number;
  /** grind-to-grind transfers locked */
  transfers: number;
  /** specials thrown */
  specials: number;
  /** lifts ridden */
  lifts: number;
  /** respawns the camera would have seen (should stay 0) */
  seenRespawns: number;
}

type Phase = 'cruise' | 'goto' | 'line';

/** test instrumentation */
export const DEBUG: Record<string, number> | null = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NPC_DEBUG ? {} : null;
if (DEBUG) Object.assign(DEBUG, { overshoot: 0, slow: 0, boxed: 0, sep: 0, timeout: 0, missRail: 0, slowKick: 0, stuckSession: 0, bailHold: 0 });

const TURNS = [0.4, 0.8, 1.2, 1.6, 2.2];
const DETOURS = [0.5, 0.9, 1.3, 1.8];
/** sideways offsets at the top of a lift, if someone's standing on the spot */
const LIFT_SLOTS = [0, 2.5, -2.5];
const MODS_FROM_NONE: GrindMod[] = ['nose', 'tail'];
const MODS_FROM_NOSE: GrindMod[] = ['tail', 'none'];
const MODS_FROM_TAIL: GrindMod[] = ['nose', 'none'];

export class NpcBrain {
  readonly sk: Skater;
  readonly inp: SkaterInput = { steer: 0, push: false, pushHold: false, brake: false, grindMod: 'none', crouch: false };
  stats: NpcStats = { pops: 0, lands: 0, bails: 0, grinds: 0, tricks: 0, respawns: 0, attempts: 0, vert: 0, megas: 0, megaGaps: 0, transfers: 0, specials: 0, lifts: 0, seenRespawns: 0 };
  /** how often a trick attempt is deliberately blown (0..1), scaled up for harder tricks */
  bailRate: number;
  /** 0..1: bigger tricks, longer grinds */
  skill: number;
  readonly style: Style;
  /** how far out the map goes for us */
  readonly limit: number;
  private readonly sessions: Feature[];

  private phase: Phase = 'cruise';
  private f: Feature | null = null;
  private lat = 0;
  private recent: number[] = [];
  private want = 0; // desired heading (rad)
  private target = 4.5; // desired speed
  private tx = 0; // cruise target
  private tz = 0;
  private hasTarget = false;
  private thinkT: number;
  private cooldown = 1;
  private slowT = 0;
  private planT = 0;
  private flatT = 3;
  private air: AirPlan | null = null;
  private airSeen = false;
  private wasMode: Skater['mode'] = 'ground';
  private grindFail = -1; // grind time at which the bot stops balancing
  private grindSlam = false; // ...and slams instead of stepping off
  private grindPop = false;
  private grindMods: GrindMod[] = ['none', 'none'];
  private grindSwitch = 99;
  private xfer: Transfer | null = null;
  private xferFrom: Rail | null = null;
  private wantXfer = false;
  private hopOff = 0;
  private xferTo: Rail | null = null;
  private xferPop = -1; // along-rail position to pop at
  private railSpin = 0;
  private needRespawn = false;
  private avoid = 0; // extra heading offset from feelers / separation
  private evIdx = 0;
  private cand: Feature[] = [];
  private brakeT = 0;
  private planBuf: AirPlan = resetPlan({} as AirPlan);
  /** feature progress: via waypoint / mega stage / session walls */
  private wp = 0;
  private stage = 0;
  private hitsWant = 0;
  private carve = 1;
  private sessionT = 0;
  private exitSession = false;
  private trapped = false;
  private liftWait = 0;
  private pad = 0;
  private aimSet = false;
  private detourT = 0;
  private detourCheck = 0;
  private dX = 0;
  private dZ = 0;
  private bestD = Infinity;
  private stuckT = 0;
  private lastSession: Session | null = null;
  private onWall = false;
  private shortClimbs = 0;
  private toeV = 0;
  private aimX = 0;
  private aimZ = 0;
  /** player close and the camera on us: go bigger */
  private showing = false;
  private bailHold = 0;
  private flatChain = 0;

  constructor(
    terrain: Terrain,
    public features: Feature[],
    public id: number,
    private r: Rand,
    private spawnPt: { x: number; z: number; heading: number },
    style?: StyleId,
  ) {
    this.sk = new Skater(terrain);
    this.sk.autoRevert = true;
    this.style = STYLES[style ?? STYLE_IDS[id % STYLE_IDS.length]];
    this.bailRate = 0.11 + r() * 0.08;
    this.skill = 0.4 + r() * 0.6;
    this.limit = npcLimit(terrain);
    this.sessions = features.filter((f) => f.session);
    // stagger the bots' thinking so they don't all plan on the same step
    this.thinkT = (id % 4) * 0.025;
    this.flatT = this.style.flat[0] + r() * 2;
  }

  get terrain() {
    return this.sk.terrain;
  }

  /** Put the bot somewhere and let it go. */
  place(x: number, z: number, heading: number) {
    const wasBail = this.sk.mode === 'bail';
    this.sk.spawn(x, z, heading);
    if (wasBail) this.sk.events.push({ type: 'respawn' });
    this.want = heading;
    this.release();
    this.phase = 'cruise';
    this.hasTarget = false;
    this.slowT = 0;
    this.air = null;
    this.needRespawn = false;
    this.trapped = false;
    this.bailHold = 0;
    this.cooldown = 0.5 + this.r() * 1.5;
  }

  /** Let go of the current feature. */
  private release() {
    if (this.f?.session) this.lastSession = this.f.session;
    if (this.f && this.f.user === this.id) this.f.user = -1;
    this.f = null;
    this.exitSession = false;
  }

  dispose() {
    this.release();
  }

  /**
   * One physics substep: decide, then step the skater. Returns after the step;
   * the skater's events stay in sk.events for the caller to read and clear.
   */
  step(dt: number, world: WorldView) {
    const sk = this.sk;
    this.evIdx = sk.events.length;
    if (sk.mode === 'bail' && sk.bailT > 1.7) this.getUp(world);
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.1;
      this.think(0.1, world);
    }
    const inp = this.inp;
    inp.push = false;
    inp.brake = false;
    inp.pushHold = false;
    if (sk.mode === 'ground') this.drive(dt);
    else if (sk.mode === 'air') this.airControl();
    else if (sk.mode === 'grind') this.grindControl();
    else inp.steer = 0;
    this.wasMode = sk.mode;
    sk.step(dt, inp);
    this.readEvents();
  }

  /**
   * About to get up after a slam. Getting up where you fell is fine; being
   * teleported back to the last safe spot in full view isn't, so pick a quiet
   * spot ourselves (or stay down a moment longer until there is one).
   */
  private getUp(world: WorldView) {
    const sk = this.sk;
    const t = this.terrain;
    const bx = sk.bpos.x;
    const bz = sk.bpos.z;
    const n = t.normal(bx, bz, _v);
    const h = t.height(bx, bz);
    let inPlace = t.waterAt(bx, bz) === null && n.y > 0.999 && Math.abs(bx) < 70 && Math.abs(bz) < 70;
    if (inPlace) {
      for (let k = 0; k < 4; k++) {
        const ox = k === 0 ? 1.2 : k === 1 ? -1.2 : 0;
        const oz = k === 2 ? 1.2 : k === 3 ? -1.2 : 0;
        if (Math.abs(t.height(bx + ox, bz + oz) - h) > 0.02) inPlace = false;
      }
    }
    if (inPlace) return;
    const s = sk.safePos;
    const dist = Math.hypot(s.x - bx, s.z - bz);
    if (dist < 3 || !(world.visible(s.x, s.y + 0.8, s.z) || world.visible(bx, sk.bpos.y, bz))) return;
    if (this.respawn(world, false)) return;
    // nowhere quiet yet: lie there a little longer
    if (this.bailHold < 6) {
      this.bailHold++;
      sk.bailT = 1.3;
      if (DEBUG) DEBUG.bailHold++;
    }
  }

  private readEvents() {
    const ev = this.sk.events;
    for (let i = this.evIdx; i < ev.length; i++) {
      const e = ev[i];
      switch (e.type) {
        case 'pop':
          this.stats.pops++;
          break;
        case 'land':
          this.stats.lands++;
          this.stats.tricks += e.tricks.length;
          this.landed();
          break;
        case 'bail':
          this.stats.bails++;
          // a blown trick still proves the spot works; the water or a wall doesn't
          this.done(e.reason === 'uncaught' || e.reason === 'sloppy' || e.reason === 'sideways' || e.reason === 'balance');
          break;
        case 'grindStart':
          this.stats.grinds++;
          if (this.xferTo && this.sk.grind?.rail === this.xferTo) this.stats.transfers++;
          this.xferTo = null;
          if (this.f?.kind === 'rail') this.win();
          this.startGrind();
          break;
        case 'wall':
          if (this.f && this.phase === 'line' && !this.f.session) {
            // ran into something: that line doesn't work (no win for it)
            this.done(false);
          }
          this.avoid = (this.r() < 0.5 ? -1 : 1) * 1.2;
          break;
        case 'respawn':
          this.air = null;
          break;
      }
    }
  }

  private landed() {
    const f = this.f;
    if (f && this.phase === 'line') {
      if (f.kind === 'mega') {
        const along = (this.sk.pos.x - f.sx) * f.dx + (this.sk.pos.z - f.sz) * f.dz;
        // (the hop off the tower deck onto the roll-in doesn't count)
        if (this.stage === 0 && along < f.at) return;
        if (this.stage === 0) {
          // cleared the gap: on to the giant quarter
          if (along > f.at + 12) this.stats.megaGaps++;
          this.win();
          this.stage = f.at2 > 0 ? 1 : 2;
          this.air = null;
          return;
        }
        if (this.stage === 1 && this.sk.airTime > 0.6) {
          this.stage = 2;
          this.air = null;
          return;
        }
      }
      if (f.session && (this.stage >= 1 || this.inSession(f.session))) {
        // still sessioning; leaving is decided by the drive loop
        this.air = null;
        if (this.exitSession && this.sk.pos.y > f.session.y0 + f.session.H - 0.4) this.done();
        return;
      }
    }
    this.done();
  }

  private win() {
    const f = this.f;
    if (!f || this.airSeen) return;
    this.airSeen = true;
    f.wins++;
  }

  /** The feature attempt is over (landed, slammed, or gave up). */
  private done(ok = true) {
    const f = this.f;
    if (f && this.phase === 'line') {
      // kickers, gaps and QPs count when they gave us real air; rails when we locked on
      if (ok && f.kind !== 'rail' && this.sk.airTime > 0.3) this.win();
      if (f.tries >= 3 && f.wins / f.tries < 0.34) f.off = true;
      if (this.sk.mode !== 'grind') {
        // ended up somewhere you can't ride out of (a pipe's flat): slip away once nobody's looking
        if (f.session && !ok) this.trapped = this.inSession(f.session);
        this.release();
        this.phase = 'cruise';
        this.hasTarget = false;
        // chain straight into the next line while the speed is up
        this.cooldown = this.sk.speed > 3.5 ? 0.05 + this.r() * 0.3 : 0.3 + this.r() * 0.9;
      }
    }
    this.air = null;
    this.xfer = null;
  }

  /* ------------------------------ thinking -------------------------- */

  private think(dt: number, world: WorldView) {
    const sk = this.sk;
    const t = this.terrain;
    const p = sk.mode === 'bail' ? sk.bpos : sk.pos;
    const lim = this.limit;
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) || !isFinite(sk.vel.x)) this.needRespawn = true;
    const out = Math.abs(p.x) > lim - 1 || Math.abs(p.z) > lim - 1;
    if (out || p.y < t.floor - 8) this.needRespawn = true;
    if (sk.mode === 'ground' && wet(t, p.x, p.z)) this.needRespawn = true;
    if (this.phase === 'cruise') this.planT = 0;
    else this.planT += dt;
    if (sk.mode === 'ground') {
      if (sk.speed < 0.7) this.slowT += dt;
      else this.slowT = Math.max(0, this.slowT - dt * 2);
      if (this.slowT > 3.5 && this.phase !== 'cruise') {
        if (DEBUG) DEBUG.slow++;
        this.giveUp();
      }
      const maxPlan = this.f?.session || this.f?.lifts ? 75 : 30;
      if (this.slowT > 9 || this.planT > maxPlan) this.needRespawn = true;
    }
    if (this.trapped && sk.mode === 'ground' && this.phase === 'cruise' && !world.visible(p.x, p.y + 0.8, p.z)) this.needRespawn = true;
    if (this.needRespawn) {
      this.respawn(world, out || !isFinite(p.x));
      return;
    }
    if (world.player) {
      const d = Math.hypot(world.player.x - p.x, world.player.z - p.z);
      this.showing = d < 20 && world.visible(p.x, p.y + 1, p.z);
    }
    if (sk.mode !== 'ground') return;
    this.cooldown -= dt;
    this.avoid *= 0.7;
    if (this.phase === 'cruise' && this.adopt()) {
      // rolled into a pipe or bowl (or got dropped in one): session it
    } else if (this.phase === 'cruise') {
      if (this.cooldown <= 0 && this.choose(world)) {
        this.phase = 'goto';
        this.planT = 0;
      } else if (!this.hasTarget || Math.hypot(this.tx - p.x, this.tz - p.z) < 3) this.pickCruise(world);
    }
    if (this.phase === 'goto' && this.f) {
      this.approach(dt, world);
      if (this.phase === 'goto') this.detour(dt);
    }
    else if (this.phase === 'cruise') this.target = 4.6;
    if (this.phase === 'goto' || this.phase === 'cruise') {
      this.want = Math.atan2(this.tz - p.z, this.tx - p.x);
      this.feel();
      this.hazard();
    }
    this.separate(world);
    if (this.phase === 'cruise') this.maybeFlat(dt, world);
  }

  /** In a pipe or bowl already? Then that's the session. */
  private adopt() {
    const p = this.sk.pos;
    for (const f of this.sessions) {
      const s = f.session!;
      if (f.off || (f.user >= 0 && f.user !== this.id) || p.y > s.y0 + 0.4 || !this.inSession(s)) continue;
      this.take(f);
      this.commit(f);
      this.stage = 1;
      return true;
    }
    return false;
  }

  /** A long way to go and no straight shot: head off at an angle that is clear for a bit. */
  private detour(dt: number) {
    const p = this.sk.pos;
    if (this.detourT > 0) {
      this.detourT -= dt;
      if (Math.hypot(this.dX - p.x, this.dZ - p.z) < 2.5) this.detourT = 0;
      this.tx = this.dX;
      this.tz = this.dZ;
      return;
    }
    if (Math.hypot(this.tx - p.x, this.tz - p.z) < 14) return;
    if ((this.detourCheck -= dt) > 0) return;
    this.detourCheck = 0.6;
    if (this.reachable(this.tx, this.tz)) return;
    const base = Math.atan2(this.tz - p.z, this.tx - p.x);
    const pref = wrapPi(this.heading() - base) >= 0 ? 1 : -1;
    for (const k of DETOURS) {
      for (let sgn = 0; sgn < 2; sgn++) {
        const a = base + (sgn === 0 ? pref : -pref) * k;
        const x = p.x + Math.cos(a) * 12;
        const z = p.z + Math.sin(a) * 12;
        if (Math.abs(x) > this.limit - 4 || Math.abs(z) > this.limit - 4 || !this.reachable(x, z)) continue;
        this.dX = x;
        this.dZ = z;
        this.detourT = 2.5;
        this.tx = x;
        this.tz = z;
        return;
      }
    }
  }

  /** Riding to a feature: via its lift or access bank, then onto the run-up line. */
  private approach(dt: number, world: WorldView) {
    const f = this.f!;
    const sk = this.sk;
    const p = sk.pos;
    // not getting any closer (pinned along a rail, circling): forget it
    this.entry(f, _e);
    const d = Math.hypot(_e.x - p.x, _e.z - p.z);
    if (d < this.bestD - 1) {
      this.bestD = d;
      this.stuckT = 0;
    } else if (d < 8 && sk.speed > 2.5) {
      // close and still rolling: lining up takes a moment
    } else if ((this.stuckT += dt) > 7) {
      if (DEBUG) DEBUG.timeout++;
      this.giveUp();
      return;
    }
    if (f.lifts) {
      const atStart = Math.hypot(p.x - f.sx, p.z - f.sz) < 6 && Math.abs(p.y - f.y0) < 0.3;
      if (!atStart) {
        const L = f.lifts[this.pad] ?? f.lifts[0];
        const a = L.area;
        this.tx = (a.x0 + a.x1) / 2;
        this.tz = (a.z0 + a.z1) / 2;
        const far = Math.hypot(this.tx - p.x, this.tz - p.z);
        this.target = far > 25 ? 7 : far > 10 ? 5.5 : 3.5;
        if (p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1) {
          this.liftWait += dt;
          this.brakeT = 0.15;
          const to = L.to;
          // ride up once the top isn't on camera (or we've waited long enough), next to anyone already up there
          const cx = -Math.sin(to.heading);
          const cz = Math.cos(to.heading);
          let ox = 0;
          for (let k = 0; k < LIFT_SLOTS.length; k++) {
            const o = LIFT_SLOTS[k];
            let clear = true;
            for (const q of world.others) if (q.pos !== p && Math.hypot(q.pos.x - (to.x + cx * o), q.pos.z - (to.z + cz * o)) < 2.5) clear = false;
            if (clear) {
              ox = o;
              break;
            }
            if (k === LIFT_SLOTS.length - 1) ox = NaN;
          }
          const seen = world.visible(to.x, f.y0 + 1, to.z) || world.visible(p.x, p.y + 1, p.z);
          if (!isNaN(ox) && (!seen || this.liftWait > 3)) {
            this.stats.lifts++;
            sk.spawn(to.x + cx * ox, to.z + cz * ox, to.heading);
            this.want = to.heading;
            this.liftWait = 0;
            this.lat = -ox;
            this.commit(f);
          } else if (this.liftWait > 9) this.giveUp();
        } else this.liftWait = 0;
        return;
      }
      this.commit(f);
      return;
    }
    if (f.via && this.wp * 2 < f.via.length && (this.wp > 1 || p.y < f.y0 - 0.15)) {
      // up the bank onto the deck the run-up starts on (and round anything on the deck)
      const x = f.via[this.wp * 2];
      const z = f.via[this.wp * 2 + 1];
      this.tx = x;
      this.tz = z;
      this.target = 6.2;
      if (Math.hypot(x - p.x, z - p.z) < 2.2) this.wp++;
      return;
    }
    const sx = f.sx - f.dz * -this.lat;
    const sz = f.sz + f.dx * -this.lat;
    const rx = p.x - sx;
    const rz = p.z - sz;
    const along = rx * f.dx + rz * f.dz;
    const lat = -rx * f.dz + rz * f.dx;
    const dist = Math.hypot(rx, rz);
    const minRun = f.kind === 'qp' || f.kind === 'pipe' ? 2.5 : 3.5;
    // on the line and pointing down it: commit
    if (Math.abs(lat) < 0.9 && along > -7 && along < f.at - minRun && this.headingErr(Math.atan2(f.dz, f.dx)) < 0.5 && Math.abs(p.y - f.y0) < 0.2) {
      this.commit(f);
    } else if (along > -8 && along < f.at - minRun && Math.abs(lat) < 4 && this.headingErr(Math.atan2(f.dz, f.dx)) < 1.3) {
      // close and heading the right way: chase a carrot on the (extended) line so we merge onto it
      const c = Math.max(-4, along + 3);
      this.tx = sx + f.dx * c;
      this.tz = sz + f.dz * c;
      this.target = Math.max(4, f.speed - 1);
    } else if (along > f.at - minRun - 0.5 && Math.abs(lat) < 1.5 && this.headingErr(Math.atan2(f.dz, f.dx)) < 1) {
      // overshot the run-up start: circle round for another go
      if (DEBUG) DEBUG.overshoot++;
      this.giveUp();
    } else {
      // out in the park, or alongside / ahead of the line: swing round to a point behind the start, staying on our side of it
      const back = Math.min(6, 2 + dist * 0.25);
      const side = along > -4 ? (lat >= 0 ? 1 : -1) * Math.min(4, Math.max(2.5, Math.abs(lat))) : 0;
      this.tx = sx - f.dx * back - f.dz * side;
      this.tz = sz - f.dz * back + f.dx * side;
      this.target = dist > 25 ? 7 : dist > 10 ? 5.6 : 4.2;
    }
  }

  private commit(f: Feature) {
    this.phase = 'line';
    this.airSeen = false;
    this.stage = 0;
    this.stats.attempts++;
    f.tries++;
    if (f.kind === 'mega') this.stats.megas++;
    if (f.session) {
      const [a, b] = this.style.hits;
      this.hitsWant = a + Math.floor(this.r() * (b - a + 1));
      this.sessionT = 0;
      this.onWall = false;
      this.shortClimbs = 0;
      this.toeV = 0;
      this.carve = this.r() < 0.5 ? -1 : 1;
    }
  }

  private headingErr(h: number) {
    return Math.abs(wrapPi(h - this.heading()));
  }

  /** direction of travel (or of the board when stopped) */
  private heading() {
    const sk = this.sk;
    if (Math.hypot(sk.vel.x, sk.vel.z) > 0.6) return Math.atan2(sk.vel.z, sk.vel.x);
    return Math.atan2(sk.fwd.z, sk.fwd.x);
  }

  /** Abandon the plan; `miss` counts it against the feature (we lined up and blew the approach). */
  private giveUp(miss = false) {
    const f = this.f;
    if (f && this.phase === 'line' && !this.airSeen) {
      if (!miss) f.tries--;
      else if (f.tries >= 3 && f.wins / f.tries < 0.34) f.off = true;
    }
    if (f?.session && this.phase === 'line') this.trapped = this.inSession(f.session);
    this.release();
    this.phase = 'cruise';
    this.hasTarget = false;
    this.cooldown = 0.5 + this.r();
    this.slowT = 0;
    this.xfer = null;
  }

  /** Where to ride to first for a feature. */
  private entry(f: Feature, out: { x: number; z: number; pad: number }) {
    const p = this.sk.pos;
    if (f.lifts && !(Math.hypot(p.x - f.sx, p.z - f.sz) < 6 && Math.abs(p.y - f.y0) < 0.3)) {
      // the nearest pad
      let best = Infinity;
      for (let i = 0; i < f.lifts.length; i++) {
        const a = f.lifts[i].area;
        const x = (a.x0 + a.x1) / 2;
        const z = (a.z0 + a.z1) / 2;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < best) {
          best = d;
          out.x = x;
          out.z = z;
          out.pad = i;
        }
      }
    } else if (f.via && p.y < f.y0 - 0.15) {
      out.x = f.via[0];
      out.z = f.via[1];
    } else {
      out.x = f.sx;
      out.z = f.sz;
    }
  }

  /** Pick a feature to session: one we like, that's close, and that we can roll into without much turning. */
  private choose(world: WorldView): boolean {
    const sk = this.sk;
    const r = this.r;
    const cand = this.cand;
    const like = this.style.like;
    const h = this.heading();
    const moving = sk.speed > 2;
    cand.length = 0;
    for (const f of this.features) {
      if (f.off || (f.user >= 0 && f.user !== this.id) || this.recent.includes(f.id)) continue;
      this.entry(f, _e);
      const d = Math.hypot(_e.x - sk.pos.x, _e.z - sk.pos.z);
      if (d > (f.lifts ? this.limit * 1.6 : Math.max(48, this.limit * 0.6))) continue;
      if (world.player && lineNear(f, world.player, 5)) continue;
      // the turn to get there and the turn onto the line, as extra metres
      let cost = d;
      if (moving && d > 1) {
        const toward = Math.atan2(_e.z - sk.pos.z, _e.x - sk.pos.x);
        cost += Math.abs(wrapPi(toward - h)) * 5;
        if (_e.x === f.sx) cost += Math.abs(wrapPi(Math.atan2(f.dz, f.dx) - toward)) * 3;
      }
      const fit = (f.tries >= 2 ? 0.3 + f.wins / f.tries : 1) * (f.session && f.session === this.lastSession ? 0.35 : 1);
      // the lift-fed lines are worth a ride across the park
      f.w = like[f.kind] * fit * Math.exp(-cost / (f.lifts ? 45 : 13)) * (0.3 + r());
      cand.push(f);
    }
    cand.sort((a, b) => b.w - a.w);
    let best: Feature | null = null;
    for (let i = 0; i < Math.min(5, cand.length); i++) {
      this.entry(cand[i], _e);
      // far ones: the detour finder gets us round whatever's in between
      if (this.reachable(_e.x, _e.z) || Math.hypot(_e.x - sk.pos.x, _e.z - sk.pos.z) > 25) {
        best = cand[i];
        break;
      }
    }
    cand.length = 0;
    if (!best) {
      this.cooldown = 1.5;
      return false;
    }
    this.take(best);
    return true;
  }

  private take(f: Feature) {
    this.release();
    this.f = f;
    f.user = this.id;
    this.recent.push(f.id);
    if (this.recent.length > 3) this.recent.shift();
    this.lat = (this.r() * 2 - 1) * f.spread;
    this.wp = 0;
    this.bestD = Infinity;
    this.stuckT = 0;
    this.detourT = 0;
    this.entry(f, _e);
    this.pad = _e.pad;
    this.liftWait = 0;
    this.trapped = false;
  }

  /** Straight shot from here to (x,z) without riding into a wall? */
  private reachable(x: number, z: number) {
    const t = this.terrain;
    const p = this.sk.pos;
    const L = Math.hypot(x - p.x, z - p.z);
    const n = Math.max(1, Math.ceil(L / 1.2));
    let prev = t.height(p.x, p.z);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const qx = p.x + (x - p.x) * k;
      const qz = p.z + (z - p.z) * k;
      const h = t.height(qx, qz);
      if (h - prev > 0.35 || prev - h > 1.2 || wet(t, qx, qz)) return false;
      prev = h;
    }
    // rails are solid
    for (const r of t.rails) {
      if (r.kind !== 'rail') continue;
      if (Math.max(p.x, x) < r.minX || Math.min(p.x, x) > r.maxX || Math.max(p.z, z) < r.minZ || Math.min(p.z, z) > r.maxZ) continue;
      const ry = Math.min(r.a.y, r.b.y);
      if (ry - p.y > TUNE.railHead || Math.max(r.a.y, r.b.y) - p.y < 0.08) continue;
      if (segHit(p.x, p.z, x, z, r.a.x, r.a.z, r.b.x, r.b.z, 0.3)) return false;
    }
    return true;
  }

  private pickCruise(world: WorldView) {
    const t = this.terrain;
    const p = this.sk.pos;
    const h = this.heading();
    for (let i = 0; i < 8; i++) {
      // mostly onward, so cruising flows instead of zig-zagging
      const a = i < 5 ? h + (this.r() - 0.5) * 2.2 : this.r() * TAU;
      const d = 7 + this.r() * 18;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (Math.abs(x) > this.limit - 6 || Math.abs(z) > this.limit - 6) continue;
      if (wet(t, x, z)) continue;
      if (world.player && Math.hypot(world.player.x - x, world.player.z - z) < 5) continue;
      if (!this.reachable(x, z)) continue;
      this.tx = x;
      this.tz = z;
      this.hasTarget = true;
      return;
    }
    // boxed in: head back toward the middle of the park
    this.tx = this.spawnPt.x * 0.5;
    this.tz = this.spawnPt.z * 0.5;
    this.hasTarget = true;
  }

  private blocked(a: number, reach: number) {
    const sk = this.sk;
    const t = this.terrain;
    const p = sk.pos;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    let prev = p.y;
    for (let d = 0.15; d <= reach; d += 0.15) {
      const x = p.x + cx * d;
      const z = p.z + cz * d;
      const h = t.height(x, z);
      // a sharp rise is a box side, a ramp's side edge, or a steep transition: all bad news sideways on
      if (h - prev > 0.06) return true;
      if (prev - h > 1.2) return true; // big drop
      if (wet(t, x, z)) return true;
      prev = h;
    }
    const ex = p.x + cx * reach;
    const ez = p.z + cz * reach;
    for (const r of t.rails) {
      if (r.kind !== 'rail') continue;
      if (Math.max(p.x, ex) < r.minX || Math.min(p.x, ex) > r.maxX || Math.max(p.z, ez) < r.minZ || Math.min(p.z, ez) > r.maxZ) continue;
      if (segHit(p.x, p.z, ex, ez, r.a.x, r.a.z, r.b.x, r.b.z, 0.3)) return true;
    }
    return false;
  }

  /** Whiskers: steer round walls between here and where we want to go. */
  private feel() {
    const sk = this.sk;
    const reach = 1.2 + Math.min(8, sk.speed) * 0.4;
    const base = this.want + this.avoid;
    if (!this.blocked(base, reach)) {
      this.want = base;
      return;
    }
    const pref = wrapPi(this.want - this.heading()) >= 0 ? 1 : -1;
    for (const k of TURNS) {
      if (!this.blocked(base + pref * k, reach)) {
        this.want = base + pref * k;
        return;
      }
      if (!this.blocked(base - pref * k, reach)) {
        this.want = base - pref * k;
        return;
      }
    }
    // no way through: keep going and let the stuck check sort it out
    if (DEBUG) DEBUG.boxed++;
    this.want = base;
  }

  /** About to roll off into the water or a big drop: brake and turn away. */
  private hazard() {
    const sk = this.sk;
    const t = this.terrain;
    const h = this.heading();
    const cx = Math.cos(h);
    const cz = Math.sin(h);
    const reach = 0.8 + sk.speed * 0.5;
    for (let d = 0.4; d <= reach; d += 0.4) {
      const x = sk.pos.x + cx * d;
      const z = sk.pos.z + cz * d;
      if (wet(t, x, z) || sk.pos.y - t.height(x, z) > 0.9) {
        this.brakeT = 0.5;
        if (Math.abs(wrapPi(this.want - h)) < 1.2) this.want = h + (wrapPi(this.want - h) >= 0 ? 1.6 : -1.6);
        if (this.phase !== 'cruise') this.giveUp();
        this.hasTarget = false;
        return;
      }
    }
  }

  /** Keep a couple of metres from other skaters. */
  private separate(world: WorldView) {
    const p = this.sk.pos;
    const h = this.heading();
    const fx = Math.cos(h);
    const fz = Math.sin(h);
    for (const o of world.others) {
      if (o.pos === p) continue;
      const rx = o.pos.x - p.x;
      const rz = o.pos.z - p.z;
      const d = Math.hypot(rx, rz);
      if (d > 4.5 || d < 1e-3 || Math.abs(o.pos.y - p.y) > 2.5) continue;
      const ahead = (rx * fx + rz * fz) / d;
      if (ahead < 0.1) continue;
      const side = fx * rz - fz * rx > 0 ? -1 : 1; // steer away from their side
      if (this.phase === 'line' && d < 3.5 && this.sk.mode === 'ground') {
        // someone's in the way of the line: bail out of it and brake
        if (DEBUG) DEBUG.sep++;
        this.giveUp();
        this.inp.brake = true;
      }
      this.want += side * 0.7 * (1 - d / 4.5) * ahead;
    }
  }

  /** Flatground tricks while cruising (tech skaters string them together). */
  private maybeFlat(dt: number, world: WorldView) {
    const sk = this.sk;
    this.flatT -= dt;
    if (this.flatT > 0 || sk.speed < 3.2 || sk.groundN.y < 0.999) return;
    const t = this.terrain;
    const h = this.heading();
    const cx = Math.cos(h);
    const cz = Math.sin(h);
    const reach = sk.speed * 0.85;
    for (let d = 0.5; d <= reach; d += 0.5) {
      if (Math.abs(t.height(sk.pos.x + cx * d, sk.pos.z + cz * d) - sk.pos.y) > 0.01) return;
    }
    for (const o of world.others) if (o.pos !== sk.pos && o.pos.distanceToSquared(sk.pos) < 16) return;
    const st = this.style;
    if (this.flatChain > 0) {
      this.flatChain--;
      this.flatT = 0.25 + this.r() * 0.25;
    } else {
      this.flatT = st.flat[0] + this.r() * (st.flat[1] - st.flat[0]);
      if (this.r() < st.flatLine) {
        this.flatChain = 1 + (this.r() < 0.4 ? 1 : 0);
        this.flatT = 0.25 + this.r() * 0.2;
      }
    }
    this.pop(this.planAir(this.predictPop(false), 'flat'));
  }

  /** Estimated airtime if we popped right now (with the vert assist the skater applies off steep walls). */
  private predictPop(carry: boolean) {
    const sk = this.sk;
    const n = sk.mode === 'ground' ? sk.groundN : UPV;
    let dx = n.x * 0.4;
    let dy = n.y * 0.4 + 0.6;
    let dz = n.z * 0.4;
    const l = Math.hypot(dx, dy, dz);
    dx /= l;
    dy /= l;
    dz /= l;
    if (dx * sk.vel.x + dz * sk.vel.z < 0) {
      dx = 0;
      dz = 0;
      dy = 1;
    }
    const pv = TUNE.popSpeed * 0.983;
    let vx = sk.vel.x + dx * pv;
    const vy = sk.vel.y + dy * pv;
    let vz = sk.vel.z + dz * pv;
    if (n.y < 0.72 && vy > 0) {
      const hl = Math.hypot(n.x, n.z);
      if (hl > 1e-3) {
        const ux = n.x / hl;
        const uz = n.z / hl;
        const into = -(vx * ux + vz * uz);
        const behind = this.terrain.height(sk.pos.x - ux * 0.6, sk.pos.z - uz * 0.6);
        const spine = behind < sk.pos.y - 0.35 || carry;
        if (into > 0 && !spine) {
          vx += ux * into;
          vz += uz * into;
        }
        if (!spine) {
          vx += ux * 0.22;
          vz += uz * 0.22;
        }
      }
    }
    return this.predictAir(vx, vy, vz);
  }

  /** Ballistic flight time from the current position until the trajectory meets the ground. */
  private predictAir(vx: number, vy: number, vz: number) {
    const t = this.terrain;
    const p = this.sk.pos;
    let x = p.x;
    let y = p.y;
    let z = p.z;
    const h = 1 / 60;
    for (let i = 1; i < 300; i++) {
      vy -= TUNE.gravity * h;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (vy < 0 && y <= t.height(x, z)) return i * h;
    }
    return 5;
  }

  /**
   * Choose what to do with an air of about T seconds: a body spin, a flip
   * (multi-turn when there's time, a special when showing off), a grab, a
   * late flip after it. Harder plans get blown more often.
   */
  private planAir(T: number, ctx: AirCtx, popped = true): AirPlan {
    const r = this.r;
    const st = this.style;
    const plan = resetPlan(this.planBuf);
    const fd = TUNE.flickDelay;
    const beat = TUNE.beat;
    const margin = 0.17;
    const show = this.showing;
    const amb = Math.min(1.6, this.skill * st.risk * (show ? 1.4 : 1) * (0.55 + r() * 0.7) + (ctx === 'big' ? 0.3 : 0));
    let diff = 0.35;
    // 1. body spin
    const halfT = Math.PI / TUNE.spinRate;
    let maxHalf = Math.floor((T - (ctx === 'vert' || ctx === 'big' ? 0.4 : 0.12)) / halfT);
    if (ctx === 'flat' || ctx === 'grind') maxHalf = Math.min(maxHalf, 1);
    maxHalf = Math.min(maxHalf, ctx === 'big' ? 6 : 5);
    let half = 0;
    const spinP = st.spin * (ctx === 'vert' || ctx === 'big' ? 1.25 : ctx === 'flat' ? 0.4 : ctx === 'grind' ? 0.3 : 1);
    if (maxHalf >= 1 && r() < spinP) {
      half = Math.max(1, Math.min(maxHalf, Math.round(maxHalf * (0.35 + 0.5 * Math.min(1, amb)) + (r() - 0.5))));
      diff += 0.22 * half;
    }
    // 2. a flip at the pop
    let caught = popped ? 0.1 : 0.05;
    if (popped || T > 0.6) {
      const room = T - margin - fd;
      const pFlip = (ctx === 'vert' ? 0.7 : 1) * st.flip;
      if (room > beat / SPEEDS[SPEEDS.length - 1] && r() < pFlip) {
        // the special: a highlight for when someone's watching (or the air's huge)
        const pSpecial = show ? 0.3 : ctx === 'big' || ctx === 'vert' ? 0.07 : 0.025;
        if (popped && ctx !== 'flat' && ctx !== 'grind' && room > 0.35 && amb > 0.8 && r() < pSpecial) {
          plan.spec = SPECIAL_SPECS[Math.floor(r() * SPECIAL_SPECS.length)];
          plan.catchAt = fd + beat / plan.spec.speed + (r() - 0.5) * 0.02;
          diff += 0.9;
        } else {
          const base = pickWeighted(r, st.flips);
          // a flick speed that fits the air
          let k = Math.floor(r() * SPEEDS.length);
          while (k < SPEEDS.length - 1 && beat / SPEEDS[k] > room) k++;
          const s = SPEEDS[k];
          const maxN = Math.floor(room / (beat / s));
          let n = 1;
          if (maxN >= 2 && r() < 0.15 + 0.45 * amb) n = 2;
          if (n === 2 && maxN >= 3 && r() < 0.35 * amb) n = 3;
          // doubles and triples are for plain flips, impossibles and shove-its (no 720 double tre flips)
          if (base.flip !== 0 && base.shove !== 0) n = 1;
          if (base.wrap !== 0 && n > 2) n = 2;
          plan.spec = atSpeed(popped || !base.nollie ? base : KICK, k);
          plan.catchAt = fd + (n * beat) / s + (r() - 0.5) * 0.025;
          diff += 0.3 + 0.38 * (n - 1) + (Math.abs(base.shove) > 1 || (base.flip !== 0 && base.shove !== 0) ? 0.12 : 0);
        }
        caught = plan.catchAt + 0.08;
      } else if (popped && r() < (ctx === 'flat' ? 0.35 : 0.2)) plan.spec = OLLIE_N;
    }
    // 3. a grab once the board's under your feet
    const hasFlip = plan.catchAt > 0;
    if (ctx !== 'flat' && T - caught - margin > 0.32 && r() < st.grab * (hasFlip ? 0.6 : 1.15)) {
      plan.grab = Math.floor(r() * GRABS.length);
      plan.grabFrom = caught;
      plan.grabUntil = T - margin - 0.04 - r() * 0.1;
      diff += 0.12;
    }
    // 4. a late flip to finish
    const lateFrom = plan.grab >= 0 ? plan.grabFrom + 0.35 + r() * 0.15 : caught + 0.04;
    if (ctx !== 'flat' && T - lateFrom - margin > fd + beat + 0.04 && r() < st.late * Math.min(1, amb + 0.2)) {
      plan.late = pickWeighted(r, QUICK);
      plan.lateAt = lateFrom;
      plan.lateCatch = lateFrom + fd + beat + (r() - 0.5) * 0.02;
      if (plan.grab >= 0) plan.grabUntil = Math.min(plan.grabUntil, lateFrom - 0.02);
      diff += 0.3;
    }
    plan.spin = half * Math.PI * (r() < 0.5 ? -1 : 1);
    // 5. sometimes it just doesn't work out
    if (r() < this.bailRate * diff * (show ? 1.1 : 1)) {
      const how = r();
      if (plan.late && how < 0.4) plan.lateCatch = -1;
      else if (hasFlip && how < 0.75) plan.catchAt = -1; // never gets a foot back on it
      else if (T > 0.45) {
        plan.spin = plan.spin || (r() < 0.5 ? -1 : 1) * Math.PI;
        plan.spinFail = true;
      } else if (hasFlip) plan.catchAt = -1;
    }
    return plan;
  }

  private pop(plan: AirPlan) {
    const sk = this.sk;
    if (!sk.flick(plan.spec)) return false;
    if (plan.spec.special) this.stats.specials++;
    this.air = plan;
    return true;
  }

  /** Put the bot somewhere quiet right away (joining a session). */
  respawnNow(world: WorldView) {
    this.respawn(world, true);
  }

  /** Respawn somewhere quiet: a run-up start nobody's looking at, away from the player. Returns whether it moved. */
  private respawn(world: WorldView, force: boolean) {
    const t = this.terrain;
    const r = this.r;
    const ok = (x: number, y: number, z: number) => {
      if (world.visible(x, y, z) || world.visible(x, y + 1.6, z)) return false;
      if (world.player && Math.hypot(world.player.x - x, world.player.z - z) < 12) return false;
      for (const o of world.others) if (o.pos !== this.sk.pos && Math.hypot(o.pos.x - x, o.pos.z - z) < 3) return false;
      return true;
    };
    const n = this.features.length;
    for (let i = 0; i < 10 && n; i++) {
      const f = this.features[Math.floor(r() * n)];
      if (f.off || (f.user >= 0 && f.user !== this.id) || !ok(f.sx, f.y0, f.sz)) continue;
      this.place(f.sx, f.sz, Math.atan2(f.dz, f.dx));
      this.stats.respawns++;
      // dropped at a run-up start: ride it
      this.take(f);
      this.phase = 'goto';
      this.planT = 0;
      return true;
    }
    const s = this.spawnPt;
    for (let i = 0; i < 10; i++) {
      const x = s.x + (r() - 0.5) * 16;
      const z = s.z + (r() - 0.5) * 16;
      const y = t.height(x, z);
      if (Math.abs(y - t.height(s.x, s.z)) > 0.01 || !ok(x, y, z)) continue;
      this.place(x, z, s.heading);
      this.stats.respawns++;
      return true;
    }
    if (force) {
      const x = s.x + (r() - 0.5) * 6;
      const z = s.z + (r() - 0.5) * 6;
      if (world.visible(x, t.height(x, z) + 0.8, z)) this.stats.seenRespawns++;
      this.place(x, z, s.heading);
      this.stats.respawns++;
      return true;
    }
    // else: try again next think
    return false;
  }

  /* ------------------------------ driving --------------------------- */

  private inSession(s: Session) {
    const p = this.sk.pos;
    if (p.y > s.y0 + s.H - 0.3) return false;
    if (s.bowl) return Math.hypot(p.x - s.cx, p.z - s.cz) < s.rad;
    const a = (p.x - s.ox) * s.ax + (p.z - s.oz) * s.az;
    const n = (p.x - s.ox) * s.nx + (p.z - s.oz) * s.nz;
    return a > -1 && a < s.len + 1 && Math.abs(n) < s.half + 6;
  }

  private drive(dt: number) {
    const sk = this.sk;
    const inp = this.inp;
    const f = this.f;
    if (this.wasMode !== 'ground') this.air = null;
    let steerOK = true;
    let pump = this.phase !== 'line';
    if (this.phase === 'line' && f) {
      if (f.session && this.stage >= 1) {
        const r = this.sessionDrive(f.session, dt);
        if (r < 0) return;
        steerOK = r > 0;
        pump = true;
      } else if (f.kind === 'mega' && this.stage === 2) {
        // rolling back out of the giant quarter: powerslide it down, then off you go
        this.want = this.heading();
        if (sk.groundN.y > 0.98 && sk.speed > 4.5) inp.brake = true;
        if (sk.speed < 5 && sk.groundN.y > 0.98) this.done();
        steerOK = false;
      } else if (this.followLine(f)) return;
    }
    const err = wrapPi(this.want - this.heading());
    inp.steer = steerOK ? Math.max(-1, Math.min(1, err * 2.4)) : 0;
    // slow down for tight turns
    let tgt = this.target;
    if (Math.abs(err) > 1.1 && this.phase !== 'line') tgt = Math.min(tgt, 2.6);
    const flat = sk.groundN.y > 0.94;
    const climbing = sk.groundN.y < 0.97 && sk.vel.y > 0;
    const onVia = this.phase === 'goto' && !!f?.via && this.wp >= 1 && this.wp * 2 < f.via.length;
    if ((flat || onVia) && (!climbing || onVia) && sk.speed < tgt - 0.3 && sk.pushT <= 0 && sk.pushCd <= 0) inp.push = true;
    if (flat && sk.speed > tgt + 1.8 && this.phase !== 'line') inp.brake = true;
    if (this.brakeT > 0) {
      this.brakeT -= dt;
      inp.brake = sk.speed > 1;
      inp.push = false;
    }
    // pump the transitions on the way down (never on the way up: holding it carries you over the lip)
    if (pump && !flat && sk.vel.y < -0.3) inp.pushHold = true;
  }

  /** Ride the run-up line and act at the feature. Returns true when it's taken over this step. */
  private followLine(f: Feature): boolean {
    const sk = this.sk;
    const inp = this.inp;
    const ox = -f.dz * -this.lat;
    const oz = f.dx * -this.lat;
    const rx = sk.pos.x - (f.sx + ox);
    const rz = sk.pos.z - (f.sz + oz);
    const along = rx * f.dx + rz * f.dz;
    const look = Math.max(1.6, sk.speed * 0.45);
    const cx = f.sx + ox + f.dx * (along + look);
    const cz = f.sz + oz + f.dz * (along + look);
    this.want = Math.atan2(cz - sk.pos.z, cx - sk.pos.x);
    this.target = f.speed;
    const toGo = f.at - along;
    switch (f.kind) {
      case 'rail': {
        // pop so we're above the rail by the time we reach it, then drop onto it
        const v = Math.max(0.5, sk.speed);
        const tall = f.h > 0.42;
        const pv = TUNE.popSpeed * (tall ? RAIL_POP : 0.983);
        const need = f.h + (tall ? 0.06 : 0.12);
        const disc = pv * pv - 2 * TUNE.gravity * need;
        const tUp = disc > 0 ? (pv - Math.sqrt(disc)) / TUNE.gravity : 0.3;
        if (toGo <= v * tUp + 0.3) {
          const latErr = Math.abs(-rx * f.dz + rz * f.dx);
          if (latErr > 0.25 || sk.speed < 2.5) {
            if (DEBUG) DEBUG.missRail++;
            this.giveUp(true);
          } else this.railPop(f);
          return true;
        }
        break;
      }
      case 'kicker':
      case 'gap':
        if (toGo <= (f.kind === 'gap' ? 0.25 : 0.35 + sk.speed * 0.02)) {
          if (sk.speed < 4) {
            if (DEBUG) DEBUG.slowKick++;
            this.giveUp(true);
            return true;
          }
          this.pop(this.planAir(this.predictPop(false), f.kind === 'gap' || f.h > 1.1 ? 'drop' : 'ramp'));
          return true;
        }
        break;
      case 'qp':
        // ride up the transition; pop at the lip
        if (toGo < 0) {
          const up = sk.pos.y - f.y0;
          if (up >= f.h - 0.3 && sk.vel.y > 0.5) {
            this.pop(this.planAir(this.predictPop(false), f.tag === 'spine' ? 'ramp' : 'vert'));
            return true;
          }
          if (sk.vel.y < -0.2 || sk.speed < 0.6) {
            // didn't make it to the lip: roll back out
            this.done();
          }
        }
        break;
      case 'mega':
        if (this.stage === 0) {
          // the drop: no pushing, no pumping, keep it straight, pop the kicker
          inp.pushHold = false;
          if (toGo <= 0.35 + sk.speed * 0.025 && sk.speed > 6) {
            this.pop(this.planAir(this.predictPop(false), 'big'));
            return true;
          }
          if (toGo < -3) this.stage = 1;
        } else if (this.stage === 1) {
          if (f.at2 - along < 0) {
            if (sk.pos.y - this.terrain.floor >= f.h2 - 0.4 && sk.vel.y > 0.5) {
              this.stats.vert++;
              this.pop(this.planAir(this.predictPop(false), 'big'));
              return true;
            }
            if (sk.vel.y < -0.2) this.stage = 2;
          }
        }
        break;
      case 'pipe':
        if (this.inSession(f.session!) && this.sk.pos.y < f.session!.y0 + 0.3) this.stage = 1;
        break;
    }
    if (toGo < -8 && (f.kind === 'kicker' || f.kind === 'gap' || f.kind === 'rail')) this.done();
    if (f.kind === 'mega' && toGo < -8 && this.stage === 0) this.stage = 1;
    return false;
  }

  /**
   * Carving a pipe, mini ramp or bowl: aim for the next wall, pump on the way
   * down, pop at the lip. Returns 1 to steer toward `want`, 0 to hold the
   * line, -1 when it handled the step itself.
   */
  private sessionDrive(s: Session, dt: number): number {
    const sk = this.sk;
    const p = sk.pos;
    const inp = this.inp;
    this.sessionT += dt;
    const floor = sk.groundN.y > 0.96;
    const up = p.y - s.y0;
    if (!floor) {
      this.aimSet = false;
      if (!this.onWall) {
        this.onWall = true;
        // hitting the wall: is there the speed for the coping, and will there be for the next one?
        const v = sk.speed;
        const need = Math.sqrt(2 * TUNE.gravity * Math.max(0.2, s.H - 0.35)) * 1.03 + 0.15;
        if (v < need) {
          if (++this.shortClimbs >= 2) {
            if (DEBUG) DEBUG.stuckSession++;
            this.done(false);
            return 0;
          }
        } else {
          this.shortClimbs = 0;
          const loss = this.toeV > 0 ? Math.max(0.6, this.toeV - v) : s.H > 4 ? 2.5 : 1;
          this.toeV = v;
          if (v - loss < need) this.exitSession = true;
        }
      }
      // on a wall: ride it straight; carry over the lip on the way out
      if (this.exitSession && sk.vel.y > 0) inp.pushHold = true;
      if (this.exitSession && !s.exit) {
        // done here, but there's no riding out of this one: carve about until nobody's looking
        this.done(false);
        return 0;
      }
      if (this.exitSession) {
        // no pop on the way out: just carry over onto the deck
        if (this.air === null) this.air = resetPlan(this.planBuf);
        return 0;
      }
      if (up >= s.H - 0.35 && sk.vel.y > 0.5) {
        this.stage++;
        this.stats.vert++;
        this.win();
        this.pop(this.planAir(this.predictPop(false), 'vert'));
        if (this.stage > this.hitsWant) this.exitSession = true;
        return -1;
      }
      return 0;
    }
    this.onWall = false;
    this.target = PUSH_TOP;
    if (sk.speed < 2.2 && this.sessionT > 3) {
      if (DEBUG) DEBUG.stuckSession++;
      this.done(false);
      return 1;
    }
    if (this.stage > this.hitsWant + 3 || this.sessionT > 55) this.exitSession = true;
    if (s.bowl) {
      // aim across the bowl, a bit off-centre so it carves round (picked once per crossing)
      if (!this.aimSet) {
        const rx = p.x - s.cx;
        const rz = p.z - s.cz;
        const d = Math.hypot(rx, rz);
        const a = (d > 1 ? Math.atan2(-rz, -rx) : this.heading()) + this.carve * (s.flat > 5 ? 0.8 : 0.3);
        this.aimX = s.cx + Math.cos(a) * s.rad;
        this.aimZ = s.cz + Math.sin(a) * s.rad;
        this.aimSet = true;
      }
      this.want = Math.atan2(this.aimZ - p.z, this.aimX - p.x);
    } else {
      const along = (p.x - s.ox) * s.ax + (p.z - s.oz) * s.az;
      const across = (p.x - s.ox) * s.nx + (p.z - s.oz) * s.nz;
      const vn = sk.vel.x * s.nx + sk.vel.z * s.nz;
      const side = vn > 0.8 ? 1 : vn < -0.8 ? -1 : across > 0 ? -1 : 1;
      // drift down the pipe, turning back before either end
      if (along > s.len - 10) this.carve = -1;
      else if (along < 10) this.carve = 1;
      const th = 0.45;
      const hx = s.nx * side * Math.cos(th) + s.ax * this.carve * Math.sin(th);
      const hz = s.nz * side * Math.cos(th) + s.az * this.carve * Math.sin(th);
      this.want = Math.atan2(hz, hx);
    }
    return 1;
  }

  /** Pop onto the rail we're lined up on: maybe a flip in, maybe swung into a slide or an angled lock. */
  private railPop(f: Feature) {
    const r = this.r;
    const st = this.style;
    const plan = resetPlan(this.planBuf);
    const slide = r();
    this.railSpin = slide < st.slide ? (r() < 0.5 ? -1 : 1) * 1.5 : slide < st.slide + st.angled ? (r() < 0.5 ? -1 : 1) * 0.78 : 0;
    const tall = f.h > 0.42;
    plan.spec = atSpeed(r() < 0.25 ? OLLIE_N : OLLIE, tall ? 2 : 0);
    // time from the pop until we're back down at rail height
    const pv = TUNE.popSpeed * (tall ? RAIL_POP : 0.983);
    const disc = pv * pv - 2 * TUNE.gravity * f.h;
    const tDown = disc > 0 ? (pv + Math.sqrt(disc)) / TUNE.gravity : 0;
    const flipIn = st.flipIn * (this.showing ? 1.4 : 1) * (0.5 + this.skill * 0.5);
    if (tDown > TUNE.flickDelay + TUNE.beat / 1.2 + 0.1 && r() < flipIn) {
      const k = 2;
      const base = pickWeighted(r, FLIP_INS);
      plan.spec = atSpeed(base, k);
      plan.catchAt = TUNE.flickDelay + TUNE.beat / SPEEDS[k] + (r() - 0.5) * 0.02;
      if (r() < this.bailRate * 0.6) plan.catchAt = -1;
    }
    this.pop(plan);
  }

  /** Where's the ground coming up? */
  private landingSoon(lead: number) {
    const sk = this.sk;
    if (sk.vel.y > 0) return false;
    const t = this.terrain;
    const gx = sk.pos.x + sk.vel.x * lead;
    const gz = sk.pos.z + sk.vel.z * lead;
    const gap = sk.pos.y - t.height(gx, gz);
    return gap < Math.max(0.12, -sk.vel.y * lead);
  }

  private airControl() {
    const sk = this.sk;
    const inp = this.inp;
    inp.steer = 0;
    if (this.wasMode !== 'air' && !this.air && this.wasMode !== 'grind') {
      // rolled off something without popping: maybe throw something in
      const T = this.predictAir(sk.vel.x, sk.vel.y, sk.vel.z);
      if (T > 0.5 && this.f?.kind !== 'rail' && this.r() < 0.7) this.air = this.planAir(T, 'drop', false);
      if (this.air && this.air.catchAt > 0 && !sk.flick(this.air.spec)) this.air.catchAt = 0;
    }
    const a = this.air;
    if (this.f?.kind === 'rail' && this.phase === 'line' && !this.airSeen) {
      // spin the board into slide / angled lock while we come down onto the rail
      if (this.railSpin !== 0 && Math.abs(sk.bodySpin) < Math.abs(this.railSpin)) inp.steer = -Math.sign(this.railSpin);
      if (a && sk.trick.active && !sk.trick.caught && a.catchAt >= 0 && (sk.airTime >= a.catchAt || this.landingSoon(0.1))) sk.catchBoard();
      return;
    }
    if (!a) return;
    const tr = sk.trick;
    const soon = this.landingSoon(0.12);
    if (tr.active && !tr.caught) {
      const at = a.lateOn ? a.lateCatch : a.catchAt;
      if (at >= 0 && (sk.airTime >= at || soon)) sk.catchBoard();
    }
    if (a.spin !== 0) {
      const goal = Math.abs(a.spin) - (a.spinFail ? Math.PI * 0.45 : 0.08);
      if (Math.abs(sk.bodySpin) < goal) inp.steer = -Math.sign(a.spin);
    }
    if (a.grab >= 0) {
      if (!sk.grab && sk.airTime >= a.grabFrom && sk.airTime < a.grabUntil && !soon) {
        if (sk.startGrab(a.grab)) a.grabFrom = 99; // once
      } else if (sk.grab && (sk.airTime >= a.grabUntil || (soon && a.grabUntil < 50))) {
        sk.releaseGrab();
        a.grab = -1;
      }
    }
    if (a.late && !a.lateOn && sk.airTime >= a.lateAt && !soon && (!tr.active || (tr.caught && sk.residual() < 0.2))) {
      if (sk.flick(a.late)) a.lateOn = true;
      a.late = null;
    }
  }

  private startGrind() {
    const r = this.r;
    const st = this.style;
    const sk = this.sk;
    const g = sk.grind;
    const m = r() < st.mods ? (r() < 0.5 ? 'nose' : 'tail') : 'none';
    this.grindMods[0] = m;
    this.grindMods[1] = m;
    this.grindSwitch = 99;
    this.hopOff = 0;
    if (r() < st.switchMod) {
      // switch it up halfway: 50-50 to 5-0, boardslide to noseslide...
      const opts = m === 'none' ? MODS_FROM_NONE : m === 'nose' ? MODS_FROM_NOSE : MODS_FROM_TAIL;
      this.grindMods[1] = opts[r() < 0.5 ? 0 : 1];
      this.grindSwitch = 0.45 + r() * 0.5;
    }
    this.inp.grindMod = 'none';
    // sometimes lose it partway (falls off the side: not always a slam)
    this.grindFail = r() < this.bailRate * 1.1 ? 0.3 + r() * 1.2 : -1;
    this.grindSlam = r() < 0.6;
    this.grindPop = r() < 0.75;
    this.air = null;
    // a hop over to the rail or edge alongside?
    this.xfer = null;
    this.xferFrom = g ? g.rail : null;
    this.wantXfer = !!g && this.grindFail < 0 && r() < st.transfer * (this.showing ? 1.3 : 1);
    if (g && this.wantXfer) this.planTransfer(g.rail, g.t, g.spd);
  }

  /** Find the rail alongside to hop to, and where to pop for it. */
  private planTransfer(rail: Rail, t: number, spd: number) {
    this.xfer = null;
    this.xferFrom = rail;
    const list = transfersFor(this.terrain).get(rail);
    if (!list) return;
    const fwd = spd >= 0;
    const v = Math.abs(spd);
    const hl = Math.hypot(rail.b.x - rail.a.x, rail.b.z - rail.a.z) / rail.len;
    const pos = t * hl;
    const hop = v * hl * 0.6; // horizontal distance covered in the air
    const lead = 0.4 + v * 0.3;
    for (const x of list) {
      // pop so we come down well inside the stretch where it runs alongside
      const land = fwd ? Math.max(x.s0 + 0.5, pos + lead + hop) : Math.min(x.s1 - 0.5, pos - lead - hop);
      if ((fwd ? x.s1 - land : land - x.s0) < 0.8) continue;
      this.xfer = x;
      this.xferPop = land - (fwd ? 1 : -1) * hop;
      return;
    }
  }

  private grindControl() {
    const sk = this.sk;
    const g = sk.grind;
    const inp = this.inp;
    if (!g) return;
    if (g.time > this.grindSwitch && this.grindSwitch < 50) {
      // switch it up (and on a long rail, keep switching every couple of seconds)
      this.grindMods[0] = this.grindMods[1];
      const m = this.grindMods[1];
      const opts = m === 'none' ? MODS_FROM_NONE : m === 'nose' ? MODS_FROM_NOSE : MODS_FROM_TAIL;
      this.grindMods[1] = opts[this.r() < 0.5 ? 0 : 1];
      this.grindSwitch = g.time + 1.4 + this.r() * 1.6;
    }
    if (g.time > 0.12) inp.grindMod = this.grindMods[0];
    // balance: cancel the drift and the lean (the stick drives d(balance)/dt)
    const k = Math.min(1.5, 0.5 + g.time * 0.2) * TUNE.balance;
    let bal = 0;
    // rolled on onto the next piece of a kinked rail / hubba: look again
    if (this.xferFrom !== g.rail) {
      if (this.wantXfer) this.planTransfer(g.rail, g.t, g.spd);
      else this.xfer = null;
    }
    const x = this.xfer;
    const hl = Math.hypot(g.rail.b.x - g.rail.a.x, g.rail.b.z - g.rail.a.z) / g.rail.len;
    const pos = g.t * hl;
    const fwd = g.spd >= 0;
    let hop = 0;
    if (x) {
      // lean the other way first, then throw it toward the other rail and pop
      const toGo = fwd ? this.xferPop - pos : pos - this.xferPop;
      const v = Math.abs(g.spd) * hl;
      const s = x.side * g.boardSign;
      if (toGo < v * 0.22) hop = s;
      else if (toGo < v * 0.5) bal = -0.35 * s;
      if (toGo <= 0) {
        const plan = resetPlan(this.planBuf);
        inp.grindMod = 'none';
        if (sk.flick(OLLIE)) {
          this.air = plan;
          this.xferTo = x.to;
        }
        this.xfer = null;
        this.wantXfer = false;
        return;
      }
    }
    let steer = -((g.balance - bal) * k + g.drift * 0.5 * TUNE.balance) / 2.6 - (g.balance - bal) * 1.6;
    if (hop !== 0) steer = hop;
    if (this.grindFail >= 0 && g.time > this.grindFail) {
      if (this.grindSlam) {
        this.grindFail = -1;
        sk.bail('balance', 2.5);
        return;
      }
      steer = Math.sign(g.balance || 1) * 0.6;
    }
    inp.steer = Math.max(-1, Math.min(1, steer));
    // pop out near the end of the rail, with a little something
    const left = fwd ? g.rail.len - g.t : g.t;
    const v = Math.abs(g.spd);
    const atEnd = left < v * 0.18 + 0.1 && !this.hasContinuation(g.rail, fwd) && (this.grindPop || this.joined(g.rail, fwd));
    // on a long rail, hop off to the side before it grinds to a halt
    if (!this.xfer && !atEnd && v < 1.9 && g.time > 1 && g.rail.dir.y > -0.05) {
      if (this.hopOff === 0) this.hopOff = this.r() < 0.5 ? -1 : 1;
      inp.steer = this.hopOff;
      if (Math.abs(sk.steerS) < 0.85) return;
    }
    if (!this.xfer && (atEnd || this.hopOff !== 0)) {
      this.hopOff = 0;
      this.grindPop = false;
      inp.grindMod = 'none';
      // the air we'll get off the end: pop height plus the drop to the ground
      const pv = TUNE.popSpeed * 0.983 * 0.92;
      _v.copy(g.rail.dir).multiplyScalar(g.spd);
      const T = this.predictAir(_v.x, Math.max(0, _v.y) + pv, _v.z);
      const plan = this.planAir(T, 'grind');
      if (plan.spec === OLLIE_N) plan.spec = OLLIE;
      // flip-outs: keep them to one quick flip
      if (plan.catchAt > 0 && plan.spec.special) {
        plan.spec = pickWeighted(this.r, QUICK);
        plan.catchAt = TUNE.flickDelay + TUNE.beat;
      }
      this.pop(plan);
    }
  }

  /** Is another rail joined on at this end (we'd ride onto it unless we pop)? */
  private joined(r: Rail, forward: boolean) {
    const end = forward ? r.b : r.a;
    for (const q of this.terrain.rails) if (q !== r && (near(q.a, end) || near(q.b, end))) return true;
    return false;
  }

  /** Does the rail carry on from this end (and not uphill, where you'd stall out)? */
  private hasContinuation(r: Rail, forward: boolean) {
    const end = forward ? r.b : r.a;
    for (const q of this.terrain.rails) {
      if (q === r) continue;
      if (near(q.a, end)) return q.dir.y < 0.02;
      if (near(q.b, end)) return -q.dir.y < 0.02;
    }
    return false;
  }

  /** Is the bot rolling through (or about to start) a line, for the renderer's culling decisions. */
  get busy() {
    return this.phase === 'line';
  }

  get feature() {
    return this.f;
  }

  /** debug: what it's up to */
  get doing() {
    return this.phase + (this.f ? ':' + this.f.tag : '');
  }
}

const _v = new THREE.Vector3();
const _e = { x: 0, z: 0, pad: 0 };

/** Is p within `r` of the feature's line (run-up + a bit past)? */
function lineNear(f: Feature, p: THREE.Vector3, r: number) {
  if (f.session) {
    const s = f.session;
    if (s.bowl) return Math.hypot(p.x - s.cx, p.z - s.cz) < s.rad + 1;
    const a = (p.x - s.ox) * s.ax + (p.z - s.oz) * s.az;
    const n = (p.x - s.ox) * s.nx + (p.z - s.oz) * s.nz;
    if (a > -2 && a < s.len + 2 && Math.abs(n) < s.half + 4) return true;
  }
  const rx = p.x - f.sx;
  const rz = p.z - f.sz;
  const along = rx * f.dx + rz * f.dz;
  // somebody standing about on the mega ramp tower isn't in the way
  if (f.kind === 'mega' && along < f.at - 30) return false;
  const end = f.at + (f.kind === 'rail' ? f.railLen : f.kind === 'mega' ? Math.max(f.at2, f.at) + 10 : 8);
  if (along < -2 || along > end) return false;
  return Math.abs(-rx * f.dz + rz * f.dx) < r;
}
