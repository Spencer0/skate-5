/**
 * Replay clips are snapshots, not inputs: the physics runs on a variable
 * timestep with random effects, so re-simulating inputs would drift. Every
 * recorded frame is a flat run of floats (board, rider skeleton, contact
 * shadow, camera, rolling sound) and playback just interpolates between them.
 */

export const FPS = 30;
export const MAX_CLIP_SECONDS = 60;
/** total footage the studio keeps (about 9 MB at the frame size below) */
export const MAX_LIBRARY_SECONDS = 10 * 60;
export const MAX_CLIPS = 60;

/** rider bones in the order HumanRider writes them */
export const POSE_BONES = 20;

export const F = {
  boardPos: 0,
  boardQuat: 3,
  pivotY: 7,
  wheelSpin: 8,
  steer: 9,
  riderPos: 10,
  riderQuat: 13,
  riderVis: 17,
  /** 1 when the rider model was loaded and the pose below is valid */
  poseOk: 18,
  pelvisPos: 19,
  boneQuats: 22, // POSE_BONES × 4
  blobPos: 22 + POSE_BONES * 4,
  blobQuat: 25 + POSE_BONES * 4,
  blobScale: 29 + POSE_BONES * 4,
  blobOpacity: 31 + POSE_BONES * 4,
  camPos: 32 + POSE_BONES * 4,
  camQuat: 35 + POSE_BONES * 4,
  camFov: 39 + POSE_BONES * 4,
  /** audio.update() inputs: roll speed, grind kind (0 none, 1 grind, 2 slide), grind speed, powerslide */
  sound: 40 + POSE_BONES * 4,
  /** board in the air, bailing… (0 ground, 1 air, 2 grind, 3 bail) */
  mode: 44 + POSE_BONES * 4,
} as const;
export const STRIDE = 45 + POSE_BONES * 4;

const QUATS = [F.boardQuat, F.riderQuat, F.blobQuat, F.camQuat, ...Array.from({ length: POSE_BONES }, (_, i) => F.boneQuats + i * 4)];
/** values that snap instead of blending */
const STEPPED = [F.riderVis, F.poseOk, F.sound + 1, F.sound + 3, F.mode];

export const MODES = ['ground', 'air', 'grind', 'bail'] as const;

/** A sound the game played while recording, replayed at the same moment. */
export interface Sfx {
  t: number;
  n: string;
  a: (number | string | boolean)[];
}

export interface ClipMeta {
  id: string;
  name: string;
  created: number;
  level: number;
  levelName: string;
  rider: string;
  /** create-a-skater look (only for the custom rider) */
  look: unknown;
  deck: string;
  frames: number;
}

export interface Clip extends ClipMeta {
  data: Float32Array;
  sfx: Sfx[];
}

export const clipDuration = (c: { frames: number }) => Math.max(0, (c.frames - 1) / FPS);

/** Blend the recording at time t (seconds) into out. */
export function sampleFrame(c: Clip, t: number, out: Float32Array) {
  const last = c.frames - 1;
  const x = Math.max(0, Math.min(last, t * FPS));
  const i = Math.floor(x);
  const j = Math.min(last, i + 1);
  const k = x - i;
  const a = i * STRIDE;
  const b = j * STRIDE;
  const d = c.data;
  for (let n = 0; n < STRIDE; n++) out[n] = d[a + n] + (d[b + n] - d[a + n]) * k;
  for (const n of STEPPED) out[n] = d[(k < 0.5 ? a : b) + n];
  // quaternions: take the short way round, then renormalize
  for (const q of QUATS) {
    const dot = d[a + q] * d[b + q] + d[a + q + 1] * d[b + q + 1] + d[a + q + 2] * d[b + q + 2] + d[a + q + 3] * d[b + q + 3];
    const s = dot < 0 ? -1 : 1;
    let l = 0;
    for (let m = 0; m < 4; m++) {
      out[q + m] = d[a + q + m] * (1 - k) + d[b + q + m] * s * k;
      l += out[q + m] * out[q + m];
    }
    l = Math.sqrt(l) || 1;
    for (let m = 0; m < 4; m++) out[q + m] /= l;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

export type CamMode = 'game' | 'tripod' | 'filmer';
export const CAM_MODES: { id: CamMode; name: string }[] = [
  { id: 'game', name: 'Game' },
  { id: 'filmer', name: 'Filmer' },
  { id: 'tripod', name: 'Tripod' },
];
export const SPEEDS = [1, 0.5, 0.25];

/** One cut in the edit: a trimmed piece of a clip with its own lens and speed. */
export interface Segment {
  clip: string;
  in: number;
  out: number;
  speed: number;
  cam: CamMode;
}

export interface Edit {
  title: string;
  segments: Segment[];
}

export const segLength = (s: Segment) => Math.max(0, s.out - s.in) / s.speed;
export const editLength = (e: Edit) => e.segments.reduce((n, s) => n + segLength(s), 0);

/** Which segment plays at edit time t, and where in its clip. */
export function locate(e: Edit, t: number): { index: number; start: number; clipT: number } | null {
  let start = 0;
  for (let i = 0; i < e.segments.length; i++) {
    const s = e.segments[i];
    const len = segLength(s);
    if (t < start + len || i === e.segments.length - 1) {
      const local = Math.max(0, Math.min(len, t - start));
      return { index: i, start, clipT: s.in + local * s.speed };
    }
    start += len;
  }
  return null;
}

/** Sounds of the whole edit on the edit's own clock. */
export function editSfx(e: Edit, clips: Map<string, Clip>): Sfx[] {
  const out: Sfx[] = [];
  let start = 0;
  for (const s of e.segments) {
    const c = clips.get(s.clip);
    if (c) {
      for (const x of c.sfx) {
        if (x.t < s.in || x.t >= s.out) continue;
        out.push({ ...x, t: start + (x.t - s.in) / s.speed });
      }
    }
    start += segLength(s);
  }
  return out;
}

/** Trim a segment, keeping at least a few frames and staying inside its clip. */
export function trim(s: Segment, c: { frames: number }, which: 'in' | 'out', t: number) {
  const len = clipDuration(c);
  const min = 4 / FPS;
  if (which === 'in') s.in = Math.max(0, Math.min(t, s.out - min));
  else s.out = Math.min(len, Math.max(t, s.in + min));
}

export function fmtTime(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
