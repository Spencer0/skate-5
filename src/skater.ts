import * as THREE from 'three';
import { Terrain, Rail } from './terrain';
import { TrickSpec, TrickResult, trickName, trickPoints, GrindFamily, GrindMod, grindName, grindBasePoints } from './tricks';
import { DECK } from './board';

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const TUNE = {
  gravity: 11,
  popSpeed: 3.75, // m/s -> ~0.64m ollie
  beat: 0.42, // seconds per flip revolution / shove half turn at speed 1
  flickDelay: 0.07, // the board pops before the foot flicks it into rotation
  pushAccel: 7.5,
  pushTime: 0.24,
  pushCooldown: 0.5,
  pushMaxSpeed: 8.2,
  brakeDecel: 5.5,
  rollingResistance: 0.12,
  airDrag: 0.0032,
  grip: 26, // lateral velocity decay rate
  spinRate: 7.2, // body spin rad/s in air at full stick
  grindFriction: 0.45,
  slideFriction: 1.7,
  railMagnet: 0.45,
  ledgeMagnet: 0.36,
  stepMax: 0.1, // taller than this is a wall while rolling
  coyote: 0.12,
  catchSettle: 26,
  balance: 1, // grind instability multiplier (Rail Balance stat lowers it)
};

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

export type Mode = 'ground' | 'air' | 'grind' | 'bail';
export type Quality = 'perfect' | 'clean' | 'sketchy';

export interface TrickRecord {
  name: string;
  points: number;
  quality?: Quality;
  kind: 'trick' | 'grind';
}

export type SkaterEvent =
  | { type: 'pop'; nollie: boolean; fakie: boolean; fromGrind: boolean }
  | { type: 'catch'; quality: Quality; name: string }
  | { type: 'land'; quality: Quality; airTime: number; impact: number; tricks: TrickRecord[] }
  | { type: 'touchdown'; impact: number }
  | { type: 'bail'; reason: string; impact: number }
  | { type: 'grindStart'; name: string; slide: boolean; tricks: TrickRecord[] }
  | { type: 'grindChange'; name: string }
  | { type: 'grindEnd'; record: TrickRecord; popped: boolean }
  | { type: 'push' }
  | { type: 'revert' }
  | { type: 'spinTick' }
  | { type: 'fallOff' }
  | { type: 'wall'; impact: number }
  | { type: 'respawn' };

export interface SkaterInput {
  steer: number;
  push: boolean;
  pushHold: boolean;
  brake: boolean;
  grindMod: GrindMod;
  crouch: boolean;
}

interface TrickState {
  active: boolean;
  caught: boolean;
  flipRate: number;
  delay: number; // seconds until the flick starts the rotation
  shoveRate: number;
  wrapRate: number;
  flip: number;
  shove: number;
  wrap: number;
  start: [number, number, number];
  target: [number, number, number];
  spec: TrickSpec | null;
  quality: Quality;
}

interface GrindState {
  rail: Rail;
  t: number;
  spd: number;
  family: GrindFamily;
  mod: GrindMod;
  rel: number; // canonical relative yaw (rad)
  boardSign: number;
  lip: boolean;
  cross: number; // which way we were crossing the rail (+perp / -perp)
  balance: number;
  drift: number;
  time: number;
  dist: number; // metres ground on this grind (across chained rails)
  name: string;
  points: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class Skater {
  mode: Mode = 'ground';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  fwd = new THREE.Vector3(1, 0, 0);
  up = new THREE.Vector3(0, 1, 0);
  groundN = new THREE.Vector3(0, 1, 0);

  steerS = 0;
  pushT = 0;
  pushCd = 0;
  braking = false;
  slideYaw = 0; // visual powerslide yaw

  airTime = 0;
  sinceGround = 0;
  takeoff = new THREE.Vector3(); // where the current air started (for gaps)
  maxAirY = 0;
  popped = false;
  followPitch = false;
  alignTarget: THREE.Vector3 | null = null;
  bodySpin = 0;
  airTricks: TrickResult[] = [];
  airQualities: Quality[] = [];
  pendingRecords: TrickRecord[] = [];
  fakieAtPop = false;
  nollieAtPop = false;

  trick: TrickState = freshTrick();
  grind: GrindState | null = null;
  lastGrindExit = 0;

  // visual springs
  popPitch = 0;
  popPitchV = 0;
  squash = 0;
  squashV = 0;
  wobble = 0;
  lean = 0;
  yawOffset = 0; // visual-only: eases out landing / lock snaps
  yawDecay = 11; // how fast yawOffset unwinds (slow for the in-air vert turn)
  autoRevert = true; // pivot back to forward after rolling down a ramp fakie
  private lastSteep = -10;
  /** visual-only: the deck is turned end for end (after an odd number of shove-it half turns) */
  boardFlipped = false;
  boost = 0; // extra top speed while the special meter is full
  posOffset = new THREE.Vector3(); // visual-only: eases the magnet snap onto rails
  carry = false; // holding forward: carry over lips instead of vert assist

  // bail
  bailT = 0;
  bpos = new THREE.Vector3();
  bvel = new THREE.Vector3();
  bq = new THREE.Quaternion();
  bw = new THREE.Vector3();

  safePos = new THREE.Vector3();
  safeFwd = new THREE.Vector3(1, 0, 0);
  private safeT = 0;
  time = 0;
  distance = 0; // for wheel spin
  events: SkaterEvent[] = [];

  constructor(public terrain: Terrain) {}

  spawn(x: number, z: number, heading: number) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.fwd.set(Math.cos(heading), 0, Math.sin(heading));
    this.up.copy(UP);
    this.mode = 'ground';
    this.trick = freshTrick();
    this.grind = null;
    this.airTricks = [];
    this.pendingRecords = [];
    this.alignTarget = null;
    this.popped = false;
    this.popPitch = this.popPitchV = this.squash = this.squashV = 0;
    this.slideYaw = 0;
    this.safePos.copy(this.pos);
    this.safeFwd.copy(this.fwd);
  }

  get speed() {
    return this.vel.length();
  }

