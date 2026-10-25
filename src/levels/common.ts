import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain } from '../terrain';
import type { ParkMaterials, ParkVisuals } from '../park';
import { rng, flagTexture } from '../textures';
import { flagDef } from '../flags';
import { ambient } from './decor';

/** The collectible letters hidden in every street spot, in order. */
export const LETTERS = 'NATION';
export const LETTERS_GOAL = `Collect ${LETTERS.split('').join('-')}`;

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

export type V3 = [number, number, number];
export type CharId = 'mara' | 'dex' | 'kai' | 'pete' | 'announcer' | 'you';

export interface Line {
  who: CharId;
  text: string;
}

/** One camera move in a cutscene; dialogue lines play while it runs. */
export interface Shot {
  cam: V3;
  cam2?: V3;
  look: V3;
  look2?: V3;
  dur: number;
  title?: string;
  subtitle?: string;
  lines?: Line[];
}

export interface Cutscene {
  id: string;
  shots: Shot[];
}

interface GoalBase {
  id: string;
  text: string;
  /** one-line tip shown in the goal list / preview */
  hint?: string;
  /** camera for the "show me" preview */
  view?: { cam: V3; look: V3 };
}

export type GoalDef = GoalBase &
  (
    | { kind: 'score'; points: number }
    | { kind: 'combo'; points: number }
    | { kind: 'comboCount'; count: number }
    | { kind: 'letters' }
    | { kind: 'tape' }
    | { kind: 'objects'; count: number }
    | { kind: 'gap'; gap: string; trick?: string }
    | { kind: 'grind'; tag: string; dist: number; trick?: string }
    | { kind: 'air'; height: number }
    | { kind: 'trick'; trick: string }
    | { kind: 'medal'; medal: 'bronze' | 'silver' | 'gold' }
  );

export type PropKind = 'sign' | 'cone' | 'ball';
export interface PropDef {
  kind: PropKind;
  pos: THREE.Vector3;
}

/** Ride onto the pad and you're carried up to `to` (the top of a tower). */
export interface LiftDef {
  name: string;
  area: Rect;
  to: { x: number; z: number; heading: number };
}

export interface LevelData {
  vis: ParkVisuals;
  spawn: { x: number; z: number; heading: number };
  lifts?: LiftDef[];
  gaps: GapDef[];
  letters: THREE.Vector3[]; // one per letter of LETTERS
  tape: THREE.Vector3;
  props: PropDef[];
}

export interface Level {
  id: string;
  name: string;
  chapter: number;
  tagline: string;
  blurb: string;
  /** horizon colour (also the fog) */
  sky: string;
  /** top of the sky dome */
  zenith: string;
  fog: [number, number];
  ground: boolean;
  /** tint over the ground concrete */
  groundColor?: number;
  /** 'free' parks are free-skate only: no goals, never in the career */
  kind: 'street' | 'comp' | 'free';
  /** seconds per run */
  runTime: number;
  /** goals needed here to unlock the next chapter */
  unlockAt: number;
  /** what the object goal is about, e.g. "No Skating signs" */
  objectNoun: string;
  goals: GoalDef[];
  intro: Cutscene;
  /** plays when this chapter's goals unlock the next one */
  outro: Cutscene;
  build(t: Terrain): LevelData;
  decorate(group: THREE.Group, mats: ParkMaterials, t: Terrain): void;
}

/** Standard score goals, THPS style. */
export function scoreGoals(high: number, pro: number, sick: number): GoalDef[] {
  const f = (n: number) => n.toLocaleString('en-US');
  return [
    { id: 'high', kind: 'score', points: high, text: `High Score: ${f(high)}`, hint: 'Score in a single run. Chain tricks with grinds for bigger multipliers.' },
    { id: 'pro', kind: 'score', points: pro, text: `Pro Score: ${f(pro)}`, hint: 'Mix it up: repeating the same trick scores less each time.' },
    { id: 'sick', kind: 'score', points: sick, text: `Sick Score: ${f(sick)}`, hint: 'Long combos, gaps and specials. Fill your special meter!' },
  ];
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

const flagMats = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A flagpole flying a country flag, rippled into a frozen wave. Decor only
 * (non-colliding), so keep it off skate lines. `face` turns the flag about the pole.
 */
export function flagpole(group: THREE.Group, mats: ParkMaterials, x: number, z: number, base: number, flag: string, height = 9, face = 0) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, height, 8), mats.metal);
  pole.position.set(x, base + height / 2, z);
  pole.castShadow = true;
  group.add(pole);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mats.metal);
  knob.position.set(x, base + height + 0.08, z);
  group.add(knob);
  const ratio = flagDef(flag)?.ratio ?? 1.5;
  const fh = 1.5;
  const fw = fh * ratio;
  const geo = new THREE.PlaneGeometry(fw, fh, 24, 4);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / fw + 0.5; // 0 at the pole
    p.setX(i, u * fw);
    p.setZ(i, Math.sin(u * 7 + 0.6) * 0.16 * u);
    p.setY(i, p.getY(i) - u * u * 0.12);
  }
  geo.computeVertexNormals();
  let mat = flagMats.get(flag);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ map: flagTexture(flag), roughness: 0.8, side: THREE.DoubleSide });
    // ripple in the wind: waves run out from the pole, each flag on its own beat
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = ambient;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fu = position.x / ${fw.toFixed(3)};
        transformed.z += sin(fu * 6.0 - uTime * 5.0 + modelMatrix[3].x * 0.7 + modelMatrix[3].z) * 0.14 * fu;
        transformed.y += sin(fu * 4.0 - uTime * 3.0 + modelMatrix[3].z) * 0.04 * fu;`,
      );
    };
    mat.customProgramCacheKey = () => 'flag-wave-' + fw.toFixed(3);
    flagMats.set(flag, mat);
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x + 0.06, base + height - fh / 2 - 0.15, z);
  m.rotation.y = face;
  m.castShadow = true;
  group.add(m);
}

/** Simple box buildings around a plaza (decor, beyond the walls), each painted from `palette`. */
export function buildings(group: THREE.Group, mats: ParkMaterials, ring: number, seed: number, palette: number[] = [0xffffff]) {
  const r = rng(seed);
  const pr = rng(seed + 1);
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
      tint(g, palette[Math.floor(pr() * palette.length)]);
      geos.push(g);
      along += w + 0.5;
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(geos, false)!, paintedFacade(mats)));
}

/** Give every vertex of `g` one colour (for vertex-coloured materials). */
export function tint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** The facade material, tinted per building by vertex colour. */
export function paintedFacade(mats: ParkMaterials) {
  const m = mats.facade.clone();
  m.vertexColors = true;
  return m;
}
