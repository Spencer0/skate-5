import * as THREE from 'three';
import { buildLayout, parkDecor, SPAWN } from '../park';
import { Level, rect, tagRails } from './common';

export const parkLevel: Level = {
  id: 'park',
  name: 'Claude Park',
  tagline: 'Chapter 1 · Home turf',
  story:
    'Word is a crew from the city is coming to check out the new park. Before anyone takes you seriously you need ' +
    'footage. Learn the lines, land the basics, and find the six letters hidden around the park.',
  outro: 'The locals are hyped. Somebody mentions a fountain downtown that nobody has cleared yet…',
  sky: '#EFE7DA',
  fog: [45, 150],
  ground: true,
  unlockAt: 4,
  goals: [
    { id: 'jb', kind: 'gap', text: 'Clear the Jump Box gap', gap: 'jumpbox' },
    { id: 'jbkf', kind: 'gap', text: 'Kickflip the Jump Box gap', gap: 'jumpbox', trick: 'Kickflip' },
    { id: 'long', kind: 'grind', text: 'Grind 12m of the long flat rail', tag: 'longrail', dist: 12 },
    { id: 'six', kind: 'gap', text: 'Ollie down the 6-stair', gap: 'sixstair' },
    { id: 'air', kind: 'air', text: 'Get 1.8m of air out of a quarter pipe', height: 1.8 },
    { id: 'let', kind: 'letters', text: 'Collect C-L-A-U-D-E' },
    { id: 'combo', kind: 'combo', text: 'Land a 3,000 point combo', points: 3000 },
  ],
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
        { id: 'spine2', name: 'Spine Transfer', points: 300, from: rect(-8, -51.95, 8, -48), to: rect(-8, -55, 8, -52.05) },
        { id: 'platdrop', name: 'Platform Drop', points: 200, from: rect(29, -56, 31, -40), to: rect(20, -58, 29.5, -38) },
      ],
      letters: [
        new THREE.Vector3(-34, 2.4, 25.6), // C: over the jump box
        new THREE.Vector3(38, 1.6, -38.6), // L: down the 6-stair
        new THREE.Vector3(0, 3.6, -73.3), // A: vert air on the big QP (pop at the lip)
        new THREE.Vector3(-42, -1.9, -40), // U: bottom of the bowl
        new THREE.Vector3(14, 1.05, 9), // D: end of the long rail
        new THREE.Vector3(52, 1.9, 20), // E: top of the pyramid
      ],
    };
  },
  decorate(group, mats) {
    parkDecor(group, mats);
  },
};
