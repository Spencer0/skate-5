import * as THREE from 'three';
import { Terrain } from '../terrain';
import { ParkVisuals, box, kicker, bank, ledge, stairs, hubba, quarterPipe } from '../park';
import { Level, N, S, W, rect, ringRail, polyRail, buildings, lamps, scatterTrees, scoreGoals, flagpole, LETTERS_GOAL } from './common';
import { Batch, birds, bunting, grime, palm, perimeter, tileBands, wallBunting, wallCrowd } from './decor';

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
  name: 'Plaza de España',
  chapter: 2,
  tagline: 'Chapter 2 · Downtown',
  blurb: 'A legendary fountain gap, a 7-stair Dex claims as his, and a security guard on a long lunch.',
  sky: '#F2E2C6',
  zenith: '#5E9FDB',
  fog: [45, 175],
  ground: true,
  kind: 'street',
  runTime: 120,
  unlockAt: 6,
  objectNoun: 'traffic cones',
  goals: [
    ...scoreGoals(10000, 30000, 70000),
    { id: 'let', kind: 'letters', text: LETTERS_GOAL, hint: 'All six in one run. One of them is floating over the fountain.' },
    { id: 'tape', kind: 'tape', text: 'Find the secret tape', hint: 'Ride up the big west bank and pop off the very top.', view: { cam: [-38, 4, 8], look: [-49.3, 2.4, 0] } },
    { id: 'cones', kind: 'objects', count: 5, text: "Knock over Pete's 5 traffic cones", hint: 'Five cones scattered around the plaza. One is up on the terrace.' },
    { id: 'fg', kind: 'gap', gap: 'fountain', text: 'Gap over the fountain', hint: 'Push hard, ride up the kicker and pop right at the lip.' },
    { id: 'fgkf', kind: 'gap', gap: 'fountain', trick: 'Kickflip', text: 'Kickflip over the fountain', hint: 'Same line — flick up-left at the lip and catch it over the water.' },
    { id: 'rim', kind: 'grind', tag: 'fountain', dist: 12, text: 'Grind a full lap of the fountain rim', hint: 'Ollie onto the rim at a shallow angle and keep your balance.', view: { cam: [5, 3, 5], look: [0, 0.5, 0] } },
    { id: 'rail', kind: 'grind', tag: 'bigrail', dist: 2.5, trick: 'slide', text: 'Slide the 7-stair handrail', hint: 'Spin the board sideways in the air before you land on the rail.', view: { cam: [8, 3.5, -22], look: [2.6, 1.2, -29] } },
    { id: 'tre', kind: 'gap', gap: 'sevenstair', trick: '360 Flip', text: '360 Flip down the 7-stair', hint: 'From the terrace, pop at the top step. Dex says it can\'t be done.' },
    { id: 'plant', kind: 'gap', gap: 'planter', text: 'Clear the Planter Gap', hint: 'Up the little bank onto the first planter, then ollie to the second.' },
    { id: 'combo', kind: 'combo', points: 8000, text: 'Land an 8,000 point combo', hint: 'Grinds link tricks together. Don\'t touch the ground between them.' },
  ],
  intro: {
    id: 'plaza-intro',
    shots: [
      {
        cam: [24, 26, 44],
        cam2: [12, 16, 26],
        look: [0, 0, -4],
        dur: 4,
        title: 'Plaza de España',
        subtitle: 'Chapter 2 · Downtown',
        lines: [
          { who: 'pete', text: 'Hey! HEY! This is a public plaza, not a skatepark!' },
          { who: 'mara', text: "That's Officer Pete. Give it ten minutes, he'll go get a sandwich." },
        ],
      },
      {
        cam: [7, 3.2, 11],
        cam2: [4.5, 2.4, 8],
        look: [0, 0.6, 0],
        dur: 4,
        lines: [
          { who: 'mara', text: "There it is. The fountain gap. Kicker on this side, landing on the other." },
          { who: 'mara', text: 'Pop right at the lip and catch it over the water. Come up short and you go swimming.' },
        ],
      },
      {
        cam: [9, 4.5, -19],
        cam2: [6, 3.6, -23],
        look: [0, 1, -30],
        dur: 4,
        lines: [
          { who: 'dex', text: 'The seven-stair is mine. Only person with a clip on it.' },
          { who: 'mara', text: 'Then go take it from him.' },
        ],
      },
      {
        cam: [-6, 6, 26],
        cam2: [-10, 5, 20],
        look: [-20, 0, 10],
        dur: 3.5,
        lines: [
          { who: 'pete', text: 'And stop knocking over my traffic cones!' },
          { who: 'mara', text: '...there are exactly five of them. Just saying.' },
        ],
      },
    ],
  },
  outro: {
    id: 'plaza-outro',
    shots: [
      {
        cam: [6, 5, 18],
        cam2: [3, 3.6, 12],
        look: [0, 1, 0],
        dur: 4,
        title: 'Chapter 2 complete',
        lines: [
          { who: 'kai', text: 'Saw the fountain clip. That catch was clean.' },
          { who: 'mara', text: "That's Kai Moreno. Atlas team manager. Do not freak out." },
          { who: 'kai', text: "There's a rail at the pier I want to see someone ride end to end. Saturday." },
          { who: 'dex', text: "Wait — he didn't invite me?" },
        ],
      },
    ],
  },
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
      tape: new THREE.Vector3(-49.3, 2.5, 0),
      props: [
        { kind: 'cone', pos: new THREE.Vector3(-10, 0, 18) },
        { kind: 'cone', pos: new THREE.Vector3(16, 0, -10) },
        { kind: 'cone', pos: new THREE.Vector3(-28, 0, -20) },
        { kind: 'cone', pos: new THREE.Vector3(32, 0, 26) },
        { kind: 'cone', pos: new THREE.Vector3(6, 0, -45) },
      ],
      letters: [
        new THREE.Vector3(0, 3.0, -0.4), // N: over the fountain
        new THREE.Vector3(2.6, 1.35, -28.4), // A: on the 7-stair handrail
        new THREE.Vector3(25, 1.9, 8.2), // T: over the planter gap
        new THREE.Vector3(40, 1.0, -13.5), // I: end of the long ledge
        new THREE.Vector3(-2.0, 0.95, 0), // O: on the fountain rim
        new THREE.Vector3(0, 2.3, -44), // N: above the terrace ledge
      ],
    };
  },
  decorate(group, mats, t) {
    // Seville: ochre, albero, terracotta and whitewash
    buildings(group, mats, 58, 3, [0xf3c46a, 0xe9b872, 0xe39468, 0xffffff, 0xf7dc8f, 0xf0b4a0, 0xffe8c0]);
    const walls = perimeter(56, 3.6);
    tileBands(group, t, walls, 1.2, 13);
    grime(group, t, rect(-56, -56, 56, 56), 380, 23, {
      tags: ['#c0392b', '#1f4e9c'],
      avoid: [{ x: 0, z: 0, r: 3.2 }],
      mix: { gum: 3, tag: 0.4, drain: 1, wax: 1.5, chalk: 0.6 },
    });
    const life = new Batch();
    wallCrowd(life, t, walls, [0xc60b1e, 0xffc400, 0xfaf9f5, 0x1f4e9c, 0x141413, 0x2a9d8f, 0xf4a3b4], 0.45, 33);
    const red = 0xc60b1e;
    const gold = 0xffc400;
    wallBunting(life, 58, 3.6, 14, [red, gold, red, 0xfaf9f5], 43);
    // strings across the corners, high over the riding
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      bunting(life, new THREE.Vector3(sx * 58, 7.5, sz * 30), new THREE.Vector3(sx * 30, 7.5, sz * 58), 1.6, [red, gold], 90 + sx * 3 + sz);
    }
    // palms in the four corners of the plaza
    for (const [x, z] of [
      [-51, -51],
      [51, -51],
      [-51, 51],
      [51, 51],
      [-51, 44],
      [44, 51],
    ]) {
      palm(life, x, 0, z, 9 + ((x * 7 + z * 3) % 3), 200 + x + z);
    }
    group.add(life.build({ side: THREE.DoubleSide }));
    birds(group, 9, 0, 0, 9, 7, 0x8d8f99, 61);
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
    flagpole(group, mats, -32, -56, 0, 'spain', 11);
    flagpole(group, mats, 32, -56, 0, 'spain', 11);
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
