import * as THREE from 'three';
import { buildLayout, parkDecor, SPAWN } from '../park';
import { Level, rect, tagRails, scoreGoals, LETTERS_GOAL } from './common';
import { Batch, grime, murals, palm, perimeter, wallBunting, wallCrowd } from './decor';
import { rng } from '../textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const parkLevel: Level = {
  id: 'park',
  name: 'Brazil Park',
  chapter: 1,
  tagline: 'Chapter 1 · Home turf',
  blurb: 'The Atlas team is scouting. Get footage at the local park and shut Dex up.',
  sky: '#F4DFC2',
  zenith: '#4F93D6',
  fog: [50, 330],
  ground: true,
  groundColor: 0xd9dcdd, // cool grey cement under the warm plywood ramps
  kind: 'street',
  runTime: 120,
  unlockAt: 6,
  objectNoun: 'No Skating signs',
  goals: [
    ...scoreGoals(5000, 15000, 40000),
    { id: 'let', kind: 'letters', text: LETTERS_GOAL, hint: 'All six letters in one run. Red dots on the minimap.' },
    { id: 'tape', kind: 'tape', text: 'Find the secret tape', hint: 'Way up high. Hold up on the left stick at a lip to carry onto the deck.', view: { cam: [-10, 5, -66], look: [-15, 2.8, -74.3] } },
    { id: 'signs', kind: 'objects', count: 5, text: 'Knock over 5 No Skating signs', hint: 'Skate, grind or air right through them. All five in one run.' },
    { id: 'jb', kind: 'gap', gap: 'jumpbox', text: 'Clear the Jump Box gap', hint: 'Pop at the lip of the kicker and clear the table.' },
    { id: 'six', kind: 'gap', gap: 'sixstair', trick: 'Kickflip', text: 'Kickflip the 6-stair', hint: 'Off the platform, down the stairs. Catch it before you land.' },
    { id: 'long', kind: 'grind', tag: 'longrail', dist: 12, text: 'Grind 12m of the long flat rail', hint: 'Keep your balance with the left thumb.', view: { cam: [18, 3, 34], look: [14, 0.5, 18] } },
    { id: 'air', kind: 'air', height: 1.8, text: 'Get 1.8m of air on a quarter pipe', hint: 'Ollie right at the lip of a quarter pipe.', view: { cam: [10, 4, -60], look: [0, 1.5, -72] } },
    { id: 'spine', kind: 'gap', gap: 'spine', text: 'Transfer the spine', hint: 'Ride straight up and over the spine to the other side.' },
    { id: 'combo4', kind: 'comboCount', count: 4, text: 'Land a 4-trick combo', hint: 'Land, then pop again quickly — or go trick, grind, trick.' },
    { id: 'tre', kind: 'trick', trick: '360 Flip', text: 'Land a 360 Flip', hint: 'Roll the trick stick three-quarters around to the left. See the Trick list.' },
  ],
  intro: {
    id: 'park-intro',
    shots: [
      {
        cam: [0, 34, 75],
        cam2: [0, 24, 48],
        look: [0, 0, 0],
        dur: 4,
        title: 'Brazil Park',
        subtitle: 'Chapter 1 · Home turf',
        lines: [
          { who: 'mara', text: "So you're the kid everyone keeps talking about. The one with the flick." },
          { who: 'mara', text: "I'm Mara. I run the crew here. Welcome to Brazil Park." },
        ],
      },
      {
        cam: [-24, 5, 36],
        cam2: [-27, 4, 30],
        look: [-34, 1, 24],
        dur: 4,
        lines: [
          { who: 'mara', text: "Here's the deal: the Atlas team is scouting this summer. They want footage, not talk." },
          { who: 'mara', text: 'Every session is two minutes. Land a goal and it stays landed, so chip away at them.' },
        ],
      },
      {
        cam: [47, 6, -29],
        cam2: [45, 5, -33],
        look: [38, 0.5, -40],
        dur: 4,
        lines: [
          { who: 'dex', text: "Footage? From this kid? I've skated this park since it was a parking lot." },
          { who: 'mara', text: "Ignore Dex. He's still mad he can't kickflip the six-stair." },
          { who: 'dex', text: '...I can. I just choose not to.' },
        ],
      },
      {
        cam: [60, 5, 28],
        cam2: [57, 4, 25],
        look: [52, 2, 20],
        dur: 3.5,
        lines: [
          { who: 'mara', text: 'Somebody hid letters all over the park. N-A-T-I-O-N. Grab all six in one run.' },
          { who: 'mara', text: "And the city put up No Skating signs. Five of them. You know what to do." },
        ],
      },
      {
        cam: [0, 4.5, 49],
        cam2: [0, 3, 44.5],
        look: [0, 0.3, 38],
        dur: 3,
        lines: [{ who: 'mara', text: 'Flick to pop. Tap again to catch the board. Land clean. Show me what you got.' }],
      },
    ],
  },
  outro: {
    id: 'park-outro',
    shots: [
      {
        cam: [6, 6, 50],
        cam2: [3, 4, 44],
        look: [0, 0.5, 36],
        dur: 4,
        title: 'Chapter 1 complete',
        lines: [
          { who: 'mara', text: "Okay. That's real footage. The crew is losing it." },
          { who: 'dex', text: 'Lucky. Anyone can look good at their home park. Try it downtown.' },
        ],
      },
      {
        cam: [-10, 8, 20],
        cam2: [-6, 10, 10],
        look: [0, 2, -20],
        dur: 4,
        lines: [
          { who: 'mara', text: "Plaza de España. There's a gap over the fountain nobody has ever flipped." },
          { who: 'mara', text: 'Security is a guy named Pete. He takes long lunches. Let\'s go.' },
        ],
      },
    ],
  },
  build(t) {
    const vis = buildLayout(t);
    // built ramps here are plywood; the bowls stay poured concrete
    for (const e of t.elements) if (e.mat === 'ramp') e.mat = 'ply';
    tagRails(t, rect(13, 5, 15, 31), 'longrail');
    tagRails(t, rect(37, -42, 39, -36), 'sixrail');
    return {
      vis,
      spawn: SPAWN,
      gaps: [
        { id: 'jumpbox', name: 'Jump Box Gap', points: 400, from: rect(-36, 27, -32, 31), to: rect(-37, 15, -31, 22.4) },
        { id: 'sixstair', name: '6-Stair', points: 500, from: rect(33, -46, 43, -40), to: rect(32, -37.2, 44, -28) },
        { id: 'spine', name: 'Spine Transfer', points: 300, from: rect(-8, -55, 8, -52.05), to: rect(-8, -51.95, 8, -48) },
        { id: 'spine', name: 'Spine Transfer', points: 300, from: rect(-8, -51.95, 8, -48), to: rect(-8, -55, 8, -52.05) },
        { id: 'platdrop', name: 'Platform Drop', points: 200, from: rect(29, -56, 31, -40), to: rect(20, -58, 29.5, -38) },
        { id: 'kinkdrop', name: 'Kinked Drop', points: 250, from: rect(-68, -9, -60, 5), to: rect(-58, -9, -48, 5) },
      ],
      letters: [
        V(-34, 2.4, 25.6), // N: over the jump box
        V(38, 1.6, -38.6), // A: down the 6-stair
        V(0, 3.6, -73.3), // T: vert air on the big QP (pop at the lip)
        V(-42, -1.9, -40), // I: bottom of the bowl
        V(14, 1.05, 9), // O: end of the long rail
        V(52, 1.9, 20), // N: top of the pyramid
      ],
      tape: V(-15, 3.2, -74.3),
      props: [
        { kind: 'sign', pos: V(29, 0, 4) },
        { kind: 'sign', pos: V(-38, 0, -40) },
        { kind: 'sign', pos: V(38, 0, -50) },
        { kind: 'sign', pos: V(-55, 0, 58.8) },
        { kind: 'sign', pos: V(3, 0, -17) },
      ],
    };
  },
  decorate(group, mats, t) {
    parkDecor(group, mats);
    const walls = perimeter(75, 3.6);
    grime(group, t, rect(-75, -75, 75, 75), 520, 11, { tags: ['#ffdf00', '#009c3b', '#3a6fb0'], avoid: [{ x: 0, z: 31, r: 7 }] });
    murals(group, t, walls, ['VAI BRASIL', 'SKATE', 'RIO', 'NAÇÕES'], [
      ['#ffdf00', '#009c3b', 'rgba(16,72,150,0.92)'],
      ['#ff7ac0', '#ff8a00', 'rgba(36,30,70,0.9)'],
      ['#8ff3ff', '#2a6fdb', 'rgba(255,206,0,0.92)'],
      ['#ffffff', '#e04a3b', 'rgba(20,120,80,0.92)'],
    ], 21);
    const life = new Batch();
    const shirts = [0xffdf00, 0x009c3b, 0x3a6fb0, 0xfaf9f5, 0xe04a3b, 0x141413, 0xff8a00, 0x7ec8e3];
    wallCrowd(life, t, walls, shirts, 0.55, 31);
    wallBunting(life, 77, 3.6, 15, [0x009c3b, 0xffdf00, 0x3a6fb0, 0xfaf9f5], 41);
    // palms among the trees outside the walls
    const r = rng(51);
    for (let i = 0; i < 26; i++) {
      const side = Math.floor(r() * 4);
      const along = (r() * 2 - 1) * 92;
      const out = 82 + r() * 14;
      const x = side === 0 ? along : side === 1 ? -along : side === 2 ? out : -out;
      const z = side === 0 ? out : side === 1 ? -out : side === 2 ? along : -along;
      palm(life, x, 0, z, 8 + r() * 5, 60 + i);
    }
    group.add(life.build({ side: THREE.DoubleSide }));
    rioSkyline(group);
  },
};

