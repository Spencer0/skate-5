import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain } from '../terrain';
import type { ParkMaterials, ParkVisuals } from '../park';
import { rng } from '../textures';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A THPS-style gap: take off inside `from`, land (cleanly) inside `to`. */
export interface GapDef {
  id: string;
  name: string;
  points: number;
  from: Rect;
  to: Rect;
}

export type GoalDef =
  | { id: string; kind: 'gap'; text: string; gap: string; trick?: string }
  | { id: string; kind: 'trick'; text: string; trick: string }
  | { id: string; kind: 'grind'; text: string; tag: string; dist: number; trick?: string }
  | { id: string; kind: 'combo'; text: string; points: number }
  | { id: string; kind: 'air'; text: string; height: number }
  | { id: string; kind: 'letters'; text: string };

export interface LevelData {
  vis: ParkVisuals;
  spawn: { x: number; z: number; heading: number };
  gaps: GapDef[];
  letters: THREE.Vector3[]; // C, L, A, U, D, E
}

export interface Level {
  id: string;
  name: string;
  tagline: string;
  story: string;
  outro: string;
  sky: string;
  fog: [number, number];
  ground: boolean;
  /** goals needed here to unlock the next chapter */
  unlockAt: number;
  goals: GoalDef[];
  build(t: Terrain): LevelData;
  decorate(group: THREE.Group, mats: ParkMaterials, t: Terrain): void;
}

export const N = -Math.PI / 2; // rising toward -z
export const S = Math.PI / 2;
export const E = 0;
export const W = Math.PI;

export function rect(x0: number, z0: number, x1: number, z1: number): Rect {
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
}

export function inRect(r: Rect, x: number, z: number) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Chain of rail segments through `pts` (xz), all at height y. */
export function polyRail(t: Terrain, vis: ParkVisuals, pts: [number, number][], y: number, kind: 'rail' | 'ledge', tag: string, friction = 1) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(pts[i][0], y, pts[i][1]);
    const b = new THREE.Vector3(pts[i + 1][0], y, pts[i + 1][1]);
    t.addRail(a, b, kind, tag, friction);
    if (kind === 'rail') vis.railPosts.push({ a, b });
  }
}

/** Closed ring of short ledge segments (a round fountain rim, a planter). */
export function ringRail(t: Terrain, cx: number, cz: number, r: number, y: number, n: number, tag: string, friction = 1) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    t.addRail(new THREE.Vector3(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r), new THREE.Vector3(cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r), 'ledge', tag, friction);
  }
}

/** Tag the rails whose endpoints both lie inside `area`. */
export function tagRails(t: Terrain, area: Rect, tag: string, friction?: number) {
  for (const r of t.rails) {
    if (inRect(area, r.a.x, r.a.z) && inRect(area, r.b.x, r.b.z)) {
      r.tag = tag;
      if (friction !== undefined) r.friction = friction;
    }
  }
}

export function scatterTrees(group: THREE.Group, count: number, inner: number, outer: number, seed: number) {
  const r = rng(seed);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 4, 6).translate(0, 2, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.5, 0);
  const trunks: THREE.BufferGeometry[] = [];
  const crowns: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const side = Math.floor(r() * 4);
    const along = (r() * 2 - 1) * (outer + 10);
    const out = inner + r() * (outer - inner);
    const x = side === 0 ? along : side === 1 ? -along : side === 2 ? out : -out;
    const z = side === 0 ? out : side === 1 ? -out : side === 2 ? along : -along;
    const s = 0.8 + r() * 0.7;
    trunks.push(trunkGeo.clone().scale(s, s, s).translate(x, 0, z));
    crowns.push(crownGeo.clone().scale(s, s * (0.9 + r() * 0.3), s).translate(x, 0, z));
  }
  group.add(new THREE.Mesh(mergeGeometries(trunks, false)!, new THREE.MeshStandardMaterial({ color: 0x6b5443, roughness: 1 })));
  group.add(new THREE.Mesh(mergeGeometries(crowns, false)!, new THREE.MeshStandardMaterial({ color: 0x788c5d, roughness: 1, flatShading: true })));
}

/** Decorative lamp posts (non-colliding: keep them off skate lines). */
export function lamps(group: THREE.Group, mats: ParkMaterials, spots: [number, number, number][]) {
  const poles: THREE.BufferGeometry[] = [];
  const heads: THREE.BufferGeometry[] = [];
  for (const [x, z, base] of spots) {
    poles.push(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8).translate(x, base + 2.1, z));
    heads.push(new THREE.SphereGeometry(0.26, 12, 8).translate(x, base + 4.35, z));
  }
  if (!spots.length) return;
  group.add(new THREE.Mesh(mergeGeometries(poles, false)!, mats.metal));
  group.add(new THREE.Mesh(mergeGeometries(heads, false)!, new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0.6 })));
}

/** Simple box buildings around a plaza (decor, beyond the walls). */
export function buildings(group: THREE.Group, mats: ParkMaterials, ring: number, seed: number) {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  for (const side of [0, 1, 2, 3]) {
    let along = -ring - 6;
    while (along < ring + 6) {
      const w = 10 + r() * 10;
      const h = 9 + r() * 16;
      const d = 12;
      const g = new THREE.BoxGeometry(w, h, d);
      // world-scale uvs on the sides
      const uv = g.getAttribute('uv');
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nrm.getX(i));
        const u = nx > 0.5 ? pos.getZ(i) : pos.getX(i);
        uv.setXY(i, u / 6, (pos.getY(i) + h / 2) / 6);
      }
      const c = along + w / 2;
      const out = ring + 4 + d / 2;
      g.translate(0, h / 2, 0);
      if (side === 0) g.translate(c, 0, out);
      else if (side === 1) g.translate(c, 0, -out);
      else if (side === 2) g.rotateY(Math.PI / 2).translate(out, 0, c);
      else g.rotateY(Math.PI / 2).translate(-out, 0, c);
      geos.push(g);
      along += w + 0.5;
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(geos, false)!, mats.facade));
}
