import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ParkVisuals, box, kicker, bank, ledge, stairs, quarterPipe, funbox } from '../park';
import { Level, N, S, E, W, rect, polyRail, flagpole } from './common';
import { textTexture, atlasBillboardTexture, rng } from '../textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const arenaLevel: Level = {
  id: 'arena',
  name: 'The Nations Cup',
  chapter: 4,
  tagline: 'Chapter 4 · The contest',
  blurb: 'Three heats, sixty seconds each. Medal and you are on the Atlas team.',
  sky: '#E6DED2',
  fog: [40, 120],
  ground: true,
  kind: 'comp',
  runTime: 60,
  unlockAt: 99,
  objectNoun: '',
  goals: [
    { id: 'bronze', kind: 'medal', medal: 'bronze', text: 'Win a bronze medal', hint: 'Finish top three. Your best two heats count.' },
    { id: 'silver', kind: 'medal', medal: 'silver', text: 'Win a silver medal', hint: 'Beat Rin Takeda.' },
    { id: 'gold', kind: 'medal', medal: 'gold', text: 'Win the gold medal', hint: "Beat last year's champ, Sol Arquette." },
    { id: 'big', kind: 'gap', gap: 'biggap', text: 'Clear The Big Gap in a heat', hint: 'West kicker to the landing. Pop at the lip.' },
    { id: 'combo', kind: 'combo', points: 10000, text: 'Land a 10,000 point combo in a heat', hint: 'Judges love long lines.' },
  ],
  intro: {
    id: 'arena-intro',
    shots: [
      {
        cam: [0, 24, 46],
        cam2: [0, 15, 26],
        look: [0, 0, 0],
        dur: 4.5,
        title: 'The Nations Cup',
        subtitle: 'Chapter 4 · The contest',
        lines: [
          { who: 'announcer', text: 'Ladies and gentlemen, live from Japan Arena: welcome to the NATIONS CUP!' },
          { who: 'announcer', text: 'Three heats. Sixty seconds each. Your best two heats are averaged for the final score.' },
        ],
      },
      {
        cam: [-14, 4, 22],
        cam2: [-18, 3.5, 18],
        look: [-20, 1, 12],
        dur: 4,
        lines: [
          { who: 'announcer', text: 'Bails score nothing — and the judges hate seeing the same trick twice.' },
          { who: 'announcer', text: 'Tonight: Dex Tran, Rin Takeda, and defending champion Sol Arquette!' },
        ],
      },
      {
        cam: [10, 5, 30],
        cam2: [6, 4, 27],
        look: [0, 0.5, 20],
        dur: 3.5,
        lines: [
          { who: 'kai', text: 'Medal and you are in. Gold and you are a legend. No pressure.' },
          { who: 'mara', text: 'Fill your special meter. Then hit the star button in the air.' },
        ],
      },
    ],
  },
  outro: {
    id: 'arena-outro',
    shots: [
      {
        cam: [0, 6, 30],
        cam2: [0, 4, 22],
        look: [0, 1, 10],
        dur: 5,
        title: 'Champion',
        lines: [
          { who: 'announcer', text: 'What a finish! Your new medalist at the Nations Cup!' },
          { who: 'kai', text: "That's it. Welcome to Atlas Skateboards." },
          { who: 'mara', text: 'Told you. The kid with the flick.' },
          { who: 'dex', text: '...Rematch next year. And I want a copy of that clip.' },
        ],
      },
    ],
  },
  build(t) {
    const vis: ParkVisuals = { copings: [], railPosts: [] };
    const B = 38;
    box(t, 0, -B - 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, 0, B + 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, -B - 2, 0, 0, 2, B + 4, 3.6, 'wall');
    box(t, B + 2, 0, 0, 2, B + 4, 3.6, 'wall');
    const coping = (q: ReturnType<typeof quarterPipe>) => {
      const P = (v: number) => V(q.el.cx + q.lipU * q.el.c - v * q.el.s, q.H, q.el.cz + q.lipU * q.el.s + v * q.el.c);
      vis.copings.push({ a: P(-q.el.hz), b: P(q.el.hz) });
    };
    // big walls north and south, a smaller one east
    coping(quarterPipe(t, 0, -33.4, N, 60, 2.2, 2.9));
    coping(quarterPipe(t, -6, 33.4, S, 48, 1.8, 2.6));
    coping(quarterPipe(t, 33.6, 14, E, 16, 1.4, 2.2));

    // centre funbox with a rail and a ledge
    funbox(t, 0, 0, 0, 7, 4, 0.8, 2);
    polyRail(t, vis, [
      [-4, 0],
      [4, 0],
    ], 0.8 + 0.42, 'rail', 'boxrail');
    ledge(t, 0, 1.4, 0, 4, 0.5, 0.8 + 0.3);

    // The Big Gap: west kicker to a landing deck
    kicker(t, -27, 14, E, 4, 1.0, 2.6);
    bank(t, -13, 14, W, 4, 1.0, 5, 1.2);

    // platform with a 5-stair and handrail (east)
    box(t, 28, -10, 0, 6, 8, 1.0);
    bank(t, 28, 4, N, 6, 1.0, 6);
    const st = stairs(t, 22, -10, W, 7, 1.0, 5, 0.45);
    {
      const a = V(23.2, 1.5, -10);
      const b = V(22, 1.5, -10);
      const c = V(22 - st.L - 0.2, 0.5 - 0.2 * (1.0 / st.L), -10);
      t.addRail(a, b, 'rail', 'comprail');
      t.addRail(b, c, 'rail', 'comprail');
      vis.railPosts.push({ a, b }, { a: b, b: c });
    }

    // flat bars and a hip
    polyRail(t, vis, [
      [-22, 24],
      [-8, 24],
    ], 0.45, 'rail', 'flat1');
    polyRail(t, vis, [
      [8, 24],
      [20, 24],
    ], 0.38, 'rail', 'flat2');
    funbox(t, -22, -16, 0.6, 4, 4, 1.2, 3.6);
    ledge(t, 12, -20, 0, 10, 0.8, 0.45);
    ledge(t, -12, -24, 0, 8, 0.8, 0.35, true);

    return {
      vis,
      spawn: { x: 0, z: 28, heading: -Math.PI / 2 },
      gaps: [
        { id: 'biggap', name: 'The Big Gap', points: 800, from: rect(-27, 11.5, -23.6, 16.5), to: rect(-19.3, 11.5, -12, 16.5) },
        { id: 'stairset', name: 'Cup 5-Stair', points: 450, from: rect(22, -17, 26, -3), to: rect(12, -17, 19.8, -3) },
      ],
      letters: [],
      tape: V(0, -10, 0),
      props: [],
    };
  },
  decorate(group, mats) {
    // bleachers + crowd behind the walls
    const r = rng(17);
    const seats: THREE.BufferGeometry[] = [];
    const crowd: THREE.BufferGeometry[] = [];
    const colors: number[] = [];
    // a crowd in national colours
    const palette = [0xe04a3b, 0x1d2f5c, 0x3a6fb0, 0x009c3b, 0xffdf00, 0xfaf9f5, 0x141413, 0xbc002d, 0xff9933];
    for (const side of [-1, 1]) {
      for (let row = 0; row < 6; row++) {
        const z = side * (42 + row * 1.6);
        const y = 1.2 + row * 1.1;
        seats.push(new THREE.BoxGeometry(80, 0.5, 1.4).translate(0, y, z));
        for (let x = -38; x < 38; x += 0.9) {
          if (r() < 0.25) continue;
          const g = new THREE.BoxGeometry(0.5, 0.9, 0.4).translate(x + r() * 0.3, y + 0.7, z);
          const c = new THREE.Color(palette[Math.floor(r() * palette.length)]);
          for (let i = 0; i < g.getAttribute('position').count; i++) colors.push(c.r, c.g, c.b);
          crowd.push(g);
        }
      }
    }
    group.add(new THREE.Mesh(mergeGeometries(seats, false)!, new THREE.MeshStandardMaterial({ color: 0x5c5850, roughness: 0.9 })));
    const cg = mergeGeometries(crowd.map((g) => g.toNonIndexed()), false)!;
    cg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    group.add(new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
    // banners on the walls
    const banner = new THREE.MeshBasicMaterial({ map: textTexture('THE NATIONS CUP', '#FAF9F5', '#1D2F5C', 1024, 128, 'bold 76px Georgia, serif') });
    for (const [x, z, ry] of [
      [0, -39.9, 0],
      [0, 39.9, Math.PI],
      [-39.9, 0, Math.PI / 2],
      [39.9, 0, -Math.PI / 2],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), banner);
      m.position.set(x, 5.6, z);
      m.rotation.y = ry;
      group.add(m);
    }
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: atlasBillboardTexture() }));
    bb.position.set(0, 13, -49);
    group.add(bb);
    // the nations line the side walls; the host flies over the billboard
    const nations = ['brazil', 'usa', 'uk', 'france', 'germany', 'southkorea', 'canada', 'australia', 'spain', 'southafrica', 'sweden', 'argentina', 'italy', 'jamaica'];
    nations.forEach((f, i) => {
      const side = i % 2 ? 1 : -1;
      const z = -30 + Math.floor(i / 2) * 10;
      flagpole(group, mats, side * 44, z, 0, f, 11, side > 0 ? Math.PI : 0);
    });
    flagpole(group, mats, -11, -49, 0, 'japan', 18);
    flagpole(group, mats, 11, -49, 0, 'japan', 18);
    // light towers
    for (const [x, z] of [
      [-40, -40],
      [40, -40],
      [-40, 40],
      [40, 40],
    ]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 18, 8), mats.metal);
      pole.position.set(x, 9, z);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 1 }));
      head.position.set(x * 0.97, 18, z * 0.97);
      head.lookAt(0, 0, 0);
      group.add(head);
    }
  },
};

