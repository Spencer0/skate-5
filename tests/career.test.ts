import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Career, GoalTracker, applyStats, SPECIALS } from '../src/career';
import { LEVELS } from '../src/levels';
import { TUNE } from '../src/skater';

const [park, plaza, , arena] = LEVELS;

test('every level has unique goal ids and enough goals to unlock the next', () => {
  for (const L of LEVELS) {
    const ids = L.goals.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, L.id);
    if (L.kind === 'street') assert.ok(L.goals.length >= L.unlockAt + 3, L.id);
  }
});

test('gap goals need the right gap, and the trick when one is named', () => {
  const c = new Career();
  c.reset();
  const done: string[] = [];
  const tr = new GoalTracker(plaza, c, (g) => done.push(g.id));
  const fountain = { id: 'fountain', name: 'Fountain Gap', points: 600, from: { x0: 0, z0: 0, x1: 1, z1: 1 }, to: { x0: 0, z0: 0, x1: 1, z1: 1 } };
  tr.landed([{ name: 'Heelflip', points: 300, kind: 'trick' }], [fountain], 1);
  assert.deepEqual(done, ['fg']);
  tr.landed([{ name: 'Varial Kickflip', points: 500, kind: 'trick' }], [], 1);
  assert.deepEqual(done, ['fg']);
  tr.landed([{ name: 'Double Kickflip', points: 500, kind: 'trick' }], [fountain], 1);
  assert.deepEqual(done, ['fg', 'fgkf']);
});

test('score, objects, letters and tape goals', () => {
  const c = new Career();
  c.reset();
  const done: string[] = [];
  const tr = new GoalTracker(park, c, (g) => done.push(g.id));
  tr.runScore(16000);
  assert.deepEqual(done, ['high', 'pro']);
  tr.objects(4);
  tr.objects(5);
  tr.letters(6);
  tr.tape();
  tr.comboBanked(100, 4);
  assert.deepEqual(done, ['high', 'pro', 'signs', 'let', 'tape', 'combo4']);
});

test('chapters unlock in order and stat points come from goals', () => {
  const c = new Career();
  c.reset();
  assert.equal(c.isUnlocked(1), false);
  for (const g of park.goals.slice(0, park.unlockAt)) c.complete(park, g.id);
  assert.equal(c.isUnlocked(1), true);
  assert.equal(c.isUnlocked(2), false);
  assert.equal(c.statPointsFree(), park.unlockAt);
  assert.ok(c.addStat('ollie', 1));
  assert.equal(c.statPointsFree(), park.unlockAt - 1);
});

test('medal goals: gold also counts silver and bronze', () => {
  const c = new Career();
  c.reset();
  const done: string[] = [];
  new GoalTracker(arena, c, (g) => done.push(g.id)).medal('gold');
  assert.deepEqual(done.sort(), ['bronze', 'gold', 'silver']);
});

test('stats nudge the tuning and stat 5 is stock', () => {
  const base = { ...TUNE };
  applyStats({ speed: 5, ollie: 5, spin: 5, flip: 5, balance: 5 });
  assert.equal(TUNE.popSpeed, base.popSpeed);
  applyStats({ speed: 10, ollie: 10, spin: 10, flip: 10, balance: 10 });
  assert.ok(TUNE.popSpeed > base.popSpeed && TUNE.beat < base.beat && TUNE.balance < base.balance);
  applyStats({ speed: 5, ollie: 5, spin: 5, flip: 5, balance: 5 });
});

test('specials unlock as goals pile up', () => {
  const c = new Career();
  c.reset();
  assert.equal(c.equippedSpecial(), null);
  for (const g of park.goals.slice(0, SPECIALS[0].needs)) c.complete(park, g.id);
  assert.equal(c.equippedSpecial()?.id, SPECIALS[0].id);
});
