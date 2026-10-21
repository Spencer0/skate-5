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

test('fuzz: random play never produces NaNs or escapes the park', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const specs = [spec(0, 0), spec(1, 0), spec(-1, 0), spec(0, -1), spec(1, -2), spec(-1, 2), spec(0, 0, 1), spec(1, 1)];
  for (let run = 0; run < 12; run++) {
    const { sk, run: step } = rig((rnd() - 0.5) * 120, (rnd() - 0.5) * 120, 0, 0);
    if (Math.abs(sk.pos.y) > 0.01) continue;
    const inp: SkaterInput = { ...idle };
    for (let i = 0; i < 1500; i++) {
      if (rnd() < 0.05) inp.steer = rnd() * 2 - 1;
      inp.pushHold = rnd() < 0.7;
      inp.brake = rnd() < 0.02;
      inp.grindMod = rnd() < 0.1 ? 'nose' : rnd() < 0.1 ? 'tail' : 'none';
      if (rnd() < 0.03) sk.flick(specs[Math.floor(rnd() * specs.length)]);
      if (rnd() < 0.06) sk.catchBoard();
      step(1 / 60, inp);
      for (const v of [sk.pos.x, sk.pos.y, sk.pos.z, sk.vel.x, sk.vel.y, sk.vel.z, sk.fwd.x, sk.fwd.z]) assert.ok(Number.isFinite(v), `NaN at run ${run} step ${i}`);
      assert.ok(Math.abs(sk.pos.x) < 76 && Math.abs(sk.pos.z) < 76, `escaped to ${sk.pos.x},${sk.pos.z}`);
      assert.ok(sk.pos.y > -3 && sk.pos.y < 12, `height ${sk.pos.y}`);
    }
  }
});
