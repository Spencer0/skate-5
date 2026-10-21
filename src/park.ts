import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain, Element, Material, transitionRun, transitionHeight, radiusFor, bowlProfile } from './terrain';
import * as T from './textures';

/* ------------------------------------------------------------------ */
/* Element constructors                                                */
/* ------------------------------------------------------------------ */

interface Knots {
  uK: number[];
  vK: number[];
  arcU?: boolean;
}
const knots = new WeakMap<Element, Knots>();

function lin(a: number, b: number, n: number) {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

function dirOf(rot: number) {
  return { x: Math.cos(rot), z: Math.sin(rot) };
}

/** Quarter pipe whose toe line is centered at (tx,tz), rising toward `rot`. */
export function quarterPipe(t: Terrain, tx: number, tz: number, rot: number, length: number, H: number, R: number, deck = 1.4) {
  const w = transitionRun(H, R);
  const hx = (w + deck) / 2;
  const d = dirOf(rot);
  const el = t.addElement({
    kind: 'qp',
    cx: tx + d.x * hx,
    cz: tz + d.z * hx,
    rot,
    hx,
    hz: length / 2,
    h: (u) => {
      const tt = u + hx;
      return tt >= w ? H : transitionHeight(tt, R);
    },
    resU: 0,
    resV: 0,
    mat: 'ramp',
    skirt: true,
  });
  const uK = lin(-hx, -hx + w, 28);
  uK.push(hx);
  knots.set(el, { uK, vK: [-length / 2, length / 2], arcU: true });
  return { el, lipU: -hx + w, H };
}

export function kicker(t: Terrain, tx: number, tz: number, rot: number, width: number, H: number, L: number) {
  const R = radiusFor(H, L);
  const hx = L / 2;
  const d = dirOf(rot);
  const el = t.addElement({
    kind: 'kicker',
    cx: tx + d.x * hx,
    cz: tz + d.z * hx,
    rot,
    hx,
    hz: width / 2,
    h: (u) => transitionHeight(u + hx, R),
    resU: 0,
    resV: 0,
    mat: 'ramp',
    skirt: true,
  });
  knots.set(el, { uK: lin(-hx, hx, 16), vK: [-width / 2, width / 2], arcU: true });
  return el;
}

/** Flat bank: rises linearly over L to H, then a flat deck. */
export function bank(t: Terrain, tx: number, tz: number, rot: number, width: number, H: number, L: number, deck = 0) {
  const hx = (L + deck) / 2;
  const d = dirOf(rot);
  const el = t.addElement({
    kind: 'bank',
    cx: tx + d.x * hx,
    cz: tz + d.z * hx,
    rot,
    hx,
    hz: width / 2,
    h: (u) => {
      const tt = u + hx;
      return tt >= L ? H : (H * tt) / L;
    },
    resU: 0,
    resV: 0,
    mat: 'ramp',
    skirt: true,
  });
  const uK = [-hx, -hx + L];
  if (deck > 0) uK.push(hx);
  knots.set(el, { uK, vK: [-width / 2, width / 2], arcU: true });
  return el;
}

export function box(t: Terrain, cx: number, cz: number, rot: number, hx: number, hz: number, H: number, mat: Material = 'box') {
  const el = t.addElement({
    kind: 'box',
    cx,
    cz,
    rot,
    hx,
    hz,
    h: () => H,
    resU: 0,
    resV: 0,
    mat,
    skirt: true,
  });
  knots.set(el, { uK: [-hx, hx], vK: [-hz, hz] });
  return el;
}

/** Ledge: a box with grindable top edges along its long (u) sides. */
export function ledge(t: Terrain, cx: number, cz: number, rot: number, length: number, width: number, H: number, allEdges = false) {
  const el = box(t, cx, cz, rot, length / 2, width / 2, H);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (u: number, v: number) => new THREE.Vector3(cx + u * c - v * s, H, cz + u * s + v * c);
  const hx = length / 2;
  const hz = width / 2;
  t.addRail(P(-hx, -hz), P(hx, -hz), 'ledge');
  t.addRail(P(-hx, hz), P(hx, hz), 'ledge');
  if (allEdges) {
    t.addRail(P(-hx, -hz), P(-hx, hz), 'ledge');
    t.addRail(P(hx, -hz), P(hx, hz), 'ledge');
  }
  return el;
}

/** Funbox / pyramid: banked on all four sides up to a flat top. */
export function funbox(t: Terrain, cx: number, cz: number, rot: number, hx: number, hz: number, H: number, slopeLen: number) {
  const el = t.addElement({
    kind: 'funbox',
    cx,
    cz,
    rot,
    hx,
    hz,
    h: (u, v) => {
      const d = Math.min(hx - Math.abs(u), hz - Math.abs(v));
      return Math.min(H, (Math.max(0, d) * H) / slopeLen);
    },
    resU: 0,
    resV: 0,
    mat: 'ramp',
    skirt: false,
  });
  const uK = [-hx, -hx + slopeLen, hx - slopeLen, hx];
  const vK = [-hz, -hz + slopeLen, hz - slopeLen, hz];
  // diagonal creases need extra density to render the hip lines sharply
  knots.set(el, { uK: densify(uK, 10), vK: densify(vK, 10) });
  return el;
}

function densify(k: number[], per: number) {
  const out: number[] = [];
  for (let i = 0; i < k.length - 1; i++) {
    const seg = lin(k[i], k[i + 1], per);
    if (i > 0) seg.shift();
    out.push(...seg);
  }
  return out;
}

/** Stairs descending along `rot` from height H, starting at (tx,tz). */
export function stairs(t: Terrain, tx: number, tz: number, rot: number, width: number, H: number, steps: number, run: number) {
  const L = steps * run;
  const hx = L / 2;
  const d = dirOf(rot);
  const rise = H / steps;
  const el = t.addElement({
    kind: 'stairs',
    cx: tx + d.x * hx,
    cz: tz + d.z * hx,
    rot,
    hx,
    hz: width / 2,
    h: (u) => {
      const i = Math.floor((u + hx) / run);
      return Math.max(0, H - rise * (i + 1));
    },
    resU: 0,
    resV: 0,
    mat: 'box',
    skirt: true,
    custom: true,
  });
  return { el, rise, run, L };
}

/** Sloped ledge running alongside stairs: height = ledgeH + nosing(u). */
export function hubba(t: Terrain, tx: number, tz: number, rot: number, width: number, topFlat: number, H: number, L: number, ledgeH: number, bottomFlat: number) {
  const total = topFlat + L + bottomFlat;
  const hx = total / 2;
  const d = dirOf(rot);
  const nosing = (tt: number) => (tt <= topFlat ? H : tt >= topFlat + L ? 0 : H * (1 - (tt - topFlat) / L));
  const el = t.addElement({
    kind: 'hubba',
    cx: tx + d.x * hx,
    cz: tz + d.z * hx,
    rot,
    hx,
    hz: width / 2,
    h: (u) => nosing(u + hx) + ledgeH,
    resU: 0,
    resV: 0,
    mat: 'box',
    skirt: true,
  });
  knots.set(el, { uK: [-hx, -hx + topFlat, -hx + topFlat + L, hx], vK: [-width / 2, width / 2] });
  // grind edges: both top edges, split into flat-slope-flat
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const v of [-width / 2, width / 2]) {
    const P = (tt: number) => new THREE.Vector3(tx + tt * c - v * s, nosing(tt) + ledgeH, tz + tt * s + v * c);
    t.addRail(P(0), P(topFlat), 'ledge');
    t.addRail(P(topFlat), P(topFlat + L), 'ledge');
    t.addRail(P(topFlat + L), P(total), 'ledge');
  }
  return el;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export interface ParkVisuals {
  copings: { a: THREE.Vector3; b: THREE.Vector3 }[];
  railPosts: { a: THREE.Vector3; b: THREE.Vector3 }[];
}

export const SPAWN = { x: 0, z: 40, heading: -Math.PI / 2 };

const N = -Math.PI / 2; // rising toward -z
const S = Math.PI / 2;
const E = 0;
const W = Math.PI;

export function buildLayout(t: Terrain): ParkVisuals {
  const vis: ParkVisuals = { copings: [], railPosts: [] };
  const coping = (q: ReturnType<typeof quarterPipe>) => {
    const { el, lipU, H } = q;
    const P = (v: number) => new THREE.Vector3(el.cx + lipU * el.c - v * el.s, H, el.cz + lipU * el.s + v * el.c);
    vis.copings.push({ a: P(-el.hz), b: P(el.hz) });
  };
  const rail = (ax: number, az: number, ay: number, bx: number, bz: number, by: number) => {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    t.addRail(a, b, 'rail');
    vis.railPosts.push({ a, b });
  };

  const B = 75; // inner wall line
  // perimeter walls
  box(t, 0, -B - 2, 0, B + 4, 2, 3.6, 'wall');
  box(t, 0, B + 2, 0, B + 4, 2, 3.6, 'wall');
  box(t, -B - 2, 0, 0, 2, B + 4, 3.6, 'wall');
  box(t, B + 2, 0, 0, 2, B + 4, 3.6, 'wall');

  // --- perimeter quarter pipes (toe lines) ---
  const qpDepth = (H: number, R: number, deck = 1.4) => transitionRun(H, R) + deck;
  // north: three sections of different heights
  coping(quarterPipe(t, -45, -B + qpDepth(1.8, 2.6), N, 50, 1.8, 2.6));
  coping(quarterPipe(t, 0, -B + qpDepth(2.7, 3.0), N, 40, 2.7, 3.0));
  coping(quarterPipe(t, 45, -B + qpDepth(1.2, 2.0), N, 50, 1.2, 2.0));
  // south
  coping(quarterPipe(t, -30, B - qpDepth(1.5, 2.4), S, 80, 1.5, 2.4));
  coping(quarterPipe(t, 45, B - qpDepth(2.1, 2.8), S, 50, 2.1, 2.8));
  // west
  coping(quarterPipe(t, -B + qpDepth(2.0, 2.8), 0, W, 140, 2.0, 2.8));
  // east
  coping(quarterPipe(t, B - qpDepth(1.4, 2.2), 0, E, 140, 1.4, 2.2));

  // --- bowl (north-west) ---
  t.bowls.push({ cx: -42, cz: -40, radius: 10, flat: 6.6, depth: 2.4, R: radiusFor(2.4, 3.4) });

  // --- spine (north centre) ---
  {
    const H = 1.6;
    const R = 2.4;
    const w = transitionRun(H, R);
    const deck = 0.15;
    const zTop = -52;
    coping(quarterPipe(t, 0, zTop + w + deck, N, 16, H, R, deck));
    quarterPipe(t, 0, zTop - w - deck, S, 16, H, R, deck);
    vis.copings.pop();
    vis.copings.push({ a: new THREE.Vector3(-8, H, zTop), b: new THREE.Vector3(8, H, zTop) });
  }

  // --- central funbox with rail + kicker approach ---
  funbox(t, 0, -16, 0, 7, 4, 0.7, 2.2);
  rail(-3.2, -16, 0.7 + 0.42, 3.2, -16, 0.7 + 0.42);
  ledge(t, 0, -14.9, 0, 5, 0.6, 0.7 + 0.32);

  // --- flat rails near spawn ---
  rail(4, 26, 0.42, 4, 16, 0.42);
  rail(-5, 24, 0.32, -5, 12, 0.32);
  rail(14, 30, 0.5, 14, 6, 0.5);

  // --- ledges + manual pads (east plaza) ---
  ledge(t, 26, 18, S, 9, 1.0, 0.45);
  ledge(t, 32, 18, S, 9, 1.0, 0.5);
  ledge(t, 29, 4, E, 10, 1.1, 0.3, true); // manual pad, every edge grindable
  ledge(t, -22, -2, -0.5, 14, 1.0, 0.42); // long diagonal ledge
  ledge(t, -12, 2, 0.5, 6, 0.9, 0.36);

  // --- stair set with handrail + hubba (north-east) ---
  {
    const H = 1.2;
    // platform
    box(t, 38, -48, 0, 8, 8, H);
    // access bank from the north
    bank(t, 38, -64, S, 16, H, 8);
    // drop-off edge to the west, gap edge to the east: platform edges themselves
    // stairs going south off the platform
    const st = stairs(t, 38, -40, S, 8, H, 6, 0.46);
    const zEnd = -40 + st.L;
    // handrail down the middle
    const railH = 0.5;
    rail(38, -41.2, H + railH, 38, -40, H + railH);
    const slope = H / st.L;
    rail(38, -40, H + railH, 38, zEnd + 0.2, railH - 0.2 * slope);
    // hubba on the east edge of stairs
    hubba(t, 42.6, -41.5, S, 0.9, 1.5, H, st.L, 0.4, 1.0);
    // ledge on platform
    ledge(t, 32.5, -50, S, 7, 0.8, H + 0.4);
  }

  // --- kicker to landing ramp gap (west plaza) ---
  {
    const x = -34;
    // jump box: kicker -> table -> landing bank
    kicker(t, x, 30, N, 4, 0.75, 2.2);
    box(t, x, 25.65, 0, 2.25, 2.15, 0.75, 'ramp');
    bank(t, x, 17.8, S, 4.5, 0.75, 4.5, 1.2);
    ledge(t, x - 2.6, 25.6, S, 6, 0.8, 0.75 + 0.3);
    // free kickers launching to flat
    kicker(t, -48, 34, N, 3, 0.6, 1.9);
    kicker(t, -20, 40, N, 3, 0.5, 1.7);
  }

  // --- mini ramp (south-east) ---
  {
    const H = 1.25;
    const R = 2.0;
    coping(quarterPipe(t, 22, 42.5, S, 14, H, R, 1.6));
    coping(quarterPipe(t, 22, 36.5, N, 14, H, R, 1.6));
  }

  // --- pyramid + hip (east) ---
  funbox(t, 52, 20, 0.25, 5, 5, 1.1, 3.9);
  funbox(t, 52, -12, 0, 5, 6, 0.6, 1.8);
  rail(48.5, -12, 0.6 + 0.4, 55.5, -12, 0.6 + 0.4);

  // --- banks into wall (south-west) ---
  bank(t, -55, 55, S, 16, 1.1, 4.2, 0);
  ledge(t, -55, 46, E, 12, 0.8, 0.4);

  // --- down rail off a small platform (south) ---
  {
    box(t, -2, 58, 0, 6, 3, 0.9);
    bank(t, -2, 65.5, N, 12, 0.9, 4.5);
    // rail going down from platform edge north to ground
    rail(-2, 54.6, 0.9 + 0.45, -2, 50.4, 0.38);
    // bank down from the platform's north face so it's skateable both ways
    bank(t, 2.5, 51, S, 3, 0.9, 4, 0);
  }

  // --- kidney pool (small bowl, north-centre-west) ---
  t.bowls.push({ cx: -18, cz: -38, radius: 6.5, flat: 3.6, depth: 1.7, R: radiusFor(1.7, 2.9) });

  // --- west street section: platform, 4 stairs with a kinked rail ---
  {
    const H = 0.8;
    box(t, -64, -2, 0, 4, 7, H);
    bank(t, -64, -13, S, 8, H, 4); // access from the north
    const st = stairs(t, -60, -2, E, 7, H, 4, 0.48);
    const x0 = -60;
    const x1 = -60 + st.L;
    const rz = -2;
    const rh = 0.45;
    // kinked: flat on top, down the stairs, flat at the bottom
    rail(x0 - 1.6, rz, H + rh, x0, rz, H + rh);
    rail(x0, rz, H + rh, x1, rz, rh);
    rail(x1, rz, rh, x1 + 2.2, rz, rh);
    // a low ledge along the platform's south side
    ledge(t, -64.5, 4.4, 0, 6, 0.5, H + 0.3);
    // long flat bar out in the open
    rail(-58, 14, 0.38, -42, 14, 0.38);
  }

  // --- benches + planters (centre-east plaza) ---
  ledge(t, 12, -34, 0, 3.2, 0.7, 0.45, true);
  ledge(t, 18, -34, 0, 3.2, 0.7, 0.45, true);
  ledge(t, 24, -34, 0, 3.2, 0.7, 0.45, true);
  ledge(t, 14, -2, 0, 2.4, 2.4, 0.5, true);
  ledge(t, 20, -2, 0, 2.4, 2.4, 0.5, true);
  rail(8, -26, 0.4, 26, -26, 0.4);

  // --- bank to bank (south-east) ---
  bank(t, 50, 56, W, 10, 1.2, 4.5, 0.8);
  bank(t, 60, 56, E, 10, 1.2, 4.5, 0.8);
  ledge(t, 55, 46, E, 10, 0.8, 0.35);

  // --- south-west: curb + hubba bank ---
  ledge(t, -32, 54, 0, 14, 0.5, 0.25, true);
  bank(t, -18, 64, N, 8, 0.7, 3.5, 2.5);
  ledge(t, -18, 59, 0, 6, 0.5, 0.7 + 0.3);

  // --- flat rails in the north plaza ---
  rail(-6, -34, 0.35, 6, -34, 0.35);
  rail(-26, -14, 0.45, -14, -22, 0.45);

  return vis;
}

/* ------------------------------------------------------------------ */
/* Meshes                                                              */
/* ------------------------------------------------------------------ */

export interface ParkMaterials {
  concrete: THREE.MeshStandardMaterial;
  ramp: THREE.MeshStandardMaterial;
  box: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  clay: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
}

export function makeMaterials(): ParkMaterials {
  const concreteTex = T.concreteTexture();
  const rampTex = T.rampTexture();
  const boxTex = T.boxTexture();
  const wallTex = T.wallTexture();
  return {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.92, metalness: 0 }),
    ramp: new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }),
    box: new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.85, side: THREE.DoubleSide }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.3, metalness: 0.85 }),
    clay: new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: 0.55, metalness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ map: T.plankTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    stone: new THREE.MeshStandardMaterial({ map: T.paverTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ map: T.waterTexture(), color: 0xffffff, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.9 }),
    facade: new THREE.MeshStandardMaterial({ map: T.facadeTexture(), roughness: 0.9 }),
  };
}

