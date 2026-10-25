import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RiderId, RiderState, RiderStyle, ik, DECK_TOP } from './rider';
import { CustomLook, PRESET_LOOKS, PRINT_SPOTS, defaultLook, extraParts, heightOf, partColors, shapeInfluences } from './custom';
import { TUNE, GRAB_LIFT } from './skater';
import { DECK } from './board';
import { Ragdoll, RAG, Ground } from './ragdoll';

/**
 * A MakeHuman character (generated in Blender with MPFB, CC0) driven by the
 * skate intent (RiderState): crouch, tuck, lean, push, grind
 * balance. Each frame the skeleton is reset to its rest pose, the pelvis and
 * spine are rotated, then legs and arms are solved with 2-bone IK against the
 * model's own bone lengths and every bone is aimed at its target with a
 * minimal swing, so the skin deforms like a person and the feet stay on the
 * bolts. Every rider, the story three included, is the create-a-skater model
 * dressed for its look; nothing is drawn until that model has loaded.
 */

const HUNCH: Record<RiderId, number> = { brock: 0.05, coral: 0, voss: 0.2, custom: 0 };

const cache = new Map<string, Promise<THREE.Group>>();

/**
 * Set by main.ts: compiles an object's shaders in the background so the first
 * frame a model appears doesn't stall on the compiler. Resolves when ready.
 */
