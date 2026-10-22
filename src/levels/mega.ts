import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ParkVisuals, box, kicker, bank, ledge, stairs, hubba, quarterPipe, funbox, rollIn } from '../park';
import { radiusFor, transitionRun } from '../terrain';
import { Level, N, S, E, W, rect, polyRail, flagpole } from './common';
import { textTexture, rng } from '../textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Mega line: the tower deck, its roll-in, the big kicker and the landing. */
export const MEGA = {
  deckH: 8,
  deckZ: 52, // north edge of the tower deck, where the roll-in starts
  rollDeg: 30,
  rollR: 8,
  kickToe: 28,
  kickH: 1.3,
  kickL: 3.8,
  landTop: 13, // z of the knuckle (the landing deck runs south from here)
  landDeck: 2,
  landH: 2.4,
  landL: 10,
};

/** Run length of a roll-in (see park.rollIn). */
function rollRun(H: number, deg: number, R: number) {
  const th = (deg * Math.PI) / 180;
  return R * Math.sin(th) + (H - R * (1 - Math.cos(th))) / Math.tan(th);
}

/**
 * The Mega Park: a free-skate playground built for big air. A five metre
 * roll-in tower feeds the mega kicker and a giant quarter pipe, with a vert
 * half pipe, a deep bowl and a rail yard on the sides.
 */
