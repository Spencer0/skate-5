import * as THREE from 'three';
import { Skater, SkaterInput, TUNE } from './skater';
import type { Terrain, Rail } from './terrain';
import type { LevelData } from './levels/common';
import { GRABS, TrickSpec } from './tricks';
import type { GrindMod } from './tricks';

/**
 * The brains of the park locals: THPS-style bots that ride the real physics.
 *
 * Every NPC is an ordinary Skater driven by a synthesized SkaterInput plus the
 * same flick / catch / grab calls the touch controls make, so they ride the
 * real terrain, lock onto real rails and land or slam by the same rules as the
 * player. Nothing here touches the scene, the HUD or the score.
 *
 * The level is boiled down to a list of Features (a kicker, a quarter pipe, a
 * rail or ledge entry, a gap), each with a straight run-up line. A bot picks a
 * feature it can see, rides to the start of the run-up, lines up, holds its
 * speed, then pops on cue and picks a trick that fits the air it's about to
 * get. Features that keep failing (a run-up that clips a wall, a landing into
 * a box) are dropped for the rest of the level.
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

export type FeatureKind = 'kicker' | 'qp' | 'rail' | 'gap';

export interface Feature {
  id: number;
  kind: FeatureKind;
  /** run-up start */
  sx: number;
  sz: number;
  /** unit heading of the run-up line */
  dx: number;
  dz: number;
  /** along-line distance from the start to the feature (kicker lip, rail entry, gap edge, QP toe) */
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
  tries: number;
  wins: number;
  off: boolean;
  user: number;
  /** scratch: selection weight */
  w: number;
}

const WEIGHT: Record<FeatureKind, number> = { kicker: 1.3, qp: 1.1, rail: 1.4, gap: 0.8 };
const TAU = Math.PI * 2;

