import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rider, RiderId, RiderState, RiderStyle, ik, DECK_TOP } from './rider';

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
    const pushing = st.push >= 0;
    s.push = ease(s.push, pushing ? 1 : 0, 10);

    // back to the rest pose, then build the pose top-down
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    }
    this.group.updateMatrixWorld(true);
    const B = this.bones;
    const toW = (v: THREE.Vector3) => v.applyMatrix4(this.group.matrixWorld);

    // intent (rider frame: +X nose, +Y up, +Z toe side; the rider faces +Z)
    const twist = s.push * 0.75;
    const bend = 0.06 + HUNCH[this.id] + s.crouch * 0.42 + s.push * 0.3 + s.lean * 0.8;
    const roll = s.grind * 0.25;
    const hipQ = tq().setFromEuler(new THREE.Euler(bend * 0.35, twist * 0.35 + 0.15, -roll * 0.5, 'YXZ'));
    const torsoQ = tq().setFromEuler(new THREE.Euler(bend, twist + 0.25, -roll, 'YXZ'));
    const headQ = tq().setFromEuler(new THREE.Euler(-0.1 + s.crouch * 0.1 - s.air * 0.15, 1.05 - s.push * 0.6, 0, 'YXZ'));

    const fL = new THREE.Vector3(0.19, DECK_TOP + this.ankleH + s.tuck * 0.3, -0.06);
    const fR = new THREE.Vector3(-0.19, DECK_TOP + this.ankleH + s.tuck * 0.34, -0.06);
    if (pushing) {
      const ph = st.push;
      const ground = new THREE.Vector3(0.12 - ph * 0.6, this.ankleH, 0.24);
      fR.lerp(ground, Math.min(1, Math.sin(ph * Math.PI) * 1.6));
    }
    const hipY = DECK_TOP + this.ankleH + this.legLen * (0.9 - 0.3 * s.crouch) + s.tuck * 0.12 - s.push * 0.1;
    const hipC = new THREE.Vector3(-0.02 - s.push * 0.08, hipY, -0.03 + Math.sin(s.lean) * 0.35);

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
    const legPole = toW(new THREE.Vector3(0, 0.25, 1)).sub(toW(new THREE.Vector3()));
    const leg = (thigh: THREE.Bone, calf: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3, yaw: number) => {
      const root = thigh.getWorldPosition(tv());
      const a = root.distanceTo(calf.getWorldPosition(tv()));
      const b = calf.getWorldPosition(tv()).distanceTo(foot.getWorldPosition(tv()));
      const knee = tv();
      const end = tv();
      ik(root, toW(target.clone()), a, b, legPole, knee, end);
      this.aim(thigh, calf, knee);
      this.aim(calf, foot, end);
      // foot flat on the deck, toes across the board
      const fq = tq().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.setRiderQ(foot, fq.multiply(this.restQ.get(foot)!));
    };
    leg(B.thigh_l, B.calf_l, B.foot_l, fL, 0.35);
    leg(B.thigh_r, B.calf_r, B.foot_r, fR, pushing ? 0.6 : -0.15);

    // arms: by the sides, wide on rails, flung up in the air
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(torsoQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQ);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(torsoQ);
    const g2l = this.group.matrixWorld.clone().invert();
    const wide = Math.max(st.grind !== null ? 1 : 0, s.air * 0.8);
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
        .addScaledVector(up, -0.1 + (side > 0 ? s.grind : -s.grind) * 0.3)
        .addScaledVector(front, 0.06);
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
