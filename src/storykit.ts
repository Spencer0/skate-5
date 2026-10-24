import * as THREE from 'three';
import { BoardModel } from './board';
import { HumanRider, StandState } from './humanrider';
import type { RiderId } from './rider';
import { Clip, F, STRIDE, Sfx, sampleFrame } from './replay/clip';
import { applyFrame } from './replay/rig';
import { shadowTexture } from './textures';
import type { CustomLook } from './custom';
import type { Audio } from './audio';
import type { Cues } from './captions';
import { rigJaw, Jaw } from './jaw';

/**
 * The pieces the story scenes (src/opening.ts, src/filmthis.ts) share: skaters
 * replayed from recorded lines, people standing around talking and pointing,
 * and the 9:16 phone framing.
 */

export interface StoryHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  audio: Audio;
  groundAt(x: number, z: number): number;
}

/** phone framing on wide screens */
export const PORTRAIT = 9 / 16;

export const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** The phone-shaped rectangle a story scene renders into (CSS pixels, top-left origin). */
export function phoneView(w: number, h: number) {
  if (w / h <= PORTRAIT + 0.01) return { x: 0, y: 0, w, h };
  const vw = Math.round(h * PORTRAIT);
  return { x: Math.round((w - vw) / 2), y: 0, w: vw, h };
}

/* ---------------------------- skaters ---------------------------- */

export interface Ghost {
  clip: Clip;
  board: BoardModel;
  rider: HumanRider;
  blob: THREE.Mesh;
  /** clip time at dialogue time 0 */
  offset: number;
  frame: Float32Array;
  sfxAt: number;
}

/**
 * The recorded lines in a tools/story/ghosts.mjs file, each on its own board and
 * rider (the pose was solved for that body, so it plays back on the same one).
 */
export function unpackGhosts(buf: ArrayBuffer, group: THREE.Group): Ghost[] {
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as { name: string; rider: RiderId; frames: number; sfx?: Sfx[] }[];
  let off = 4 + n + ((4 - ((4 + n) % 4)) % 4);
  const decks = ['brazil', 'atlas', 'compass', 'japan', 'airmail', 'mosaic'];
  return head.map((h, i) => {
    const data = new Float32Array(buf, off, h.frames * STRIDE);
    off += h.frames * STRIDE * 4;
    const clip = { id: h.name, name: h.name, created: 0, level: 0, levelName: '', rider: h.rider, look: null, deck: decks[i % decks.length], frames: h.frames, data, sfx: h.sfx ?? [] } as Clip;
    const board = new BoardModel();
    board.setDeck(clip.deck);
    const rider = new HumanRider(h.rider);
    rider.setStyle('solid');
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    group.add(board.root, rider.group, blob);
    return { clip, board, rider, blob, offset: 0, frame: new Float32Array(STRIDE), sfxAt: -1 };
  });
}

/** Pose a skater at clip time ct and play the line's own sounds since the last call, quieter with distance. */
export function poseGhost(g: Ghost, ct: number, host: StoryHost, near = 7, gain = 1) {
  sampleFrame(g.clip, ct, g.frame);
  applyFrame({ board: g.board, rider: g.rider, blob: g.blob, camera: host.camera }, g.frame);
  const dist = g.board.root.position.distanceTo(host.camera.position);
  if (ct < g.sfxAt) g.sfxAt = ct - 1e-3; // looped, or a replay
  const level = Math.min(1, near / Math.max(1, dist)) * 0.9 * gain;
  for (const s of g.clip.sfx) {
    if (s.t > g.sfxAt && s.t <= ct) {
      const fn = (host.audio as unknown as Record<string, (...a: unknown[]) => void>)[s.n];
      if (fn) host.audio.distant(level, () => fn.apply(host.audio, s.a));
    }
  }
  g.sfxAt = ct;
  return dist;
}

/** The wheels: a skater's roll and grind on the bed, `k` loud. */
export function wheels(g: Ghost, host: StoryHost, k: number) {
  const f = g.frame;
  host.audio.update(f[F.sound] * k, f[F.sound + 1] === 2 ? 'slide' : f[F.sound + 1] === 1 ? 'grind' : 'none', f[F.sound + 2] * k, false);
}