function wrapPi(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** A clear, flat run-up from (x,z) along (dx,dz) for `len` metres at height y0 (no walls, no rails in the way). */
function clearRun(t: Terrain, x: number, z: number, dx: number, dz: number, len: number, y0: number, skip: Rail | null) {
  const px = -dz;
  const pz = dx;
  for (let d = 0; d <= len; d += 0.5) {
    for (const lat of [-0.35, 0, 0.35]) {
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
  return Math.abs(x) < t.bounds - 3 && Math.abs(z) < t.bounds - 3 && !wet(t, x, z);
}

/** Would you be in the water here? */
export function wet(t: Terrain, x: number, z: number) {
  const w = t.waterAt(x, z);
  return w !== null && t.height(x, z) < w;
}

/** Do 2D segments p0p1 and q0q1 come within `pad` of each other (approximately)? */
function segHit(p0x: number, p0z: number, p1x: number, p1z: number, q0x: number, q0z: number, q1x: number, q1z: number, pad: number) {
  const d = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => {
    const vx = bx - ax;
    const vz = bz - az;
    const l2 = vx * vx + vz * vz || 1e-9;
    const s = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
    return Math.hypot(ax + vx * s - px, az + vz * s - pz);
  };
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const c1 = cross(p0x, p0z, p1x, p1z, q0x, q0z);
  const c2 = cross(p0x, p0z, p1x, p1z, q1x, q1z);
  const c3 = cross(q0x, q0z, q1x, q1z, p0x, p0z);
  const c4 = cross(q0x, q0z, q1x, q1z, p1x, p1z);
  if (c1 * c2 < 0 && c3 * c4 < 0) return true;
  return Math.min(d(p0x, p0z, p1x, p1z, q0x, q0z), d(p0x, p0z, p1x, p1z, q1x, q1z), d(q0x, q0z, q1x, q1z, p0x, p0z), d(q0x, q0z, q1x, q1z, p1x, p1z)) < pad;
}

const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) < 0.0025;

/** Rail length from `start` along `r`, following kinks onto continuing rails. */
function chainLength(rails: Rail[], r: Rail, fromA: boolean) {
  let len = 0;
  let cur = r;
  let a = fromA;
  for (let i = 0; i < 8; i++) {
    len += cur.len;
    const end = a ? cur.b : cur.a;
    const dir = a ? cur.dir : cur.dir.clone().negate();
    let next: Rail | null = null;
    for (const q of rails) {
      if (q === cur) continue;
      if (near(q.a, end) && q.dir.dot(dir) > 0.5) {
        next = q;
        a = true;
        break;
      }
      if (near(q.b, end) && -q.dir.dot(dir) > 0.5) {
        next = q;
        a = false;
        break;
      }
    }
    if (!next) break;
    cur = next;
  }
  return len;
}

/** Highest rail the bots will try to ollie onto (m above the run-up). */
export function maxRailHeight() {
  return (TUNE.popSpeed * TUNE.popSpeed) / (2 * TUNE.gravity) - 0.1;
}

/** Everything in a level a bot can session, with a clear straight run-up to each. */
export function buildFeatures(t: Terrain, data: LevelData): Feature[] {
  const out: Feature[] = [];
  const add = (f: Omit<Feature, 'id' | 'tries' | 'wins' | 'off' | 'user' | 'w'>) => out.push({ ...f, id: out.length, tries: 0, wins: 0, off: false, user: -1, w: 0 });
  for (const e of t.elements) {
    if (e.kind !== 'kicker' && e.kind !== 'qp') continue;
    const toeX = e.cx - e.c * e.hx;
    const toeZ = e.cz - e.s * e.hx;
    const y0 = t.height(toeX - e.c * 0.4, toeZ - e.s * 0.4);
    if (Math.abs(e.h(-e.hx + 0.01, 0) + 0 - y0) > 0.05) continue; // toe isn't at ground level
    const H = e.h(e.hx - 0.01, 0) - y0;
    const spread = Math.max(0, e.hz - 1.1) * 0.7;
    for (const run of [10, 8, 6.5]) {
      const sx = toeX - e.c * run;
      const sz = toeZ - e.s * run;
      if (!clearRun(t, sx, sz, e.c, e.s, run - 0.4, y0, null)) continue;
      if (e.kind === 'kicker') add({ kind: 'kicker', sx, sz, dx: e.c, dz: e.s, at: run + e.hx * 2, spread, speed: 7, y0, h: H, rail: null, railLen: 0 });
      else {
        const speed = Math.min(8, Math.sqrt(2 * TUNE.gravity * (H + 0.5)));
        add({ kind: 'qp', sx, sz, dx: e.c, dz: e.s, at: run, spread, speed, y0, h: H, rail: null, railLen: 0 });
      }
      break;
    }
  }
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
      if (len < 2.4) continue;
      const y0 = t.height(E.x - dx * 0.7, E.z - dz * 0.7);
      const h = E.y - y0;
      if (h < 0.1 || h > maxH) continue;
      for (const run of [9, 7, 5.5]) {
        const sx = E.x - dx * run;
        const sz = E.z - dz * run;
        if (!clearRun(t, sx, sz, dx, dz, run - 0.4, y0, r)) continue;
        add({ kind: 'rail', sx, sz, dx, dz, at: run, spread: 0, speed: Math.min(6, 4.2 + len * 0.12), y0, h, rail: r, railLen: len });
        break;
      }
    }
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
    const ex = fx + dx * exit;
    const ez = fz + dz * exit;
    const y0 = t.height(ex - dx * 0.3, ez - dz * 0.3);
    for (const run of [9, 7]) {
      const sx = ex - dx * run;
      const sz = ez - dz * run;
      if (!clearRun(t, sx, sz, dx, dz, run - 0.3, y0, null)) continue;
      seen.add(g.id);
      add({ kind: 'gap', sx, sz, dx, dz, at: run, spread: 0, speed: 7.2, y0, h: 0, rail: null, railLen: 0 });
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tricks                                                              */
/* ------------------------------------------------------------------ */

const sp = (flip: number, shove: number, wrap: number, label: string, nollie = false): TrickSpec => ({ flip, shove, wrap, nollie, speed: 1, label });
/** one-beat flip tricks, roughly by how often you'd see them in a session */
const FLIPS: [TrickSpec, number][] = [
  [sp(1, 0, 0, 'Kickflip'), 5],
  [sp(-1, 0, 0, 'Heelflip'), 3],
  [sp(0, -1, 0, 'Pop Shove-it'), 3],
  [sp(0, 1, 0, 'FS Pop Shove-it'), 2],
  [sp(1, -1, 0, 'Varial Kickflip'), 2],
  [sp(-1, 1, 0, 'Varial Heelflip'), 1],
  [sp(1, 1, 0, 'Hardflip'), 1.5],
  [sp(-1, -1, 0, 'Inward Heelflip'), 1],
  [sp(1, -2, 0, '360 Flip'), 2],
  [sp(-1, 2, 0, 'Laser Flip'), 0.6],
  [sp(0, -2, 0, '360 Shove-it'), 1.2],
  [sp(0, 0, 1, 'Impossible'), 0.8],
  [sp(1, 0, 0, 'Nollie Kickflip', true), 1],
  [sp(0, 1, 0, 'Nollie Shove-it', true), 0.8],
];
const OLLIE = sp(0, 0, 0, 'Ollie');
const OLLIE_N = sp(0, 0, 0, 'Nollie', true);

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

/** What the bot will do with the air it's about to get. */
interface AirPlan {
  spec: TrickSpec;
  /** revolutions to wait for before catching (0 for an ollie) */
  turns: number;
  /** airTime to catch at (-1: never: a planned slam) */
  catchAt: number;
  grab: number;
  grabFrom: number;
  grabUntil: number;
  /** body spin target (rad, signed like Skater.bodySpin) */
  spin: number;
  /** stop the spin short (a planned sideways slam) */
  spinFail: boolean;
}

function resetPlan(p: AirPlan): AirPlan {
  p.spec = OLLIE;
  p.turns = 0;
  p.catchAt = 0;
  p.grab = -1;
  p.grabFrom = 0;
  p.grabUntil = 0;
  p.spin = 0;
  p.spinFail = false;
  return p;
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
}

type Phase = 'cruise' | 'goto' | 'line';

const _v = new THREE.Vector3();
/** test instrumentation */
export const DEBUG: Record<string, number> | null = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NPC_DEBUG ? {} : null;
if (DEBUG) Object.assign(DEBUG, { overshoot: 0, slow: 0, boxed: 0, sep: 0, timeout: 0 });

export class NpcBrain {
  readonly sk: Skater;
  readonly inp: SkaterInput = { steer: 0, push: false, pushHold: false, brake: false, grindMod: 'none', crouch: false };
  stats: NpcStats = { pops: 0, lands: 0, bails: 0, grinds: 0, tricks: 0, respawns: 0, attempts: 0 };
  /** how often a trick attempt is deliberately blown (0..1) */
  bailRate: number;
  /** 0..1: bigger tricks, longer grinds */
  skill: number;

  private phase: Phase = 'cruise';
  private f: Feature | null = null;
  private lat = 0;
  private recent: number[] = [];
  private want = 0; // desired heading (rad)
  private target = 4.5; // desired speed
  private tx = 0; // cruise target
  private tz = 0;
  private hasTarget = false;
  private thinkT = 0;
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
  private grindModNext: GrindMod = 'none';
  private railSpin = 0;
  private needRespawn = false;
  private avoid = 0; // extra heading offset from feelers / separation
  private evIdx = 0;
  private cand: Feature[] = [];
  private brakeT = 0;
  private planBuf: AirPlan = resetPlan({} as AirPlan);

  constructor(
    terrain: Terrain,
    public features: Feature[],
    public id: number,
    private r: Rand,
    private spawnPt: { x: number; z: number; heading: number },
  ) {
    this.sk = new Skater(terrain);
    this.sk.autoRevert = true;
    this.bailRate = 0.13 + r() * 0.1;
    this.skill = 0.35 + r() * 0.65;
  }

  get terrain() {
    return this.sk.terrain;
  }

  /** Put the bot somewhere and let it go. */
  place(x: number, z: number, heading: number) {
    this.sk.spawn(x, z, heading);
    this.want = heading;
    this.release();
    this.phase = 'cruise';
    this.hasTarget = false;
    this.slowT = 0;
    this.air = null;
    this.needRespawn = false;
    this.cooldown = 0.5 + this.r() * 1.5;
  }

  /** Let go of the current feature. */
  private release() {
    if (this.f && this.f.user === this.id) this.f.user = -1;
    this.f = null;
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
          this.done();
          break;
        case 'bail':
          this.stats.bails++;
          // a blown trick still proves the spot works; the water or a wall doesn't
          this.done(e.reason === 'uncaught' || e.reason === 'sloppy' || e.reason === 'sideways');
          break;
        case 'grindStart':
          this.stats.grinds++;
          if (this.f?.kind === 'rail') this.win();
          this.startGrind();
          break;
        case 'wall':
          if (this.f && this.phase === 'line') this.done();
          this.avoid = (this.r() < 0.5 ? -1 : 1) * 1.2;
          break;
        case 'respawn':
          this.air = null;
          break;
      }
    }
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
        this.release();
        this.phase = 'cruise';
        this.hasTarget = false;
        this.cooldown = 0.3 + this.r() * 1.2;
      }
    }
    this.air = null;
  }

  /* ------------------------------ thinking -------------------------- */

  private think(dt: number, world: WorldView) {
    const sk = this.sk;
    const t = this.terrain;
    const p = sk.mode === 'bail' ? sk.bpos : sk.pos;
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) || !isFinite(sk.vel.x)) this.needRespawn = true;
    if (Math.abs(p.x) > t.bounds - 1 || Math.abs(p.z) > t.bounds - 1 || p.y < t.floor - 4) this.needRespawn = true;
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
      if (this.slowT > 9 || this.planT > 30) this.needRespawn = true;
    }
    if (this.needRespawn) {
      this.respawn(world, Math.abs(p.x) > t.bounds - 1 || Math.abs(p.z) > t.bounds - 1 || !isFinite(p.x));
      return;
    }
    if (sk.mode !== 'ground') return;
    this.cooldown -= dt;
    this.avoid *= 0.7;
    if (this.phase === 'cruise') {
      if (this.cooldown <= 0 && this.choose(world)) {
        this.phase = 'goto';
        this.planT = 0;
      } else if (!this.hasTarget || Math.hypot(this.tx - p.x, this.tz - p.z) < 3) this.pickCruise(world);
    }
    if (this.phase === 'goto' && this.f) {
      const f = this.f;
      const sx = f.sx - f.dz * -this.lat;
      const sz = f.sz + f.dx * -this.lat;
      const rx = p.x - sx;
      const rz = p.z - sz;
      const along = rx * f.dx + rz * f.dz;
      const lat = -rx * f.dz + rz * f.dx;
      const dist = Math.hypot(rx, rz);
      // on the line and pointing down it: commit
      if (Math.abs(lat) < 0.8 && along > -6 && along < f.at - 3.5 && this.headingErr(Math.atan2(f.dz, f.dx)) < 0.45) {
        this.phase = 'line';
        this.airSeen = false;
        this.stats.attempts++;
        f.tries++;
      } else if (along > f.at - 4 && Math.abs(lat) < 6) {
        // overshot the run-up start: circle round for another go
        if (DEBUG) DEBUG.overshoot++;
        this.giveUp();
      } else if (along < -8 || Math.abs(lat) > 4) {
        // still out in the park: head for a point behind the start
        this.tx = sx - f.dx * 5;
        this.tz = sz - f.dz * 5;
        this.target = dist > 10 ? 4.6 : 3.8;
      } else {
        // close: chase a carrot on the (extended) line so we merge onto it
        const c = Math.max(-4, along + 3);
        this.tx = sx + f.dx * c;
        this.tz = sz + f.dz * c;
        this.target = 3.8;
      }
    } else if (this.phase === 'cruise') {
      this.target = 4.4;
    }
    if (this.phase !== 'line') {
      this.want = Math.atan2(this.tz - p.z, this.tx - p.x);
      this.feel();
      this.hazard();
    }
    this.separate(world);
    if (this.phase === 'cruise') this.maybeFlat(dt, world);
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
    this.release();
    this.phase = 'cruise';
    this.hasTarget = false;
    this.cooldown = 0.5 + this.r();
    this.slowT = 0;
  }

  /** Pick a feature to session. */
  private choose(world: WorldView): boolean {
    const sk = this.sk;
    const r = this.r;
    const cand = this.cand;
    cand.length = 0;
    for (const f of this.features) {
      if (f.off || (f.user >= 0 && f.user !== this.id) || this.recent.includes(f.id)) continue;
      const d = Math.hypot(f.sx - sk.pos.x, f.sz - sk.pos.z);
      if (d > 42) continue;
      if (world.player && lineNear(f, world.player, 5)) continue;
      const fit = f.tries >= 2 ? 0.3 + f.wins / f.tries : 1;
      f.w = WEIGHT[f.kind] * fit * Math.exp(-d / 11) * (0.3 + r());
      cand.push(f);
    }
    cand.sort((a, b) => b.w - a.w);
    let best: Feature | null = null;
    for (let i = 0; i < Math.min(5, cand.length); i++) {
      if (this.reachable(cand[i].sx, cand[i].sz)) {
        best = cand[i];
        break;
      }
    }
    cand.length = 0;
    if (!best) {
      this.cooldown = 1.5;
      return false;
    }
    this.release();
    this.f = best;
    best.user = this.id;
    this.recent.push(best.id);
    if (this.recent.length > 3) this.recent.shift();
    this.lat = (r() * 2 - 1) * best.spread;
    return true;
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
    return true;
  }

  private pickCruise(world: WorldView) {
    const t = this.terrain;
    const p = this.sk.pos;
    for (let i = 0; i < 8; i++) {
      const a = this.r() * TAU;
      const d = 7 + this.r() * 18;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (Math.abs(x) > t.bounds - 6 || Math.abs(z) > t.bounds - 6) continue;
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

  /** Whiskers: steer round walls between here and where we want to go. */
  private feel() {
    const sk = this.sk;
    const t = this.terrain;
    const p = sk.pos;
    const h0 = p.y;
    const reach = 1.2 + Math.min(8, sk.speed) * 0.4;
    const blocked = (a: number) => {
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      let prev = h0;
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
        if (segHit(p.x, p.z, p.x + cx * reach, p.z + cz * reach, r.a.x, r.a.z, r.b.x, r.b.z, 0.3)) return true;
      }
      return false;
    };
    const base = this.want + this.avoid;
    if (!blocked(base)) {
      this.want = base;
      return;
    }
    const pref = wrapPi(this.want - this.heading()) >= 0 ? 1 : -1;
    for (const k of [0.4, 0.8, 1.2, 1.6, 2.2]) {
      for (const s of [pref, -pref]) {
        if (!blocked(base + s * k)) {
          this.want = base + s * k;
          return;
        }
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
      if (d > 4.5 || d < 1e-3) continue;
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

  /** Flatground tricks while cruising. */
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
    this.flatT = 2.5 + this.r() * 5;
    this.pop(this.planAir(this.predictPop(), true));
  }

  /** Estimated airtime if we popped right now. */
  private predictPop() {
    const sk = this.sk;
    _v.copy(sk.groundN).multiplyScalar(0.4);
    _v.y += 0.6;
    _v.normalize();
    if (_v.x * sk.vel.x + _v.z * sk.vel.z < 0) _v.set(0, 1, 0);
    const pv = TUNE.popSpeed * 0.983;
    return this.predictAir(sk.vel.x + _v.x * pv, sk.vel.y + _v.y * pv, sk.vel.z + _v.z * pv);
  }

  /** Ballistic flight time from the current position until the trajectory meets the ground. */
  private predictAir(vx: number, vy: number, vz: number) {
    const t = this.terrain;
    const p = this.sk.pos;
    let x = p.x;
    let y = p.y;
    let z = p.z;
    const h = 1 / 60;
    for (let i = 1; i < 240; i++) {
      vy -= TUNE.gravity * h;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (vy < 0 && y <= t.height(x, z)) return i * h;
    }
    return 4;
  }

  /** Choose a trick for an air of about T seconds. */
  private planAir(T: number, flat = false): AirPlan {
    const r = this.r;
    const plan = resetPlan(this.planBuf);
    const unit = TUNE.flickDelay + TUNE.beat;
    const blow = r() < this.bailRate;
    if (T < unit + 0.12) {
      // only room for an ollie (maybe a little 180)
      if (r() < 0.3) plan.spec = OLLIE_N;
      if (T > 0.55 && r() < 0.35) plan.spin = (r() < 0.5 ? -1 : 1) * Math.PI;
      if (blow && T > 0.4) {
        // over-turn it and come down sideways
        plan.spin = (r() < 0.5 ? -1 : 1) * Math.PI;
        plan.spinFail = true;
      }
      return plan;
    }
    const roll = r();
    const big = T > 1.0;
    if (!flat && big && roll < 0.45) {
      // a grab, held, maybe spun
      plan.grab = Math.floor(r() * GRABS.length);
      plan.grabFrom = 0.12 + r() * 0.1;
      plan.grabUntil = T - 0.22 - r() * 0.15;
      if (r() < 0.45) plan.spin = (r() < 0.5 ? -1 : 1) * Math.PI * (T > 1.5 && r() < 0.5 ? 2 : 1);
      if (blow) {
        // late out of the grab and a half-spun landing
        plan.spin = plan.spin || (r() < 0.5 ? -1 : 1) * Math.PI;
        plan.spinFail = true;
        plan.grabUntil = T + 1;
      }
      return plan;
    }
    plan.spec = pickWeighted(r, FLIPS);
    plan.turns = 1;
    if (T > unit * 2 + 0.2 && this.skill > 0.5 && r() < 0.35 && plan.spec.wrap === 0) plan.turns = 2;
    plan.catchAt = TUNE.flickDelay + TUNE.beat * plan.turns + (r() - 0.5) * 0.03;
    if (T > plan.catchAt + 0.5 && r() < 0.3) plan.spin = (r() < 0.5 ? -1 : 1) * Math.PI;
    if (!flat && T > plan.catchAt + 0.45 && r() < 0.25) {
      plan.grab = Math.floor(r() * GRABS.length);
      plan.grabFrom = plan.catchAt + 0.08;
      plan.grabUntil = T - 0.22;
    }
    if (blow) {
      const how = r();
      if (how < 0.65) plan.catchAt = -1; // never gets a foot back on it
      else {
        plan.spin = plan.spin || (r() < 0.5 ? -1 : 1) * Math.PI;
        plan.spinFail = true;
      }
    }
    return plan;
  }

  private pop(plan: AirPlan) {
    const sk = this.sk;
    if (!sk.flick(plan.spec)) return false;
    this.air = plan;
    return true;
  }

  /** Put the bot somewhere quiet right away (joining a session). */
  respawnNow(world: WorldView) {
    this.respawn(world, true);
  }

  /** Respawn somewhere quiet: a run-up start nobody's looking at, away from the player. */
  private respawn(world: WorldView, force: boolean) {
    const t = this.terrain;
    const r = this.r;
    const ok = (x: number, z: number) => {
      const y = t.height(x, z);
      if (world.visible(x, y, z) || world.visible(x, y + 1.6, z)) return false;
      if (world.player && Math.hypot(world.player.x - x, world.player.z - z) < 12) return false;
      for (const o of world.others) if (o.pos !== this.sk.pos && Math.hypot(o.pos.x - x, o.pos.z - z) < 3) return false;
      return true;
    };
    const n = this.features.length;
    for (let i = 0; i < 10 && n; i++) {
      const f = this.features[Math.floor(r() * n)];
      if (f.off || !ok(f.sx, f.sz)) continue;
      this.place(f.sx, f.sz, Math.atan2(f.dz, f.dx));
      this.stats.respawns++;
      return;
    }
    const s = this.spawnPt;
    for (let i = 0; i < 10; i++) {
      const x = s.x + (r() - 0.5) * 16;
      const z = s.z + (r() - 0.5) * 16;
      if (Math.abs(t.height(x, z) - t.height(s.x, s.z)) > 0.01 || !ok(x, z)) continue;
      this.place(x, z, s.heading);
      this.stats.respawns++;
      return;
    }
    if (force) {
      this.place(s.x + (r() - 0.5) * 6, s.z + (r() - 0.5) * 6, s.heading);
      this.stats.respawns++;
    }
    // else: try again next think
  }

  /* ------------------------------ driving --------------------------- */

  private drive(dt: number) {
    const sk = this.sk;
    const inp = this.inp;
    const f = this.f;
    if (this.wasMode !== 'ground') this.air = null;
    if (this.phase === 'line' && f) {
      // follow the run-up line with a carrot ahead of us on it
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
      if (f.kind === 'rail') {
        // pop so we're above the rail by the time we reach it, then drop onto it
        const v = Math.max(0.5, sk.speed);
        const pv = TUNE.popSpeed * 0.983;
        const need = f.h + 0.12;
        const disc = pv * pv - 2 * TUNE.gravity * need;
        const tUp = disc > 0 ? (pv - Math.sqrt(disc)) / TUNE.gravity : 0.3;
        if (toGo <= v * tUp + 0.3) {
          const latErr = Math.abs(-rx * f.dz + rz * f.dx);
          if (latErr > 0.25 || sk.speed < 2.5) {
            this.giveUp(true);
          } else {
            const plan = resetPlan(this.planBuf);
            const slide = this.r();
            this.railSpin = slide < 0.3 ? (this.r() < 0.5 ? -1 : 1) * 1.45 : slide < 0.45 ? (this.r() < 0.5 ? -1 : 1) * 0.75 : 0;
            plan.spec = this.r() < 0.25 ? OLLIE_N : OLLIE;
            this.pop(plan);
          }
          return;
        }
      } else if (f.kind === 'kicker') {
        if (toGo <= 0.35 + sk.speed * 0.02) {
          if (sk.speed < 4) return this.giveUp(true);
          this.pop(this.planAir(this.predictPop()));
          return;
        }
      } else if (f.kind === 'gap') {
        if (toGo <= 0.25) {
          if (sk.speed < 4.5) return this.giveUp(true);
          this.pop(this.planAir(this.predictPop()));
          return;
        }
      } else if (f.kind === 'qp') {
        // ride up the transition; pop at the lip
        if (toGo < 0) {
          const up = sk.pos.y - f.y0;
          if (up >= f.h - 0.3 && sk.vel.y > 0.5) {
            this.pop(this.planAir(this.predictPop()));
            return;
          }
          if (sk.vel.y < -0.2 || sk.speed < 0.6) {
            // didn't make it to the lip: roll back out
            this.done();
          }
        }
      }
      if (toGo < -8 && f.kind !== 'qp') this.done();
    }
    const err = wrapPi(this.want - this.heading());
    inp.steer = Math.max(-1, Math.min(1, err * 2.4));
    // slow down for tight turns
    let tgt = this.target;
    if (Math.abs(err) > 1.1 && this.phase !== 'line') tgt = Math.min(tgt, 2.6);
    const flat = sk.groundN.y > 0.94;
    const climbing = sk.groundN.y < 0.97 && sk.vel.y > 0;
    if (flat && !climbing && sk.speed < tgt - 0.3 && sk.pushT <= 0 && sk.pushCd <= 0) inp.push = true;
    if (flat && sk.speed > tgt + 1.8 && this.phase !== 'line') inp.brake = true;
    if (this.brakeT > 0) {
      this.brakeT -= dt;
      inp.brake = sk.speed > 1;
      inp.push = false;
    }
    // pump the transitions on the way down
    if (!flat && sk.vel.y < 0 && this.phase !== 'line') inp.pushHold = true;
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
    if (this.wasMode !== 'air' && !this.air) {
      // rolled off something without popping: maybe grab it
      const T = this.predictAir(sk.vel.x, sk.vel.y, sk.vel.z);
      if (T > 0.8 && this.f?.kind !== 'rail' && this.r() < 0.6) {
        const plan = resetPlan(this.planBuf);
        plan.grab = Math.floor(this.r() * GRABS.length);
        plan.grabFrom = 0.1;
        plan.grabUntil = T - 0.22;
        this.air = plan;
      }
    }
    const a = this.air;
    if (this.f?.kind === 'rail' && this.phase === 'line' && !this.airSeen) {
      // spin the board into slide / angled lock while we come down onto the rail
      if (this.railSpin !== 0 && Math.abs(sk.bodySpin) < Math.abs(this.railSpin)) inp.steer = -Math.sign(this.railSpin);
      return;
    }
    if (!a) return;
    const tr = sk.trick;
    const soon = this.landingSoon(0.12);
    if (tr.active && !tr.caught) {
      if (a.catchAt >= 0 && (sk.airTime >= a.catchAt || soon)) {
        sk.catchBoard();
      }
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
  }

  private startGrind() {
    const r = this.r;
    const m = r();
    this.grindModNext = m < 0.25 ? 'nose' : m < 0.5 ? 'tail' : 'none';
    this.inp.grindMod = 'none';
    // sometimes lose it partway (falls off the side: not a slam)
    this.grindFail = r() < this.bailRate * 1.2 ? 0.3 + r() * 1.2 : -1;
    this.grindSlam = r() < 0.6;
    this.grindPop = r() < 0.55;
    this.air = null;
  }

  private grindControl() {
    const sk = this.sk;
    const g = sk.grind;
    const inp = this.inp;
    if (!g) return;
    if (g.time > 0.12) inp.grindMod = this.grindModNext;
    // balance: cancel the drift and the lean (the stick drives d(balance)/dt)
    const k = Math.min(1.5, 0.5 + g.time * 0.2) * TUNE.balance;
    let steer = -(g.balance * k + g.drift * 0.5 * TUNE.balance) / 2.6 - g.balance * 1.6;
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
    const left = g.spd >= 0 ? g.rail.len - g.t : g.t;
    const v = Math.abs(g.spd);
    if (this.grindPop && left < v * 0.18 + 0.1 && !this.hasContinuation(g.rail, g.spd >= 0)) {
      this.grindPop = false;
      const roll = this.r();
      const spec = roll < 0.55 ? OLLIE : roll < 0.8 ? sp(0, this.r() < 0.5 ? 1 : -1, 0, 'Shove-it') : sp(1, 0, 0, 'Kickflip');
      const plan = resetPlan(this.planBuf);
      plan.spec = spec;
      plan.turns = spec === OLLIE ? 0 : 1;
      plan.catchAt = TUNE.flickDelay + TUNE.beat;
      inp.grindMod = 'none';
      if (sk.flick(spec)) this.air = plan;
    }
  }

  private hasContinuation(r: Rail, forward: boolean) {
    const end = forward ? r.b : r.a;
    for (const q of this.terrain.rails) if (q !== r && (near(q.a, end) || near(q.b, end))) return true;
    return false;
  }

  /** Is the bot rolling through (or about to start) a line, for the renderer's culling decisions. */
  get busy() {
    return this.phase === 'line';
  }

  get feature() {
    return this.f;
  }
}

/** Is p within `r` of the feature's line (run-up + a bit past)? */
function lineNear(f: Feature, p: THREE.Vector3, r: number) {
  const rx = p.x - f.sx;
  const rz = p.z - f.sz;
  const along = rx * f.dx + rz * f.dz;
  const end = f.at + (f.kind === 'rail' ? f.railLen : 8);
  if (along < -2 || along > end) return false;
  return Math.abs(-rx * f.dz + rz * f.dx) < r;
}
