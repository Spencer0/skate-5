import * as THREE from 'three';
import { Terrain } from '../terrain';
import { ParkVisuals, box, kicker, bank, ledge, stairs, hubba, quarterPipe } from '../park';
import { Level, N, S, W, rect, ringRail, polyRail, buildings, lamps, scatterTrees } from './common';

const FOUNTAIN = { r: 2.2, inner: 1.8, rim: 0.5, ped: 0.35, pedH: 1.1, water: 0.3 };

function fountain(t: Terrain, cx: number, cz: number) {
  const F = FOUNTAIN;
  t.addElement({
    kind: 'fountain',
    cx,
    cz,
    rot: 0,
    hx: F.r,
    hz: F.r,
    h: (u, v) => {
      const r = Math.hypot(u, v);
      if (r > F.r) return -Infinity;
      // the spout in the middle is decoration: the basin is all water
      return r >= F.inner ? F.rim : 0;
    },
    resU: 0,
    resV: 0,
    mat: 'stone',
    skirt: false,
    meshFn: () => {
      const b = 0.03; // small bevels keep the lathe shading crisp
      const pts = [
        [0, F.pedH],
        [F.ped - b, F.pedH],
        [F.ped, F.pedH - b],
        [F.ped, 0.01],
        [F.inner, 0.01],
        [F.inner, F.rim - b],
        [F.inner + b, F.rim],
        [F.r - b, F.rim],
        [F.r, F.rim - b],
        [F.r, 0],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const g = new THREE.LatheGeometry(pts, 64);
      const p = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getY(i)) / 2, p.getZ(i) / 2);
      g.translate(cx, 0, cz);
      return g;
    },
  });
  t.water.push({ y: F.water, circle: { cx, cz, r: F.inner } });
  ringRail(t, cx, cz, (F.r + F.inner) / 2, F.rim, 28, 'fountain', 0.4);
}

