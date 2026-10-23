import * as THREE from 'three';
import type { BoardModel } from '../board';
import type { HumanRider } from '../humanrider';
import { CamMode, Clip, F, FPS, STRIDE, sampleFrame } from './clip';

/** The scene objects a replay frame describes. */
export interface Rig {
  board: BoardModel;
  rider: HumanRider;
  blob: THREE.Mesh;
  camera: THREE.PerspectiveCamera;
}

export function writeFrame(r: Rig, out: Float32Array, o: number, sound: readonly number[], mode: number) {
  const b = r.board;
  b.root.position.toArray(out, o + F.boardPos);
  b.root.quaternion.toArray(out, o + F.boardQuat);
  out[o + F.pivotY] = b.pivot.position.y;
  out[o + F.wheelSpin] = b.wheelSpin;
  out[o + F.steer] = b.steer;
  const g = r.rider.group;
  g.position.toArray(out, o + F.riderPos);
  g.quaternion.toArray(out, o + F.riderQuat);
  out[o + F.riderVis] = g.visible ? 1 : 0;
  out[o + F.poseOk] = r.rider.writePose(out, o + F.pelvisPos) ? 1 : 0;
  r.blob.position.toArray(out, o + F.blobPos);
  r.blob.quaternion.toArray(out, o + F.blobQuat);
  out[o + F.blobScale] = r.blob.scale.x;
  out[o + F.blobScale + 1] = r.blob.scale.y;
  out[o + F.blobOpacity] = (r.blob.material as THREE.MeshBasicMaterial).opacity;
  r.camera.position.toArray(out, o + F.camPos);
  r.camera.quaternion.toArray(out, o + F.camQuat);
  out[o + F.camFov] = r.camera.fov;
  for (let i = 0; i < 4; i++) out[o + F.sound + i] = sound[i];
  out[o + F.mode] = mode;
}

/** Put the board, rider and shadow where the frame says (the camera is up to the lens). */
export function applyFrame(r: Rig, f: Float32Array) {
  const b = r.board;
  b.root.position.fromArray(f, F.boardPos);
  b.root.quaternion.fromArray(f, F.boardQuat);
  b.pivot.position.y = f[F.pivotY];
  b.pose(f[F.wheelSpin], f[F.steer]);
  const g = r.rider.group;
  g.visible = f[F.riderVis] > 0.5;
  g.position.fromArray(f, F.riderPos);
  g.quaternion.fromArray(f, F.riderQuat);
  if (f[F.poseOk] > 0.5) r.rider.readPose(f, F.pelvisPos);
  r.blob.position.fromArray(f, F.blobPos);
  r.blob.quaternion.fromArray(f, F.blobQuat);
  r.blob.scale.set(f[F.blobScale], f[F.blobScale + 1], 1);
  (r.blob.material as THREE.MeshBasicMaterial).opacity = f[F.blobOpacity];
}

/* ------------------------------------------------------------------ */
/* Lenses                                                              */
/* ------------------------------------------------------------------ */

const scratch = new Float32Array(STRIDE);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const sampleV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function boardAt(c: Clip, t: number, out: THREE.Vector3) {
  sampleFrame(c, t, scratch);
  return out.fromArray(scratch, F.boardPos);
}

/** Board position averaged over a short window, so the lens floats instead of jittering. */
function smoothBoard(c: Clip, t: number, out: THREE.Vector3, win = 0.25) {
  out.set(0, 0, 0);
  const n = 5;
  for (let i = 0; i < n; i++) out.add(boardAt(c, t - win * (i / (n - 1)), sampleV));
  return out.multiplyScalar(1 / n);
}