const TEX_SCALE: Record<Material, number> = { concrete: 4, ramp: 3, box: 1.5, paint: 4, wall: 4, wood: 3, stone: 3 };

let SKIRT_FLOOR = 0;

function elementGeometry(e: Element): THREE.BufferGeometry {
  const k = knots.get(e) ?? { uK: lin(-e.hx, e.hx, 2), vK: lin(-e.hz, e.hz, 2) };
  const { uK, vK } = k;
  const sc = TEX_SCALE[e.mat];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const W = (u: number, v: number, y: number) => {
    pos.push(e.cx + u * e.c - v * e.s, y, e.cz + u * e.s + v * e.c);
  };
  // arc length along u for profile textures
  const arc: number[] = [0];
  for (let i = 1; i < uK.length; i++) {
    const du = uK[i] - uK[i - 1];
    const dy = e.h(uK[i], 0) - e.h(uK[i - 1], 0);
    arc.push(arc[i - 1] + Math.hypot(du, dy));
  }
  const nu = uK.length;
  const nv = vK.length;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const u = uK[i];
      const v = vK[j];
      W(u, v, e.h(u, v));
      if (k.arcU) uv.push(v / sc, arc[i] / sc);
      else uv.push((e.cx + u * e.c - v * e.s) / sc, (e.cz + u * e.s + v * e.c) / sc);
    }
  }
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      const b = a + 1;
      const c = a + nu;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx);
  top.computeVertexNormals();
  // make sure normals face up
  const n = top.getAttribute('normal');
  let sumY = 0;
  for (let i = 0; i < n.count; i++) sumY += n.getY(i);
  if (sumY < 0) {
    const ix = top.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) {
      const t0 = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t0);
    }
    top.computeVertexNormals();
  }
  const parts: THREE.BufferGeometry[] = [top];
  if (e.skirt) {
    const edges: [number, number][][] = [
      uK.map((u) => [u, -e.hz] as [number, number]),
      uK.map((u) => [u, e.hz] as [number, number]),
      vK.map((v) => [-e.hx, v] as [number, number]),
      vK.map((v) => [e.hx, v] as [number, number]),
    ];
    for (const edge of edges) {
      const g = skirtGeometry(e, edge, sc);
      if (g) {
        g.computeVertexNormals();
        parts.push(g);
      }
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
}

function skirtGeometry(e: Element, edge: [number, number][], sc: number) {
  let maxH = -Infinity;
  for (const [u, v] of edge) maxH = Math.max(maxH, e.h(u, v));
  if (maxH - SKIRT_FLOOR < 0.01) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  for (let i = 0; i < edge.length; i++) {
    const [u, v] = edge[i];
    if (i > 0) along += Math.hypot(u - edge[i - 1][0], v - edge[i - 1][1]);
    const x = e.cx + u * e.c - v * e.s;
    const z = e.cz + u * e.s + v * e.c;
    const h = e.h(u, v);
    pos.push(x, h, z, x, SKIRT_FLOOR - 0.02, z);
    uv.push(along / sc, h / sc, along / sc, SKIRT_FLOOR / sc);
  }
  for (let i = 0; i < edge.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function stairsGeometry(e: Element): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const steps: { u0: number; u1: number; h: number }[] = [];
  const N = 64;
  let prevH = -1;
  for (let i = 0; i <= N; i++) {
    const u = -e.hx + (2 * e.hx * (i + 0.5)) / (N + 1);
    const h = e.h(u, 0);
    if (h !== prevH && h > 0) {
      steps.push({ u0: u, u1: u, h });
      prevH = h;
    } else if (steps.length && h === prevH) steps[steps.length - 1].u1 = u;
  }
  // compute exact bounds from step heights
  const run = (2 * e.hx) / (steps.length + 1);
  steps.forEach((s, i) => {
    const u0 = -e.hx + i * run;
    const u1 = u0 + run;
    const g = new THREE.BoxGeometry(u1 - u0, s.h, e.hz * 2);
    // nosing UVs scaled
    g.translate((u0 + u1) / 2, s.h / 2, 0);
    parts.push(g);
  });
  const geo = mergeGeometries(parts, false)!;
  geo.rotateY(-e.rot);
  geo.translate(e.cx, 0, e.cz);
  return geo;
}

export function buildMeshes(t: Terrain, vis: ParkVisuals, mats: ParkMaterials, opts: { ground?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  SKIRT_FLOOR = t.floor;

  // Ground with bowl holes
  const G = 140;
  const shape = new THREE.Shape();
  shape.moveTo(-G, -G);
  shape.lineTo(G, -G);
  shape.lineTo(G, G);
  shape.lineTo(-G, G);
  shape.lineTo(-G, -G);
  for (const b of t.bowls) {
    const hole = new THREE.Path();
    hole.absarc(b.cx, -b.cz, b.radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const groundGeo = new THREE.ShapeGeometry(shape, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const guv = groundGeo.getAttribute('uv');
  for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) / 4, guv.getY(i) / 4);
  const ground = new THREE.Mesh(groundGeo, mats.concrete);
  ground.receiveShadow = true;
  if (opts.ground !== false) group.add(ground);

  // Water
  for (const w of t.water) {
    let geo: THREE.BufferGeometry;
    if (w.circle) {
      geo = new THREE.CircleGeometry(w.circle.r, 48);
      geo.rotateX(-Math.PI / 2);
      geo.translate(w.circle.cx, w.y, w.circle.cz);
    } else {
      const r = w.rect!;
      geo = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
      geo.rotateX(-Math.PI / 2);
      geo.translate((r.x0 + r.x1) / 2, w.y, (r.z0 + r.z1) / 2);
    }
    const p = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
    const m = new THREE.Mesh(geo, mats.water);
    m.receiveShadow = true;
    group.add(m);
  }

  // Bowls
  for (const b of t.bowls) {
    const pts: THREE.Vector2[] = [];
    const n = 48;
    pts.push(new THREE.Vector2(0, -b.depth));
    for (let i = 0; i <= n; i++) {
      const r = b.flat + ((b.radius - b.flat) * i) / n;
      pts.push(new THREE.Vector2(r, bowlProfile(b, r)));
    }
    const geo = new THREE.LatheGeometry(pts, 96);
    // uv: planar
    const p = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 3, p.getZ(i) / 3);
    geo.translate(b.cx, 0, b.cz);
    const m = new THREE.Mesh(geo, mats.ramp);
    m.receiveShadow = true;
    group.add(m);
    const cop = new THREE.Mesh(new THREE.TorusGeometry(b.radius, 0.035, 8, 128), mats.metal);
    cop.rotation.x = Math.PI / 2;
    cop.position.set(b.cx, 0.0, b.cz);
    group.add(cop);
    // painted rim tiles
    const rimGeo = new THREE.RingGeometry(b.radius, b.radius + 0.35, 96);
    rimGeo.rotateX(-Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: 0.8 }));
    rim.position.set(b.cx, 0.004, b.cz);
    rim.receiveShadow = true;
    group.add(rim);
  }

  // Elements, batched by material
  const byMat = new Map<Material, THREE.BufferGeometry[]>();
  for (const e of t.elements) {
    const g = e.meshFn ? e.meshFn() : e.custom ? stairsGeometry(e) : elementGeometry(e);
    const arr = byMat.get(e.mat) ?? [];
    arr.push(g.index ? g.toNonIndexed() : g);
    byMat.set(e.mat, arr);
  }
  for (const [mat, geos] of byMat) {
    // strip attributes to the common set
    for (const g of geos) {
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    const merged = mergeGeometries(geos, false)!;
    const material = { ramp: mats.ramp, wall: mats.wall, wood: mats.wood, stone: mats.stone, box: mats.box, concrete: mats.concrete, paint: mats.box }[mat];
    const m = new THREE.Mesh(merged, material);
    m.castShadow = mat !== 'wall';
    m.receiveShadow = true;
    group.add(m);
  }

  // Grind edges: metal for rails, clay angle iron for ledges
  const railGeos: THREE.BufferGeometry[] = [];
  const edgeGeos: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 10) => {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-3) return null;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    return g;
  };
  for (const r of t.rails) {
    if (r.kind === 'rail') {
      const g = tube(r.a.clone().setY(r.a.y - 0.03), r.b.clone().setY(r.b.y - 0.03), 0.03);
      if (g) railGeos.push(g);
    } else {
      // angle iron along the ledge edge
      const g = tube(r.a.clone().setY(r.a.y - 0.012), r.b.clone().setY(r.b.y - 0.012), 0.016, 6);
      if (g) edgeGeos.push(g);
    }
  }
  for (const rp of vis.railPosts) {
    const d = rp.b.clone().sub(rp.a);
    const len = Math.hypot(d.x, d.z);
    const posts = Math.max(2, Math.ceil(len / 3) + 1);
    for (let i = 0; i < posts; i++) {
      const f = 0.06 + (0.88 * i) / (posts - 1);
      const p = rp.a.clone().lerp(rp.b, f);
      const base = t.height(p.x, p.z);
      const g = tube(new THREE.Vector3(p.x, base, p.z), new THREE.Vector3(p.x, p.y - 0.03, p.z), 0.022, 8);
      if (g) railGeos.push(g);
    }
  }
  for (const c of vis.copings) {
    const g = tube(c.a, c.b, 0.035, 10);
    if (g) railGeos.push(g);
  }
  if (railGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(railGeos.map((g) => g.toNonIndexed()), false)!, mats.metal);
    m.castShadow = true;
    group.add(m);
  }
  if (edgeGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(edgeGeos.map((g) => g.toNonIndexed()), false)!, mats.clay);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

