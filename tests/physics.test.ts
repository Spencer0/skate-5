import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/terrain';
import { buildLayout } from '../src/park';
import { Skater, SkaterEvent, SkaterInput, TUNE } from '../src/skater';
import type { TrickSpec } from '../src/tricks';

const terrain = new Terrain();
buildLayout(terrain);

const idle: SkaterInput = { steer: 0, push: false, pushHold: false, brake: false, grindMod: 'none', crouch: false };

function rig(x: number, z: number, vx: number, vz: number) {
  const sk = new Skater(terrain);
  sk.spawn(x, z, Math.atan2(vz, vx));
  sk.vel.set(vx, 0, vz);
  const events: SkaterEvent[] = [];
  const run = (sec: number, inp: Partial<SkaterInput> = {}) => {
    for (let i = 0; i < Math.round(sec * 240); i++) {
      sk.step(1 / 240, { ...idle, ...inp });
      events.push(...sk.events);
      sk.events.length = 0;
    }
  };
  return { sk, events, run };
}

const spec = (flip: number, shove: number, wrap = 0): TrickSpec => ({ flip, shove, wrap, nollie: false, speed: 1, label: '' });
const types = (evs: SkaterEvent[]) => evs.map((e) => e.type);

test('ollie on flat lands clean', () => {
  const { sk, events, run } = rig(0, 40, 0, -5);
  run(0.1);
  assert.ok(sk.flick(spec(0, 0)));
  run(1);
  assert.equal(sk.mode, 'ground');
  const land = events.find((e) => e.type === 'land');
  assert.ok(land && land.type === 'land');
  assert.equal(land.tricks[0].name, 'Ollie');
});

test('kickflip caught on time is a perfect landing', () => {
  const { sk, events, run } = rig(0, 40, 0, -5);
  run(0.1);
  sk.flick(spec(1, 0));
  run(TUNE.beat);
  assert.ok(sk.catchBoard());
  run(1);
  const land = events.find((e) => e.type === 'land');
  assert.ok(land && land.type === 'land');
  assert.equal(land.quality, 'perfect');
  assert.equal(land.tricks[0].name, 'Kickflip');
});

test('uncaught kickflip bails', () => {
  const { events, run, sk } = rig(0, 40, 0, -5);
  run(0.1);
  sk.flick(spec(1, 0));
  run(1);
  const bail = events.find((e) => e.type === 'bail');
  assert.ok(bail && bail.type === 'bail');
  assert.equal(bail.reason, 'uncaught');
});

test('waiting longer makes a double kickflip off the jump box', () => {
  const { sk, events, run } = rig(-34, 36, 0, -7.5);
  run(1.1);
  sk.flick(spec(1, 0));
  run(TUNE.beat * 2);
  sk.catchBoard();
  run(1.5);
  const land = events.find((e) => e.type === 'land');
  assert.ok(land && land.type === 'land', types(events).join(','));
  assert.equal(land.tricks[0].name, 'Double Kickflip');
});

test('ollie onto a rail locks a 50-50 and grinds to the end', () => {
  const { sk, events, run } = rig(4, 28.6, 0, -5);
  run(0.02);
  sk.flick(spec(0, 0));
  run(0.7);
  assert.equal(sk.mode, 'grind');
  const start = events.find((e) => e.type === 'grindStart');
  assert.ok(start && start.type === 'grindStart');
  assert.equal(start.name, '50-50 Grind');
  run(3);
  assert.ok(types(events).includes('grindEnd'));
});

test('board angle picks boardslide, lipslide and feeble on a ledge', () => {
  const lock = (fx: number, fz: number) => {
    const { sk, events, run } = rig(24.45, 22, 2, -4);
    run(0.01);
    sk.flick(spec(0, 0));
    sk.fwd.set(fx, 0, fz).normalize();
    run(0.7);
    const s = events.find((e) => e.type === 'grindStart');
    return s && s.type === 'grindStart' ? s.name : 'none';
  };
  assert.equal(lock(1, 0), 'Boardslide');
  assert.equal(lock(-1, 0), 'Lipslide');
  assert.equal(lock(0.7, -0.7), 'Feeble Grind');
});

test('kinked rail grinds through all three segments', () => {
  const { sk, events, run } = rig(-65, -2, 6, 0);
  run(0.1);
  sk.pos.y = 0.8;
  run(0.2);
  sk.flick(spec(0, 0));
  run(1.6);
  const ends = events.filter((e) => e.type === 'grindEnd');
  assert.equal(ends.length, 1);
  assert.ok(sk.pos.x > -57, `stopped grinding at x=${sk.pos.x}`);
});

test('quarter pipe air comes back down into the ramp, not onto the deck', () => {
  const { sk, events, run } = rig(60, 0, 8.5, 0);
  let maxY = 0;
  for (let i = 0; i < 40; i++) {
    run(0.1);
    maxY = Math.max(maxY, sk.pos.y);
  }
  assert.ok(maxY > 1.6, `max height ${maxY}`);
  assert.ok(!types(events).includes('bail'), types(events).join(','));
  assert.ok(!types(events).includes('wall'), types(events).join(','));
  assert.ok(sk.vel.x < 0, 'should be rolling back out fakie');
});

test('riding into a ledge at speed bails', () => {
  const { events, run } = rig(20, 18, 6, 0);
  run(1.5);
  assert.ok(types(events).includes('bail'));
});