export interface Lens {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/**
 * Where the camera is at clip time t. 'game' is what the player saw;
 * 'filmer' is a low fisheye chasing the board; 'tripod' stands beside the
 * segment's line and pans to follow it.
 */
export function lens(c: Clip, mode: CamMode, t: number, seg: { in: number; out: number }, groundAt: (x: number, z: number) => number, out: Lens) {
  if (mode === 'game') {
    sampleFrame(c, t, scratch);
    out.pos.fromArray(scratch, F.camPos);
    const q = new THREE.Quaternion().fromArray(scratch, F.camQuat);
    out.look.set(0, 0, -1).applyQuaternion(q).add(out.pos);
    out.fov = scratch[F.camFov];
    return out;
  }
  if (mode === 'filmer') {
    const p = smoothBoard(c, t, new THREE.Vector3(), 0.15);
    const back = smoothBoard(c, t - 0.45, new THREE.Vector3(), 0.3);
    const dir = tmp.subVectors(p, back).setY(0);
    if (dir.lengthSq() < 0.04) {
      // barely moving: keep looking from the camera the player had
      sampleFrame(c, t, scratch);
      dir.set(p.x - scratch[F.camPos], 0, p.z - scratch[F.camPos + 2]);
    }
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
    out.pos.copy(p).addScaledVector(dir, -2.3).addScaledVector(side, 0.9);
    out.pos.y = Math.max(out.pos.y + 0.45, groundAt(out.pos.x, out.pos.z) + 0.35);
    out.look.copy(p).addScaledVector(dir, 0.6).add(tmp.set(0, 0.55, 0));
    out.fov = 82;
    return out;
  }
  // tripod: beside the middle of the line, far enough to see all of it
  const a = boardAt(c, seg.in, new THREE.Vector3());
  const b = boardAt(c, seg.out, new THREE.Vector3());
  const mid = boardAt(c, (seg.in + seg.out) / 2, new THREE.Vector3());
  const along = tmp.subVectors(b, a).setY(0);
  const len = along.length();
  if (len < 0.5) along.set(1, 0, 0);
  along.normalize();
  const side = new THREE.Vector3().crossVectors(UP, along).normalize();
  const d = Math.max(5, len * 0.55);
  out.pos.copy(mid).addScaledVector(side, d);
  out.pos.y = Math.max(mid.y, groundAt(out.pos.x, out.pos.z)) + 1.3;
  out.look.copy(smoothBoard(c, t, tmp2, 0.3)).add(tmp.set(0, 0.6, 0));
  out.fov = Math.max(35, Math.min(70, 2 * Math.atan((len * 0.35 + 3) / d) * (180 / Math.PI)));
  return out;
}

/* ------------------------------------------------------------------ */
/* Recorder                                                            */
/* ------------------------------------------------------------------ */

/** Sounds worth hearing in a skate video (no menu blips, horns or score jingles). */
export const SFX = ['pop', 'flipWhoosh', 'joint', 'catchClick', 'land', 'touchdown', 'grindStart', 'grab', 'revert', 'push', 'bail', 'wall', 'splash', 'knock'] as const;

/** Samples the live scene at 30 fps into a growing buffer. */
export class Recorder {
  active = false;
  frames = 0;
  data = new Float32Array(0);
  sfx: { t: number; n: string; a: (number | string | boolean)[] }[] = [];
  tricks: string[] = [];
  private acc = 0;

  constructor(private maxFrames: number) {}

  get time() {
    return this.frames / FPS;
  }

  start() {
    this.active = true;
    this.frames = 0;
    this.acc = 1 / FPS; // first frame right away
    this.data = new Float32Array(STRIDE * FPS * 10);
    this.sfx = [];
    this.tricks = [];
  }

  stop() {
    this.active = false;
    return this.data.slice(0, this.frames * STRIDE);
  }

  /** Called once per rendered frame with real (unscaled) time; returns false when full. */
  capture(dt: number, write: (out: Float32Array, o: number) => void) {
    if (!this.active) return true;
    this.acc += dt;
    while (this.acc >= 1 / FPS) {
      this.acc -= 1 / FPS;
      if (this.frames >= this.maxFrames) return false;
      if ((this.frames + 1) * STRIDE > this.data.length) {
        const grown = new Float32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
      }
      write(this.data, this.frames * STRIDE);
      this.frames++;
    }
    return true;
  }

  sound(n: string, a: (number | string | boolean)[]) {
    if (this.active) this.sfx.push({ t: Math.max(0, this.time - 1 / FPS + this.acc), n, a });
  }
}
