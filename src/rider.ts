import * as THREE from 'three';
import type { StatId } from './career';
import type { Skater } from './skater';
import { DECK } from './board';

/**
 * The riders, the skate intent a rider is posed from, and the IK they share.
 * Local frame = the board's base frame: +X nose, +Y up, +Z toe side (the
 * rider faces +Z, regular stance).
 */

export type RiderId = 'brock' | 'coral' | 'voss' | 'custom';
export type RiderStyle = 'ghost' | 'solid' | 'off';

export interface RiderDef {
  id: RiderId;
  name: string;
  title: string;
  desc: string;
  bias: Partial<Record<StatId, number>>;
  color: string; // card accent
}

export const RIDERS: RiderDef[] = [
  {
    id: 'brock',
    name: 'Brock Steele',
    title: 'The muscle',
    desc: 'Pops like a cannon and pushes like a freight train. Spins are… a work in progress.',
    bias: { ollie: 1, speed: 1, spin: -1, flip: -1 },
    color: '#D97757',
  },
  {
    id: 'coral',
    name: 'Coral Reyes',
    title: 'Beach local',
    desc: 'Grew up on the pier rail. Silky balance and quick spins, a little less raw speed.',
    bias: { balance: 1, spin: 1, speed: -1 },
    color: '#3FA7A0',
  },
  {
    id: 'voss',
    name: 'Dr. Elmer Voss',
    title: 'Retired physicist',
    desc: 'Has calculated the optimal flip rate. Knees disagree about ollie height.',
    bias: { flip: 2, balance: 1, ollie: -1, speed: -1 },
    color: '#6A9BCC',
  },
  {
    id: 'custom',
    name: 'Your skater',
    title: 'Create',
    desc: 'Pick the body, skin, hair, clothes and kicks. No strengths, no weaknesses, all yours.',
    bias: {},
    color: '#788C5D',
  },
];

export interface RiderState {
  crouch: number; // 0 stand .. 1 deep crouch
  tuck: number; // 0 feet on deck .. 1 knees up (board flipping underneath)
  lean: number; // rad, toward toe side positive
  push: number; // -1 none, else push stroke phase 0..1
  grind: number | null; // balance -1..1 when grinding
  air: boolean;
  time: number;
  /** richer cues for the full-body pose */
  act?: RiderAct;
}

export interface RiderAct {
  popT: number; // seconds since the pop, -1 when not in a popped air
  flip: number; // +1 kickflip, -1 heelflip, 0 none
  shove: number; // +1 FS, -1 BS, 0 none
  wrap: number; // impossible
  nollie: boolean;
  caught: boolean;
  catchT: number; // seconds since catch, -1 if none
  landT: number; // seconds since last landing
  pushAt: number; // physics time of the last push event
  pushHold: boolean; // push is held: keep kicking instead of stepping back on
  ground: boolean; // rolling on the ground (pushing is possible)
  clock: number; // physics time, for the footwork state machines
  speed: number; // board speed (m/s), for the planted push foot
  fakie?: boolean; // rolling backwards: look over the other shoulder
  special: boolean;
  /** Around the World: where the board is (rider frame) and how much each hand has it */
  orbit?: OrbitHold;
  /** grab in progress: which hand, where on the board, the tweak, and the 0..1 blend */
  grab?: { hand: 'front' | 'back'; x: number; z: number; pitch: number; roll: number; yaw: number; amt: number };
}

export const DECK_TOP = 0.088;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Two-bone IK: writes the middle joint and the (reach-clamped) end. */
export function ik(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3) {
  const d = tmpA.copy(target).sub(root);
  let L = d.length();
  const dir = L > 1e-5 ? d.divideScalar(L) : d.set(0, -1, 0);
  L = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, L));
  const x = (a * a - b * b + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = tmpB.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1);
  p.normalize();
  mid.copy(root).addScaledVector(dir, x).addScaledVector(p, h);
  end.copy(root).addScaledVector(dir, L);
}

export interface OrbitHold {
  x: number;
  y: number;
  z: number;
  l: number;
  r: number;
}
const orbitP = new THREE.Vector3();
const orbitQ = new THREE.Quaternion();
const orbitC = new THREE.Vector3();

/**
 * Around the World hand-off: the left hand (nose side) takes the board up and round
 * the nose side, the right hand takes it behind the back and round the tail side
 * and puts it back under the feet. Both have it for a moment behind the back.
 */
export function orbitHands(sk: Pick<Skater, 'orbitPose' | 'trick'>, out: OrbitHold = { x: 0, y: 0, z: 0, l: 0, r: 0 }): OrbitHold | undefined {
  const e = sk.orbitPose(orbitP, orbitQ);
  if (!e) return undefined;
  const u = sk.trick.orbit - Math.floor(sk.trick.orbit);
  const win = (a: number, b: number) => Math.max(0, Math.min(1, (u - a) / 0.08, (b - u) / 0.08));
  // the middle of the deck, a hand's width up the edge nearest the body
  orbitC.set(0, DECK.deckY, 0).applyQuaternion(orbitQ).add(orbitP);
  out.x = orbitC.x;
  out.y = orbitC.y;
  out.z = orbitC.z;
  out.l = e * (u < 0.1 ? 1 : win(0, 0.58));
  out.r = e * (u > 0.9 ? 1 : win(0.42, 1));
  return out;
}