/* ---------------------------- people ---------------------------- */

export interface Person {
  rider: HumanRider;
  st: StandState;
  /** eased hand targets */
  hl: THREE.Vector3;
  hr: THREE.Vector3;
  jaw: Jaw | null;
  /** the current gesture and when it started */
  aimKey: string;
  aimT: number;
}

/** A person standing at `at`: a custom look, or one of the riders. */
export function person(look: CustomLook | RiderId, at: THREE.Vector3): Person {
  const rider = typeof look === 'string' ? new HumanRider(look) : new HumanRider('custom', look);
  rider.setStyle('solid');
  rider.group.position.copy(at);
  return {
    rider,
    st: { time: 0, look: new THREE.Vector3(), talk: 0, handL: new THREE.Vector3(), reachL: 0, handR: new THREE.Vector3(), reachR: 0, lean: 0, shrug: 0 },
    hl: new THREE.Vector3(),
    hr: new THREE.Vector3(),
    jaw: null,
    aimKey: '',
    aimT: 0,
  };
}

export const headOf = (p: Person) => p.rider.joint('head', new THREE.Vector3());

/** What a person is doing right now: the targets their hands, head and body ease toward. */
export interface Intent {
  look: THREE.Vector3;
  /** a world point to point at (with whichever hand is on that side) */
  point?: THREE.Vector3 | null;
  /**
   * an "over there" point, in the body's own frame: ang radians from straight ahead
   * (+ toward the left hand), up how high. Things behind them get pointed at like
   * this, out to the side, the way people do, not with an arm wrenched backwards.
   */
  aim?: { ang: number; up: number };
  /** both palms up and out */
  palms?: number;
  /** hands to the head */
  head?: number;
  /** both arms flung up */
  fling?: number;
  /** a hand over the face */
  face?: number;
  /** the hands held here (world), e.g. both on a phone, filming */
  holdR?: THREE.Vector3;
  holdL?: THREE.Vector3;
  lean?: number;
  shrug?: number;
}

/** 0..1 mouth-and-head energy for a speaker: a pulse on every word they say. */
export function talkLevel(cues: Cues | null, who: 'a' | 'b', d: number) {
  let v = 0;
  for (const L of cues?.lines ?? []) {
    if (L.who !== who || d < L.t0 - 0.1 || d > L.t1 + 0.1) continue;
    for (const w of L.words) {
      if (d < w.t0 - 0.05 || d > w.t1 + 0.05) continue;
      const k = (d - w.t0) / Math.max(0.08, w.t1 - w.t0);
      v = Math.max(v, Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * (/[!?]|[A-Z]{2,}/.test(w.w) ? 1 : 0.7));
    }
  }
  return v;
}

/** The jaw flaps with the syllables inside each word. */
export function flapJaw(p: Person, talk: number, d: number, phase: number) {
  if (!p.jaw && p.rider.ready) p.jaw = rigJaw(p.rider.group);
  p.jaw?.set(talk * (0.45 + 0.55 * Math.abs(Math.sin(d * 17 + phase))));
}