export let compileHook: ((model: THREE.Object3D, owner: THREE.Object3D) => Promise<unknown>) | null = null;
export function setCompileHook(fn: typeof compileHook) {
  compileHook = fn;
}
function loadModel(file: string) {
  let p = cache.get(file);
  if (!p) {
    p = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}riders/${file}.glb`).then((g) => g.scene);
    cache.set(file, p);
  }
  return p;
}

/** The Atlas Skateboards globe: ring, two meridian ellipses, the axis and three parallels. */
function atlasGlobe(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, col: string) {
  g.strokeStyle = col;
  g.lineWidth = Math.max(2, R * 0.12);
  g.beginPath();
  g.ellipse(cx, cy, R, R, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = Math.max(2, R * 0.08);
  g.beginPath();
  for (const k of [0.38, 0.75]) {
    g.moveTo(cx + R * k, cy);
    g.ellipse(cx, cy, R * k, R, 0, 0, Math.PI * 2);
  }
  g.moveTo(cx, cy - R);
  g.lineTo(cx, cy + R);
  for (const t of [-0.5, 0, 0.5]) {
    const hw = Math.sqrt(R * R - (t * R) ** 2);
    g.moveTo(cx - hw, cy + t * R);
    g.lineTo(cx + hw, cy + t * R);
  }
  g.stroke();
}

/** Hide every part of the modular model the look doesn't wear and tint the ones it does. */
function dress(scene: THREE.Object3D, look: CustomLook) {
  const colors = partColors(look);
  const drop: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o.name in colors)) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
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

/** Orientation of the frame whose +X is `across` and +Y is (orthogonalized) `up`. */
function frameQ(across: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion) {
  const x = across.clone().normalize();
  const z = tv().crossVectors(x, up).normalize();
  const y = tv().crossVectors(z, x);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Off the board: a person standing around (story cutscenes). Points are in
 * world space; each hand blends from hanging relaxed toward its target by
 * its reach.
 */
export interface StandState {
  time: number;
  /** what the head turns to */
  look: THREE.Vector3;
  /** 0..1 how hard they're talking: head bobs, chest pumps */
  talk: number;
  handL: THREE.Vector3 | null;
  reachL: number;
  handR: THREE.Vector3 | null;
  reachR: number;
  /** radians, + leans in, - rocks back */
  lean: number;
  /** 0..1 shoulders up to the ears */
  shrug: number;
  /** radians the chest turns (+ toward the left hand), e.g. to point at something off to the side */
  turn?: number;
  /** 0..1 how far each hand's fingers close round something held (a phone) */
  gripL?: number;
  gripR?: number;
}

/** the axis a finger joint bends on, in the bone's own frame */
const CURL_AXIS = new THREE.Vector3(1, 0, 0);
/** the finger bones of one hand, knuckle first; the thumb's chain is last */
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];

export class HumanRider {
  group = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private bones = {} as Record<BoneName, THREE.Bone>;
  private all: THREE.Bone[] = [];
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion }>();
  /** rest rotation of each bone relative to the rider frame (group local) */
  private restQ = new Map<THREE.Bone, THREE.Quaternion>();
  private mats: THREE.MeshStandardMaterial[] = [];
  private matByPart = new Map<string, THREE.MeshStandardMaterial>();
  private style: RiderStyle = 'solid';
  private s = { crouch: 0, tuck: 0, lean: 0, grind: 0, air: 0, push: 0, fakie: 0 };
  private disposed = false;
  ready = false;
  /** cast real shadows (the park locals use a cheap blob instead) */
  shadows = true;
  /** [material name pattern, colour] multiplied into a preset rider's clothes for variety */
  private tints: [RegExp, string][] = [];
  // rest measurements (rider frame, after scaling)
  private ankleH = 0.08;
  private legLen = 0.9;
  private hipOffset = new THREE.Vector3(); // pelvis origin -> midpoint of thigh heads
  // rest-pose torso frames (rider frame) for posing from the ragdoll
  private restHipQ = new THREE.Quaternion();
  private restChestQ = new THREE.Quaternion();
  private rag: Ragdoll | null = null;
  /** each hand's finger chains (knuckle, middle, tip), for gripping */
  private fingers: Record<'l' | 'r', THREE.Bone[][]> = { l: [], r: [] };
  private ground: Ground | null = null;

  private look: CustomLook;
  /** the top's texture before a print was drawn over it */
  private printBase: THREE.Texture | null = null;
  /** settles once the model is dressed and posed (or fails to load) */
  readonly loaded: Promise<void>;

  /** `look` dresses the modular create-a-skater model when id is 'custom'; the story riders wear their preset. */
  constructor(
    public id: RiderId,
    look: CustomLook | null = null,
  ) {
    this.look = id === 'custom' ? (look ?? defaultLook()) : PRESET_LOOKS[id];
    // themed parts (beach, party, cowboy) live in a second model, fetched only when worn
    const extras = extraParts(this.look).length ? loadModel(`extras_${this.look.body}`).catch(() => null) : Promise.resolve(null);
    this.loaded = Promise.all([loadModel(`custom_${this.look.body}`), extras]).then(
      ([scene, ex]) => {
        if (this.disposed) return;
        const root = scene.clone(true);
        if (ex) {
          // same skeleton bone names: the rebind in attach() hooks these meshes to this rider's bones
          const spare = ex.clone(true);
          for (const name of extraParts(this.look)) {
            const m = spare.getObjectByName(name);
            if (m) root.add(m);
          }
        }
        return this.attach(root);
      },
      (e) => console.warn('rider model failed to load', e),
    );
  }

  private attach(scene: THREE.Object3D) {
    dress(scene, this.look);
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
        this.matByPart.set(sm.name, m);
        if (/^(top|bottom|shoes|hat)_/.test(sm.name)) {
          // cloth always wins the depth test against the skin under it
          m.polygonOffset = true;
          m.polygonOffsetFactor = -2;
          m.polygonOffsetUnits = -2;
        }
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
    for (const side of ['l', 'r'] as const) {
      this.fingers[side] = FINGERS.map((f) => [1, 2, 3].map((k) => byName.get(`${f}_0${k}_${side}`)).filter((b): b is THREE.Bone => !!b));
    }
    for (const b of this.all) this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone() });

    // scale to the character's height; MakeHuman faces +Z with feet at y=0
    // hats and hair don't count towards how tall the character is
    const box = new THREE.Box3().setFromObject(scene.getObjectByName('body') ?? scene);
    const k = heightOf(this.look) / Math.max(0.5, box.max.y - box.min.y);
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
    const hipMid = P('thigh_l').add(P('thigh_r')).multiplyScalar(0.5);
    const up = P('spine_03').sub(hipMid);
    frameQ(P('thigh_l').sub(P('thigh_r')), up, this.restHipQ);
    frameQ(P('upperarm_l').sub(P('upperarm_r')), up, this.restChestQ);

    this.recolor(this.look);
    this.reshape(this.look);
    for (const [re, c] of this.tints) for (const m of this.mats) if (re.test(m.name)) m.color.set(c);
    // material flags (alpha test, sides, shadows) are part of the shader: settle them before compiling
    this.setStyle(this.style);
    const show = () => {
      if (this.disposed) return;
      this.group.add(scene);
      this.ready = true;
    };
    // nothing is drawn while the model's shaders compile off the main thread
    this.group.remove(scene);
    if (compileHook) return compileHook(scene, this.group).then(show, show);
    show();
  }

  /** Multiply a colour into every material whose name matches (preset riders' clothes). */
  tint(re: RegExp, color: string) {
    this.tints.push([re, color]);
    for (const m of this.mats) if (re.test(m.name)) m.color.set(color);
  }

  /** Re-tint a create-a-skater model in place (same parts, new colours). */
  recolor(look: CustomLook) {
    this.look = look;
    for (const [part, c] of Object.entries(partColors(look))) if (c) this.matByPart.get(part)?.color.set(c);
    this.applyPrint();
  }

  /**
   * Draw the look's chest print into this rider's copy of the top texture.
   * The kit's cloth is greyscale tinted by the material colour, which would
   * tint the print too, so the colour is baked into the copy instead.
   */
  private applyPrint() {
    for (const m of this.mats) {
      if (m.userData.printed) {
        m.map?.dispose();
        m.map = this.printBase;
        m.userData.printed = false;
        m.needsUpdate = true;
      }
    }
    const spot = PRINT_SPOTS[this.look.top];
    const m = this.matByPart.get('top_' + this.look.top);
    const img = m?.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!this.look.print || !spot || !m || !img) return;
    this.printBase = m.map;
    const W = img.width;
    const H = img.height;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#' + m.color.getHexString();
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    atlasGlobe(g, spot.x * W, spot.y * H, spot.r * W, '#faf6ec');
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = this.printBase!.wrapS;
    tex.wrapT = this.printBase!.wrapT;
    m.map = tex;
    m.color.set(0xffffff);
    m.userData.printed = true;
    m.needsUpdate = true;
  }

  /** Blend the body / top / bottom morph targets to the look's shape sliders. */
  reshape(look: CustomLook) {
    this.look = look;
    const w = shapeInfluences(look);
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
      for (const [name, i] of Object.entries(m.morphTargetDictionary)) m.morphTargetInfluences[i] = w[name] ?? 0;
    });
  }

  setStyle(style: RiderStyle) {
    this.style = style;
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
        o.castShadow = !ghost && this.shadows;
        o.renderOrder = ghost ? 2 : 0;
      }
    });
  }

  dispose() {
    this.disposed = true;
    for (const m of this.mats) if (m.userData.printed) m.map?.dispose();
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

  /* ---------------------------- replays --------------------------- */

  /**
   * Snapshot the posed skeleton for a replay: pelvis position then each named
   * bone's local rotation (every other bone stays at rest). Returns false
   * while the model is still loading.
   */
  writePose(out: Float32Array, o: number) {
    if (!this.ready) return false;
    this.bones.pelvis.position.toArray(out, o);
    BONES.forEach((n, i) => this.bones[n].quaternion.toArray(out, o + 3 + i * 4));
    return true;
  }

  /** Pose the skeleton straight from a replay snapshot. */
  readPose(src: Float32Array, o: number) {
    if (!this.ready) return;
    this.rag = null;
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    }
    this.bones.pelvis.position.fromArray(src, o);
    BONES.forEach((n, i) => this.bones[n].quaternion.fromArray(src, o + 3 + i * 4));
  }

  /* ---------------------------- ragdoll --------------------------- */

  get ragdolling() {
    return this.rag !== null;
  }

  /**
   * Go limp from the current pose. The feet catch (the board shoots out from
   * under them) while the upper body carries on, so the rider tips over and
   * tumbles in the direction of travel; `side` picks which way they topple.
   * Returns false while the model hasn't loaded (the caller animates the fall).
   */
  startRagdoll(vel: THREE.Vector3, side: number, ground: Ground) {
    if (!this.ready) return false;
    const B = this.bones;
    const order: BoneName[] = [
      'thigh_l', 'thigh_r', 'spine_03', 'head', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
      'hand_l', 'hand_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r',
    ];
    this.group.updateMatrixWorld(true);
    const pos = order.map((n) => B[n].getWorldPosition(tv()));
    // toward the rider's front (rider frame +Z) or back
    const tip = tv().set(0, 0, side).applyQuaternion(this.group.quaternion);
    tip.y = 0;
    tip.normalize();
    const vels = order.map((_, i) => {
      const v = vel.clone();
      if (i === RAG.ankL || i === RAG.ankR) return v.multiplyScalar(0.3);
      if (i === RAG.kneeL || i === RAG.kneeR) return v.multiplyScalar(0.55);
      if (i === RAG.hipL || i === RAG.hipR) return v.multiplyScalar(0.85).addScaledVector(tip, 0.4);
      return v.addScaledVector(tip, 1.3).add(tv().set(0, 0.6, 0));
    });
    this.rag = new Ragdoll(TUNE.gravity);
    this.rag.start(pos, vels);
    this.ground = ground;
    return true;
  }

  stopRagdoll() {
    this.rag = null;
  }

  private poseRagdoll(dt: number) {
    const rag = this.rag!;
    rag.step(dt, this.ground!);
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    }
    this.group.updateMatrixWorld(true);
    const B = this.bones;
    const P = rag.p;
    const hipMid = tv().addVectors(P[RAG.hipL], P[RAG.hipR]).multiplyScalar(0.5);
    const up = tv().subVectors(P[RAG.chest], hipMid);
    // rotation taking the rest torso frames (rider frame) to the ragdoll's (world)
    const hipR = frameQ(tv().subVectors(P[RAG.hipL], P[RAG.hipR]), up, tq()).multiply(this.restHipQ.clone().invert());
    const chestR = frameQ(tv().subVectors(P[RAG.shL], P[RAG.shR]), up, tq()).multiply(this.restChestQ.clone().invert());
    const setW = (b: THREE.Bone, q: THREE.Quaternion) => {
      const parentW = (b.parent as THREE.Object3D).getWorldQuaternion(_q2).invert();
      b.quaternion.copy(parentW.multiply(q));
      b.updateMatrixWorld(true);
    };
    // pelvis: placed so its hip joints sit on the ragdoll's hips
    const pw = hipMid.clone().sub(this.hipOffset.clone().applyQuaternion(hipR));
    B.pelvis.position.copy((B.pelvis.parent as THREE.Object3D).worldToLocal(pw));
    B.pelvis.updateMatrixWorld(true);
    setW(B.pelvis, hipR.clone().multiply(this.restQ.get(B.pelvis)!));
    const spine: BoneName[] = ['spine_01', 'spine_02', 'spine_03'];
    spine.forEach((n, i) => setW(B[n], hipR.clone().slerp(chestR, (i + 1) / spine.length).multiply(this.restQ.get(B[n])!)));
    this.aim(B.neck_01, B.head, P[RAG.head]);
    setW(B.head, chestR.clone().multiply(this.restQ.get(B.head)!));
    this.aim(B.thigh_l, B.calf_l, P[RAG.kneeL]);
    this.aim(B.calf_l, B.foot_l, P[RAG.ankL]);
    this.aim(B.thigh_r, B.calf_r, P[RAG.kneeR]);
    this.aim(B.calf_r, B.foot_r, P[RAG.ankR]);
    this.aim(B.upperarm_l, B.lowerarm_l, P[RAG.elbL]);
    this.aim(B.lowerarm_l, B.hand_l, P[RAG.handL]);
    this.aim(B.upperarm_r, B.lowerarm_r, P[RAG.elbR]);
    this.aim(B.lowerarm_r, B.hand_r, P[RAG.handR]);
  }

  /** World position of a skeleton point (head, hands...) once the model is in. */
  joint(name: 'head' | 'hand_l' | 'hand_r' | 'lowerarm_l' | 'lowerarm_r' | 'neck_01', out: THREE.Vector3) {
    return this.ready ? this.bones[name].getWorldPosition(out) : out.copy(this.group.position).setY(this.group.position.y + 1.6);
  }

  /** Stand on the ground at the group's origin, facing +Z: no board, just a person. */
  stand(st: StandState) {
    if (!this.ready || !this.group.visible) return;
    this.rag = null;
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    }
    this.group.updateMatrixWorld(true);
    const B = this.bones;
    const toW = (v: THREE.Vector3) => v.applyMatrix4(this.group.matrixWorld);
    const g2l = this.group.matrixWorld.clone().invert();
    const t = st.time;
    // idle life: breathing, a slow weight shift, a little bob while talking
    const sway = Math.sin(t * 0.7) * 0.025;
    const bob = Math.sin(t * 8.5) * 0.04 * st.talk;
    const turn = st.turn ?? 0;
    const hipQ = tq().setFromEuler(new THREE.Euler(st.lean * 0.25, sway * 2 + turn * 0.35, sway * 1.5, 'YXZ'));
    // head toward the look point, the chest follows a little
    const head = B.head.getWorldPosition(tv()).applyMatrix4(g2l);
    const d = st.look.clone().applyMatrix4(g2l).sub(head);
    const yaw = Math.max(-1.3, Math.min(1.3, Math.atan2(d.x, d.z)));
    const pitch = Math.max(-0.5, Math.min(0.6, Math.atan2(-d.y, Math.hypot(d.x, d.z))));
    const torsoQ = tq().setFromEuler(new THREE.Euler(st.lean + bob * 0.5 + Math.sin(t * 1.7) * 0.01, yaw * 0.3 + turn, -sway, 'YXZ'));
    const headQ = tq().setFromEuler(new THREE.Euler(pitch + bob, yaw, Math.sin(t * 0.9) * 0.04, 'YXZ'));

    const hipC = new THREE.Vector3(sway, this.ankleH + this.legLen * 0.985, -st.lean * 0.05);
    const pelvisPos = hipC.clone().sub(this.hipOffset.clone().applyQuaternion(hipQ));
    B.pelvis.position.copy((B.pelvis.parent as THREE.Object3D).worldToLocal(toW(pelvisPos)));
    B.pelvis.updateMatrixWorld(true);
    this.setRiderQ(B.pelvis, hipQ.clone().multiply(this.restQ.get(B.pelvis)!));
    (['spine_01', 'spine_02', 'spine_03'] as BoneName[]).forEach((n, i) => {
      this.setRiderQ(B[n], hipQ.clone().slerp(torsoQ, (i + 1) / 3).multiply(this.restQ.get(B[n])!));
    });
    this.setRiderQ(B.neck_01, torsoQ.clone().slerp(headQ, 0.4).multiply(this.restQ.get(B.neck_01)!));
    this.setRiderQ(B.head, headQ.clone().multiply(this.restQ.get(B.head)!));

    // feet planted a little apart, toes out
    const legPole = toW(new THREE.Vector3(0, 0.25, 1)).sub(toW(new THREE.Vector3()));
    const leg = (thigh: THREE.Bone, calf: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3, footYaw: number) => {
      const root = thigh.getWorldPosition(tv());
      const a = root.distanceTo(calf.getWorldPosition(tv()));
      const b = calf.getWorldPosition(tv()).distanceTo(foot.getWorldPosition(tv()));
      const knee = tv();
      const end = tv();
      ik(root, toW(target.clone()), a, b, legPole, knee, end);
      this.aim(thigh, calf, knee);
      this.aim(calf, foot, end);
      this.setRiderQ(foot, tq().setFromEuler(new THREE.Euler(0, footYaw, 0, 'YXZ')).multiply(this.restQ.get(foot)!));
    };
    leg(B.thigh_l, B.calf_l, B.foot_l, new THREE.Vector3(0.13, this.ankleH, 0.02), 0.2);
    leg(B.thigh_r, B.calf_r, B.foot_r, new THREE.Vector3(-0.13, this.ankleH, -0.02), -0.2);

    // arms hang (swinging a touch), or reach for their targets
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(torsoQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQ);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(torsoQ);
    const arm = (clav: THREE.Bone, upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, side: number, want: THREE.Vector3 | null, reach: number) => {
      let sh = upper.getWorldPosition(tv());
      const a = sh.distanceTo(lower.getWorldPosition(tv()));
      const b = lower.getWorldPosition(tv()).distanceTo(hand.getWorldPosition(tv()));
      const shL = sh.clone().applyMatrix4(g2l);
      const target = shL
        .clone()
        .addScaledVector(right, side * 0.12)
        .addScaledVector(up, -(a + b) * 0.93)
        .addScaledVector(front, 0.05 + Math.sin(t * 1.1 + side) * 0.015);
      if (want && reach > 0) target.lerp(want.clone().applyMatrix4(g2l), Math.min(1, reach));
      // keep the hand outside the torso (a blend between two gestures can cut straight through it)
      const hipY = this.ankleH + this.legLen;
      if (target.y > hipY - 0.1 && target.y < shL.y + 0.05) {
        const px = target.dot(right);
        const pz = target.dot(front) + st.lean * 0.05;
        const e = (px / 0.25) ** 2 + (pz / 0.2) ** 2;
        if (e < 1) {
          const k = 1 / Math.sqrt(Math.max(e, 1e-4)) - 1;
          target.addScaledVector(right, px * k).addScaledVector(front, (pz || 0.01) * k);
        }
      }
      // ...and out of the head (hands going up to it pass in front of the face)
      const headL = B.head.getWorldPosition(tv()).applyMatrix4(g2l);
      const off = target.clone().sub(headL);
      if (off.length() < 0.17) {
        // round the side of the head, never through it
        if (Math.abs(off.dot(right)) < 0.05) off.addScaledVector(right, side * 0.05);
        target.copy(headL).add(off.setLength(0.17));
      }
      // how far the hand is raised: 0 at the hip .. 1 at shoulder height and above
      const raise = Math.max(0, Math.min(1, (target.clone().sub(shL).dot(up) + (a + b) * 0.6) / ((a + b) * 0.75)));
      // the shoulder blade rides up with a raised arm (and a shrug), as a real one does:
      // without it the top of the arm folds into the shoulder
      const lift = raise * raise * 0.045 + st.shrug * 0.04;
      if (lift > 0.002) {
        this.aim(clav, upper, toW(shL.clone().addScaledVector(up, lift).addScaledVector(right, side * raise * 0.01)));
        sh = upper.getWorldPosition(tv());
      }
      // elbows hang down and a little out; they swing out to the side as the hand comes up
      const poleL = right
        .clone()
        .multiplyScalar(side * (0.35 + 0.65 * raise))
        .addScaledVector(up, -0.8 + 0.6 * raise)
        .addScaledVector(front, -0.35 + 0.15 * raise);
      const pole = toW(poleL).sub(toW(new THREE.Vector3()));
      const elbow = tv();
      const end = tv();
      ik(sh, toW(target), a, b, pole, elbow, end);
      this.aim(upper, lower, elbow);
      this.aim(lower, hand, end);
    };
    arm(B.clavicle_l, B.upperarm_l, B.lowerarm_l, B.hand_l, -1, st.handL, st.reachL);
    arm(B.clavicle_r, B.upperarm_r, B.lowerarm_r, B.hand_r, 1, st.handR, st.reachR);
    if (st.gripL) this.curl('l', st.gripL);
    if (st.gripR) this.curl('r', st.gripR);
  }

  /** Close a hand: every finger joint bends in toward the palm, the thumb less, as round a phone. */
  private curl(side: 'l' | 'r', k: number) {
    this.fingers[side].forEach((chain, f) => {
      const thumb = f === FINGERS.length - 1;
      chain.forEach((b, j) => {
        const ang = k * (thumb ? [0.15, 0.35, 0.3][j] : [0.9, 1.1, 0.7][j]);
        b.quaternion.multiply(tq().setFromAxisAngle(CURL_AXIS, ang));
      });
    });
  }

  update(dt: number, st: RiderState) {
    if (this.rag) {
      if (this.group.visible) this.poseRagdoll(dt);
      return;
    }
    if (!this.ready) return;
    if (!this.group.visible) return;
    const s = this.s;
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, dt * rate);
    s.crouch = ease(s.crouch, st.crouch, 14);
    s.tuck = ease(s.tuck, st.tuck, 18);
    s.lean = ease(s.lean, st.lean, 10);
    s.grind = ease(s.grind, st.grind ?? 0, 10);
    s.air = ease(s.air, st.air ? 1 : 0, 8);
    const c = this.choreo(st);
    // grab: the board comes up to the hand. Feet stay on the (tweaked) deck,
    // knees fold toward the chest, the body folds down over the board.
    const grab = st.act?.grab;
    const ga = grab ? grab.amt : 0;
    let tweakQ: THREE.Quaternion | null = null;
    if (grab) {
      tweakQ = tq().setFromEuler(new THREE.Euler(grab.roll * ga, grab.yaw * ga, grab.pitch * ga, 'YXZ'));
      const pivot = new THREE.Vector3(0, DECK.deckY, 0);
      const onDeck = (x: number, z: number) => new THREE.Vector3(x, DECK_TOP + this.ankleH - 0.01, z).sub(pivot).applyQuaternion(tweakQ!).add(pivot);
      c.fL.lerp(onDeck(0.19, -0.06), ga);
      c.fR.lerp(onDeck(-0.19, -0.06), ga);
      c.pitchL *= 1 - ga;
      c.pitchR *= 1 - ga;
      c.hipDrop += ga * (GRAB_LIFT + 0.1);
      c.arms = Math.max(c.arms, ga);
    }
    // pushing turns the body down the board for as long as the push footwork runs
    s.push = this.push.into;
    // rolling backwards: look over the other shoulder toward where you're going
    s.fakie = ease(s.fakie, st.act?.fakie ? 1 : 0, 6);

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
    const bend = 0.06 + HUNCH[this.id] + s.crouch * 0.42 + s.push * 0.18 + s.lean * 0.8 + ga * 0.55;
    const roll = s.grind * 0.25;
    const hipYaw = 0.15 + twist;
    const hipQ = tq().setFromEuler(new THREE.Euler(bend * 0.35, hipYaw, -roll * 0.5, 'YXZ'));
    const torsoQ = tq().setFromEuler(new THREE.Euler(bend, twist * 0.95 + 0.25 - s.fakie * 0.45, -roll, 'YXZ'));
    const headQ = tq().setFromEuler(new THREE.Euler(-0.1 + s.crouch * 0.1 - s.air * 0.15 + ga * 0.3, 1.05 + s.push * 0.3 - s.fakie * 2.0, 0, 'YXZ'));

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
      // the grabbing hand goes to its spot on the board edge
      const grabbing = grab && (grab.hand === 'front' ? side < 0 : side > 0);
      if (grabbing && tweakQ) {
        const pivot = new THREE.Vector3(0, DECK.deckY, 0);
        const spot = new THREE.Vector3(grab.x, DECK.deckY, grab.z * 1.15).sub(pivot).applyQuaternion(tweakQ).add(pivot);
        target.lerp(spot, ga);
      }
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