  /** Signed speed along the board (negative = fakie). */
  get fwdSpeed() {
    return this.vel.dot(this.fwd);
  }

  /* ---------------------------------------------------------------- */

  step(dt: number, inp: SkaterInput) {
    this.time += dt;
    this.carry = inp.pushHold;
    this.steerS += (inp.steer - this.steerS) * Math.min(1, dt * 14);
    this.updateSprings(dt);
    switch (this.mode) {
      case 'ground':
        this.groundStep(dt, inp);
        break;
      case 'air':
        this.airStep(dt, inp);
        break;
      case 'grind':
        this.grindStep(dt, inp);
        break;
      case 'bail':
        this.bailStep(dt);
        break;
    }
    if (this.mode !== 'bail') this.settleTrick(dt);
  }

  private updateSprings(dt: number) {
    // pop pitch: under-damped so the board snaps up and levels out
    const k = 260;
    const c = 20;
    this.popPitchV += (-k * this.popPitch - c * this.popPitchV) * dt;
    this.popPitch += this.popPitchV * dt;
    const k2 = 420;
    const c2 = 22;
    this.squashV += (-k2 * this.squash - c2 * this.squashV) * dt;
    this.squash += this.squashV * dt;
    this.wobble *= Math.exp(-dt * 3);
    this.yawOffset *= Math.exp(-dt * this.yawDecay);
    this.posOffset.multiplyScalar(Math.exp(-dt * 16));
  }

  /* ------------------------------ ground --------------------------- */

  private groundStep(dt: number, inp: SkaterInput) {
    const t = this.terrain;
    const n = t.normal(this.pos.x, this.pos.z, this.groundN);
    this.up.copy(n);
    projectOnPlane(this.fwd, n).normalize();
    this.sinceGround = 0;
    this.airTime = 0;

    const speed0 = this.vel.length();
    // steering
    const sp = speed0;
    const yawRate = this.steerS * (0.9 + 2.2 / (1 + sp * 0.35));
    this.fwd.applyAxisAngle(n, -yawRate * dt);

    // gravity along the slope
    tmp.set(0, -TUNE.gravity, 0);
    projectOnPlane(tmp, n);
    this.vel.addScaledVector(tmp, dt);
    projectOnPlane(this.vel, n);

    // wheels: kill lateral velocity, keep speed (carving)
    const right = tmp2.crossVectors(this.fwd, n).normalize();
    const vf = this.vel.dot(this.fwd);
    let vl = this.vel.dot(right);
    const spd = this.vel.length();
    vl *= Math.exp(-TUNE.grip * dt);
    this.vel.copy(this.fwd).multiplyScalar(vf).addScaledVector(right, vl);
    const l = this.vel.length();
    if (l > 1e-4) this.vel.multiplyScalar(spd / l);
    // carving bleeds a little speed
    this.vel.multiplyScalar(1 - Math.abs(this.steerS) * 0.05 * dt);

    // push
    this.pushCd -= dt;
    if ((inp.push || (inp.pushHold && this.pushT <= 0)) && this.pushCd <= 0 && !inp.brake && n.y > 0.94) {
      this.pushT = TUNE.pushTime;
      this.pushCd = TUNE.pushCooldown;
      this.events.push({ type: 'push' });
      this.squashV -= 0.35;
    }
    if (this.pushT > 0) {
      this.pushT -= dt;
      const dir = vf < -0.3 ? -1 : 1;
      const s = this.vel.length();
      const f = Math.max(0, 1 - s / (TUNE.pushMaxSpeed + this.boost));
      // the push ramps in and out for a smooth kick
      const ph = 1 - this.pushT / TUNE.pushTime;
      const env = Math.sin(Math.PI * Math.min(1, Math.max(0, ph)));
      this.vel.addScaledVector(this.fwd, dir * TUNE.pushAccel * f * env * 1.6 * dt);
    }

    // brake / powerslide
    this.braking = inp.brake && this.vel.length() > 0.3;
    if (this.braking) {
      const s = this.vel.length();
      const ns = Math.max(0, s - TUNE.brakeDecel * dt);
      this.vel.multiplyScalar(s > 0 ? ns / s : 0);
    }
    const slideTarget = this.braking && this.vel.length() > 2 ? 1.25 * (this.steerS >= 0 ? 1 : -1) : 0;
    this.slideYaw += (slideTarget - this.slideYaw) * Math.min(1, dt * 9);

    // rolling resistance + drag
    {
      const s = this.vel.length();
      if (s > 0) {
        const ns = Math.max(0, s - (TUNE.rollingResistance + TUNE.airDrag * s * s) * dt);
        this.vel.multiplyScalar(ns / s);
      }
    }

    // integrate
    const next = tmp.copy(this.pos).addScaledVector(this.vel, dt);
    const hN = t.height(next.x, next.z);
    if (hN - next.y > TUNE.stepMax) {
      this.hitWall(next, dt);
      return;
    }
    const gap = next.y - hN;
    const tol = 0.5 * TUNE.gravity * dt * dt + 0.0004;
    if (gap > tol) {
      // the ground fell away faster than we can follow: airborne
      this.pos.copy(next);
      this.distance += this.vel.length() * dt;
      this.launch(false);
      return;
    }
    this.distance += this.vel.length() * dt;
    this.pos.copy(next);
    this.pos.y = hN;
    const n2 = t.normal(this.pos.x, this.pos.z, tmp2);
    const s = this.vel.length();
    projectOnPlane(this.vel, n2);
    const l2 = this.vel.length();
    if (l2 > 1e-5) this.vel.multiplyScalar(s / l2);

    const gw = t.waterAt(this.pos.x, this.pos.z);
    if (gw !== null && this.pos.y < gw) {
      this.bail('water', 0);
      return;
    }

    // revert: rolled back down a ramp backwards -> pivot to face forward
    if (n2.y < 0.85) this.lastSteep = this.time;
    if (this.autoRevert && n2.y > 0.97 && this.time - this.lastSteep < 1.2 && this.fwdSpeed < -1.2 && !this.braking) {
      this.fwd.negate();
      this.yawOffset += Math.PI * (this.steerS < -0.1 ? -1 : 1);
      this.yawDecay = 9;
      this.lastSteep = -10;
      this.events.push({ type: 'revert' });
    }

    // safe spot for respawn
    this.safeT += dt;
    if (this.safeT > 0.25) {
      this.safeT = 0;
      if (n2.y > 0.999 && this.isClear(this.pos.x, this.pos.z)) {
        this.safePos.copy(this.pos);
        this.safeFwd.set(this.fwd.x, 0, this.fwd.z).normalize();
      }
    }
  }

