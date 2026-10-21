import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, GoalTracker } from '../src/story';
import { LEVELS } from '../src/levels';

const park = LEVELS[0];
const plaza = LEVELS[1];

test('gap goals need the right gap, and the trick when one is named', () => {
  const p = new Progress();
  p.reset();
  const done: string[] = [];
  const tr = new GoalTracker(plaza, p, (g) => done.push(g.id));
  const fountain = { id: 'fountain', name: 'Fountain Gap', points: 600, from: { x0: 0, z0: 0, x1: 1, z1: 1 }, to: { x0: 0, z0: 0, x1: 1, z1: 1 } };
  tr.landed([{ name: 'Heelflip', points: 300, kind: 'trick' }], [fountain], 1);
  assert.deepEqual(done, ['fg']);
  tr.landed([{ name: 'Varial Kickflip', points: 500, kind: 'trick' }], [], 1);
  assert.deepEqual(done, ['fg'], 'kickflip without the gap does not count');
  tr.landed([{ name: 'Double Kickflip', points: 500, kind: 'trick' }], [fountain], 1);
  assert.deepEqual(done, ['fg', 'fgkf']);
});

test('grind goals match tag, distance and grind name', () => {
  const p = new Progress();
  p.reset();
  const done: string[] = [];
  const tr = new GoalTracker(plaza, p, (g) => done.push(g.id));
  tr.grinding('bigrail', 3, '50-50 Grind');
  assert.deepEqual(done, []);
  tr.grinding('bigrail', 3, 'Boardslide');
  assert.deepEqual(done, ['rail']);
});

test('chapters unlock in order', () => {
  const p = new Progress();
  p.reset();
  assert.equal(p.isUnlocked(1), false);
  for (const g of park.goals.slice(0, park.unlockAt)) p.complete(park, g.id);
  assert.equal(p.isUnlocked(1), true);
  assert.equal(p.isUnlocked(2), false);
});

test('letters goal completes on the sixth letter', () => {
  const p = new Progress();
  p.reset();
  const done: string[] = [];
  const tr = new GoalTracker(park, p, (g) => done.push(g.id));
  for (let i = 0; i < 6; i++) {
    p.collect(park, i);
    tr.letters(p.letters(park).length);
  }
  assert.deepEqual(done, ['let']);
});