/** Ease a person toward what they're doing and stand them there (set st.time and st.talk first). */
export function posePerson(p: Person, it: Intent, dt: number, t: number) {
  const st = p.st;
  const k = 1 - Math.exp(-dt * 11);
  st.lean += ((it.lean ?? 0) - st.lean) * k;
  st.shrug += ((it.shrug ?? 0) - st.shrug) * k;
  const g = p.rider.group;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
  const head = headOf(p);
  const chest = head.clone().setY(head.y - 0.42);
  // decide each hand's target
  let wl: THREE.Vector3 | null = null;
  let wr: THREE.Vector3 | null = null;
  // pointing: the chest turns toward it, the arm covers the rest within reach of a
  // real shoulder (never back behind the body), angled up over anything in the way
  let turn = 0;
  if (it.point || it.aim) {
    let ang: number;
    let lift: number;
    if (it.aim) {
      ({ ang, up: lift } = it.aim);
    } else {
      const toT = it.point!.clone().sub(chest);
      ang = Math.max(-1.1, Math.min(1.1, Math.atan2(toT.dot(left), toT.dot(fwd)))); // + toward the left hand
      lift = Math.max(-0.2, Math.min(0.4, toT.y / Math.max(0.3, Math.hypot(toT.x, toT.z))));
    }
    turn = ang * 0.4;
    const side = ang >= 0 ? 'l' : 'r';
    const yawF = Math.atan2(fwd.x, fwd.z);
    const horiz = new THREE.Vector3(Math.sin(yawF + ang), 0, Math.cos(yawF + ang));
    const dir = horiz.add(new THREE.Vector3(0, lift, 0)).normalize();
    // glance along the arm as the point goes out, then back to the other guy
    const key = `${ang},${lift}`;
    if (key !== p.aimKey) {
      p.aimKey = key;
      p.aimT = t;
    }
    if (it.aim && t - p.aimT < 0.45) it.look = chest.clone().addScaledVector(dir, 8);
    const turnedLeft = left.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    const sh = chest.clone().addScaledVector(turnedLeft, side === 'l' ? 0.17 : -0.17).setY(chest.y + 0.12);
    // just short of full reach: the arm reads straight, the elbow isn't locked
    const target = sh.addScaledVector(dir, 0.62);
    if (side === 'l') wl = target;
    else wr = target;
  }
  st.turn = (st.turn ?? 0) + (turn - (st.turn ?? 0)) * k;
  st.look.lerp(it.look, st.look.lengthSq() ? k : 1);
  if (it.holdR) wr = it.holdR;
  if (it.holdL) wl = it.holdL;
  if (it.palms) {
    const lo = chest.clone().setY(chest.y - 0.2).addScaledVector(fwd, 0.3);
    wl ??= lo.clone().addScaledVector(left, 0.32 * it.palms);
    wr ??= lo.clone().addScaledVector(left, -0.32 * it.palms);
  }
  if (it.head) {
    // palms on the sides of the head, elbows out
    wl = head.clone().addScaledVector(left, 0.1).addScaledVector(fwd, -0.01).setY(head.y + 0.07);
    wr = head.clone().addScaledVector(left, -0.1).addScaledVector(fwd, -0.01).setY(head.y + 0.07);
  }
  if (it.fling) {
    // arms thrown up and out, a bit forward: "what do you want from me"
    wl = head.clone().addScaledVector(left, 0.5).setY(head.y + 0.12).addScaledVector(fwd, 0.22);
    wr = head.clone().addScaledVector(left, -0.5).setY(head.y + 0.12).addScaledVector(fwd, 0.22);
  }
  if (it.face) wl = head.clone().addScaledVector(fwd, 0.12).setY(head.y + 0.02);
  // ease: quick to throw a hand out, slower to let it drop
  const ease = (cur: THREE.Vector3, want: THREE.Vector3 | null, r: number, curReach: number) => {
    if (want) cur.lerp(want, curReach < 0.05 ? 1 : 1 - Math.exp(-dt * 16));
    return curReach + ((want ? 1 : 0) - curReach) * (1 - Math.exp(-dt * (want ? r : 6)));
  };
  st.reachL = ease(p.hl, wl, 12, st.reachL);
  st.reachR = ease(p.hr, wr, 12, st.reachR);
  st.handL!.copy(p.hl);
  st.handR!.copy(p.hr);
  p.rider.stand(st);
}

/** Handheld: a phone in somebody's hand. Puts the camera at the lens with a little wobble. */
export function handheld(cam: THREE.PerspectiveCamera, pos: THREE.Vector3, look: THREE.Vector3, fov: number, t: number, shake: number, roll = 0) {
  const n1 = Math.sin(t * 7.3) * 0.6 + Math.sin(t * 13.1) * 0.4;
  const n2 = Math.sin(t * 5.9 + 1.3) * 0.6 + Math.sin(t * 11.7 + 0.4) * 0.4;
  cam.position.copy(pos);
  cam.position.x += n1 * shake * 4;
  cam.position.y += n2 * shake * 3;
  cam.up.set(0, 1, 0);
  cam.lookAt(look.x + n2 * shake, look.y + n1 * shake, look.z);
  if (roll) cam.rotateZ(roll);
  cam.fov = fov;
  cam.updateProjectionMatrix();
}