  private isClear(x: number, z: number) {
    const h = this.terrain.height(x, z);
    for (const [dx, dz] of [
      [1.2, 0],
      [-1.2, 0],
      [0, 1.2],
      [0, -1.2],
    ]) {
      if (Math.abs(this.terrain.height(x + dx, z + dz) - h) > 0.02) return false;
    }
    return true;
  }

  private hitWall(next: THREE.Vector3, _dt: number) {
    const wn = this.terrain.wallNormal(next.x, next.z, this.vel, tmp2);
    const vn = this.vel.x * wn.x + this.vel.z * wn.z;
    if (vn < 0) {
      const impact = -vn;
      if (impact > 4.6 && this.mode === 'ground') {
        this.bail('wall', impact);
        return;
      }
      this.vel.x -= wn.x * vn * 1.35;
      this.vel.z -= wn.z * vn * 1.35;
      this.vel.multiplyScalar(0.8);
      // turn the board along the wall
      if (this.mode === 'ground') {
        const fn = this.fwd.x * wn.x + this.fwd.z * wn.z;
        if (Math.abs(fn) < 0.85) {
          this.fwd.x -= wn.x * fn;
          this.fwd.z -= wn.z * fn;
          this.fwd.normalize();
        }
      }
      if (impact > 0.6) this.events.push({ type: 'wall', impact });
    }
    this.pos.x += wn.x * 0.004;
    this.pos.z += wn.z * 0.004;
  }

  /* ------------------------------ air ------------------------------ */