/** Claude Park set dressing: painted zones, the floor spark, billboard, trees. */
export function parkDecor(group: THREE.Group, mats: ParkMaterials) {
  // Ground zones: tinted concrete pads with painted borders break up the plaza
  const zones: [number, number, number, number, number][] = [
    // x0, z0, x1, z1, tint
    [8, -10, 40, 30, 0xe4dccf],
    [-72, -22, -40, 18, 0xd2ccc2],
    [-12, -42, 30, -22, 0xefe6d6],
    [-44, 44, -8, 70, 0xddd5c8],
  ];
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const [x0, z0, x1, z1, tint] of zones) {
    const w = x1 - x0;
    const d = z1 - z0;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 4, (uv.getY(i) * d) / 4);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: mats.concrete.map, color: tint, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    m.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
    const lw = 0.18;
    for (const [cx, cz, sx, sz] of [
      [(x0 + x1) / 2, z0, w, lw],
      [(x0 + x1) / 2, z1, w, lw],
      [x0, (z0 + z1) / 2, lw, d],
      [x1, (z0 + z1) / 2, lw, d],
    ]) {
      const lg = new THREE.PlaneGeometry(sx, sz);
      lg.rotateX(-Math.PI / 2);
      const l = new THREE.Mesh(lg, lineMat);
      l.position.set(cx, 0.004, cz);
      l.receiveShadow = true;
      group.add(l);
    }
  }

  // Decor: painted spark on the plaza near spawn
  const sparkMat = new THREE.MeshStandardMaterial({ map: T.groundSparkTexture(), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const spark = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), sparkMat);
  spark.rotation.x = -Math.PI / 2;
  spark.position.set(0, 0.01, 31);
  spark.receiveShadow = true;
  group.add(spark);

  // Billboard above the north wall
  const bb = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: T.sparkBillboardTexture() }));
  bb.position.set(0, 3.6 + 5.8, -77.2);
  group.add(bb);
  const bbBack = new THREE.Mesh(new THREE.BoxGeometry(22.6, 11.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x141413 }));
  bbBack.position.set(0, 3.6 + 5.8, -77.4);
  group.add(bbBack);
  for (const x of [-8, 8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), mats.metal);
    leg.position.set(x, 3.6 + 1.0, -77.4);
    group.add(leg);
  }

  // Wall-top cap stripe in clay
  const capGeo = mergeGeometries(
    [
      new THREE.BoxGeometry(2 * 79, 0.12, 4.2).translate(0, 3.66, -77),
      new THREE.BoxGeometry(2 * 79, 0.12, 4.2).translate(0, 3.66, 77),
      new THREE.BoxGeometry(4.2, 0.12, 2 * 79).translate(-77, 3.66, 0),
      new THREE.BoxGeometry(4.2, 0.12, 2 * 79).translate(77, 3.66, 0),
    ],
    false,
  )!;
  group.add(new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: 0.7 })));

  // Trees beyond the walls for a sense of place
  const r = T.rng(5);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 4, 6).translate(0, 2, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.5, 0);
  const trunks: THREE.BufferGeometry[] = [];
  const crowns: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 70; i++) {
    const side = Math.floor(r() * 4);
    const along = (r() * 2 - 1) * 95;
    const out = 84 + r() * 18;
    const x = side === 0 ? along : side === 1 ? -along : side === 2 ? out : -out;
    const z = side === 0 ? out : side === 1 ? -out : side === 2 ? along : -along;
    const s = 0.8 + r() * 0.7;
    trunks.push(trunkGeo.clone().scale(s, s, s).translate(x, 0, z));
    crowns.push(crownGeo.clone().scale(s, s * (0.9 + r() * 0.3), s).translate(x, 0, z));
  }
  group.add(new THREE.Mesh(mergeGeometries(trunks, false)!, new THREE.MeshStandardMaterial({ color: 0x6b5443, roughness: 1 })));
  group.add(new THREE.Mesh(mergeGeometries(crowns, false)!, new THREE.MeshStandardMaterial({ color: 0x788c5d, roughness: 1, flatShading: true })));

  return group;
}
