import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ParkVisuals, box, kicker, bank, ledge, stairs, hubba, quarterPipe, rollIn } from '../park';
import { radiusFor, transitionRun, transitionHeight } from '../terrain';
import { Level, N, S, E, W, rect, polyRail, flagpole } from './common';
import { textTexture, rng } from '../textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The mega ramp, south to north: tower, roll-in, kicker, gap, landing, giant quarter. */
export const MEGA = {
  B: 118, // inner wall line
  deckH: 24,
  deckZ: 96, // north edge of the tower deck, where the roll-in starts
  rollDeg: 38,
  rollR: 14,
  width: 14,
  kickH: 2.6,
  kickL: 7.5,
  gap: 17, // kicker lip to knuckle
  landH: 7,
  landDeg: 25,
  landR: 14,
  landDeck: 10, // a long knuckle deck: come up short and you land on the table
  qpH: 8,
  qpR: 8.08, // just shy of true vert, so airs come straight back down
};

/** Superpipe: 6.5 m walls, fed by its own drop-in. */
export const PIPE = { x: -72, flat: 16, H: 6.5, R: 6.56, z0: -64, z1: 56, dropH: 11 };

/** Run length of a roll-in (see park.rollIn). */
export function rollRun(H: number, deg: number, R: number) {
  const th = (deg * Math.PI) / 180;
  return R * Math.sin(th) + (H - R * (1 - Math.cos(th))) / Math.tan(th);
}

/** Height of a roll-in's surface `s` metres from its toe. */
function rollProfile(H: number, deg: number, R: number, s: number) {
  const th = (deg * Math.PI) / 180;
  const s1 = R * Math.sin(th);
  const h1 = R * (1 - Math.cos(th));
  if (s <= s1) return transitionHeight(Math.max(0, s), R);
  return Math.min(H, h1 + (s - s1) * Math.tan(th));
}

/** Where the mega line's pieces sit along z (derived from MEGA). */
export function megaLine() {
  const M = MEGA;
  const rollToe = M.deckZ - rollRun(M.deckH, M.rollDeg, M.rollR);
  const kickToe = rollToe - 12;
  const lip = kickToe - M.kickL;
  const knuckle = lip - M.gap; // the landing deck runs north from here
  const landToe = knuckle - M.landDeck - rollRun(M.landH, M.landDeg, M.landR);
  const qpToe = landToe - 26;
  return { rollToe, kickToe, lip, knuckle, landToe, qpToe };
}

/**
 * The Mega Park: a free-skate playground with no ceiling. A 24 m mega ramp
 * (roll-in, kicker, 17 m gap, landing, 9 m quarter pipe), a superpipe with
 * its own drop-in, a giant bowl, a 4 m spine, a 16-stair, and rails up to
 * 100 m long. Lift pads carry you back to the top.
 */
