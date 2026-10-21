import * as THREE from 'three';
import { buildLayout, parkDecor, SPAWN } from '../park';
import { Level, rect, tagRails, scoreGoals } from './common';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const parkLevel: Level = {
  id: 'park',
  name: 'Claude Park',
  chapter: 1,
  tagline: 'Chapter 1 · Home turf',
  blurb: 'The Spark team is scouting. Get footage at the local park and shut Dex up.',
  sky: '#EFE7DA',
  fog: [45, 150],
  ground: true,
  kind: 'street',
  runTime: 120,
  unlockAt: 6,
  objectNoun: 'No Skating signs',
  goals: [
    ...scoreGoals(5000, 15000, 40000),
    { id: 'let', kind: 'letters', text: 'Collect C-L-A-U-D-E', hint: 'All six letters in one run. Orange dots on the minimap.' },
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
        title: 'Claude Park',
        subtitle: 'Chapter 1 · Home turf',
        lines: [
          { who: 'mara', text: "So you're the kid everyone keeps talking about. The one with the flick." },
          { who: 'mara', text: "I'm Mara. I run the crew here. Welcome to Claude Park." },
        ],
      },
      {
        cam: [-24, 5, 36],
        cam2: [-27, 4, 30],
        look: [-34, 1, 24],
        dur: 4,
        lines: [
          { who: 'mara', text: "Here's the deal: the Spark team is scouting this summer. They want footage, not talk." },
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
          { who: 'mara', text: 'Somebody hid letters all over the park. C-L-A-U-D-E. Grab all six in one run.' },
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
          { who: 'mara', text: "Fountain Plaza. There's a gap over the fountain nobody has ever flipped." },
          { who: 'mara', text: 'Security is a guy named Pete. He takes long lunches. Let\'s go.' },
        ],
      },
    ],
  },
  build(t) {
    const vis = buildLayout(t);
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
        V(-34, 2.4, 25.6), // C: over the jump box
        V(38, 1.6, -38.6), // L: down the 6-stair
        V(0, 3.6, -73.3), // A: vert air on the big QP (pop at the lip)
        V(-42, -1.9, -40), // U: bottom of the bowl
        V(14, 1.05, 9), // D: end of the long rail
        V(52, 1.9, 20), // E: top of the pyramid
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
  decorate(group, mats) {
    parkDecor(group, mats);
  },
};
