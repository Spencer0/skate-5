import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ParkVisuals, box, kicker, bank, ledge, stairs, quarterPipe, funbox } from '../park';
import { Level, N, S, rect, polyRail, lamps, scoreGoals } from './common';

const SEA = -0.9;

/** The long pier rail: up the east edge, all the way round the pier head, back down the west edge. */
const PIER_RAIL: [number, number][] = [
  [4.6, 22],
  [4.6, -68.5],
  [6.6, -70.5],
  [15.5, -70.5],
  [17.5, -72.5],
  [17.5, -92.5],
  [15.5, -94.5],
  [-15.5, -94.5],
  [-17.5, -92.5],
  [-17.5, -72.5],
  [-15.5, -70.5],
  [-6.6, -70.5],
  [-4.6, -68.5],
  [-4.6, 22],
];

export const pierLevel: Level = {
  id: 'pier',
  name: 'The Pier',
  chapter: 3,
  tagline: 'Chapter 3 · Saturday at the beach',
  blurb: 'Kai Moreno wants to see someone ride the 250m pier rail. The water is cold.',
  sky: '#DCE8EC',
  fog: [50, 170],
  ground: false,
  kind: 'street',
  runTime: 120,
  unlockAt: 6,
  objectNoun: 'beach balls',
  goals: [
    ...scoreGoals(15000, 45000, 100000),
    { id: 'let', kind: 'letters', text: 'Collect C-L-A-U-D-E', hint: 'All six in one run. Two of them are on the pier rail.' },
    { id: 'tape', kind: 'tape', text: 'Find the secret tape', hint: 'On the deck of the pier-head quarter pipe. Hold up at the lip.', view: { cam: [14, 5, -82], look: [8, 2, -92.9] } },
    { id: 'balls', kind: 'objects', count: 5, text: 'Pop 5 beach balls', hint: 'The tourists left them everywhere. Promenade, boardwalk, pier head.' },
    { id: 'pg', kind: 'gap', gap: 'piergap', text: 'Ollie the Pier Gap', hint: 'Kickers on both sides of the rotten planks. Pop at the lip.' },
    { id: 'pghf', kind: 'gap', gap: 'piergap', trick: 'Hardflip', text: 'Hardflip the Pier Gap', hint: 'Roll the trick stick right, past the top. Catch it over the hole.' },
    { id: 'rail', kind: 'grind', tag: 'pierrail', dist: 100, text: 'Grind 100m of the pier rail in one go', hint: 'Get on at the boardwalk with speed and keep balancing.', view: { cam: [9, 3, 14], look: [4.6, 0.5, 0] } },
    { id: 'stairs', kind: 'gap', gap: 'promstairs', trick: 'Heelflip', text: 'Heelflip the promenade stairs', hint: 'From the promenade down to the boardwalk.' },
    { id: 'air', kind: 'air', height: 2, text: 'Get 2m of air on the pier head quarter pipe', hint: 'Pop at the lip.', view: { cam: [8, 4, -78], look: [0, 1.5, -91] } },
    { id: 'combo', kind: 'combo', points: 15000, text: 'Land a 15,000 point combo', hint: 'The pier rail is one long combo waiting to happen.' },
  ],
  intro: {
    id: 'pier-intro',
    shots: [
      {
        cam: [34, 22, 44],
        cam2: [16, 14, 18],
        look: [0, 0, -30],
        dur: 4.5,
        title: 'The Pier',
        subtitle: 'Chapter 3 · Saturday at the beach',
        lines: [
          { who: 'kai', text: 'You came. Good. See that rail?' },
          { who: 'kai', text: 'Two hundred and fifty meters. Up the pier, all the way round the head, and back.' },
        ],
      },
      {
        cam: [8, 3, -19],
        cam2: [6, 2.4, -23],
        look: [0, 0, -28],
        dur: 4,
        lines: [
          { who: 'kai', text: 'Planks rotted out last winter. Kickers both sides. Try not to look down.' },
          { who: 'mara', text: 'If you fall in, I am not fishing you out.' },
        ],
      },
      {
        cam: [12, 6, -68],
        cam2: [6, 5, -74],
        look: [0, 1, -88],
        dur: 4,
        lines: [
          { who: 'dex', text: "Thought I'd come watch. Heard the Spark team only has one spot." },
          { who: 'kai', text: 'It does.' },
        ],
      },
      {
        cam: [-6, 5, 34],
        cam2: [-12, 4, 30],
        look: [-30, 1, 24],
        dur: 3.5,
        lines: [{ who: 'mara', text: 'Also: five beach balls. Tourists. You know the drill.' }],
      },
    ],
  },
  outro: {
    id: 'pier-outro',
    shots: [
      {
        cam: [10, 6, -58],
        cam2: [4, 4, -70],
        look: [0, 0.5, -84],
        dur: 4.5,
        title: 'Chapter 3 complete',
        lines: [
          { who: 'kai', text: 'Alright. I have seen enough.' },
          { who: 'kai', text: 'One spot on the team. One contest: the Claude Classic.' },
          { who: 'kai', text: 'You, Dex, and the best riders on the coast. Medal and you are on Spark.' },
          { who: 'dex', text: 'See you there, rookie.' },
        ],
      },
    ],
  },
  build(t) {
    const vis: ParkVisuals = { copings: [], railPosts: [] };
    t.floor = -3;
    t.water.push({ y: SEA, rect: { x0: -400, z0: -400, x1: 400, z1: 18 } });

    // land: raised promenade, boardwalk, pier, pier head
    box(t, 0, 45, 0, 60, 15, 1.2, 'concrete');
    box(t, 0, 24, 0, 60, 6, 0, 'wood');
    box(t, 0, -4, 0, 5, 22, 0, 'wood');
    box(t, 0, -50, 0, 5, 20, 0, 'wood');
    box(t, 0, -82.5, 0, 18, 12.5, 0, 'wood');
    // walls behind the promenade
    box(t, 0, 62, 0, 64, 2, 4.8, 'wall');
    box(t, 62, 40, 0, 2, 22, 4.8, 'wall');
    box(t, -62, 40, 0, 2, 22, 4.8, 'wall');

    // promenade -> boardwalk: 6-stair with a handrail, plus two banks
    const st = stairs(t, -6, 30, N, 8, 1.2, 6, 0.45);
    const slope = 1.2 / st.L;
    {
      const a = new THREE.Vector3(-6, 1.7, 31.2);
      const b = new THREE.Vector3(-6, 1.7, 30);
      const c = new THREE.Vector3(-6, 0.5 - 0.2 * slope, 30 - st.L - 0.2);
      t.addRail(a, b, 'rail', 'promrail');
      t.addRail(b, c, 'rail', 'promrail');
      vis.railPosts.push({ a, b }, { a: b, b: c });
    }
    bank(t, 12, 23, S, 10, 1.2, 7);
    bank(t, -30, 23, S, 10, 1.2, 7);
    ledge(t, 22, 40, 0, 8, 0.6, 1.2 + 0.45);
    ledge(t, -45, 44, 0, 8, 0.6, 1.2 + 0.45);
    polyRail(t, vis, [
      [-40, 36],
      [-15, 36],
    ], 1.2 + 0.45, 'rail', 'promflat');
    ledge(t, -25, 21, 0, 6, 0.6, 0.45);
    ledge(t, 30, 21, 0, 6, 0.6, 0.45);

    // the pier gap: rotten planks between z -26 and -30, kickers both ways
    kicker(t, 0, -23.8, N, 3, 0.5, 1.8);
    kicker(t, 0, -32.2, S, 3, 0.5, 1.8);

    // the long rail (polished: it runs forever)
    polyRail(t, vis, PIER_RAIL, 0.45, 'rail', 'pierrail', 0.25);

    // pier head: quarter pipe, funbox with a rail, ledges
    const qp = quarterPipe(t, 0, -90, N, 20, 1.6, 2.4, 1.2);
    const lip = (v: number) => new THREE.Vector3(qp.el.cx + qp.lipU * qp.el.c - v * qp.el.s, qp.H, qp.el.cz + qp.lipU * qp.el.s + v * qp.el.c);
    vis.copings.push({ a: lip(-qp.el.hz), b: lip(qp.el.hz) });
    funbox(t, 0, -79, 0, 4, 3, 0.6, 1.6);
    polyRail(t, vis, [
      [-2.4, -79],
      [2.4, -79],
    ], 1.0, 'rail', 'headrail');
    ledge(t, -11, -80, S, 10, 0.7, 0.45);
    ledge(t, 11, -80, S, 10, 0.7, 0.45);

    return {
      vis,
      spawn: { x: 0, z: 24, heading: -Math.PI / 2 },
      gaps: [
        { id: 'piergap', name: 'Pier Gap', points: 600, from: rect(-5, -26, 5, -20), to: rect(-5, -45, 5, -30) },
        { id: 'piergap', name: 'Pier Gap', points: 600, from: rect(-5, -36, 5, -30), to: rect(-5, -26, 5, -10) },
        { id: 'promstairs', name: 'Promenade Stairs', points: 450, from: rect(-10.5, 30, -1.5, 34), to: rect(-11, 18.5, -1, 27.2) },
        { id: 'promdrop', name: 'Promenade Drop', points: 250, from: rect(-60, 30, 60, 34), to: rect(-60, 18.5, 60, 29.9) },
      ],
      tape: new THREE.Vector3(8, 2.1, -92.9),
      props: [
        { kind: 'ball', pos: new THREE.Vector3(20, 0, 25) },
        { kind: 'ball', pos: new THREE.Vector3(-40, 0, 50) },
        { kind: 'ball', pos: new THREE.Vector3(0, 0, -60) },
        { kind: 'ball', pos: new THREE.Vector3(-12, 0, -88) },
        { kind: 'ball', pos: new THREE.Vector3(12, 0, -75) },
      ],
      letters: [
        new THREE.Vector3(0, 2.2, -28), // C: over the pier gap
        new THREE.Vector3(17.5, 1.0, -82), // L: east side of the pier-head rail
        new THREE.Vector3(0, 2.5, -92.1), // A: quarter pipe air
        new THREE.Vector3(-6, 1.3, 28.6), // U: promenade handrail
        new THREE.Vector3(-4.6, 1.0, -12), // D: west pier rail
        new THREE.Vector3(-27, 2.0, 36), // E: promenade flat rail
      ],
    };
  },
  decorate(group, mats, t) {
    // sea floor
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9b48d, roughness: 1 }));
    sand.position.y = t.floor - 0.05;
    group.add(sand);
    // pilings under the pier and pier head
    const piles: THREE.BufferGeometry[] = [];
    const pile = (x: number, z: number) => piles.push(new THREE.CylinderGeometry(0.18, 0.2, 3.2, 8).translate(x, -1.6, z));
    for (let z = 16; z > -70; z -= 4) {
      if (z < -26 && z > -30) continue;
      pile(-4.7, z);
      pile(4.7, z);
    }
    for (let x = -17; x <= 17; x += 4.25) for (let z = -71; z >= -94; z -= 4.6) pile(x, z);
    for (let x = -58; x <= 58; x += 5) pile(x, 18.3);
    group.add(new THREE.Mesh(mergeGeometries(piles, false)!, new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 })));
    // broken plank stubs at the gap
    const stub = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 0.4), mats.wood);
    stub.position.set(0, -0.06, -26.2);
    group.add(stub);
    // lighthouse on a rock past the pier head
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0), new THREE.MeshStandardMaterial({ color: 0x7c766c, flatShading: true }));
    rock.position.set(22, -2.5, -112);
    group.add(rock);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 14, 16), new THREE.MeshStandardMaterial({ color: 0xfaf9f5 }));
    tower.position.set(22, 6, -112);
    group.add(tower);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.8, 2.2, 16), mats.clay);
    band.position.set(22, 6, -112);
    group.add(band);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 2, 12), new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 0.8 }));
    lamp.position.set(22, 14, -112);
    group.add(lamp);
    // buildings beyond the promenade
    const geos: THREE.BufferGeometry[] = [];
    for (let x = -70; x < 70; x += 14) {
      const h = 8 + ((x * 7919) % 9 + 9) % 9;
      geos.push(new THREE.BoxGeometry(13, h, 10).translate(x + 6.5, 1.2 + h / 2, 70));
    }
    group.add(new THREE.Mesh(mergeGeometries(geos, false)!, mats.facade));
    lamps(group, mats, [
      [-5.2, 10, 0],
      [5.2, 10, 0],
      [-5.2, -10, 0],
      [5.2, -10, 0],
      [-5.2, -50, 0],
      [5.2, -50, 0],
      [-20, 45, 1.2],
      [20, 45, 1.2],
      [0, 50, 1.2],
    ]);
  },
};
