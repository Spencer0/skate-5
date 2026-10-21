import * as THREE from 'three';

/**
 * A light Verlet ragdoll for bails: 14 points (hips, chest, head, shoulders,
 * elbows, hands, knees, ankles) held together by distance constraints. The
 * torso is braced into a rigid block, knees only bend forward and elbows only
 * bend back, and every point collides with the park's height field with
 * Coulomb friction, so the body tumbles, slides and settles. The rider's
 * skeleton is then aimed at the points each frame.
 */

export interface Ground {
  height(x: number, z: number): number;
  waterAt(x: number, z: number): number | null;
}

export const RAG = {
  hipL: 0,
  hipR: 1,
  chest: 2,
  head: 3,
  shL: 4,
  shR: 5,
  elbL: 6,
  elbR: 7,
  handL: 8,
  handR: 9,
  kneeL: 10,
  kneeR: 11,
  ankL: 12,
  ankR: 13,
} as const;
const N = 14;
// collision radius per point (m)
const RADIUS = [0.1, 0.1, 0.13, 0.11, 0.07, 0.07, 0.05, 0.05, 0.04, 0.04, 0.06, 0.06, 0.05, 0.05];

const SUB = 1 / 240;
const ITER = 8;
const FRICTION = 0.65; // Coulomb coefficient against the ground
const BOUNCE = 0.12;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _m = new THREE.Vector3();