/** Hills of colourful houses to the north and Sugarloaf in the haze. */
function rioSkyline(group: THREE.Group) {
  const r = rng(71);
  const b = new Batch();
  // green hills
  for (const [x, z, sx, sy, sz] of [
    [-60, -230, 90, 38, 50],
    [50, -250, 110, 52, 60],
    [150, -215, 70, 30, 46],
    [-160, -200, 80, 34, 50],
  ]) {
    b.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(sx, sy, sz).translate(x, 0, z), 0x5f8a48);
  }
  // Sugarloaf: a tall rounded dome off to the side
  b.add(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(34, 95, 30).translate(150, 0, -300), 0x6b7a5c);
  b.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(26, 52, 24).translate(105, 0, -285), 0x71805f);
  // favela houses stacked up the hillsides
  const colors = [0xf2c14e, 0xe76f51, 0x2a9d8f, 0xf4a3b4, 0x8ecae6, 0xfaf9f5, 0xe9c46a, 0xd62828, 0x90be6d];
  for (const [hx, hz, sx, sy, sz] of [
    [-60, -230, 90, 38, 50],
    [50, -250, 110, 52, 60],
  ]) {
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI - Math.PI; // the face looking at the park
      const d = Math.sqrt(r()) * 0.92;
      const lx = Math.cos(a) * d;
      const lz = -Math.sin(a) * d;
      const top = Math.sqrt(Math.max(0, 1 - lx * lx - lz * lz));
      const x = hx + lx * sx;
      const z = hz + lz * sz;
      const w = 3 + r() * 4;
      const h = 3 + r() * 4;
      b.add(new THREE.BoxGeometry(w, h, 3 + r() * 3).translate(x, top * sy + h / 2 - 1, z), colors[Math.floor(r() * colors.length)]);
    }
  }
  group.add(b.build({ roughness: 1, flatShading: true }));
}
