import * as THREE from 'three';
import type { StatId } from './career';

/**
 * A procedurally animated skater standing on the board. Every limb is a
 * capsule placed between two joints; legs and arms are solved with 2-bone IK
 * each frame, so the feet stay planted on the deck through carves, pops,
 * pushes and grinds. Local frame = the board's base frame:
 * +X nose, +Y up, +Z toe side (the rider faces +Z, regular stance).
 */

export type RiderId = 'brock' | 'coral' | 'voss';
export type RiderStyle = 'ghost' | 'solid' | 'off';

export interface RiderDef {
  id: RiderId;
  name: string;
  title: string;
  desc: string;
  bias: Partial<Record<StatId, number>>;
  color: string; // card accent
}

export const RIDERS: RiderDef[] = [
  {
    id: 'brock',
    name: 'Brock Steele',
    title: 'The muscle',
    desc: 'Pops like a cannon and pushes like a freight train. Spins are… a work in progress.',
    bias: { ollie: 1, speed: 1, spin: -1, flip: -1 },
    color: '#D97757',
  },
  {
    id: 'coral',
    name: 'Coral Reyes',
    title: 'Beach local',
    desc: 'Grew up on the pier rail. Silky balance and quick spins, a little less raw speed.',
    bias: { balance: 1, spin: 1, speed: -1 },
    color: '#3FA7A0',
  },
  {
    id: 'voss',
    name: 'Dr. Elmer Voss',
    title: 'Retired physicist',
    desc: 'Has calculated the optimal flip rate. Knees disagree about ollie height.',
    bias: { flip: 2, balance: 1, ollie: -1, speed: -1 },
    color: '#6A9BCC',
  },
];

interface Look {
  skin: number;
  top: number; // chest / shirt
  belly: number; // lower torso
  legsTop: number; // thighs (shorts / trousers)
  legsLow: number; // shins
  shoe: number;
  hair: number;
  // proportions
  shoulder: number; // half width
  hip: number; // half width
  torsoR: number;
  armR: number;
  legR: number;
  height: number; // overall scale
  hunch: number; // extra forward lean (rad)
}

const LOOKS: Record<RiderId, Look> = {
  brock: {
    skin: 0xc68863,
    top: 0xd97757,
    belly: 0xd97757,
    legsTop: 0x2c3e64,
    legsLow: 0xc68863,
    shoe: 0x1c1b1a,
    hair: 0x2a1d14,
    shoulder: 0.25,
    hip: 0.1,
    torsoR: 0.16,
    armR: 0.068,
    legR: 0.075,
    height: 1.04,
    hunch: 0.05,
  },
  coral: {
    skin: 0xe2b48c,
    top: 0x3fa7a0,
    belly: 0xe2b48c,
    legsTop: 0xff8a65,
    legsLow: 0xe2b48c,
    shoe: 0xfaf9f5,
    hair: 0xe6c27a,
    shoulder: 0.18,
    hip: 0.095,
    torsoR: 0.115,
    armR: 0.042,
    legR: 0.056,
    height: 0.96,
    hunch: 0,
  },
  voss: {
    skin: 0xf0d0b8,
    top: 0xf4f4f0,
    belly: 0xf4f4f0,
    legsTop: 0x5f5d58,
    legsLow: 0x5f5d58,
    shoe: 0x5b3a22,
    hair: 0xf2f2f2,
    shoulder: 0.18,
    hip: 0.09,
    torsoR: 0.12,
    armR: 0.045,
    legR: 0.055,
    height: 0.98,
    hunch: 0.22,
  },
};

export interface RiderState {
  crouch: number; // 0 stand .. 1 deep crouch
  tuck: number; // 0 feet on deck .. 1 knees up (board flipping underneath)
  lean: number; // rad, toward toe side positive
  push: number; // -1 none, else push stroke phase 0..1
  grind: number | null; // balance -1..1 when grinding
  air: boolean;
  time: number;
  /** richer cues for the full-body rider (the capsule rider ignores them) */
  act?: RiderAct;
}

export interface RiderAct {
  popT: number; // seconds since the pop, -1 when not in a popped air
  flip: number; // +1 kickflip, -1 heelflip, 0 none
  shove: number; // +1 FS, -1 BS, 0 none
  wrap: number; // impossible
  nollie: boolean;
  caught: boolean;
  catchT: number; // seconds since catch, -1 if none
  landT: number; // seconds since last landing
  pushAt: number; // physics time of the last push event
  pushHold: boolean; // push is held: keep kicking instead of stepping back on
  ground: boolean; // rolling on the ground (pushing is possible)
  clock: number; // physics time, for the footwork state machines
  speed: number; // board speed (m/s), for the planted push foot
  special: boolean;
}

