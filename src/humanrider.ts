import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rider, RiderId, RiderState, RiderStyle, ik, DECK_TOP } from './rider';
import { TUNE } from './skater';

/**
 * A MakeHuman character (generated in Blender with MPFB, CC0) driven by the
 * same skate intent as the capsule rider: crouch, tuck, lean, push, grind
 * balance. Each frame the skeleton is reset to its rest pose, the pelvis and
 * spine are rotated, then legs and arms are solved with 2-bone IK against the
 * model's own bone lengths and every bone is aimed at its target with a
 * minimal swing, so the skin deforms like a person and the feet stay on the
 * bolts. Until the GLB finishes loading, the capsule rider stands in.
 */

const HEIGHT: Record<RiderId, number> = { brock: 1.86, coral: 1.64, voss: 1.72 };
const HUNCH: Record<RiderId, number> = { brock: 0.05, coral: 0, voss: 0.2 };

const cache = new Map<RiderId, Promise<THREE.Group>>();
function loadModel(id: RiderId) {
  let p = cache.get(id);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}riders/${id}.glb`).then((g) => g.scene);
    cache.set(id, p);
  }
  return p;
}

const BONES = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'thigh_l',
  'calf_l',
  'foot_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
] as const;
type BoneName = (typeof BONES)[number];

const tv = () => new THREE.Vector3();
const tq = () => new THREE.Quaternion();
const _a = tv();
const _b = tv();
const _c = tv();
const _q = tq();
const _q2 = tq();

export class HumanRider {
  group = new THREE.Group();
  private fallback: Rider;
  private model: THREE.Object3D | null = null;
  private bones = {} as Record<BoneName, THREE.Bone>;
  private all: THREE.Bone[] = [];
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion }>();
  /** rest rotation of each bone relative to the rider frame (group local) */
  private restQ = new Map<THREE.Bone, THREE.Quaternion>();
  private mats: THREE.MeshStandardMaterial[] = [];
  private style: RiderStyle = 'ghost';
  private s = { crouch: 0, tuck: 0, lean: 0, grind: 0, air: 0, push: 0 };
  private disposed = false;
  ready = false;
  // rest measurements (rider frame, after scaling)
  private ankleH = 0.08;
  private legLen = 0.9;
  private hipOffset = new THREE.Vector3(); // pelvis origin -> midpoint of thigh heads

  constructor(public id: RiderId) {
    this.fallback = new Rider(id);
    this.group.add(this.fallback.group);
    loadModel(id).then(
      (scene) => {
        if (!this.disposed) this.attach(scene.clone(true));
      },
      (e) => console.warn('rider model failed to load, keeping the simple rider', e),
    );
  }

  private attach(scene: THREE.Object3D) {
    // skinned clones need their skeletons rebound to the cloned bones
    const byName = new Map<string, THREE.Bone>();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    scene.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        const bones = sm.skeleton.bones.map((b) => byName.get(b.name) ?? b);
        sm.bind(new THREE.Skeleton(bones, sm.skeleton.boneInverses), sm.bindMatrix);
        sm.frustumCulled = false;
        const m = (sm.material as THREE.MeshStandardMaterial).clone();
        sm.material = m;
        m.userData.cut = /hair|brow|lash|ponytail|bob|short0/i.test(m.name);
        this.mats.push(m);
      }
    });
    for (const n of BONES) {
      const b = byName.get(n);
      if (!b) {
        console.warn('rider rig missing bone', n);
        return;
      }
      this.bones[n] = b;
    }
    this.all = [...byName.values()];
    for (const b of this.all) this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone() });

    // scale to the character's height; MakeHuman faces +Z with feet at y=0
    const box = new THREE.Box3().setFromObject(scene);
    const k = HEIGHT[this.id] / Math.max(0.5, box.max.y - box.min.y);
    scene.scale.setScalar(k);
    this.model = scene;
    this.group.add(scene);
    this.group.updateMatrixWorld(true);

    const inv = tq().copy(this.group.getWorldQuaternion(tq())).invert();
    const g2l = this.group.matrixWorld.clone().invert();
    for (const b of this.all) this.restQ.set(b, inv.clone().multiply(b.getWorldQuaternion(tq())));
    const P = (n: BoneName) => this.bones[n].getWorldPosition(tv()).applyMatrix4(g2l);
    this.ankleH = P('foot_l').y;
    this.legLen = P('thigh_l').distanceTo(P('calf_l')) + P('calf_l').distanceTo(P('foot_l'));
    this.hipOffset = P('thigh_l').add(P('thigh_r')).multiplyScalar(0.5).sub(P('pelvis'));

    this.group.remove(this.fallback.group);
    this.fallback.dispose();
    this.ready = true;
    this.setStyle(this.style);
  }

  setStyle(style: RiderStyle) {
    this.style = style;
    this.fallback.setStyle(style);
    this.group.visible = style !== 'off';
    const ghost = style === 'ghost';
    for (const m of this.mats) {
      const cut = m.userData.cut as boolean;
      m.transparent = ghost;
      m.opacity = ghost ? 0.45 : 1;
      m.depthWrite = true;
      m.alphaTest = cut ? 0.5 : 0;
      m.side = cut ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
    this.model?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = !ghost;
        o.renderOrder = ghost ? 2 : 0;
      }
    });
  }

  dispose() {
    this.disposed = true;
    this.fallback.dispose();
    // geometry and textures are shared with the cached model; only our material clones go
    for (const m of this.mats) m.dispose();
  }

  /* -------------------------------------------------------------- */

  private setRiderQ(b: THREE.Bone, qRider: THREE.Quaternion) {
    // world = groupQ * qRider ; local = parentWorld^-1 * world
    const world = this.group.getWorldQuaternion(_q).multiply(qRider);
    const parentW = (b.parent as THREE.Object3D).getWorldQuaternion(_q2).invert();
    b.quaternion.copy(parentW.multiply(world));
    b.updateMatrixWorld(true);
  }

  /** Rotate bone b (minimal swing) so that `child` lands on world point target. */
  private aim(b: THREE.Bone, child: THREE.Bone, target: THREE.Vector3) {
    const head = b.getWorldPosition(_a);
    const cur = child.getWorldPosition(_b).sub(head);
    const want = _c.copy(target).sub(head);
    if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
    const swing = _q.setFromUnitVectors(cur.normalize(), want.normalize());
    const world = b.getWorldQuaternion(tq()).premultiply(swing);
    const parentW = (b.parent as THREE.Object3D).getWorldQuaternion(_q2).invert();
    b.quaternion.copy(parentW.multiply(world));
    b.updateMatrixWorld(true);
  }

  private lastR = new THREE.Vector3(-0.19, 0, -0.06);
  private lastL = new THREE.Vector3(0.19, 0, -0.06);
  /** where the back foot was when the current push started */
  /**
   * The pushing foot runs as a small state machine on the physics clock, so a
   * tap does one kick and steps back on, while a held push keeps kicking
   * without the foot coming back to the board. Each phase starts from wherever
   * the foot is, so switching between them never makes it jump.
   */
  private push = {
    phase: 'board' as 'board' | 'step' | 'kick' | 'swing' | 'return',
    t0: 0,
    from: new THREE.Vector3(),
    at: -10, // physics time of the last push event seen
    clock: 0,
    swingDur: 0.28,
    // eased, so nothing snaps between phases
    into: 0,
    yawR: -0.15,
    pitchR: 0,
    arm: 0,
  };

  /**
   * Foot choreography in the board's frame. Stance: front (left) foot over the
   * front bolts, back (right) foot on the tail, toes across the board.
   */
  private choreo(st: RiderState) {
    const a = st.act;
    const deck = DECK_TOP + this.ankleH;
    const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const seg = (t: number, t0: number, t1: number) => sm((t - t0) / (t1 - t0));
    const out = {
      fL: new THREE.Vector3(0.19, deck, -0.06),
      fR: new THREE.Vector3(-0.19, deck, -0.06),
      yawL: 0.35,
      yawR: -0.15,
      pitchL: 0,
      pitchR: 0,
      hipDrop: 0,
      hipX: 0,
      arms: 0,
      armsUp: 0,
      armSwing: 0,
    };
    if (!a) {
      out.fL.y += st.tuck * 0.3;
      out.fR.y += st.tuck * 0.34;
      return out;
    }
    const { fL, fR } = out;

    // ---- pushing: step off, plant by the front truck, kick back, then either
    // swing forward for another kick (push held) or step back onto the tail
    const P = this.push;
    if (a.clock < P.clock || P.clock === 0) {
      // new rider or the clock was reset: don't replay an old push
      P.phase = 'board';
      P.at = a.pushAt;
    }
    const dtc = Math.min(0.1, Math.max(0, a.clock - P.clock));
    P.clock = a.clock;
    const go = (phase: typeof P.phase) => {
      P.phase = phase;
      P.t0 = a.clock;
      P.from.copy(this.lastR);
      // arrive at the plant point just as the next held push fires
      if (phase === 'swing') P.swingDur = Math.min(0.3, Math.max(0.14, P.at + TUNE.pushCooldown - a.clock));
    };
    if (!a.ground || a.popT >= 0) P.phase = 'board';
    else if (a.pushAt > P.at) {
      P.at = a.pushAt;
      if (P.phase === 'board' || P.phase === 'return') go('step');
      else if (P.phase === 'swing') go('kick');
    }
    let u = a.clock - P.t0;
    if (P.phase === 'step' && u >= 0.12) go('kick');
    else if (P.phase === 'kick' && u >= 0.22) go(a.pushHold ? 'swing' : 'return');
    // released mid-swing, or the next push isn't coming (braking, slope): step back on
    else if (P.phase === 'swing' && (!a.pushHold || u > P.swingDur + 0.35)) go('return');
    else if (P.phase === 'return' && u >= 0.28) P.phase = 'board';
    u = a.clock - P.t0;

    const plant = new THREE.Vector3(0.16, this.ankleH, 0.21);
    const tail = new THREE.Vector3(-0.19, deck, -0.06);
    let p: THREE.Vector3 | null = null;
    let into = 0;
    let yawR = -0.15;
    let pitchR = 0;
    let arm = 0;
    if (P.phase === 'step') {
      const k = seg(u, 0, 0.12);
      p = P.from.clone().lerp(plant, k);
      p.y += Math.sin(k * Math.PI) * 0.09;
      into = 1;
      yawR = 1.35;
      arm = -1;
    } else if (P.phase === 'kick') {
      // planted on the ground: slides back as the board rolls forward
      p = P.from.clone();
      p.x -= Math.min(0.55, a.speed * u * 0.55 + u * 0.4);
      p.y += (this.ankleH - p.y) * seg(u, 0, 0.05);
      p.z += (plant.z - p.z) * seg(u, 0, 0.08);
      // toe-off: the heel peels up at the end of the kick
      p.y += seg(u, 0.14, 0.22) * 0.03;
      into = 1;
      yawR = 1.35;
      pitchR = 0.55 * seg(u, 0.12, 0.22);
      arm = -1;
    } else if (P.phase === 'swing') {
      // knee bends and the foot swings low past the board to plant again
      const k = sm(u / P.swingDur);
      p = P.from.clone().lerp(plant, k);
      p.y += 0.015 * k + Math.sin(k * Math.PI) * 0.1;
      into = 1;
      yawR = 1.35;
      pitchR = 0.55 * (1 - seg(u / P.swingDur, 0, 0.5));
      arm = 1;
    } else if (P.phase === 'return') {
      // the knee lifts and swings the foot forward over the tail,
      // then it sets down onto the deck from above
      const k = Math.min(1, u / 0.28);
      p = P.from.clone().lerp(tail, sm(Math.min(1, k * 1.25)));
      p.y = P.from.y + (tail.y - P.from.y) * sm(k) + Math.sin(sm(Math.min(1, k * 1.1)) * Math.PI) * 0.22;
      p.z += Math.sin(k * Math.PI) * 0.04;
      into = 1 - seg(k, 0.55, 1);
      yawR = -0.15 + into * 1.2;
      arm = 1 - seg(k, 0.5, 1);
    }
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, dtc * rate);
    P.into = ease(P.into, into, 18);
    P.yawR = ease(P.yawR, yawR, 16);
    P.pitchR = ease(P.pitchR, pitchR, 20);
    P.arm = ease(P.arm, arm, 7);
    if (p) {
      // front foot turns to point down the board and shifts to the middle
      fL.lerp(new THREE.Vector3(0.13, deck, -0.03), P.into);
      out.yawL = 0.35 + P.into * 1.15;
      fR.copy(p);
      out.yawR = P.yawR;
      out.pitchR = P.pitchR;
      out.hipDrop = 0.15 * P.into; // standing knee bends deep
      out.hipX = 0.13 * P.into; // weight over the front (standing) foot
      out.armSwing = P.arm; // against the kick, then back
      this.lastR.copy(fR);
      return out;
    }

    // ---- popped air: pop, flick, tuck, catch
    if (a.popT >= 0) {
      const t = a.popT;
      const sx = a.nollie ? -1 : 1; // which end pops
      const popFoot = a.nollie ? fL : fR;
      const slideFoot = a.nollie ? fR : fL;
      // pop: the popping foot snaps the tail down to the very end
      const snap = seg(t, 0, 0.06) * (1 - seg(t, 0.16, 0.26));
      popFoot.x = -sx * (0.19 + 0.12 * snap);
      popFoot.y = deck - 0.01 * snap + seg(t, 0.08, 0.22) * 0.18;
      // the other foot drags up the grip toward the nose...
      const drag = seg(t, 0.01, 0.1);
      slideFoot.x = sx * (0.19 + 0.13 * drag);
      slideFoot.y = deck + drag * 0.14;
      if (a.nollie) out.pitchR = 0.4 * drag;
      else out.pitchL = 0.4 * drag;
      // ...and flicks it off: kickflip off the heel side, heelflip off the toe side
      const flick = seg(t, 0.04, 0.13) * (1 - seg(t, 0.26, 0.4)); // leads the board's flip (it starts at 0.07s)
      if (a.flip > 0) {
        slideFoot.z = -0.06 - 0.32 * flick;
        slideFoot.y += 0.05 * flick;
        slideFoot.x += sx * 0.05 * flick;
        if (a.nollie) out.yawR = -0.15 + 0.6 * flick;
        else out.yawL = 0.35 + 0.6 * flick;
      } else if (a.flip < 0) {
        slideFoot.z = -0.06 + 0.3 * flick;
        slideFoot.y += 0.05 * flick;
        if (a.nollie) out.pitchR = -0.5 * flick;
        else out.pitchL = -0.5 * flick;
      }
      // shove-its: the popping foot scoops the tail around
      if (a.shove !== 0) {
        const scoop = seg(t, 0.02, 0.12) * (1 - seg(t, 0.24, 0.36));
        popFoot.z = -0.06 + (a.shove < 0 ? -0.22 : 0.22) * scoop;
      }
      if (a.wrap !== 0) {
        // impossible: the back foot scoops the board up around itself
        const wrap = seg(t, 0.04, 0.18) * (1 - seg(t, 0.25, 0.35));
        popFoot.y += wrap * 0.12;
        popFoot.x += sx * 0.1 * wrap;
      }
      const tricky = a.flip !== 0 || a.shove !== 0 || a.wrap !== 0;
      // knees up while the board spins underneath; stomp back down on the catch
      const tuckIn = tricky ? seg(t, 0.16, 0.3) : seg(t, 0.14, 0.26) * 0.45;
      let tuck = tuckIn;
      if (tricky && a.caught) tuck = a.catchT >= 0 ? tuckIn * (1 - seg(a.catchT, 0, 0.15)) : 0;
      if (!tricky) tuck *= 1 - seg(t, 0.32, 0.5); // ollie: feet back on the board at the peak
      const tuckPos = (x: number) => new THREE.Vector3(x, deck + (a.special ? 0.26 : 0.18), -0.04);
      fL.lerp(tuckPos(0.23), tuck);
      fR.lerp(tuckPos(-0.23), tuck);
      out.pitchL *= 1 - tuck;
      out.pitchR *= 1 - tuck;
      out.yawL += (0.35 - out.yawL) * tuck;
      out.yawR += (-0.15 - out.yawR) * tuck;
      // knees come up toward the chest rather than the whole body floating
      out.hipDrop = -0.03 * snap + tuck * 0.14 + seg(t, 0.25, 0.45) * 0.05;
      out.armsUp = seg(t, 0, 0.08) * (1 - seg(t, 0.2, 0.45)) * 0.45;
      out.arms = Math.max(seg(t, 0.03, 0.12) * 0.55, tuck * 0.6);
      this.lastL.copy(fL);
      this.lastR.copy(fR);
      return out;
    }

    // ---- unpopped air (rolled off a lip): legs soak up, arms out
    if (st.air) {
      fL.y += st.tuck * 0.2;
      fR.y += st.tuck * 0.2;
      out.arms = 0.6;
    }
    // ---- landing: knees absorb the impact
    if (a.landT >= 0 && a.landT < 1) {
      // quick drop into the knees, slow rise back to stance
      const k = Math.exp(-a.landT * 4.2) * seg(a.landT, 0, 0.09);
      out.hipDrop = 0.17 * k;
      out.armsUp = 0.25 * k;
      out.arms = Math.max(out.arms, 0.5 * k);
    }
    this.lastL.copy(fL);
    this.lastR.copy(fR);
    return out;
  }

  update(dt: number, st: RiderState) {
    if (!this.ready) {
      this.fallback.update(dt, st);
      return;
    }
    if (!this.group.visible) return;
    const s = this.s;
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, dt * rate);
    s.crouch = ease(s.crouch, st.crouch, 14);
    s.tuck = ease(s.tuck, st.tuck, 18);
    s.lean = ease(s.lean, st.lean, 10);
    s.grind = ease(s.grind, st.grind ?? 0, 10);
    s.air = ease(s.air, st.air ? 1 : 0, 8);
    const c = this.choreo(st);
    // pushing turns the body down the board for as long as the push footwork runs
    s.push = this.push.into;

    // back to the rest pose, then build the pose top-down
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    }
    this.group.updateMatrixWorld(true);
    const B = this.bones;
    const toW = (v: THREE.Vector3) => v.applyMatrix4(this.group.matrixWorld);

    // intent (rider frame: +X nose, +Y up, +Z toe side; the rider faces +Z)
    // pushing turns the whole body (hips first) to face down the board
    const twist = s.push * 1.25;
    const bend = 0.06 + HUNCH[this.id] + s.crouch * 0.42 + s.push * 0.18 + s.lean * 0.8;
    const roll = s.grind * 0.25;
    const hipYaw = 0.15 + twist;
    const hipQ = tq().setFromEuler(new THREE.Euler(bend * 0.35, hipYaw, -roll * 0.5, 'YXZ'));
    const torsoQ = tq().setFromEuler(new THREE.Euler(bend, twist * 0.95 + 0.25, -roll, 'YXZ'));
    const headQ = tq().setFromEuler(new THREE.Euler(-0.1 + s.crouch * 0.1 - s.air * 0.15, 1.05 + s.push * 0.3, 0, 'YXZ'));

    const fL = c.fL;
    const fR = c.fR;
    const hipY = DECK_TOP + this.ankleH + this.legLen * (0.9 - 0.3 * s.crouch) - c.hipDrop;
    const hipC = new THREE.Vector3(-0.02 + c.hipX, hipY, -0.03 + Math.sin(s.lean) * 0.35);

    // pelvis: place so the hip joints straddle hipC, then rotate
    const pelvisPos = hipC.clone().sub(this.hipOffset.clone().applyQuaternion(hipQ));
    const pw = toW(pelvisPos);
    B.pelvis.position.copy((B.pelvis.parent as THREE.Object3D).worldToLocal(pw));
    B.pelvis.updateMatrixWorld(true);
    this.setRiderQ(B.pelvis, hipQ.clone().multiply(this.restQ.get(B.pelvis)!));
    // spine eases from the hips into the full torso rotation
    const spine: BoneName[] = ['spine_01', 'spine_02', 'spine_03'];
    spine.forEach((n, i) => {
      const q = hipQ.clone().slerp(torsoQ, (i + 1) / spine.length);
      this.setRiderQ(B[n], q.multiply(this.restQ.get(B[n])!));
    });
    this.setRiderQ(B.neck_01, torsoQ.clone().slerp(headQ, 0.4).multiply(this.restQ.get(B.neck_01)!));
    this.setRiderQ(B.head, headQ.clone().multiply(this.restQ.get(B.head)!));

    // legs
    // knees bend the way the hips face
    const legPole = toW(new THREE.Vector3(0, 0.25, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), hipYaw - 0.15)).sub(toW(new THREE.Vector3()));
    const leg = (thigh: THREE.Bone, calf: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3, yaw: number) => {
      const root = thigh.getWorldPosition(tv());
      const a = root.distanceTo(calf.getWorldPosition(tv()));
      const b = calf.getWorldPosition(tv()).distanceTo(foot.getWorldPosition(tv()));
      const knee = tv();
      const end = tv();
      ik(root, toW(target.clone()), a, b, legPole, knee, end);
      this.aim(thigh, calf, knee);
      this.aim(calf, foot, end);
      // foot flat on the deck (or pointed for a flick), toes across the board
      const fq = tq().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      this.setRiderQ(foot, fq.multiply(this.restQ.get(foot)!));
    };
    let pitch = c.pitchL;
    leg(B.thigh_l, B.calf_l, B.foot_l, fL, c.yawL);
    pitch = c.pitchR;
    leg(B.thigh_r, B.calf_r, B.foot_r, fR, c.yawR);

    // arms: by the sides, wide on rails, flung up in the air
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(torsoQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQ);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(torsoQ);
    const g2l = this.group.matrixWorld.clone().invert();
    const wide = Math.max(st.grind !== null ? 1 : 0, st.act ? 0 : s.air * 0.8, c.arms);
    const swingT = Math.sin(st.time * 2.4) * 0.05;
    const arm = (upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, side: number) => {
      const sh = upper.getWorldPosition(tv());
      const a = sh.distanceTo(lower.getWorldPosition(tv()));
      const b = lower.getWorldPosition(tv()).distanceTo(hand.getWorldPosition(tv()));
      const shL = sh.clone().applyMatrix4(g2l);
      const relaxed = shL
        .clone()
        .addScaledVector(right, side * 0.1)
        .addScaledVector(up, -(a + b) * 0.92)
        .addScaledVector(front, 0.1 + swingT * side);
      const out = shL
        .clone()
        .addScaledVector(right, side * (a + b) * 0.88)
        .addScaledVector(up, -0.1 + (side > 0 ? s.grind : -s.grind) * 0.3 + c.armsUp * 0.35)
        .addScaledVector(front, 0.06);
      // pushing: arms swing against the kicking leg
      if (c.armSwing) relaxed.addScaledVector(new THREE.Vector3(1, 0, 0), side * c.armSwing * 0.22);
      const target = relaxed.lerp(out, Math.min(1, wide + s.crouch * 0.35));
      const pole = toW(new THREE.Vector3(0, -0.3, -1).applyQuaternion(torsoQ)).sub(toW(new THREE.Vector3()));
      const elbow = tv();
      const end = tv();
      ik(sh, toW(target), a, b, pole, elbow, end);
      this.aim(upper, lower, elbow);
      this.aim(lower, hand, end);
    };
    arm(B.upperarm_l, B.lowerarm_l, B.hand_l, -1);
    arm(B.upperarm_r, B.lowerarm_r, B.hand_r, 1);
  }
}
