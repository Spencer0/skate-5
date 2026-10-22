import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../terrain';
import { rng, GRIME, grimeAtlas, graffitiAtlas, azulejoTexture } from '../textures';
import type { Rect } from './common';

/**
 * Set dressing that makes a spot feel lived in: ground grime, wall murals and
 * tiles, palms, spectators, bunting, birds and boats. All of it is decor:
 * nothing here collides, so keep it off skate lines.
 */

/** Seconds of ambient time; drives every swaying, bobbing decor material. */
export const ambient = { value: 0 };

type Tick = (dt: number, t: number) => void;

/** Per-frame callback for a level's moving decor (main runs these). */
export function onTick(group: THREE.Object3D, fn: Tick) {
  ((group.userData.ticks ??= []) as Tick[]).push(fn);
}

/**
 * Teach a material the `aAnim` attribute (phase, rate, bob, sway): each vertex
 * bobs up by up to `bob` and sways sideways by `sway`, in object space.
 */
export function animated<M extends THREE.Material>(mat: M): M {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = ambient;
    s.vertexShader = 'attribute vec4 aAnim;\nuniform float uTime;\n' + s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float aS = sin(uTime * aAnim.y + aAnim.x);
      transformed.y += aAnim.z * (0.5 + 0.5 * aS);
      transformed.xz += aAnim.w * vec2(aS, cos(uTime * aAnim.y * 0.73 + aAnim.x));`,
    );
  };
  mat.customProgramCacheKey = () => 'decor-anim';
  return mat;
}

/** [phase, rate, bob, sway] */
export type Anim = [number, number, number, number];
const STILL: Anim = [0, 0, 0, 0];

/**
 * Collects coloured pieces into one vertex-coloured, optionally animated mesh,
 * so a whole crowd or grove is a single draw call.
 */
export class Batch {
  private geos: THREE.BufferGeometry[] = [];

  /** `weight(p)` scales the animation per vertex (e.g. fronds sway more at the tips). */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, anim: Anim = STILL, weight?: (p: THREE.Vector3) => number) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    const col = new THREE.Color(color);
    const cols = new Float32Array(n * 3);
    const an = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    const pos = g.getAttribute('position');
    for (let i = 0; i < n; i++) {
      cols.set([col.r, col.g, col.b], i * 3);
      const w = weight ? weight(p.fromBufferAttribute(pos, i)) : 1;
      an.set([anim[0], anim[1], anim[2] * w, anim[3] * w], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setAttribute('aAnim', new THREE.BufferAttribute(an, 4));
    this.geos.push(g);
  }

  get empty() {
    return !this.geos.length;
  }

  build(opts: THREE.MeshStandardMaterialParameters = {}) {
    const mat = animated(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...opts }));
    const m = new THREE.Mesh(mergeGeometries(this.geos, false)!, mat);
    this.geos = [];
    return m;
  }
}

/** Place a piece built around the origin: turn it to `face` (radians about y) and move it to (x, y, z). */
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, face: number) {
  return g.rotateY(face).translate(x, y, z);
}

/* ------------------------------------------------------------------ */
/* Ground grime                                                        */
/* ------------------------------------------------------------------ */

export interface GrimeOpts {
  /** colours for the spray tags */
  tags?: string[];
  /** leave these alone (fountains, painted pads) */
  avoid?: { x: number; z: number; r: number }[];
  /** skip anything below this (water, sea floor) */
  minY?: number;
  /** relative weights per kind */
  mix?: Partial<Record<keyof typeof GRIME, number>>;
}

const SIZES: Record<keyof typeof GRIME, [number, number]> = {
  oil: [0.8, 2.4],
  dirt: [4, 9],
  skid: [1.6, 3],
  crack: [1.5, 3.5],
  wax: [1, 2],
  gum: [1, 1.6],
  stain: [1.5, 3],
  leaves: [0.8, 1.6],
  tag: [1.2, 2.2],
  drain: [1.7, 1.9],
  chalk: [1.4, 2],
};

/**
 * Scatter `count` decals (oil, dirt, skids, cracks, tags...) over flat ground
 * inside `area`, on whatever level surface they land on.
 */
export function grime(group: THREE.Group, t: Terrain, area: Rect, count: number, seed: number, opts: GrimeOpts = {}) {
  const r = rng(seed);
  const mix = { oil: 2, dirt: 5, skid: 2, crack: 3, wax: 1, gum: 1, stain: 2, leaves: 1, tag: 1, drain: 0.4, chalk: 0.3, ...opts.mix };
  const kinds = Object.keys(mix) as (keyof typeof GRIME)[];
  const total = kinds.reduce((a, k) => a + mix[k], 0);
  const pick = () => {
    let x = r() * total;
    for (const k of kinds) if ((x -= mix[k]) < 0) return k;
    return kinds[0];
  };
  const pos: number[] = [];
  const uv: number[] = [];
  for (let n = 0, tries = 0; n < count && tries < count * 6; tries++) {
    const kind = pick();
    const [s0, s1] = SIZES[kind];
    const s = s0 + r() * (s1 - s0);
    const x = area.x0 + r() * (area.x1 - area.x0);
    const z = area.z0 + r() * (area.z1 - area.z0);
    if (opts.avoid?.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + s / 2)) continue;
    const h = t.height(x, z);
    if (opts.minY !== undefined && h < opts.minY) continue;
    const rot = r() * Math.PI * 2;
    const c = Math.cos(rot) * (s / 2);
    const sn = Math.sin(rot) * (s / 2);
    const corners: [number, number][] = [
      [-c + sn, -sn - c],
      [c + sn, sn - c],
      [c - sn, sn + c],
      [-c - sn, -sn + c],
    ];
    // only on level ground: every corner at the same height as the middle
    if (corners.some(([dx, dz]) => Math.abs(t.height(x + dx, z + dz) - h) > 0.01)) continue;
    const cells = GRIME[kind];
    const ci = cells[Math.floor(r() * cells.length)];
    const u0 = (ci % 4) / 4;
    const v0 = 1 - (Math.floor(ci / 4) + 1) / 4;
    const cu: [number, number][] = [
      [u0, v0],
      [u0 + 0.25, v0],
      [u0 + 0.25, v0 + 0.25],
      [u0, v0 + 0.25],
    ];
    const y = h + 0.012;
    for (const i of [0, 2, 1, 0, 3, 2]) {
      pos.push(x + corners[i][0], y, z + corners[i][1]);
      uv.push(...cu[i]);
    }
    n++;
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: grimeAtlas(opts.tags ?? ['#e04a3b', '#3a6fb0'], seed),
    transparent: true,
    depthWrite: false,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.renderOrder = 1;
  group.add(m);
}

/* ------------------------------------------------------------------ */
/* Walls: murals and tiles                                             */
/* ------------------------------------------------------------------ */

/** A straight wall face, from `a` to `b` (xz), with `n` pointing out into the park. */
export interface WallFace {
  a: [number, number];
  b: [number, number];
  n: [number, number];
  /** top of the wall */
  top: number;
}

/**
 * Walk along each wall and find spans with level ground in front (the floor,
 * or a quarter pipe's deck), calling `fn` with the span and its floor height.
 */
function wallSpans(t: Terrain, walls: WallFace[], seed: number, width: [number, number], gap: [number, number], fn: (cx: number, cz: number, ry: number, w: number, base: number, top: number) => void) {
  const r = rng(seed);
  for (const wf of walls) {
    const [ax, az] = wf.a;
    const [bx, bz] = wf.b;
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const ry = Math.atan2(wf.n[0], wf.n[1]);
    let s = gap[0] * r();
    while (s < len) {
      const w = width[0] + r() * (width[1] - width[0]);
      if (s + w > len) break;
      const probe = (k: number) => t.height(ax + dx * (s + k) + wf.n[0] * 0.6, az + dz * (s + k) + wf.n[1] * 0.6);
      const base = probe(0);
      let flat = true;
      for (let k = 0; k <= w; k += 0.5) if (Math.abs(probe(k) - base) > 0.02) flat = false;
      if (flat && wf.top - base > 1.4) {
        const m = s + w / 2;
        fn(ax + dx * m + wf.n[0] * 0.02, az + dz * m + wf.n[1] * 0.02, ry, w, base, wf.top);
        s += w + gap[0] + r() * (gap[1] - gap[0]);
      } else s += 1;
    }
  }
}

/** Graffiti pieces on clear stretches of wall. `words` picks the four pieces in the atlas. */
export function murals(group: THREE.Group, t: Terrain, walls: WallFace[], words: string[], palettes: [string, string, string][], seed: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  let row = 0;
  wallSpans(t, walls, seed, [7, 12], [3, 14], (cx, cz, ry, w, base, top) => {
    const h = Math.min(w / 4, top - base - 0.3);
    const y0 = base + (top - base - h) / 2;
    const ux = Math.cos(ry);
    const uz = -Math.sin(ry);
    const v0 = 1 - (row % 4 + 1) / 4;
    row++;
    const P = (s: number, y: number) => [cx + ux * s, y, cz + uz * s];
    const quad = [
      [...P(-w / 2, y0), 0, v0],
      [...P(w / 2, y0), 1, v0],
      [...P(w / 2, y0 + h), 1, v0 + 0.25],
      [...P(-w / 2, y0 + h), 0, v0 + 0.25],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(quad[i][0], quad[i][1], quad[i][2]);
      uv.push(quad[i][3], quad[i][4]);
    }
  });
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: graffitiAtlas(words, palettes, seed), transparent: true, alphaTest: 0.02, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  group.add(m);
}

/** A band of glazed azulejo tiles along the foot of each wall, with an ochre cap. */
export function tileBands(group: THREE.Group, t: Terrain, walls: WallFace[], height: number, seed: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const caps: THREE.BufferGeometry[] = [];
  wallSpans(t, walls, seed, [10, 16], [0.6, 3], (cx, cz, ry, w, base) => {
    const ux = Math.cos(ry);
    const uz = -Math.sin(ry);
    const P = (s: number, y: number) => [cx + ux * s, y, cz + uz * s];
    const y0 = base;
    const y1 = base + height;
    const quad = [
      [...P(-w / 2, y0), 0, 0],
      [...P(w / 2, y0), w / 0.6, 0],
      [...P(w / 2, y1), w / 0.6, height / 0.6],
      [...P(-w / 2, y1), 0, height / 0.6],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(quad[i][0], quad[i][1], quad[i][2]);
      uv.push(quad[i][3], quad[i][4]);
    }
    caps.push(new THREE.BoxGeometry(w + 0.1, 0.12, 0.08).rotateY(ry).translate(cx, y1 + 0.06, cz));
  });
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const tiles = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: azulejoTexture(), roughness: 0.3, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }));
  tiles.receiveShadow = true;
  group.add(tiles);
  group.add(new THREE.Mesh(mergeGeometries(caps, false)!, new THREE.MeshStandardMaterial({ color: 0xc98a3a, roughness: 0.6 })));
}

/* ------------------------------------------------------------------ */
/* Plants                                                              */
/* ------------------------------------------------------------------ */

/** A curved palm with drooping fronds that sway in the breeze. */
export function palm(b: Batch, x: number, y: number, z: number, height: number, seed: number) {
  const r = rng(seed);
  const lean = r() * Math.PI * 2;
  const lx = Math.cos(lean);
  const lz = Math.sin(lean);
  const bend = 0.8 + r() * 1.4;
  const segs = 9;
  const ph = r() * 6;
  const sway = (top: number) => (p: THREE.Vector3) => Math.max(0, (p.y - y) / top);
  let tx = x;
  let tz = z;
  for (let i = 0; i < segs; i++) {
    const f0 = i / segs;
    const f1 = (i + 1) / segs;
    const ox = (f: number) => lx * bend * f * f;
    const oz = (f: number) => lz * bend * f * f;
    const len = height / segs;
    const rad = 0.2 - f0 * 0.07;
    const g = new THREE.CylinderGeometry(rad * 0.9, rad, len * 1.04, 7).translate(0, len / 2, 0);
    // tilt each segment along the curve
    const ax = ox(f1) - ox(f0);
    const az = oz(f1) - oz(f0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ax, len, az).normalize())));
    g.translate(x + ox(f0), y + f0 * height, z + oz(f0));
    b.add(g, i % 2 ? 0x8a6f52 : 0x7a6047, [ph, 0.9, 0, 0.04], sway(height));
    tx = x + ox(f1);
    tz = z + oz(f1);
  }
  const top = y + height;
  const fronds = 8 + Math.floor(r() * 3);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.4;
    const len = 2.6 + r() * 1.2;
    const droop = 1.2 + r() * 0.8;
    const lift = 0.3 + r() * 0.5;
    const g = new THREE.PlaneGeometry(len, 0.9, 6, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const u = p.getX(k) / len + 0.5;
      const v = p.getY(k);
      p.setXYZ(k, u * len, lift * u * 2 - droop * u * u * 1.6, v * (1 - u * 0.75) * (0.4 + Math.sin(u * Math.PI) * 0.8));
    }
    g.rotateY(a).translate(tx, top, tz);
    const shade = [0x5f8a3a, 0x6f9a40, 0x4f7a34][i % 3];
    b.add(g, shade, [ph + i * 0.3, 1.3, 0.12, 0.18], (q) => Math.min(1, Math.hypot(q.x - tx, q.z - tz) / len));
  }
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    b.add(new THREE.IcosahedronGeometry(0.16, 0).translate(tx + Math.cos(a) * 0.22, top - 0.15, tz + Math.sin(a) * 0.22), 0x5a4128, [ph, 0.9, 0, 0.04]);
  }
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x5c3a21, 0xa66a3f];
const HAIR = [0x1c1410, 0x2f1e12, 0x4a3020, 0x7a5a30, 0xc9a165, 0x101010, 0x8a3b20];
const PANTS = [0x2b3a55, 0x3b4f73, 0x1c1c1c, 0x6d6252, 0x4b5b3a, 0x8a8478, 0x24304a];

export type Pose = 'stand' | 'sit' | 'cheer';

/**
 * A low-poly spectator. Standing and sitting ones fidget; cheering ones hop.
 * For 'sit', (x, y, z) is the edge they sit on and their shins hang past it.
 */
export function person(b: Batch, x: number, y: number, z: number, face: number, pose: Pose, shirts: number[], seed: number) {
  const r = rng(seed);
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const pants = PANTS[Math.floor(r() * PANTS.length)];
  const shirt = shirts[Math.floor(r() * shirts.length)];
  const s = 0.9 + r() * 0.2;
  const ph = r() * Math.PI * 2;
  const body: Anim = pose === 'cheer' ? [ph, 6 + r() * 3, 0.16, 0] : [ph, 1.2 + r(), 0.025, 0.012];
  const legs: Anim = pose === 'cheer' ? body : STILL;
  const put = (g: THREE.BufferGeometry, col: number, a: Anim) => b.add(at(g.scale(s, s, s), x, y, z, face), col, a);
  if (pose === 'sit') {
    for (const sx of [-0.1, 0.1]) {
      put(new THREE.BoxGeometry(0.14, 0.14, 0.42).translate(sx, 0.07, 0.12), pants, STILL);
      put(new THREE.BoxGeometry(0.12, 0.46, 0.13).translate(sx, -0.16, 0.34), pants, STILL);
      put(new THREE.BoxGeometry(0.12, 0.08, 0.22).translate(sx, -0.42, 0.38), 0xf2f0ea, STILL);
    }
    put(new THREE.BoxGeometry(0.42, 0.56, 0.24).translate(0, 0.42, -0.05), shirt, body);
    for (const sx of [-0.27, 0.27]) put(new THREE.BoxGeometry(0.1, 0.5, 0.11).rotateX(-0.5).translate(sx, 0.36, 0.06), shirt, body);
    put(new THREE.IcosahedronGeometry(0.13, 1).translate(0, 0.86, -0.04), skin, body);
    put(new THREE.BoxGeometry(0.25, 0.08, 0.27).translate(0, 0.97, -0.06), hair, body);
    return;
  }
  for (const sx of [-0.1, 0.1]) {
    put(new THREE.BoxGeometry(0.14, 0.84, 0.16).translate(sx, 0.42, 0), pants, legs);
    put(new THREE.BoxGeometry(0.13, 0.08, 0.26).translate(sx, 0.04, 0.04), 0xf2f0ea, legs);
  }
  put(new THREE.BoxGeometry(0.42, 0.6, 0.24).translate(0, 1.14, 0), shirt, body);
  for (const sx of [-0.27, 0.27]) {
    if (pose === 'cheer') put(new THREE.BoxGeometry(0.1, 0.6, 0.11).rotateZ(sx > 0 ? -0.35 : 0.35).translate(sx * 1.25, 1.66, 0), shirt, body);
    else put(new THREE.BoxGeometry(0.1, 0.58, 0.11).translate(sx, 1.12, 0), shirt, body);
  }
  put(new THREE.IcosahedronGeometry(0.13, 1).translate(0, 1.6, 0), skin, body);
  if (r() < 0.3) {
    // cap, brim forward
    put(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 8).translate(0, 1.72, 0), shirts[Math.floor(r() * shirts.length)], body);
    put(new THREE.BoxGeometry(0.2, 0.025, 0.14).translate(0, 1.69, 0.15), shirts[Math.floor(r() * shirts.length)], body);
  } else put(new THREE.BoxGeometry(0.25, 0.09, 0.27).translate(0, 1.71, -0.01), hair, body);
}

/**
 * Spectators along wall tops: sitting on the inner edge with their legs hanging
 * over (where the wall face is clear), the odd one standing behind.
 */
export function wallCrowd(b: Batch, t: Terrain, walls: WallFace[], shirts: number[], density: number, seed: number) {
  const r = rng(seed);
  let n = 0;
  wallSpans(t, walls, seed + 7, [3, 7], [4, 16], (cx, cz, ry, w, base, top) => {
    if (top - base < 1.4) return;
    const ux = Math.cos(ry);
    const uz = -Math.sin(ry);
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    for (let s = -w / 2 + 0.4; s < w / 2 - 0.4; s += 0.55 + r() * 0.9) {
      if (r() > density) continue;
      const x = cx + ux * s - nx * 0.1;
      const z = cz + uz * s - nz * 0.1;
      const pose: Pose = r() < 0.75 ? 'sit' : 'stand';
      if (pose === 'sit') person(b, x, top, z, ry, 'sit', shirts, seed * 31 + n++);
      else person(b, x - nx * 1.0, top, z - nz * 1.0, ry + (r() - 0.5) * 0.6, r() < 0.3 ? 'cheer' : 'stand', shirts, seed * 31 + n++);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Bunting                                                             */
/* ------------------------------------------------------------------ */

/** A sagging string of pennants from `a` to `c` that flutter in the wind. */
export function bunting(b: Batch, a: THREE.Vector3, c: THREE.Vector3, sag: number, colors: number[], seed: number) {
  const r = rng(seed);
  const len = a.distanceTo(c);
  const n = Math.max(2, Math.floor(len / 0.55));
  const dir = new THREE.Vector3().subVectors(c, a).setY(0).normalize();
  const P = (f: number) => new THREE.Vector3().lerpVectors(a, c, f).add(new THREE.Vector3(0, -sag * 4 * f * (1 - f), 0));
  for (let i = 0; i < n; i++) {
    const p0 = P(i / n);
    const p1 = P((i + 1) / n);
    const seg = new THREE.CylinderGeometry(0.012, 0.012, p0.distanceTo(p1), 4);
    seg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize())));
    seg.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    b.add(seg, 0x3a3632);
    // a pennant hanging off the middle of the segment
    const m = P((i + 0.5) / n);
    const hw = 0.2;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([m.x - dir.x * hw, m.y, m.z - dir.z * hw, m.x + dir.x * hw, m.y, m.z + dir.z * hw, m.x, m.y - 0.38, m.z], 3));
    tri.computeVertexNormals();
    b.add(tri, colors[i % colors.length], [r() * 6, 2.2 + r(), 0.05, 0.1], (q) => (m.y - q.y) / 0.38);
  }
}

/* ------------------------------------------------------------------ */
/* Things that move                                                    */
/* ------------------------------------------------------------------ */

/** Gulls (or pigeons) wheeling around a centre, wings flapping. */
export function birds(group: THREE.Group, count: number, cx: number, cz: number, radius: number, height: number, color: number, seed: number) {
  const r = rng(seed);
  const mat = animated(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  const flock: { m: THREE.Mesh; a: number; rad: number; h: number; w: number; ph: number }[] = [];
  for (let i = 0; i < count; i++) {
    const b = new Batch();
    const ph = r() * 6;
    b.add(new THREE.BoxGeometry(0.42, 0.1, 0.1), color);
    b.add(new THREE.BoxGeometry(0.1, 0.06, 0.08).translate(0.24, 0.02, 0), 0xe8b547);
    for (const side of [-1, 1]) {
      const wing = new THREE.BufferGeometry();
      wing.setAttribute('position', new THREE.Float32BufferAttribute([0.12, 0, 0, -0.12, 0, 0, -0.02, -0.08, side * 0.55], 3));
      wing.computeVertexNormals();
      b.add(wing, color, [ph, 10 + r() * 3, 0.32, 0], (p) => Math.abs(p.z) / 0.55);
    }
    const m = new THREE.Mesh(b.build().geometry, mat);
    group.add(m);
    flock.push({ m, a: r() * Math.PI * 2, rad: radius * (0.6 + r() * 0.6), h: height + r() * 6, w: (0.25 + r() * 0.2) * (r() < 0.5 ? -1 : 1), ph });
  }
  onTick(group, (dt, t) => {
    for (const f of flock) {
      f.a += f.w * dt;
      const x = cx + Math.cos(f.a) * f.rad;
      const z = cz + Math.sin(f.a) * f.rad;
      f.m.position.set(x, f.h + Math.sin(t * 0.7 + f.ph) * 1.2, z);
      // fly along the circle: tangent heading, banked into the turn
      f.m.rotation.set(0, -(f.a + Math.sign(f.w) * Math.PI / 2), 0);
      f.m.rotateX(Math.sign(f.w) * 0.35);
    }
  });
}

/** A little boat that bobs and rolls at anchor. */
export function boat(group: THREE.Group, x: number, z: number, sea: number, heading: number, hull: number, sail: boolean, seed: number) {
  const r = rng(seed);
  const b = new Batch();
  const shape = new THREE.Shape();
  shape.moveTo(-2.2, -0.9);
  shape.lineTo(1.2, -0.9);
  shape.quadraticCurveTo(2.4, -0.6, 2.8, 0);
  shape.quadraticCurveTo(2.4, 0.6, 1.2, 0.9);
  shape.lineTo(-2.2, 0.9);
  shape.closePath();
  const h = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.4, 0);
  b.add(h, hull);
  b.add(new THREE.BoxGeometry(4.6, 0.08, 1.7).translate(0.1, 0.52, 0), 0xb08a5a);
  b.add(new THREE.BoxGeometry(4.95, 0.16, 1.9).translate(0.15, 0.1, 0), 0xfaf9f5);
  if (sail) {
    b.add(new THREE.CylinderGeometry(0.05, 0.06, 6, 6).translate(0.4, 3.5, 0), 0xd8d4cc);
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute([0.35, 0.9, 0, 0.35, 6.2, 0, -1.9, 0.9, 0], 3));
    s.computeVertexNormals();
    b.add(s, 0xfaf9f5);
    const j = new THREE.BufferGeometry();
    j.setAttribute('position', new THREE.Float32BufferAttribute([0.45, 0.9, 0, 0.45, 5.6, 0, 2.5, 0.9, 0], 3));
    j.computeVertexNormals();
    b.add(j, r() < 0.5 ? 0xe04a3b : 0xe8b547);
  } else {
    b.add(new THREE.BoxGeometry(1.4, 0.9, 1.3).translate(-0.6, 1.0, 0), 0xfaf9f5);
    b.add(new THREE.BoxGeometry(1.5, 0.1, 1.4).translate(-0.6, 1.5, 0), hull);
  }
  const m = b.build({ side: THREE.DoubleSide, roughness: 0.6 });
  m.position.set(x, sea, z);
  m.rotation.y = heading;
  group.add(m);
  const ph = r() * 6;
  onTick(group, (_dt, t) => {
    m.position.y = sea + Math.sin(t * 1.1 + ph) * 0.12;
    m.rotation.set(Math.sin(t * 0.8 + ph) * 0.05, heading, Math.sin(t * 1.3 + ph * 2) * 0.03);
  });
}

/** The four inner faces of a square perimeter wall whose inner line is at ±B. */
export function perimeter(B: number, top: number): WallFace[] {
  return [
    { a: [-B, -B], b: [B, -B], n: [0, 1], top },
    { a: [B, B], b: [-B, B], n: [0, -1], top },
    { a: [-B, B], b: [-B, -B], n: [1, 0], top },
    { a: [B, -B], b: [B, B], n: [-1, 0], top },
  ];
}

/** Bunting on posts along the top of a square perimeter wall (posts at ±P). */
export function wallBunting(b: Batch, P: number, top: number, every: number, colors: number[], seed: number) {
  const h = top + 2.6;
  const n = Math.round((2 * P) / every);
  const step = (2 * P) / n;
  for (let i = 0; i <= n; i++) {
    const s = -P + i * step;
    for (const [x, z] of [
      [s, -P],
      [s, P],
      [-P, s],
      [P, s],
    ]) {
      b.add(new THREE.CylinderGeometry(0.05, 0.06, 2.7, 6).translate(x, top + 1.35, z), 0x5a554e);
    }
    if (i === n) break;
    const s1 = s + step;
    bunting(b, new THREE.Vector3(s, h, -P), new THREE.Vector3(s1, h, -P), 0.7, colors, seed + i * 4);
    bunting(b, new THREE.Vector3(s, h, P), new THREE.Vector3(s1, h, P), 0.7, colors, seed + i * 4 + 1);
    bunting(b, new THREE.Vector3(-P, h, s), new THREE.Vector3(-P, h, s1), 0.7, colors, seed + i * 4 + 2);
    bunting(b, new THREE.Vector3(P, h, s), new THREE.Vector3(P, h, s1), 0.7, colors, seed + i * 4 + 3);
  }
}