export const megaLevel: Level = {
  id: 'mega',
  name: 'The Mega Park',
  chapter: 0,
  tagline: 'Free skate · 24 m mega ramp',
  blurb: 'A 24 m mega ramp, a superpipe, a giant bowl and 100 m rails. Lifts take you back up.',
  sky: '#D6E4F0',
  fog: [140, 390],
  ground: true,
  kind: 'free',
  runTime: 0,
  unlockAt: 0,
  objectNoun: '',
  goals: [],
  intro: { id: 'mega-intro', shots: [{ cam: [60, 40, 150], look: [0, 10, 40], dur: 3, title: 'The Mega Park' }] },
  outro: { id: 'mega-outro', shots: [{ cam: [60, 40, 150], look: [0, 10, 40], dur: 1 }] },
  build(t) {
    const vis: ParkVisuals = { copings: [], railPosts: [] };
    const M = MEGA;
    const L = megaLine();
    const B = M.B;
    box(t, 0, -B - 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, 0, B + 2, 0, B + 4, 2, 3.6, 'wall');
    box(t, -B - 2, 0, 0, 2, B + 4, 3.6, 'wall');
    box(t, B + 2, 0, 0, 2, B + 4, 3.6, 'wall');
    const coping = (q: ReturnType<typeof quarterPipe>) => {
      const P = (v: number) => V(q.el.cx + q.lipU * q.el.c - v * q.el.s, q.H, q.el.cz + q.lipU * q.el.s + v * q.el.c);
      vis.copings.push({ a: P(-q.el.hz), b: P(q.el.hz) });
    };
    const rail = (pts: [number, number, number][], tag: string, friction = 0.8) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = V(...pts[i]);
        const b = V(...pts[i + 1]);
        t.addRail(a, b, 'rail', tag, friction);
        vis.railPosts.push({ a, b });
      }
    };

    /* --- the mega ramp (centre, south to north) --- */
    const hw = M.width / 2;
    box(t, 0, M.deckZ + 8, 0, hw + 3, 8, M.deckH);
    rollIn(t, 0, L.rollToe, S, M.width, M.deckH, M.rollDeg, M.rollR);
    // mega rails down both sides of the roll-in, from the deck to the flat
    for (const sx of [1, -1]) {
      const x = sx * (hw + 0.6);
      const pts: [number, number, number][] = [[x, M.deckH + 0.6, M.deckZ + 5]];
      const run = M.deckZ - L.rollToe;
      for (let i = 0; i <= 12; i++) {
        const s = run * (1 - i / 12);
        pts.push([x, rollProfile(M.deckH, M.rollDeg, M.rollR, s) + 0.6, L.rollToe + s]);
      }
      pts.push([x, 0.6, L.rollToe - 6]);
      rail(pts, 'megarail');
    }
    kicker(t, 0, L.kickToe, N, 8, M.kickH, M.kickL);
    // landing: a knuckle deck, then a long curved landing ramp down to the flat
    box(t, 0, L.knuckle - M.landDeck / 2, 0, hw + 2, M.landDeck / 2, M.landH);
    rollIn(t, 0, L.landToe, S, M.width + 4, M.landH, M.landDeg, M.landR);
    // the gap's face is banked, so coming up short is a step-up, not a wall
    bank(t, 0, L.knuckle + 6, N, M.width + 4, M.landH, 6);
    // the giant quarter pipe at the end of the line
    coping(quarterPipe(t, 0, L.qpToe, N, 44, M.qpH, M.qpR, 6));
    // carry over the top and you ride the platform behind it and drop down the back
    {
      const back = L.qpToe - transitionRun(M.qpH, M.qpR) - 6;
      box(t, 0, back - 8, 0, 22, 8, M.qpH);
      rollIn(t, 0, back - 16 - rollRun(M.qpH, 30, 10), S, 44, M.qpH, 30, 10);
    }

    /* --- superpipe (west) with its own drop-in from the south --- */
    {
      const P = PIPE;
      const len = P.z1 - P.z0;
      const zc = (P.z0 + P.z1) / 2;
      coping(quarterPipe(t, P.x - P.flat / 2, zc, W, len, P.H, P.R, 5));
      coping(quarterPipe(t, P.x + P.flat / 2, zc, E, len, P.H, P.R, 5));
      rollIn(t, P.x, P.z1, S, P.flat, P.dropH, 32, 12, 10);
      // banks down the back of both decks
      const deckOut = P.flat / 2 + transitionRun(P.H, P.R) + 5;
      bank(t, P.x - deckOut - 14, zc, E, len, P.H, 14);
      bank(t, P.x + deckOut + 14, zc, W, len, P.H, 14);
      // and a quarter to catch you at the far end
      coping(quarterPipe(t, P.x, P.z0 - 2, N, P.flat, 4, 4.4, 2));
    }

    /* --- giant bowl (north-east) --- */
    t.bowls.push({ cx: 74, cz: 70, radius: 20, flat: 9, depth: 5.5, R: radiusFor(5.5, 11) });

    /* --- 4 m spine (between the pipe and the mega ramp) --- */
    {
      const H = 4;
      const R = 4.6;
      const w = transitionRun(H, R);
      const deck = 0.2;
      const x = -24;
      coping(quarterPipe(t, x + w + deck, -6, W, 40, H, R, deck));
      quarterPipe(t, x - w - deck, -6, E, 40, H, R, deck);
      vis.copings.pop();
      vis.copings.push({ a: V(x, H, -26), b: V(x, H, 14) });
    }

    /* --- the 100 m rail and the street section (east) --- */
    polyRail(t, vis, [
      [24, 72],
      [24, -28],
    ], 0.55, 'rail', 'longrail', 0.75);
    polyRail(t, vis, [
      [104, 30],
      [104, -12],
    ], 0.4, 'rail', 'flatbar');
    // the mega stair set: 4.4 m platform, 16 stairs, handrail and hubbas
    {
      const H = 4.4;
      const cx = 82;
      box(t, cx, -56, 0, 13, 9, H);
      bank(t, cx, -100, S, 22, H, 35);
      const st = stairs(t, cx, -47, S, 14, H, 16, 0.5);
      const z1 = -47 + st.L;
      const drop = 0.2 * (H / st.L);
      rail(
        [
          [cx, H + 0.55, -51],
          [cx, H + 0.55, -47],
          [cx, 0.55 - drop, z1 + 0.2],
          [cx, 0.55 - drop, z1 + 4],
        ],
        'stairrail',
      );
      hubba(t, cx + 8, -50, S, 1, 3, H, st.L, 0.5, 2);
      hubba(t, cx - 8, -50, S, 1, 3, H, st.L, 0.5, 2);
      ledge(t, cx, -62, 0, 18, 1, H + 0.45);
    }
    // big air tabletop
    kicker(t, 40, 16, E, 8, 1.6, 4.4);
    box(t, 54.4, 16, 0, 10, 4, 1.6, 'ramp');
    bank(t, 74.4, 16, W, 8, 1.6, 10);
    // step-up to a high deck and a drop back down
    kicker(t, 50, -14, E, 6, 1.2, 3.6);
    box(t, 64, -14, 0, 6, 4, 2.2);
    bank(t, 80, -14, W, 8, 2.2, 10);

    // wall quarters on the east and west walls
    coping(quarterPipe(t, B - transitionRun(3, 3.6) - 1.4, -20, E, 60, 3, 3.6));
    coping(quarterPipe(t, -B + transitionRun(3, 3.6) + 1.4, -96, W, 40, 3, 3.6));

    const tower = { x: 0, z: M.deckZ + 10, heading: N };
    const pipeTop = { x: PIPE.x, z: PIPE.z1 + rollRun(PIPE.dropH, 32, 12) + 6, heading: N };
    return {
      vis,
      spawn: tower,
      lifts: [
        { name: 'Up to the mega ramp tower', area: rect(18, 88, 30, 100), to: tower },
        { name: 'Up to the mega ramp tower', area: rect(-30, 88, -18, 100), to: tower },
        { name: 'Up to the superpipe drop-in', area: rect(-48, 64, -40, 76), to: pipeTop },
      ],
      gaps: [
        { id: 'megagap', name: 'MEGA GAP', points: 3000, from: rect(-4, L.lip, 4, L.kickToe), to: rect(-9, L.landToe - 4, 9, L.knuckle - M.landDeck) },
        { id: 'megaknuckle', name: 'Mega Gap (knuckle)', points: 1200, from: rect(-4, L.lip, 4, L.kickToe), to: rect(-9, L.knuckle - M.landDeck, 9, L.knuckle) },
        { id: 'spine', name: 'Big Spine Transfer', points: 600, from: rect(-30, -26, -24.05, 14), to: rect(-23.95, -26, -18, 14) },
        { id: 'spine', name: 'Big Spine Transfer', points: 600, from: rect(-23.95, -26, -18, 14), to: rect(-30, -26, -24.05, 14) },
        { id: 'stairs', name: 'Mega 16-Stair', points: 1500, from: rect(69, -65, 95, -47), to: rect(69, -39, 95, -20) },
        { id: 'tabletop', name: 'Big Air Tabletop', points: 500, from: rect(40, 12, 44.4, 20), to: rect(64.4, 12, 74.4, 20) },
        { id: 'stepup', name: 'Step-Up', points: 300, from: rect(50, -17, 53.6, -11), to: rect(58, -18, 70, -10) },
      ],
      letters: [],
      tape: V(0, -10, 0),
      props: [],
    };
  },
  decorate(group, mats, t) {
    const M = MEGA;
    const B = M.B;
    // grandstands behind the north, east and west walls
    const r = rng(41);
    const seats: THREE.BufferGeometry[] = [];
    const crowd: THREE.BufferGeometry[] = [];
    const colors: number[] = [];
    const palette = [0xe04a3b, 0x1d2f5c, 0x3a6fb0, 0x009c3b, 0xffdf00, 0xfaf9f5, 0x141413, 0xff9933];
    for (let row = 0; row < 12; row++) {
      const off = B + 5 + row * 1.6;
      const y = 1.2 + row * 1.3;
      seats.push(new THREE.BoxGeometry(2 * B, 0.5, 1.4).translate(0, y, -off));
      seats.push(new THREE.BoxGeometry(1.4, 0.5, 2 * B).translate(off, y, 0));
      seats.push(new THREE.BoxGeometry(1.4, 0.5, 2 * B).translate(-off, y, 0));
      for (let a = -B + 2; a < B - 2; a += 1.1) {
        for (const side of [0, 1, 2]) {
          if (r() < 0.35) continue;
          const g = new THREE.BoxGeometry(0.5, 0.9, 0.4);
          if (side === 0) g.translate(a + r() * 0.3, y + 0.7, -off);
          else g.rotateY(Math.PI / 2).translate(side === 1 ? off : -off, y + 0.7, a + r() * 0.3);
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

    // banners on the walls and the tower
    const banner = new THREE.MeshBasicMaterial({ map: textTexture('MEGA PARK · BIG AIR', '#FAF9F5', '#E04A3B', 1024, 128, 'bold 72px Georgia, serif'), side: THREE.DoubleSide });
    for (const [x, z, ry] of [
      [-60, -B - 1.9, 0],
      [0, -B - 1.9, 0],
      [60, -B - 1.9, 0],
      [B + 1.9, -60, -Math.PI / 2],
      [B + 1.9, 0, -Math.PI / 2],
      [-B - 1.9, 0, Math.PI / 2],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.6), banner);
      m.position.set(x, 5.8, z);
      m.rotation.y = ry;
      group.add(m);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.2), banner);
    back.position.set(0, M.deckH - 2, M.deckZ + 16.05);
    group.add(back);

    // red steel scaffolding under the tower and the roll-in
    const L = megaLine();
    const hw = M.width / 2;
    const steel: THREE.BufferGeometry[] = [];
    for (let z = L.rollToe + 6; z <= M.deckZ + 16; z += 4) {
      const onDeck = z >= M.deckZ;
      const h = onDeck ? M.deckH : rollProfile(M.deckH, M.rollDeg, M.rollR, z - L.rollToe);
      if (h < 2) continue;
      for (const sx of [-1, 1]) {
        const x = sx * (onDeck ? hw + 3.2 : hw + 0.2);
        steel.push(new THREE.BoxGeometry(0.35, h, 0.35).translate(x, h / 2, z));
        for (let y = 4; y < h - 1; y += 4) steel.push(new THREE.BoxGeometry(0.18, 0.18, 4).translate(x, y, z - 2));
      }
    }
    group.add(new THREE.Mesh(mergeGeometries(steel, false)!, new THREE.MeshStandardMaterial({ color: 0xb23a2c, roughness: 0.6, metalness: 0.4 })));

    // lift pads: glowing plates with an elevator mast
    const padMat = new THREE.MeshStandardMaterial({ map: textTexture('LIFT ▲', '#141413', '#FFD34D', 512, 256, 'bold 120px Georgia, serif'), emissive: 0xffc93a, emissiveIntensity: 0.35, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const mastMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.5, metalness: 0.3 });
    for (const [x, z, w, d, top] of [
      [24, 94, 12, 12, M.deckH],
      [-24, 94, 12, 12, M.deckH],
      [-44, 70, 8, 12, PIPE.dropH],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), padMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, t.height(x, z) + 0.02, z);
      group.add(m);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.6, top + 3, 0.6), mastMat);
      mast.position.set(x + Math.sign(x) * (w / 2 + 0.6), (top + 3) / 2, z + d / 2);
      group.add(mast);
    }

    // flags on the tower and along the south wall
    flagpole(group, mats, -hw - 2, M.deckZ + 15, M.deckH, 'usa', 8);
    flagpole(group, mats, hw + 2, M.deckZ + 15, M.deckH, 'brazil', 8);
    const nations = ['japan', 'uk', 'france', 'germany', 'southkorea', 'canada', 'australia', 'spain', 'sweden', 'argentina', 'italy', 'jamaica', 'southafrica'];
    nations.forEach((f, i) => flagpole(group, mats, -108 + i * 18, B + 6, 0, f, 13, Math.PI));

    // stadium light towers
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const px = x * (B + 26);
      const pz = z * (B + 26);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 40, 8), mats.metal);
      pole.position.set(px, 20, pz);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 1 }));
      head.position.set(px, 40, pz);
      head.lookAt(0, 0, 0);
      group.add(head);
    }
  },
};