export const plazaLevel: Level = {
  id: 'plaza',
  name: 'Fountain Plaza',
  tagline: 'Chapter 2 · Downtown',
  story:
    'Downtown, the security guard is on lunch. The city crew says nobody has ever flipped over the fountain — ' +
    'launch off the kicker and pop at the lip, then catch it before you hit the landing. The big 7-stair is waiting too.',
  outro: 'Your fountain clip is everywhere. A pro at the beach DMs you: "Pier. Saturday. Bring your board."',
  sky: '#E9E4DA',
  fog: [40, 130],
  ground: true,
  unlockAt: 4,
  goals: [
    { id: 'fg', kind: 'gap', text: 'Gap over the fountain', gap: 'fountain' },
    { id: 'fgkf', kind: 'gap', text: 'Kickflip over the fountain', gap: 'fountain', trick: 'Kickflip' },
    { id: 'rim', kind: 'grind', text: 'Grind a full lap of the fountain rim', tag: 'fountain', dist: 12 },
    { id: 'rail', kind: 'grind', text: 'Slide the 7-stair handrail', tag: 'bigrail', dist: 2.5, trick: 'slide' },
    { id: 'tre', kind: 'gap', text: '360 Flip down the 7-stair', gap: 'sevenstair', trick: '360 Flip' },
    { id: 'plant', kind: 'gap', text: 'Clear the Planter Gap', gap: 'planter' },
    { id: 'let', kind: 'letters', text: 'Collect C-L-A-U-D-E' },
    { id: 'combo', kind: 'combo', text: 'Land an 8,000 point combo', points: 8000 },
  ],
  build(t) {
    const vis: ParkVisuals = { copings: [], railPosts: [] };
    const B = 56;
    box(t, 0, -B - 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, 0, B + 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, -B - 2, 0, 0, 2, B + 4, 3.6, 'wall');
    box(t, B + 2, 0, 0, 2, B + 4, 3.6, 'wall');

    // the fountain, with a kicker on one side and a landing on the other
    fountain(t, 0, 0);
    kicker(t, 0, 5.2, N, 2.4, 1.0, 2.6);
    bank(t, 0, -8.7, S, 3, 1.0, 5, 1.2);
    // benches around it
    for (const [x, z, r] of [
      [6.2, 6.2, -Math.PI / 4],
      [-6.2, 6.2, Math.PI / 4],
      [6.2, -6.2, Math.PI / 4],
      [-6.2, -6.2, -Math.PI / 4],
    ]) {
      ledge(t, x, z, r, 3.5, 0.6, 0.45);
    }

    // north terrace with the big 7-stair
    const H = 1.4;
    box(t, 0, -40, 0, 20, 10, H);
    const st = stairs(t, 0, -30, S, 10, H, 7, 0.45);
    const slope = H / st.L;
    for (const x of [-2.6, 2.6]) {
      const a = new THREE.Vector3(x, H + 0.5, -31.2);
      const b = new THREE.Vector3(x, H + 0.5, -30);
      const c = new THREE.Vector3(x, 0.5 - 0.2 * slope, -30 + st.L + 0.2);
      t.addRail(a, b, 'rail', 'bigrail');
      t.addRail(b, c, 'rail', 'bigrail');
      vis.railPosts.push({ a, b }, { a: b, b: c });
    }
    hubba(t, -5.45, -31.5, S, 0.9, 1.5, H, st.L, 0.4, 1.0);
    bank(t, 14, -22, N, 8, H, 8);
    bank(t, -14, -22, N, 8, H, 8);
    ledge(t, 0, -44, 0, 12, 0.8, H + 0.45);
    ledge(t, 12, -36, S, 6, 0.8, H + 0.35);

    // planter gap (east)
    ledge(t, 25, 12, 0, 3, 3, 0.8, true);
    bank(t, 25, 16.5, N, 3, 0.8, 3);
    ledge(t, 25, 4.5, 0, 3, 3, 0.8, true);
    bank(t, 25, 0, S, 3, 0.8, 3);

    // long ledge (east) and flat bar (west)
    ledge(t, 40, 0, S, 30, 0.8, 0.45);
    for (const r of t.rails) if (r.a.x > 39 && r.a.x < 41 && Math.abs(r.a.z - r.b.z) > 20) r.tag = 'longledge';
    polyRail(t, vis, [
      [-30, 16],
      [-30, -10],
    ], 0.45, 'rail', 'flatbar');
    ledge(t, -20, 22, 0, 6, 2.2, 0.25, true);

    // west bank wall + south quarter pipe
    bank(t, -45, 0, W, 40, 1.8, 4);
    const qp = quarterPipe(t, 0, 48.4, S, 40, 1.5, 2.4);
    const lip = (v: number) => new THREE.Vector3(qp.el.cx + qp.lipU * qp.el.c - v * qp.el.s, qp.H, qp.el.cz + qp.lipU * qp.el.s + v * qp.el.c);
    vis.copings.push({ a: lip(-qp.el.hz), b: lip(qp.el.hz) });

    return {
      vis,
      spawn: { x: 0, z: 30, heading: -Math.PI / 2 },
      gaps: [
        { id: 'fountain', name: 'Fountain Gap', points: 600, from: rect(-1.6, 2.3, 1.6, 6), to: rect(-2.5, -9.5, 2.5, -2.3) },
        { id: 'fountain', name: 'Fountain Gap', points: 600, from: rect(-2.5, -9.5, 2.5, -2.3), to: rect(-1.6, 2.3, 1.6, 8) },
        { id: 'sevenstair', name: '7-Stair', points: 700, from: rect(-5.2, -33, 5.2, -29.9), to: rect(-6, -26.8, 6, -14) },
        { id: 'planter', name: 'Planter Gap', points: 450, from: rect(23.4, 10.4, 26.6, 13.6), to: rect(23.4, -0.5, 26.6, 6.1) },
        { id: 'terracedrop', name: 'Terrace Drop', points: 250, from: rect(-20, -50, 20, -30.1), to: rect(-22, -30, 22, -18) },
      ],
      letters: [
        new THREE.Vector3(0, 3.0, -0.4), // C: over the fountain
        new THREE.Vector3(2.6, 1.35, -28.4), // L: on the 7-stair handrail
        new THREE.Vector3(25, 1.9, 8.2), // A: over the planter gap
        new THREE.Vector3(40, 1.0, -13.5), // U: end of the long ledge
        new THREE.Vector3(-2.0, 0.95, 0), // D: on the fountain rim
        new THREE.Vector3(0, 2.3, -44), // E: above the terrace ledge
      ],
    };
  },
  decorate(group, mats) {
    buildings(group, mats, 58, 3);
    scatterTrees(group, 24, 62, 80, 9);
    lamps(group, mats, [
      [-10, 12, 0],
      [10, 12, 0],
      [-10, -12, 0],
      [10, -12, 0],
      [-18, -48, 1.4],
      [18, -48, 1.4],
      [32, 20, 0],
      [-36, 30, 0],
    ]);
    // plaza paving under everything
    const g = new THREE.PlaneGeometry(120, 120);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 40);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: mats.stone.map, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.position.y = 0.002;
    m.receiveShadow = true;
    group.add(m);
  },
};