export const megaLevel: Level = {
  id: 'mega',
  name: 'The Mega Park',
  chapter: 0,
  tagline: 'Free skate · Big air',
  blurb: 'Roll-in tower, mega kicker, vert half pipe and the longest rails in the world.',
  sky: '#DCE6EE',
  fog: [60, 180],
  ground: true,
  kind: 'free',
  runTime: 0,
  unlockAt: 0,
  objectNoun: '',
  goals: [],
  intro: { id: 'mega-intro', shots: [{ cam: [30, 18, 70], look: [0, 3, 20], dur: 3, title: 'The Mega Park' }] },
  outro: { id: 'mega-outro', shots: [{ cam: [30, 18, 70], look: [0, 3, 20], dur: 1 }] },
  build(t) {
    const vis: ParkVisuals = { copings: [], railPosts: [] };
    const B = 72;
    box(t, 0, -B - 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, 0, B + 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, -B - 2, 0, 0, 2, B + 4, 3.6, 'wall');
    box(t, B + 2, 0, 0, 2, B + 4, 3.6, 'wall');
    const coping = (q: ReturnType<typeof quarterPipe>) => {
      const P = (v: number) => V(q.el.cx + q.lipU * q.el.c - v * q.el.s, q.H, q.el.cz + q.lipU * q.el.s + v * q.el.c);
      vis.copings.push({ a: P(-q.el.hz), b: P(q.el.hz) });
    };
    const rail = (pts: [number, number, number][], tag: string) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = V(...pts[i]);
        const b = V(...pts[i + 1]);
        t.addRail(a, b, 'rail', tag, 0.8);
        vis.railPosts.push({ a, b });
      }
    };

    /* --- the mega line (centre, south to north) --- */
    const M = MEGA;
    // tower deck, reached by long banks from either side
    box(t, 0, M.deckZ + 6, 0, 7, 6, M.deckH);
    bank(t, 57, M.deckZ + 6, W, 8, M.deckH, 50);
    bank(t, -57, M.deckZ + 6, E, 8, M.deckH, 50);
    // handrails down both access banks
    for (const sx of [1, -1]) {
      const z = M.deckZ + 6 + 4.3;
      rail(
        [
          [sx * 4, M.deckH + 0.5, z],
          [sx * 7, M.deckH + 0.5, z],
          [sx * 57, 0.5, z],
          [sx * 59, 0.5, z],
        ],
        'towerrail',
      );
      // wall quarters catch you at the bottom of the banks
      coping(quarterPipe(t, sx * 64, M.deckZ - 1, sx > 0 ? E : W, 30, 2.2, 3));
    }
    rollIn(t, 0, M.deckZ - rollRun(M.deckH, M.rollDeg, M.rollR), S, 10, M.deckH, M.rollDeg, M.rollR);
    // mega kicker and the landing ramp (knuckle deck, then down)
    kicker(t, 0, M.kickToe, N, 6, M.kickH, M.kickL);
    bank(t, 0, M.landTop - M.landL, S, 10, M.landH, M.landL, M.landDeck);
    // the face of the landing deck is banked, so coming up short is a step-up, not a wall
    bank(t, 0, M.landTop + M.landDeck + 2.2, N, 10, M.landH, 2.2);
    // giant quarter pipe at the end of the line
    coping(quarterPipe(t, 0, -54, N, 30, 3.6, 3.8, 2));

    /* --- vert half pipe (west) --- */
    {
      // as tall as push speed carries you (there's no pumping): pop at the coping for air
      const H = 2.6;
      const R = 3;
      coping(quarterPipe(t, -56, -18, W, 32, H, R, 2.4));
      coping(quarterPipe(t, -49, -18, E, 32, H, R, 2.4));
    }

    /* --- big pyramid with a ledge on top and a rail down its face (west centre) --- */
    {
      const H = 2;
      funbox(t, -24, 0, 0, 9, 7, H, 5);
      ledge(t, -24, 0, 0, 6, 0.8, H + 0.35);
      rail(
        [
          [-21, H + 0.45, -2.6],
          [-21, 0.45, -7.4],
          [-21, 0.45, -10],
        ],
        'pyrail',
      );
    }

    /* --- big bowl (south-west) --- */
    t.bowls.push({ cx: -46, cz: 34, radius: 11, flat: 5, depth: 3, R: radiusFor(3, 6) });

    /* --- spine (north-west) --- */
    {
      const H = 2.4;
      const R = 3.0;
      const w = transitionRun(H, R);
      const deck = 0.15;
      const zTop = -50;
      coping(quarterPipe(t, -26, zTop + w + deck, N, 18, H, R, deck));
      quarterPipe(t, -26, zTop - w - deck, S, 18, H, R, deck);
      vis.copings.pop();
      vis.copings.push({ a: V(-35, H, zTop), b: V(-17, H, zTop) });
    }

    /* --- rail yard (east) --- */
    // the long rail
    polyRail(t, vis, [
      [46, 38],
      [46, -30],
    ], 0.5, 'rail', 'longrail', 0.8);
    polyRail(t, vis, [
      [56, 30],
      [56, 2],
    ], 0.38, 'rail', 'flat');
    // the mega stair set: platform, 12 stairs, handrail and hubba
    {
      const H = 2.4;
      box(t, 58, -40, 0, 8, 6, H);
      bank(t, 58, -62, S, 14, H, 16);
      const st = stairs(t, 58, -34, S, 10, H, 12, 0.45);
      const z1 = -34 + st.L;
      rail(
        [
          [58, H + 0.5, -36.5],
          [58, H + 0.5, -34],
          [58, 0.5 - 0.2 * (H / st.L), z1 + 0.2],
          [58, 0.5 - 0.2 * (H / st.L), z1 + 3],
        ],
        'megarail',
      );
      hubba(t, 63.6, -36, S, 0.9, 2, H, st.L, 0.45, 1.5);
      ledge(t, 52, -42, S, 8, 0.8, H + 0.4);
    }
    // hip box with a rail over the top
    funbox(t, 22, -14, 0, 8, 5, 1.4, 4);
    polyRail(t, vis, [
      [16, -14],
      [28, -14],
    ], 1.4 + 0.4, 'rail', 'hiprail');
    // big air tabletop: kicker, table, landing
    kicker(t, 10, 36, E, 6, 1.2, 3.6);
    box(t, 18.6, 36, 0, 5, 3, 1.2, 'ramp');
    bank(t, 30.6, 36, W, 6, 1.2, 7);
    // a pair of step-up kickers
    kicker(t, 26, 20, E, 4, 0.9, 2.6);
    box(t, 36.5, 20, 0, 3, 2.5, 0.9, 'ramp');
    ledge(t, 30, -38, 0, 14, 0.8, 0.5);

    return {
      vis,
      spawn: { x: 0, z: M.deckZ + 8, heading: N },
      gaps: [
        { id: 'megagap', name: 'Mega Gap', points: 1500, from: rect(-3, M.kickToe - M.kickL, 3, M.kickToe), to: rect(-5, M.landTop - M.landL - 3, 5, M.landTop) },
        { id: 'megagap2', name: 'Mega Gap Knuckle', points: 700, from: rect(-3, M.kickToe - M.kickL, 3, M.kickToe), to: rect(-5, M.landTop, 5, M.landTop + M.landDeck) },
        { id: 'megastair', name: 'Mega 12-Stair', points: 900, from: rect(50, -46, 66, -34), to: rect(50, -28.6, 66, -18) },
        { id: 'spine', name: 'Big Spine Transfer', points: 400, from: rect(-35, -54, -17, -50.05), to: rect(-35, -49.95, -17, -46) },
        { id: 'spine', name: 'Big Spine Transfer', points: 400, from: rect(-35, -49.95, -17, -46), to: rect(-35, -54, -17, -50.05) },
        { id: 'hipgap', name: 'Hip Transfer', points: 300, from: rect(14, -19, 30, -16.5), to: rect(14, -11.5, 30, -9) },
        { id: 'tabletop', name: 'Tabletop', points: 350, from: rect(10, 33, 13.6, 39), to: rect(23.6, 33, 32, 39) },
        { id: 'stepup', name: 'Step-Up', points: 250, from: rect(26, 18, 28.6, 22), to: rect(33.5, 17.5, 39.5, 22.5) },
      ],
      letters: [],
      tape: V(0, -10, 0),
      props: [],
    };
  },
  decorate(group, mats) {
    // grandstands behind the north and east walls
    const r = rng(41);
    const seats: THREE.BufferGeometry[] = [];
    const crowd: THREE.BufferGeometry[] = [];
    const colors: number[] = [];
    const palette = [0xe04a3b, 0x1d2f5c, 0x3a6fb0, 0x009c3b, 0xffdf00, 0xfaf9f5, 0x141413, 0xff9933];
    for (let row = 0; row < 8; row++) {
      const off = 77 + row * 1.6;
      const y = 1.2 + row * 1.2;
      seats.push(new THREE.BoxGeometry(150, 0.5, 1.4).translate(0, y, -off));
      seats.push(new THREE.BoxGeometry(1.4, 0.5, 150).translate(off, y, 0));
      for (let a = -74; a < 74; a += 0.9) {
        for (const side of [0, 1]) {
          if (r() < 0.3) continue;
          const g = new THREE.BoxGeometry(0.5, 0.9, 0.4);
          if (side === 0) g.translate(a + r() * 0.3, y + 0.7, -off);
          else g.rotateY(Math.PI / 2).translate(off, y + 0.7, a + r() * 0.3);
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

    // banners
    const banner = new THREE.MeshBasicMaterial({ map: textTexture('MEGA PARK · BIG AIR', '#FAF9F5', '#E04A3B', 1024, 128, 'bold 72px Georgia, serif') });
    for (const [x, z, ry] of [
      [0, -73.9, 0],
      [-40, -73.9, 0],
      [40, -73.9, 0],
      [73.9, -30, -Math.PI / 2],
      [73.9, 30, -Math.PI / 2],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), banner);
      m.position.set(x, 5.6, z);
      m.rotation.y = ry;
      group.add(m);
    }
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), banner);
    deck.position.set(0, MEGA.deckH - 1.1, MEGA.deckZ - 0.02);
    deck.rotation.y = Math.PI;
    group.add(deck);

    // flags on the tower and along the south wall
    flagpole(group, mats, -6.6, MEGA.deckZ + 11.5, MEGA.deckH, 'usa', 7);
    flagpole(group, mats, 6.6, MEGA.deckZ + 11.5, MEGA.deckH, 'brazil', 7);
    const nations = ['japan', 'uk', 'france', 'germany', 'southkorea', 'canada', 'australia', 'spain', 'sweden', 'argentina'];
    nations.forEach((f, i) => flagpole(group, mats, -66 + i * 14.6, 78, 0, f, 11, Math.PI));

    // light towers
    for (const [x, z] of [
      [-74, -74],
      [74, -74],
      [-74, 74],
      [74, 74],
    ]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 22, 8), mats.metal);
      pole.position.set(x * 1.05, 11, z * 1.05);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 1 }));
      head.position.set(x, 22, z);
      head.lookAt(0, 0, 0);
      group.add(head);
    }
  },
};
