import * as THREE from 'three';

/**
 * The park is an analytic heightfield: every rideable surface is an Element
 * with a local height function. The physics samples the same functions that
 * the meshes are built from, so what you see is exactly what you ride.
 */

export type Material = 'concrete' | 'ramp' | 'box' | 'paint' | 'wall' | 'wood' | 'stone' | 'ply';

export interface Element {
  kind: string;
  cx: number;
  cz: number;
  rot: number; // yaw: local +u axis = (cos rot, sin rot) in world xz
  hx: number; // half extent along u
  hz: number; // half extent along v
  /** Height at local coords. Only called inside the footprint. */
  h: (u: number, v: number) => number;
  /** Mesh sampling resolution along u / v. */
  resU: number;
  resV: number;
  mat: Material;
  /** Whether to draw vertical side skirts. */
  skirt: boolean;
  /** Optional custom mesh builder (stairs). */
  custom?: boolean;
  /** Fully custom mesh (round things the grid sampler can't do). */
  meshFn?: () => THREE.BufferGeometry;
  // derived
  c: number;
  s: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type RailKind = 'rail' | 'ledge';

export interface Rail {
  a: THREE.Vector3;
  b: THREE.Vector3;
  dir: THREE.Vector3; // unit a->b (3D)
  len: number;
  kind: RailKind;
  tag?: string; // story goals refer to rails by tag
  friction: number; // multiplier on grind friction (polished rails run longer)
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BowlDef {
  cx: number;
  cz: number;
  radius: number; // rim radius
  flat: number; // flat bottom radius
  depth: number;
  R: number; // transition arc radius
}

/** Water you can splash into: a circle or an axis-aligned rect. */
export interface WaterZone {
  y: number;
  circle?: { cx: number; cz: number; r: number };
  rect?: { x0: number; z0: number; x1: number; z1: number };
}

const CELL = 8;

export class Terrain {
  elements: Element[] = [];
  rails: Rail[] = [];
  bowls: BowlDef[] = [];
  water: WaterZone[] = [];
  bounds = 78;
  /** Height outside every element (sea floor on the pier, 0 elsewhere). */
  floor = 0;
  /** Optional replacement for the flat floor. */
  baseFn: ((x: number, z: number) => number) | null = null;
  private grid = new Map<number, Element[]>();

  addElement(e: Omit<Element, 'c' | 's' | 'minX' | 'maxX' | 'minZ' | 'maxZ'>): Element {
    const c = Math.cos(e.rot);
    const s = Math.sin(e.rot);
    const ex = Math.abs(c) * e.hx + Math.abs(s) * e.hz;
    const ez = Math.abs(s) * e.hx + Math.abs(c) * e.hz;
    const el: Element = {
      ...e,
      c,
      s,
      minX: e.cx - ex,
      maxX: e.cx + ex,
      minZ: e.cz - ez,
      maxZ: e.cz + ez,
    };
    this.elements.push(el);
    for (let gx = Math.floor(el.minX / CELL); gx <= Math.floor(el.maxX / CELL); gx++) {
      for (let gz = Math.floor(el.minZ / CELL); gz <= Math.floor(el.maxZ / CELL); gz++) {
        const k = key(gx, gz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(el);
      }
    }
    return el;
  }

  addRail(a: THREE.Vector3, b: THREE.Vector3, kind: RailKind, tag?: string, friction = 1) {
    const d = b.clone().sub(a);
    const len = d.length();
    this.rails.push({
      a: a.clone(),
      b: b.clone(),
      dir: d.divideScalar(len),
      len,
      kind,
      tag,
      friction,
      minX: Math.min(a.x, b.x) - 1,
      maxX: Math.max(a.x, b.x) + 1,
      minZ: Math.min(a.z, b.z) - 1,
      maxZ: Math.max(a.z, b.z) + 1,
    });
  }

  /** Base ground: 0, or a bowl dish. */
  base(x: number, z: number): number {
    for (const b of this.bowls) {
      const dx = x - b.cx;
      const dz = z - b.cz;
      const r2 = dx * dx + dz * dz;
      if (r2 < b.radius * b.radius) return bowlProfile(b, Math.sqrt(r2));
    }
    return this.baseFn ? this.baseFn(x, z) : this.floor;
  }

  /** Water surface height at (x,z), or null if there's no water here. */
  waterAt(x: number, z: number): number | null {
    for (const w of this.water) {
      if (w.circle) {
        const dx = x - w.circle.cx;
        const dz = z - w.circle.cz;
        if (dx * dx + dz * dz < w.circle.r * w.circle.r) return w.y;
      } else if (w.rect) {
        const r = w.rect;
        if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return w.y;
      }
    }
    return null;
  }

  height(x: number, z: number): number {
    let h = this.base(x, z);
    const arr = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (arr) {
      for (const e of arr) {
        if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
        const dx = x - e.cx;
        const dz = z - e.cz;
        const u = dx * e.c + dz * e.s;
        const v = -dx * e.s + dz * e.c;
        if (u < -e.hx || u > e.hx || v < -e.hz || v > e.hz) continue;
        const eh = e.h(u, v);
        if (eh > h) h = eh;
      }
    }
    return h;
  }

  /**
   * Surface normal. Uses one-sided differences across height discontinuities
   * (box edges) so that standing near an edge doesn't tilt the board.
   */
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.02;
    const hc = this.height(x, z);
    const gx = slope(this.height(x - e, z), hc, this.height(x + e, z), e);
    const gz = slope(this.height(x, z - e), hc, this.height(x, z + e), e);
    return out.set(-gx, 1, -gz).normalize();
  }

  /** Horizontal gradient direction with a wide footprint, for wall normals. */
  wallNormal(x: number, z: number, fallback: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.18;
    const gx = this.height(x + e, z) - this.height(x - e, z);
    const gz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(gx, gz);
    if (l < 1e-3) return out.set(-fallback.x, 0, -fallback.z).normalize();
    return out.set(-gx / l, 0, -gz / l);
  }
}

function slope(hl: number, hc: number, hr: number, e: number) {
  const dl = hc - hl;
  const dr = hr - hc;
  const lim = e * 6; // steeper than ~80 degrees is a step, not a slope
  const okL = Math.abs(dl) < lim;
  const okR = Math.abs(dr) < lim;
  if (okL && okR) return (hr - hl) / (2 * e);
  if (okL) return dl / e;
  if (okR) return dr / e;
  return Math.abs(dl) < Math.abs(dr) ? dl / e : dr / e;
}

function key(gx: number, gz: number) {
  return (gx + 1000) * 4096 + (gz + 1000);
}

export function bowlProfile(b: BowlDef, r: number): number {
  if (r <= b.flat) return -b.depth;
  const t = r - b.flat; // 0..(radius-flat)
  const R = b.R;
  const y = R - Math.sqrt(Math.max(0, R * R - t * t));
  return Math.min(0, -b.depth + y);
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

/** Circular transition rising from 0 to H; returns run length. */
export function transitionRun(H: number, R: number) {
  return Math.sqrt(R * R - (R - H) * (R - H));
}

export function transitionHeight(t: number, R: number) {
  return R - Math.sqrt(Math.max(0, R * R - t * t));
}

/** Arc radius for a transition of height H over run L. */
export function radiusFor(H: number, L: number) {
  return (L * L + H * H) / (2 * H);
}