  /** Leave the ground (rolled off a lip, or popped). */
  private launch(popped: boolean) {
    const n = this.groundN;
    this.mode = 'air';
    this.takeoff.copy(this.pos);
    this.maxAirY = this.pos.y;
    this.popped = popped;
    this.airTime = 0;
    this.sinceGround = 0;
    this.bodySpin = 0;
    this.followPitch = n.y < 0.985;
    // vert assist: launching off a steep transition sends you straight up so
    // you come back down into the ramp instead of onto the deck.
    if (n.y < 0.72 && this.vel.y > 0) {
      const hx = n.x;
      const hz = n.z;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-3) {
        const ux = hx / hl;
        const uz = hz / hl;
        const into = -(this.vel.x * ux + this.vel.z * uz);
        // no deck behind the lip (spine): let momentum carry you over
        const behind = this.terrain.height(this.pos.x - ux * 0.6, this.pos.z - uz * 0.6);
        const spine = behind < this.pos.y - 0.35 || this.carry;
        if (into > 0 && !spine) {
          this.vel.x += ux * into;
          this.vel.z += uz * into;
        }
        // straight up and back down: turn 180 in the air so you come down
        // facing forward (THPS-style, free - it doesn't count as a spin)
        if (!spine && this.vel.dot(this.fwd) > 0.3) {
          this.fwd.negate();
          this.yawOffset += Math.PI * (this.steerS < -0.1 ? -1 : 1);
          this.yawDecay = 3.4;
        }
        if (!spine) {
          this.vel.x += ux * 0.22;
          this.vel.z += uz * 0.22;
          this.pos.x += ux * 0.05;
          this.pos.z += uz * 0.05;
        }
      }
      this.followPitch = true;
    }
  }

  private airStep(dt: number, inp: SkaterInput) {
    this.airTime += dt;
    this.sinceGround += dt;
    const t = this.terrain;

    // body spin
    if (this.alignTarget) {
      // auto-rotate out of slides/angled grinds
      const cur = Math.atan2(this.fwd.z, this.fwd.x);
      const tgt = Math.atan2(this.alignTarget.z, this.alignTarget.x);
      const d = wrapPi(tgt - cur);
      const stepA = Math.sign(d) * Math.min(Math.abs(d), 9 * dt);
      this.fwd.applyAxisAngle(this.up, stepA);
      if (Math.abs(d) < 0.02) this.alignTarget = null;
    }
    // spins need a deliberate push on the stick so carving into a pop doesn't spin you
    const sv = Math.abs(inp.steer);
    if (sv > 0.4 && !this.alignTarget) {
      const a = -Math.sign(inp.steer) * ((sv - 0.4) / 0.6) ** 0.8 * TUNE.spinRate * dt;
      this.fwd.applyAxisAngle(this.up, a);
      this.bodySpin += a;
    }

    // orientation follows the trajectory off ramps
    if (this.followPitch && this.vel.lengthSq() > 2) {
      const right = tmp.crossVectors(this.fwd, this.up).normalize();
      const L = tmp2.copy(this.vel).normalize();
      if (L.dot(this.fwd) < 0) L.negate();
      L.addScaledVector(right, -L.dot(right));
      if (L.lengthSq() > 0.09) {
        L.normalize();
        const cross = tmpV3.crossVectors(this.fwd, L);
        const angle = Math.atan2(cross.dot(right), this.fwd.dot(L));
        const a = angle * Math.min(1, 3.5 * dt);
        this.fwd.applyAxisAngle(right, a);
        this.up.applyAxisAngle(right, a);
      }
    }
    // level out / prepare for landing
    {
      const px = this.pos.x + this.vel.x * 0.1;
      const pz = this.pos.z + this.vel.z * 0.1;
      const gh = t.height(px, pz);
      const gap = this.pos.y - gh;
      const n = t.normal(px, pz, tmp);
      let rate: number;
      let target: THREE.Vector3;
      if (gap < 1.8) {
        const w = 1 - Math.max(0, gap) / 1.8;
        rate = (2 + 12 * w) * w;
        target = n;
      } else {
        rate = this.followPitch ? 0 : 3;
        target = UP;
      }
      if (rate > 0) {
        tmpQ.setFromUnitVectors(this.up, target);
        const q = new THREE.Quaternion().slerp(tmpQ, Math.min(1, rate * dt));
        this.up.applyQuaternion(q).normalize();
        this.fwd.applyQuaternion(q);
      }
    }
    projectOnPlane(this.fwd, this.up).normalize();

    // ballistics
    this.vel.y -= TUNE.gravity * dt;
    const s = this.vel.length();
    if (s > 0) this.vel.multiplyScalar(1 - TUNE.airDrag * s * dt);
    const prev = tmpPrev.copy(this.pos);
    const next = tmpNext.copy(this.pos).addScaledVector(this.vel, dt);

    if (this.time - this.lastGrindExit > 0.2 && this.tryGrind(prev, next)) return;

    if (next.y > this.maxAirY) this.maxAirY = next.y;
    const wy = t.waterAt(next.x, next.z);
    if (wy !== null && next.y < wy) {
      this.pos.copy(next);
      this.bail('water', 0);
      return;
    }
    const hN = t.height(next.x, next.z);
    if (next.y <= hN) {
      const pen = hN - next.y;
      if (pen < 0.26 || prev.y >= hN - 0.02) {
        this.pos.copy(next);
        this.pos.y = hN;
        this.land();
        return;
      }
      // side of a box: bounce off it
      this.pos.y = next.y;
      this.hitWall(next, dt);
      return;
    }
    this.distance += 0; // wheels free-spin in air
    this.pos.copy(next);
    if (this.pos.y < -10) this.respawn();
  }

  /* ------------------------------ tricks --------------------------- */

  /** Flick gesture released. Returns true if it started something. */
  flick(spec: TrickSpec): boolean {
    if (this.mode === 'bail') return false;
    const canPop = this.mode === 'ground' || this.mode === 'grind' || (this.mode === 'air' && !this.popped && this.sinceGround < TUNE.coyote);
    if (this.mode === 'air' && !canPop) {
      if (spec.flip === 0 && spec.shove === 0 && spec.wrap === 0) return false;
      // late flick in the air: only once the previous trick is settled
      if (this.trick.active && (!this.trick.caught || this.residual() > 0.2)) return false;
      this.startTrick(spec);
      return true;
    }
    if (!canPop) return false;
    const fromGrind = this.mode === 'grind';
    const fakie = this.fwdSpeed < -0.3;
    this.fakieAtPop = fakie;
    this.nollieAtPop = spec.nollie;
    const popV = TUNE.popSpeed * (0.94 + 0.1 * ((spec.speed - 0.85) / 0.35));
    if (this.mode === 'grind') {
      const g = this.grind!;
      // pop out to the far side (or wherever you steer)
      const px = -g.rail.dir.z;
      const pz = g.rail.dir.x;
      const pl = Math.hypot(px, pz) || 1;
      const side = g.cross * 0.9 + this.steerS * 1.3 * g.boardSign;
      this.exitGrind(true);
      this.vel.y = Math.max(0, this.vel.y) + popV * 0.92;
      this.vel.x += (px / pl) * side;
      this.vel.z += (pz / pl) * side;
    } else {
      const n = this.mode === 'ground' ? this.groundN : UP;
      const dir = tmp.copy(n).multiplyScalar(0.4).addScaledVector(UP, 0.6).normalize();
      // never let the pop push back against the direction of travel (kicker lips)
      if (dir.x * this.vel.x + dir.z * this.vel.z < 0) {
        dir.x = 0;
        dir.z = 0;
        dir.normalize();
      }
      if (this.mode === 'air') this.vel.y = Math.max(this.vel.y, 0);
      this.vel.addScaledVector(dir, popV);
      if (this.mode === 'ground') this.launch(true);
    }
    this.mode = 'air';
    this.popped = true;
    this.airTricks = [];
    this.airQualities = [];
    this.bodySpin = 0;
    this.airTime = 0;
    // tail pops pitch the nose up; nose pops pitch it down
    const sgn = spec.nollie ? -1 : 1;
    this.popPitchV += sgn * 10.5;
    this.events.push({ type: 'pop', nollie: spec.nollie, fakie, fromGrind });
    this.startTrick(spec);
    return true;
  }

  private startTrick(spec: TrickSpec) {
    const tr = this.trick;
    // fold any settled previous rotation into the start angles
    tr.start = [tr.target[0], tr.target[1], tr.target[2]];
    if (!tr.active) tr.start = [0, 0, 0];
    tr.flip = tr.start[0];
    tr.shove = tr.start[1];
    tr.wrap = tr.start[2];
    const k = spec.speed / TUNE.beat;
    tr.flipRate = spec.flip * TAU * k;
    tr.shoveRate = spec.shove * Math.PI * k;
    tr.wrapRate = spec.wrap * TAU * k;
    tr.spec = spec;
    tr.delay = TUNE.flickDelay;
    tr.active = true;
    tr.caught = spec.flip === 0 && spec.shove === 0 && spec.wrap === 0;
    tr.target = [tr.flip, tr.shove, tr.wrap];
    tr.quality = 'clean';
    if (tr.caught) this.recordTrick(tr, 'clean');
  }

  /** Tap to catch the board. */
  catchBoard(): boolean {
    const tr = this.trick;
    if (!tr.active || tr.caught || this.mode === 'bail') return false;
    tr.caught = true;
    const snap = (a: number, period: number, rate: number) => {
      let tgt = Math.round(a / period) * period;
      // a catch just before completing a turn finishes the turn
      const behind = (tgt - a) * Math.sign(rate);
      if (rate !== 0 && behind < -period * 0.38) tgt += Math.sign(rate) * period;
      return tgt;
    };
    tr.target = [snap(tr.flip, TAU, tr.flipRate), snap(tr.shove, Math.PI, tr.shoveRate), snap(tr.wrap, TAU, tr.wrapRate)];
    const err = Math.max(Math.abs(tr.target[0] - tr.flip) / TAU, Math.abs(tr.target[1] - tr.shove) / Math.PI, Math.abs(tr.target[2] - tr.wrap) / TAU);
    // err is a fraction of a turn: 0..0.5
    const q: Quality = err < 0.07 ? 'perfect' : err < 0.2 ? 'clean' : 'sketchy';
    tr.quality = q;
    const name = this.recordTrick(tr, q);
    this.events.push({ type: 'catch', quality: q, name });
    return true;
  }

  private recordTrick(tr: TrickState, q: Quality) {
    const r: TrickResult = {
      flips: Math.round((tr.target[0] - tr.start[0]) / TAU),
      shoves: Math.round((tr.target[1] - tr.start[1]) / Math.PI),
      wraps: Math.round((tr.target[2] - tr.start[2]) / TAU),
      body: 0,
      nollie: this.airTricks.length === 0 && this.nollieAtPop,
      fakie: this.airTricks.length === 0 && this.fakieAtPop,
      special: tr.spec?.special,
    };
    this.airTricks.push(r);
    this.airQualities.push(q);
    return trickName(r);
  }

  private settleTrick(dt: number) {
    const tr = this.trick;
    if (!tr.active) return;
    if (!tr.caught) {
      if (tr.delay > 0) {
        tr.delay -= dt;
        return;
      }
      // tick each time the board comes back around: a timing cue for the catch
      const before = this.catchPhase();
      tr.flip += tr.flipRate * dt;
      tr.shove += tr.shoveRate * dt;
      tr.wrap += tr.wrapRate * dt;
      if (Math.floor(this.catchPhase()) > Math.floor(before)) this.events.push({ type: 'spinTick' });
      return;
    }
    const k = 1 - Math.exp(-dt * TUNE.catchSettle);
    tr.flip += (tr.target[0] - tr.flip) * k;
    tr.shove += (tr.target[1] - tr.shove) * k;
    tr.wrap += (tr.target[2] - tr.wrap) * k;
    if (this.mode === 'ground' && this.residual() < 0.002) {
      tr.active = false;
      tr.flip = tr.shove = tr.wrap = 0;
      tr.target = [0, 0, 0];
    }
  }

  /** Turns completed on the dominant rotation axis (for the catch tick). */
  private catchPhase() {
    const tr = this.trick;
    const f = Math.abs((tr.flip - tr.start[0]) / TAU);
    const s = Math.abs((tr.shove - tr.start[1]) / Math.PI);
    const w = Math.abs((tr.wrap - tr.start[2]) / TAU);
    if (tr.flipRate !== 0) return f + 0.06;
    if (tr.wrapRate !== 0) return w + 0.06;
    return s + 0.06;
  }

  /** Remaining rotation error in radians (max axis). */
  residual() {
    const tr = this.trick;
    if (!tr.active) return 0;
    return Math.max(Math.abs(tr.target[0] - tr.flip), Math.abs(tr.target[1] - tr.shove), Math.abs(tr.target[2] - tr.wrap));
  }

  /** Fold whole rotations into the base frame; keep the residual for visuals. */
  private foldTrick() {
    const tr = this.trick;
    if (!tr.active) return;
    // a shove-it turns the deck end for end under the rider; the rider (and
    // so fwd, stance and the camera) keep facing the same way
    const halfTurns = Math.round(tr.target[1] / Math.PI);
    if (Math.abs(halfTurns) % 2 === 1) this.boardFlipped = !this.boardFlipped;
    tr.flip -= tr.target[0];
    tr.shove -= tr.target[1];
    tr.wrap -= tr.target[2];
    tr.target = [0, 0, 0];
    tr.start = [0, 0, 0];
  }

  /** Finalize names with body spin; returns records. */
  private finalizeAirTricks(landQ: Quality): TrickRecord[] {
    const body = Math.round(this.bodySpin / Math.PI);
    const out: TrickRecord[] = [];
    this.airTricks.forEach((r, i) => {
      if (i === 0) r.body = body;
      const q = this.airQualities[i];
      out.push({ name: trickName(r), points: trickPoints(r), quality: worst(q, landQ), kind: 'trick' });
    });
    if (this.airTricks.length === 0 && body !== 0) {
      const r: TrickResult = { flips: 0, shoves: 0, wraps: 0, body, nollie: false, fakie: false };
      out.push({ name: trickName(r), points: trickPoints(r) - 100, quality: landQ, kind: 'trick' });
    }
    this.airTricks = [];
    this.airQualities = [];
    this.bodySpin = 0;
    return out;
  }

  /* ------------------------------ landing -------------------------- */

  private land() {
    const t = this.terrain;
    const n = t.normal(this.pos.x, this.pos.z, this.groundN);
    const vn = this.vel.dot(n);
    const impact = Math.max(0, -vn);
    this.vel.addScaledVector(n, -vn);
    const airTime = this.airTime;
    const tr = this.trick;

    if (tr.active && !tr.caught) return this.bail('uncaught', impact);
    if (this.residual() > 0.62) return this.bail('sloppy', impact);
    if (impact > 11.5) return this.bail('impact', impact);

    // fold the trick, then line the board up with the direction of travel
    this.foldTrick();
    this.up.copy(n);
    projectOnPlane(this.fwd, n).normalize();
    let angle = 0;
    const vt = this.vel.length();
    if (vt > 0.8) {
      const vd = tmp.copy(this.vel).divideScalar(vt);
      const c = this.fwd.dot(vd);
      angle = Math.acos(Math.min(1, Math.abs(c)));
      if (angle > 1.05) return this.bail('sideways', impact);
      // snap to forward or fakie (the visual eases into it)
      const sign = c >= 0 ? 1 : -1;
      const before = tmp2.copy(this.fwd);
      this.fwd.copy(vd).multiplyScalar(sign);
      const cr = tmpV3.crossVectors(this.fwd, before).dot(n);
      this.yawOffset += Math.atan2(cr, this.fwd.dot(before));
      this.vel.multiplyScalar(1 - 0.55 * (angle / 1.05) ** 2);
    }
    // soak up some of the impact
    this.vel.multiplyScalar(1 - Math.min(0.22, impact * 0.012));

    const res = this.residual();
    let q: Quality = 'clean';
    const allPerfect = this.airQualities.length > 0 && this.airQualities.every((x) => x === 'perfect');
    if (res > 0.26 || angle > 0.55) q = 'sketchy';
    else if (allPerfect && angle < 0.25) q = 'perfect';
    if (impact > 8) q = 'sketchy';

    this.mode = 'ground';
    this.squashV -= Math.min(2.2, 0.4 + impact * 0.22);
    if (q === 'sketchy') this.wobble = 1;
    const meaningful = this.popped || airTime > 0.35 || this.airTricks.length > 0;
    if (meaningful) {
      const tricks = this.finalizeAirTricks(q);
      this.events.push({ type: 'land', quality: q, airTime, impact, tricks });
    } else {
      this.bodySpin = 0;
      if (impact > 0.4) this.events.push({ type: 'touchdown', impact });
    }
    this.popped = false;
    this.alignTarget = null;
    this.yawDecay = Math.max(this.yawDecay, 9);
  }

  /* ------------------------------ grinds --------------------------- */

  private tryGrind(prev: THREE.Vector3, next: THREE.Vector3): boolean {
    if (this.vel.y > 0.6) return false;
    // rolling off an edge isn't a grind; you have to pop onto it
    if (!this.popped && this.airTime < 0.25 && this.time - this.lastGrindExit > 0.5) return false;
    for (const r of this.terrain.rails) {
      if (next.x < r.minX || next.x > r.maxX || next.z < r.minZ || next.z > r.maxZ) continue;
      const dx = r.b.x - r.a.x;
      const dz = r.b.z - r.a.z;
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      let s = ((next.x - r.a.x) * dx + (next.z - r.a.z) * dz) / l2;
      if (s < 0.01 || s > 0.99) continue;
      const cx = r.a.x + dx * s;
      const cz = r.a.z + dz * s;
      const lat = Math.hypot(next.x - cx, next.z - cz);
      const mag = r.kind === 'rail' ? TUNE.railMagnet : TUNE.ledgeMagnet;
      if (lat > mag) continue;
      const ry = r.a.y + (r.b.y - r.a.y) * s;
      const dy = next.y - ry;
      if (dy > 0.05 || dy < -0.28) continue;
      if (prev.y < ry - 0.06) continue;
      const hl = Math.sqrt(l2);
      const along = (this.vel.x * dx + this.vel.z * dz) / hl;
      if (Math.abs(along) < 0.9) continue;
      // locked on
      if (this.trick.active && (!this.trick.caught || this.residual() > 0.7)) {
        this.pos.set(cx, ry, cz);
        this.bail('uncaught', 3);
        return true;
      }
      this.posOffset.set(next.x - cx, next.y - ry, next.z - cz);
      this.startGrind(r, s, along);
      return true;
    }
    return false;
  }

  private startGrind(r: Rail, s: number, _alongH: number) {
    this.foldTrick();
    const dirH = tmp.set(r.dir.x, 0, r.dir.z).normalize();
    const fH = tmp2.set(this.fwd.x, 0, this.fwd.z).normalize();
    const boardSign = fH.dot(dirH) >= 0 ? 1 : -1;
    const base = dirH.clone().multiplyScalar(boardSign);
    // signed yaw of board relative to base (CCW positive)
    const rel = wrapPi(Math.atan2(-fH.z, fH.x) - Math.atan2(-base.z, base.x));
    const a = Math.abs(rel);
    let family: GrindFamily;
    let canon: number;
    if (a < 0.49) {
      family = 'parallel';
      canon = 0;
    } else if (a < 1.08) {
      family = 'angled';
      canon = Math.sign(rel) * 0.62;
    } else {
      family = 'slide';
      canon = Math.sign(rel) * (Math.PI / 2);
    }
    // lipslide when the tail crossed the rail first
    const perpX = -dirH.z;
    const perpZ = dirH.x;
    const vp = this.vel.x * perpX + this.vel.z * perpZ;
    const fn = fH.x * perpX + fH.z * perpZ;
    const lip = family === 'slide' && Math.abs(vp) > 0.25 && Math.sign(fn) !== Math.sign(vp);

    const spd = this.vel.dot(r.dir);
    const tr = this.finalizeAirTricks('clean');
    this.grind = {
      rail: r,
      t: s * r.len,
      spd,
      family,
      mod: 'none',
      rel: canon,
      boardSign,
      lip,
      cross: Math.abs(vp) > 0.2 ? Math.sign(vp) : 0,
      balance: (Math.random() - 0.5) * 0.25,
      drift: (Math.random() - 0.5) * 0.6,
      time: 0,
      dist: 0,
      name: grindName(family, 'none', lip, r.kind === 'ledge'),
      points: 0,
    };
    this.mode = 'grind';
    this.popped = false;
    this.alignTarget = null;
    this.squashV -= 0.8;
    this.events.push({ type: 'grindStart', name: this.grind.name, slide: family === 'slide', tricks: tr });
  }

  private grindStep(dt: number, inp: SkaterInput) {
    const g = this.grind!;
    const r = g.rail;
    g.time += dt;
    // live grind modifier from the trick stick
    if (inp.grindMod !== g.mod) {
      g.mod = inp.grindMod;
      const nm = grindName(g.family, g.mod, g.lip, r.kind === 'ledge');
      if (nm !== g.name) {
        g.name = nm;
        this.events.push({ type: 'grindChange', name: nm });
      }
    }
    const slide = g.family === 'slide' || (g.family === 'angled' && g.mod !== 'none');
    const acc = -TUNE.gravity * r.dir.y;
    g.spd += acc * dt;
    const fr = (slide ? TUNE.slideFriction : TUNE.grindFriction) * r.friction;
    const sgn = Math.sign(g.spd);
    g.spd -= sgn * Math.min(Math.abs(g.spd), fr * dt);
    g.t += g.spd * dt;
    g.dist += Math.abs(g.spd) * dt;

    // balance: unstable equilibrium nudged by drift; steer to correct
    g.drift += (Math.random() - 0.5) * 5 * dt;
    g.drift = Math.max(-0.9, Math.min(0.9, g.drift * (1 - 0.4 * dt)));
    const k = Math.min(1.5, 0.5 + g.time * 0.2) * TUNE.balance;
    g.balance += (g.balance * k + g.drift * 0.5 * TUNE.balance + inp.steer * 2.6) * dt;
    if (Math.abs(g.balance) > 1) {
      // lost it: slip off the side you were leaning to
      const side = Math.sign(g.balance);
      const right = tmp.crossVectors(this.fwd, this.up);
      right.y = 0;
      right.normalize();
      this.pos.copy(r.a).addScaledVector(r.dir, g.t);
      this.vel.copy(r.dir).multiplyScalar(g.spd);
      this.vel.addScaledVector(right, side * 1.3);
      this.exitGrind(false);
      const vh = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
      this.alignTarget = vh.multiplyScalar(this.fwd.dot(vh) >= 0 ? 1 : -1);
      this.lastGrindExit = this.time + 0.4;
      this.wobble = 1;
      this.events.push({ type: 'fallOff' });
      return;
    }

    this.pos.copy(r.a).addScaledVector(r.dir, g.t);
    this.vel.copy(r.dir).multiplyScalar(g.spd);
    this.distance += 0;

    // board frame: up is perpendicular to the rail, as vertical as possible
    this.up.copy(UP).addScaledVector(r.dir, -r.dir.y).normalize();
    const dirH = tmp.set(r.dir.x, 0, r.dir.z).normalize().multiplyScalar(g.boardSign);
    dirH.applyAxisAngle(UP, g.rel);
    // ease the yaw toward the canonical angle (magnetism)
    const cur = tmp2.set(this.fwd.x, 0, this.fwd.z).normalize();
    cur.lerp(dirH, Math.min(1, dt * 18)).normalize();
    this.fwd.copy(cur);
    projectOnPlane(this.fwd, this.up).normalize();

    g.points = grindBasePoints(g.family, g.mod) + Math.round(g.time * (slide ? 160 : 130));

    if (g.t < 0 || g.t > r.len) {
      // kinked rails / hubbas: hop onto a rail that continues from this end
      const end = g.t > r.len ? r.b : r.a;
      const next = this.findContinuation(r, end, g.spd > 0 ? r.dir : tmp.copy(r.dir).negate());
      if (next) {
        const atA = next.a.distanceToSquared(end) < next.b.distanceToSquared(end);
        const along = g.spd > 0 ? r.dir : tmp.copy(r.dir).negate();
        const sp = Math.abs(g.spd) * Math.max(0.6, along.dot(atA ? next.dir : tmp2.copy(next.dir).negate()));
        g.rail = next;
        g.t = atA ? 0.001 : next.len - 0.001;
        g.spd = atA ? sp : -sp;
        return;
      }
      this.exitGrind(false);
      this.vel.y += 0.5;
      return;
    }
    if (Math.abs(g.spd) < 0.3) {
      // stalled out: drop off the side
      this.exitGrind(false);
      return;
    }
  }

  private findContinuation(cur: Rail, end: THREE.Vector3, dir: THREE.Vector3): Rail | null {
    let best: Rail | null = null;
    let bestDot = 0.5;
    for (const r of this.terrain.rails) {
      if (r === cur) continue;
      let d: THREE.Vector3 | null = null;
      if (r.a.distanceToSquared(end) < 0.01) d = r.dir;
      else if (r.b.distanceToSquared(end) < 0.01) d = tmpV3.copy(r.dir).negate();
      if (!d) continue;
      const dot = d.dot(dir);
      if (dot > bestDot) {
        bestDot = dot;
        best = r;
      }
    }
    return best;
  }

  private exitGrind(popped: boolean) {
    const g = this.grind!;
    const dirH = new THREE.Vector3(g.rail.dir.x, 0, g.rail.dir.z).normalize();
    const fH = tmp2.set(this.fwd.x, 0, this.fwd.z).normalize();
    this.alignTarget = g.family === 'parallel' ? null : dirH.multiplyScalar(fH.dot(dirH) >= 0 ? 1 : -1);
    this.events.push({ type: 'grindEnd', record: { name: g.name, points: g.points, kind: 'grind' }, popped });
    this.grind = null;
    this.mode = 'air';
    this.takeoff.copy(this.pos);
    this.maxAirY = this.pos.y;
    this.popped = false;
    this.airTime = 0;
    // rolling off the end of a rail still allows a late pop (coyote time)
    this.sinceGround = popped ? 1 : 0;
    this.followPitch = false;
    this.bodySpin = 0;
    this.lastGrindExit = this.time;
  }

  /* ------------------------------ bail ----------------------------- */

  bail(reason: string, impact: number) {
    if (this.mode === 'bail') return;
    this.bq.copy(this.visualQuat(new THREE.Quaternion()));
    this.mode = 'bail';
    this.bailT = 0;
    this.grind = null;
    this.bpos.copy(this.pos).addScaledVector(this.up, DECK.deckY);
    this.bvel.copy(this.vel).multiplyScalar(0.75);
    this.bvel.y = Math.abs(this.bvel.y) * 0.3 + 1.6;
    this.bw.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 22);
    this.trick = freshTrick();
    this.airTricks = [];
    this.airQualities = [];
    this.events.push({ type: 'bail', reason, impact });
  }

  private bailStep(dt: number) {
    this.bailT += dt;
    this.bvel.y -= TUNE.gravity * dt;
    this.bpos.addScaledVector(this.bvel, dt);
    const wy = this.terrain.waterAt(this.bpos.x, this.bpos.z);
    if (wy !== null && this.bpos.y < wy) {
      // splash: float and drift
      this.bpos.y = wy - 0.02;
      this.bvel.y = Math.max(0, this.bvel.y) * 0.2;
      this.bvel.x *= Math.exp(-dt * 3);
      this.bvel.z *= Math.exp(-dt * 3);
      this.bw.multiplyScalar(Math.exp(-dt * 4));
    }
    const h = this.terrain.height(this.bpos.x, this.bpos.z) + 0.03;
    if (this.bpos.y < h) {
      const was = this.bpos.y;
      this.bpos.y = h;
      if (h - was > 0.3) {
        // hit a wall: bounce horizontally
        this.bvel.x *= -0.4;
        this.bvel.z *= -0.4;
      }
      if (this.bvel.y < 0) this.bvel.y = -this.bvel.y * 0.32;
      this.bvel.x *= 0.82;
      this.bvel.z *= 0.82;
      this.bw.multiplyScalar(0.72);
    }
    const w = this.bw.length();
    if (w > 1e-3) {
      tmpQ.setFromAxisAngle(tmp.copy(this.bw).divideScalar(w), w * dt);
      this.bq.premultiply(tmpQ);
    }
    if (this.bailT > 1.8) this.respawn();
  }

  respawn() {
    // respawn where you fell if it's open flat ground, otherwise the last safe spot
    const bx = this.bpos.x;
    const bz = this.bpos.z;
    const n = this.terrain.normal(bx, bz, tmp);
    const heading = tmp2.set(this.fwd.x, 0, this.fwd.z);
    if (heading.lengthSq() < 1e-4) heading.copy(this.safeFwd);
    heading.normalize();
    const wet = this.terrain.waterAt(bx, bz) !== null;
    if (this.mode === 'bail' && !wet && n.y > 0.999 && this.isClear(bx, bz) && Math.abs(bx) < 70 && Math.abs(bz) < 70) {
      this.pos.set(bx, this.terrain.height(bx, bz), bz);
    } else {
      this.pos.copy(this.safePos);
      heading.copy(this.safeFwd);
    }
    this.vel.set(0, 0, 0);
    this.fwd.copy(heading);
    this.up.copy(UP);
    this.mode = 'ground';
    this.trick = freshTrick();
    this.grind = null;
    this.popped = false;
    this.alignTarget = null;
    this.popPitch = this.popPitchV = this.squash = this.squashV = 0;
    this.posOffset.set(0, 0, 0);
    this.yawOffset = 0;
    this.events.push({ type: 'respawn' });
  }

  /* ------------------------------ visuals -------------------------- */

  /** Base frame (no tricks) as a quaternion. */
  baseQuat(out: THREE.Quaternion) {
    const x = tmpA.copy(this.fwd);
    const y = tmpB.copy(this.up);
    const z = tmpC.crossVectors(x, y).normalize();
    x.crossVectors(y, z).normalize();
    tmpM.makeBasis(x, y, z);
    return out.setFromRotationMatrix(tmpM);
  }

  /** Full board orientation including trick rotations. */
  visualQuat(out: THREE.Quaternion) {
    if (this.mode === 'bail') return out.copy(this.bq);
    this.baseQuat(out);
    // ground feel: lean into carves, powerslide yaw, sketchy wobble
    const sp = Math.min(1, this.speed / 4);
    let leanT = 0;
    if (this.mode === 'ground') leanT = this.steerS * sp * 0.2;
    if (this.mode === 'grind' && this.grind) leanT = this.grind.balance * 0.32;
    this.lean += (leanT - this.lean) * 0.25;
    const wob = Math.sin(this.time * 38) * this.wobble * 0.12;
    tmpQ.setFromAxisAngle(AX_Y, this.slideYaw + this.yawOffset + wob * 0.6);
    out.multiply(tmpQ);
    tmpQ.setFromAxisAngle(AX_X, this.lean + wob);
    out.multiply(tmpQ);
    // grind poses
    if (this.mode === 'grind' && this.grind) {
      const m = this.grind.mod;
      const pitch = m === 'nose' ? -0.2 : m === 'tail' ? 0.2 : 0;
      tmpQ.setFromAxisAngle(AX_Z, pitch);
      out.multiply(tmpQ);
    }
    tmpQ.setFromAxisAngle(AX_Z, this.popPitch);
    out.multiply(tmpQ);
    const tr = this.trick;
    if (tr.active) {
      tmpQ.setFromAxisAngle(AX_Y, tr.shove);
      out.multiply(tmpQ);
      tmpQ.setFromAxisAngle(AX_X, tr.flip);
      out.multiply(tmpQ);
      tmpQ.setFromAxisAngle(AX_Z, tr.wrap);
      out.multiply(tmpQ);
    }
    if (this.boardFlipped) out.multiply(tmpQ.setFromAxisAngle(AX_Y, Math.PI));
    return out;
  }

  /** Root position for the board model. */
  visualPos(out: THREE.Vector3) {
    if (this.mode === 'bail') return out.copy(this.bpos).addScaledVector(UP, -DECK.deckY);
    out.copy(this.pos).add(this.posOffset);
    if (this.mode === 'grind' && this.grind) {
      const g = this.grind;
      // slides sit the deck on the rail; grinds sit on the trucks
      const deckDrop = g.family === 'slide' ? DECK.deckY - DECK.thick / 2 - 0.004 : g.family === 'angled' ? 0.03 : 0;
      out.addScaledVector(this.up, -deckDrop);
      if (g.mod !== 'none' && g.family === 'parallel') out.addScaledVector(this.up, 0.03);
    }
    // ollie: board rises from the tail
    out.addScaledVector(this.up, this.squash * 0.05 + Math.abs(this.popPitch) * 0.12);
    return out;
  }
}

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpPrev = new THREE.Vector3();
const tmpNext = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

function freshTrick(): TrickState {
  return {
    active: false,
    caught: true,
    flipRate: 0,
    delay: 0,
    shoveRate: 0,
    wrapRate: 0,
    flip: 0,
    shove: 0,
    wrap: 0,
    start: [0, 0, 0],
    target: [0, 0, 0],
    spec: null,
    quality: 'clean',
  };
}

function projectOnPlane(v: THREE.Vector3, n: THREE.Vector3) {
  return v.addScaledVector(n, -v.dot(n));
}

function wrapPi(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function worst(a: Quality, b: Quality): Quality {
  const r = { perfect: 0, clean: 1, sketchy: 2 };
  return r[a] >= r[b] ? a : b;
}