export const DECK_TOP = 0.088;
const Y = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Two-bone IK: writes the middle joint and the (reach-clamped) end. */
export function ik(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3) {
  const d = tmpA.copy(target).sub(root);
  let L = d.length();
  const dir = L > 1e-5 ? d.divideScalar(L) : d.set(0, -1, 0);
  L = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, L));
  const x = (a * a - b * b + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = tmpB.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1);
  p.normalize();
  mid.copy(root).addScaledVector(dir, x).addScaledVector(p, h);
  end.copy(root).addScaledVector(dir, L);
}

class Segment {
  mesh: THREE.Mesh;
  constructor(
    public len: number,
    r: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
  ) {
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10), mat);
    parent.add(this.mesh);
  }
  place(a: THREE.Vector3, b: THREE.Vector3) {
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const d = tmpA.copy(b).sub(a);
    const l = d.length();
    if (l > 1e-5) this.mesh.quaternion.setFromUnitVectors(Y, d.divideScalar(l));
  }
}

export class Rider {
  group = new THREE.Group();
  private body = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];
  private look: Look;
  private thighL: Segment;
  private shinL: Segment;
  private thighR: Segment;
  private shinR: Segment;
  private upperL: Segment;
  private foreL: Segment;
  private upperR: Segment;
  private foreR: Segment;
  private belly: Segment;
  private chest: Segment;
  private neck: Segment;
  private head = new THREE.Group();
  private footL: THREE.Mesh;
  private footR: THREE.Mesh;
  private handL: THREE.Mesh;
  private handR: THREE.Mesh;
  private coat: THREE.Mesh | null = null;
  private pony: THREE.Mesh | null = null;
  // smoothed pose
  private s = { crouch: 0, tuck: 0, lean: 0, grind: 0, air: 0, push: 0 };
  readonly legA: number;
  readonly legB: number;
  readonly armA: number;
  readonly armB: number;

  constructor(public id: RiderId) {
    const L = (this.look = LOOKS[id]);
    const k = L.height;
    this.legA = 0.44 * k;
    this.legB = 0.44 * k;
    this.armA = 0.29 * k;
    this.armB = 0.27 * k;
    const mat = (c: number) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
      this.mats.push(m);
      return m;
    };
    const skin = mat(L.skin);
    const top = mat(L.top);
    const belly = L.belly === L.top ? top : mat(L.belly);
    const legsTop = mat(L.legsTop);
    const legsLow = L.legsLow === L.skin ? skin : mat(L.legsLow);
    const shoe = mat(L.shoe);
    const hair = mat(L.hair);
    this.group.add(this.body);
    this.thighL = new Segment(this.legA, L.legR, legsTop, this.body);
    this.thighR = new Segment(this.legA, L.legR, legsTop, this.body);
    this.shinL = new Segment(this.legB, L.legR * 0.82, legsLow, this.body);
    this.shinR = new Segment(this.legB, L.legR * 0.82, legsLow, this.body);
    this.upperL = new Segment(this.armA, L.armR, id === 'coral' ? skin : top, this.body);
    this.upperR = new Segment(this.armA, L.armR, id === 'coral' ? skin : top, this.body);
    if (id === 'brock') {
      // tank top: bare arms
      this.upperL.mesh.material = skin;
      this.upperR.mesh.material = skin;
    }
    this.foreL = new Segment(this.armB, L.armR * 0.85, id === 'voss' ? top : skin, this.body);
    this.foreR = new Segment(this.armB, L.armR * 0.85, id === 'voss' ? top : skin, this.body);
    this.belly = new Segment(0.2 * k, L.torsoR * 0.92, belly, this.body);
    this.chest = new Segment(0.22 * k, L.torsoR, top, this.body);
    this.neck = new Segment(0.06 * k, 0.045 * k, skin, this.body);
    const foot = () => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.27), shoe);
      this.body.add(f);
      return f;
    };
    this.footL = foot();
    this.footR = foot();
    const hand = () => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(L.armR * 0.95, 10, 8), skin);
      this.body.add(h);
      return h;
    };
    this.handL = hand();
    this.handR = hand();

    // head + per-character details (built facing +Z)
    const hr = 0.105 * k;
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(hr, 18, 14), skin));
    this.body.add(this.head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 8), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.005, hr * 0.98);
    this.head.add(nose);
    if (id === 'brock') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.04, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hair);
      this.head.add(cap);
      const band = new THREE.Mesh(new THREE.TorusGeometry(hr * 1.0, 0.014, 6, 24), mat(0xfaf9f5));
      band.rotation.x = Math.PI / 2;
      band.position.y = hr * 0.35;
      this.head.add(band);
    } else if (id === 'coral') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.06, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
      cap.rotation.x = -0.25;
      this.head.add(cap);
      this.pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), hair);
      this.pony.position.set(0, 0.02, -hr * 1.05);
      this.pony.rotation.x = 0.5;
      this.head.add(this.pony);
      const shades = new THREE.Mesh(new THREE.BoxGeometry(hr * 1.6, 0.035, 0.02), mat(0x141413));
      shades.position.set(0, 0.025, hr * 0.92);
      this.head.add(shades);
    } else {
      // wild white hair around a bald top, round glasses, bow tie, lab coat
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.55 + (i / 8) * Math.PI * 0.9;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.045 + (i % 3) * 0.01, 8, 6), hair);
        puff.position.set(Math.cos(a) * hr * 1.0 * (i % 2 ? 1 : -1) * 0.95, 0.02 + (i % 3) * 0.02, Math.sin(a) * hr * -0.6);
        this.head.add(puff);
      }
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), hair);
        side.position.set(sx * hr * 0.95, 0.0, -0.01);
        this.head.add(side);
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), mat(0x2b2a27));
        lens.position.set(sx * 0.04, 0.02, hr * 0.95);
        this.head.add(lens);
      }
      const tie = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mat(0xd97757));
      tie.rotation.z = Math.PI / 2;
      this.neck.mesh.add(tie);
      tie.position.set(0, 0, 0.05);
      // coat tails: open cone hanging from the waist
      this.coat = new THREE.Mesh(new THREE.CylinderGeometry(L.torsoR * 1.05, L.torsoR * 1.5, 0.42 * k, 14, 1, true), mat(0xf4f4f0));
      this.body.add(this.coat);
    }
    this.setStyle('ghost');
  }

  setStyle(style: RiderStyle) {
    this.group.visible = style !== 'off';
    const ghost = style === 'ghost';
    for (const m of this.mats) {
      m.transparent = ghost;
      m.opacity = ghost ? 0.42 : 1;
      m.depthWrite = !ghost;
      m.emissive.set(ghost ? 0x40302a : 0x000000);
      m.needsUpdate = true;
    }
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = !ghost;
        o.renderOrder = ghost ? 2 : 0;
      }
    });
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
  }

  update(dt: number, st: RiderState) {
    const L = this.look;
    const k = L.height;
    const s = this.s;
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, dt * rate);
    s.crouch = ease(s.crouch, st.crouch, 14);
    s.tuck = ease(s.tuck, st.tuck, 18);
    s.lean = ease(s.lean, st.lean, 10);
    s.grind = ease(s.grind, st.grind ?? 0, 10);
    s.air = ease(s.air, st.air ? 1 : 0, 8);
    const pushing = st.push >= 0;
    s.push = ease(s.push, pushing ? 1 : 0, 10);

    // feet on the bolts: front (left) near the nose, back (right) on the tail
    const fL = new THREE.Vector3(0.17, DECK_TOP + s.tuck * 0.3 + 0.035, 0.01);
    const fR = new THREE.Vector3(-0.21, DECK_TOP + s.tuck * 0.34 + 0.035, 0.0);
    // pushing: back foot sweeps along the ground on the toe side
    if (pushing) {
      const ph = st.push;
      const ground = new THREE.Vector3(0.1 - ph * 0.55, 0.035, 0.2);
      fR.lerp(ground, Math.min(1, Math.sin(ph * Math.PI) * 1.6));
    }

    // hips over the board, dropping with the crouch
    const legLen = this.legA + this.legB;
    const hipY = DECK_TOP + 0.04 + legLen * (0.85 - 0.34 * s.crouch) + s.tuck * 0.12 - s.push * 0.08;
    const hipC = new THREE.Vector3(-0.02 - s.push * 0.08, hipY, -0.02 + Math.sin(s.lean) * 0.35);
    // torso twist toward the nose while pushing; lean into carves; arms out on rails
    const twist = s.push * 0.9;
    const bend = 0.04 + L.hunch + s.crouch * 0.4 + s.push * 0.25 + s.lean * 0.9;
    const roll = s.grind * 0.25;
    const torsoQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(bend, twist, -roll, 'YXZ'));
    // facing +Z, "right" is -X: rotate the person frame so up is +Y and front is +Z
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(torsoQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQ);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(torsoQ);

    const hipL = hipC.clone().addScaledVector(right, -L.hip);
    const hipR = hipC.clone().addScaledVector(right, L.hip);
    const kneePole = new THREE.Vector3(0, 0.2, 1);
    const kL = new THREE.Vector3();
    const eL = new THREE.Vector3();
    const kR = new THREE.Vector3();
    const eR = new THREE.Vector3();
    ik(hipL, fL, this.legA, this.legB, kneePole, kL, eL);
    ik(hipR, fR, this.legA, this.legB, kneePole, kR, eR);
    this.thighL.place(hipL, kL);
    this.shinL.place(kL, eL);
    this.thighR.place(hipR, kR);
    this.shinR.place(kR, eR);
    // feet point across the board (toes to +Z), front foot angled a little forward
    this.footL.position.copy(eL).add(new THREE.Vector3(0, -0.01, 0.06));
    this.footL.rotation.set(0, -0.25, 0);
    this.footR.position.copy(eR).add(new THREE.Vector3(0, -0.01, 0.06));
    this.footR.rotation.set(0, 0.15, 0);

    const waist = hipC.clone().addScaledVector(up, 0.2 * k);
    const chestTop = waist.clone().addScaledVector(up, 0.24 * k);
    this.belly.place(hipC, waist);
    this.chest.place(waist, chestTop);
    const neckTop = chestTop.clone().addScaledVector(up, 0.07 * k);
    this.neck.place(chestTop, neckTop);
    this.head.position.copy(neckTop).addScaledVector(up, 0.09 * k);
    // look where you're going (the nose), and up a bit in the air
    this.head.rotation.set(-0.15 + s.crouch * 0.2 - s.air * 0.1, 0.9 - s.push * 0.6, 0, 'YXZ');
    if (this.coat) {
      this.coat.position.copy(hipC).addScaledVector(up, -0.05).addScaledVector(front, -0.02);
      this.coat.quaternion.copy(torsoQ);
      this.coat.scale.set(1, 1, 1.0 + s.air * 0.3);
    }
    if (this.pony) this.pony.rotation.x = 0.5 + Math.sin(st.time * 6) * 0.08 + s.air * 0.4;

    // arms: relaxed by the sides, out wide on rails, up in the air
    const shoulderY = chestTop.clone().addScaledVector(up, -0.03);
    const shL = shoulderY.clone().addScaledVector(right, -L.shoulder);
    const shR = shoulderY.clone().addScaledVector(right, L.shoulder);
    const wide = Math.max(Math.abs(s.grind) > 0 || st.grind !== null ? 1 : 0, s.air * 0.8);
    const swing = Math.sin(st.time * 2.4) * 0.05;
    const handTarget = (sh: THREE.Vector3, side: number) => {
      const relaxed = sh
        .clone()
        .addScaledVector(right, side * 0.12)
        .addScaledVector(up, -0.5 * k)
        .addScaledVector(front, 0.08 + swing * side);
      const out = sh
        .clone()
        .addScaledVector(right, side * 0.52 * k)
        .addScaledVector(up, -0.12 + (side > 0 ? s.grind : -s.grind) * 0.25)
        .addScaledVector(front, 0.05);
      return relaxed.lerp(out, Math.min(1, wide + s.crouch * 0.3));
    };
    const elbowPole = new THREE.Vector3(0, -0.4, -1);
    const elL = new THREE.Vector3();
    const hL = new THREE.Vector3();
    const elR = new THREE.Vector3();
    const hR = new THREE.Vector3();
    ik(shL, handTarget(shL, -1), this.armA, this.armB, elbowPole, elL, hL);
    ik(shR, handTarget(shR, 1), this.armA, this.armB, elbowPole, elR, hR);
    this.upperL.place(shL, elL);
    this.foreL.place(elL, hL);
    this.upperR.place(shR, elR);
    this.foreR.place(elR, hR);
    this.handL.position.copy(hL);
    this.handR.position.copy(hR);
  }
}