export class Ragdoll {
  p: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3());
  private prev: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3());
  private links: [number, number, number][] = []; // a, b, rest length
  private pushed = new Float32Array(N); // how far each point was pushed out of the ground this step
  private acc = 0;

  constructor(private gravity: number) {}

  /**
   * Start from the rider's current pose (world positions, RAG order) with the
   * given velocity per point.
   */
  start(pos: THREE.Vector3[], vel: THREE.Vector3[]) {
    for (let i = 0; i < N; i++) {
      this.p[i].copy(pos[i]);
      this.prev[i].copy(pos[i]).addScaledVector(vel[i], -SUB);
    }
    const R = RAG;
    const L = (a: number, b: number) => this.links.push([a, b, pos[a].distanceTo(pos[b])]);
    this.links = [];
    // torso: every pair among hips, chest and shoulders, plus the head on top
    const torso = [R.hipL, R.hipR, R.chest, R.shL, R.shR];
    for (let i = 0; i < torso.length; i++) for (let j = i + 1; j < torso.length; j++) L(torso[i], torso[j]);
    L(R.head, R.chest);
    L(R.head, R.shL);
    L(R.head, R.shR);
    // limbs
    L(R.shL, R.elbL);
    L(R.elbL, R.handL);
    L(R.shR, R.elbR);
    L(R.elbR, R.handR);
    L(R.hipL, R.kneeL);
    L(R.kneeL, R.ankL);
    L(R.hipR, R.kneeR);
    L(R.kneeR, R.ankR);
    this.acc = 0;
  }

  step(dt: number, ground: Ground) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) {
      this.acc -= SUB;
      this.integrate(ground);
    }
  }

  /** Facing direction of the torso (unit). */
  facing(out: THREE.Vector3) {
    const R = RAG;
    const across = _v.subVectors(this.p[R.hipL], this.p[R.hipR]);
    const up = _w.subVectors(this.p[R.chest], _m.addVectors(this.p[R.hipL], this.p[R.hipR]).multiplyScalar(0.5));
    return out.crossVectors(across, up).normalize();
  }

  private integrate(ground: Ground) {
    const g = this.gravity * SUB * SUB;
    for (let i = 0; i < N; i++) {
      const p = this.p[i];
      const q = this.prev[i];
      _v.subVectors(p, q).multiplyScalar(0.9995); // a little air drag
      q.copy(p);
      p.add(_v);
      p.y -= g;
    }
    this.pushed.fill(0);
    for (let k = 0; k < ITER; k++) {
      for (const [a, b, len] of this.links) {
        const pa = this.p[a];
        const pb = this.p[b];
        _v.subVectors(pb, pa);
        const d = _v.length();
        if (d < 1e-6) continue;
        _v.multiplyScalar((d - len) / d / 2);
        pa.add(_v);
        pb.sub(_v);
      }
      this.hinges();
      for (let i = 0; i < N; i++) this.collide(i, ground);
    }
    for (let i = 0; i < N; i++) this.respond(i, ground);
  }

  /** Knees bend forward, elbows bend back, and neither folds flat. */
  private hinges() {
    const R = RAG;
    const f = this.facing(_f);
    const hinge = (root: number, mid: number, end: number, sign: number, minFold: number) => {
      const a = this.p[root];
      const m = this.p[mid];
      const e = this.p[end];
      _m.addVectors(a, e).multiplyScalar(0.5);
      const d = _v.subVectors(m, _m).dot(f) * sign;
      // straight is fine; only a backwards bend gets corrected
      if (d < 0) {
        const c = -d * sign;
        m.addScaledVector(f, c * 0.5);
        a.addScaledVector(f, -c * 0.25);
        e.addScaledVector(f, -c * 0.25);
      }
      // keep the limb from folding completely shut
      _v.subVectors(e, a);
      const len = _v.length();
      if (len < minFold && len > 1e-6) {
        _v.multiplyScalar((len - minFold) / len / 2);
        a.add(_v);
        e.sub(_v);
      }
    };
    const leg = (hip: number, knee: number, ank: number) => {
      const l = this.restLen(hip, knee) + this.restLen(knee, ank);
      hinge(hip, knee, ank, 1, l * 0.42);
      // the thigh can't swing far behind the body
      const back = _v.subVectors(this.p[knee], this.p[hip]).dot(f) + this.restLen(hip, knee) * 0.45;
      if (back < 0) {
        // knee and hip move apart equally, so the limit can't push the body around
        this.p[knee].addScaledVector(f, -back * 0.5);
        this.p[hip].addScaledVector(f, back * 0.5);
      }
    };
    const arm = (sh: number, elb: number, hand: number) => {
      const l = this.restLen(sh, elb) + this.restLen(elb, hand);
      hinge(sh, elb, hand, -1, l * 0.35);
    };
    leg(R.hipL, R.kneeL, R.ankL);
    leg(R.hipR, R.kneeR, R.ankR);
    arm(R.shL, R.elbL, R.handL);
    arm(R.shR, R.elbR, R.handR);
  }

  private restLen(a: number, b: number) {
    for (const [x, y, len] of this.links) if ((x === a && y === b) || (x === b && y === a)) return len;
    return 0;
  }

  /** Push a point out of the ground (or back off a wall). */
  private collide(i: number, ground: Ground) {
    const p = this.p[i];
    const q = this.prev[i];
    const r = RADIUS[i];
    let h = ground.height(p.x, p.z) + r;
    if (p.y >= h) return;
    if (h - q.y > 0.05) {
      // it was below this height last step, so it came in from the side: a
      // wall (box side, ledge face). Back to where this step started, which
      // also stops it dead against the face (q is untouched until respond)
      p.x = q.x;
      p.z = q.z;
      h = ground.height(p.x, p.z) + r;
      if (p.y >= h) return;
    }
    // a pure position fix: the previous position moves too, so being pushed out
    // never adds speed (the real impact speed is kept for bounce and friction)
    this.pushed[i] += h - p.y;
    q.y += h - p.y;
    p.y = h;
  }

  /** Once per step: bounce, ground friction and water drag. */
  private respond(i: number, ground: Ground) {
    const p = this.p[i];
    const q = this.prev[i];
    const v = _v.subVectors(p, q);
    const water = ground.waterAt(p.x, p.z);
    if (water !== null && p.y < water) {
      // float just under the surface and drift to a stop
      v.multiplyScalar(0.985);
      v.y += (water - 0.15 - p.y) * 0.002;
      q.copy(p).sub(v);
    }
    if (this.pushed[i] <= 0) return;
    // normal impulse: the speed into the ground plus this step's gravity;
    // friction takes mu times that off the slide
    const pen = Math.max(0, -v.y) + this.gravity * SUB * SUB;
    if (v.y < 0) v.y *= -BOUNCE;
    // contact soaks up a little of everything, so a body lying down settles
    v.multiplyScalar(0.985);
    const ht = Math.hypot(v.x, v.z);
    const keep = ht > 1e-9 ? Math.max(0, ht - FRICTION * pen) / ht : 0;
    q.set(p.x - v.x * keep, p.y - v.y, p.z - v.z * keep);
  }
}
