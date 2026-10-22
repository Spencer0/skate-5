import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/terrain';
import { Skater, SkaterEvent, SkaterInput } from '../src/skater';
import { LEVELS, PARKS, inRect } from '../src/levels';
import { megaLine } from '../src/levels/mega';
import type { TrickSpec } from '../src/tricks';

const idle: SkaterInput = { steer: 0, push: false, pushHold: false, brake: false, grindMod: 'none', crouch: false };
const spec = (flip: number, shove: number): TrickSpec => ({ flip, shove, wrap: 0, nollie: false, speed: 1, label: '' });

function level(id: string) {
  const L = PARKS.find((l) => l.id === id)!;
  const t = new Terrain();
  const data = L.build(t);
  return { L, t, data };
}

function rig(t: Terrain, x: number, z: number, vx: number, vz: number, y?: number) {
  const sk = new Skater(t);
  sk.spawn(x, z, Math.atan2(vz, vx));
  if (y !== undefined) sk.pos.y = y;
  sk.vel.set(vx, 0, vz);
  const events: SkaterEvent[] = [];
  let minGrindDist = 0;
  const run = (sec: number, inp: Partial<SkaterInput> = {}) => {
    for (let i = 0; i < Math.round(sec * 240); i++) {
      sk.step(1 / 240, { ...idle, ...inp });
      if (sk.grind) minGrindDist = Math.max(minGrindDist, sk.grind.dist);
      events.push(...sk.events);
      sk.events.length = 0;
    }
  };
  return { sk, events, run, grindDist: () => minGrindDist };
}

/** Run until the board pops off the lip of whatever it's riding up. */
function popAtLip(r: ReturnType<typeof rig>, s: TrickSpec, maxSec = 4) {
  for (let i = 0; i < maxSec * 240; i++) {
    r.run(1 / 240);
    const n = r.sk.groundN;
    if (r.sk.mode === 'ground' && r.sk.pos.y > 0.3 && n.y < 0.9) {
      // keep riding until just before the top
      const ahead = r.sk.terrain.height(r.sk.pos.x + r.sk.vel.x * 0.06, r.sk.pos.z + r.sk.vel.z * 0.06);
      if (ahead < r.sk.pos.y + 0.01) {
        r.sk.flick(s);
        return true;
      }
    }
  }
  return false;
}

test('fountain gap: pop off the kicker clears the fountain at push speed', () => {
  const { t, data } = level('plaza');
  const r = rig(t, 0, 16, 0, -8);
  assert.ok(popAtLip(r, spec(0, 0)));
  const takeoff = r.sk.pos.clone();
  r.run(2.5);
  const land = r.events.find((e) => e.type === 'land');
  assert.ok(land, r.events.map((e) => e.type).join(','));
  const gap = data.gaps.find((g) => g.id === 'fountain')!;
  assert.ok(inRect(gap.from, takeoff.x, takeoff.z), `takeoff ${takeoff.z}`);
  assert.ok(!r.events.some((e) => e.type === 'bail'), r.events.map((e) => e.type + ('reason' in e ? ':' + e.reason : '')).join(','));
});

test('fountain: rolling off the kicker without popping lands in the water', () => {
  const { t } = level('plaza');
  const r = rig(t, 0, 16, 0, -8);
  r.run(3);
  const bail = r.events.find((e) => e.type === 'bail');
  assert.ok(bail && bail.type === 'bail' && bail.reason === 'water', r.events.map((e) => e.type).join(','));
});

test('fountain rim: a full lap is grindable', () => {
  const { t } = level('plaza');
  // approach tangentially just outside the rim and ollie onto it
  const r = rig(t, 2.0, 7, 0, -6);
  while (r.sk.pos.z > 2.9) r.run(1 / 240);
  r.sk.flick(spec(0, 0));
  for (let i = 0; i < 6 * 60; i++) {
    const b = r.sk.grind ? r.sk.grind.balance : 0;
    r.run(1 / 60, { steer: Math.max(-1, Math.min(1, -b * 3)) });
  }
  assert.ok(r.grindDist() > 12, `ground ${r.grindDist().toFixed(1)}m`);
});

test('pier gap: kicker pop clears the rotten planks', () => {
  const { t } = level('pier');
  const r = rig(t, 0, -12, 0, -7);
  assert.ok(popAtLip(r, spec(0, 0)));
  r.run(2.5);
  const desc = r.events.map((e) => e.type + ('reason' in e ? ':' + e.reason : '')).join(',') + ` z=${r.sk.pos.z.toFixed(1)}`;
  assert.ok(r.events.some((e) => e.type === 'land'), desc);
  assert.ok(!r.events.some((e) => e.type === 'bail'), desc);
  assert.ok(r.sk.pos.z < -30, desc);
});

test('pier: riding off the edge splashes into the sea', () => {
  const { t } = level('pier');
  const r = rig(t, 0, -40, 6, 0);
  r.run(2);
  const bail = r.events.find((e) => e.type === 'bail');
  assert.ok(bail && bail.type === 'bail' && bail.reason === 'water');
});

test('pier rail: 100m in one grind is possible', () => {
  const { t } = level('pier');
  const r = rig(t, 4.25, 16, 0.3, -8);
  r.run(0.03);
  r.sk.flick(spec(0, 0));
  // balance actively like a player would
  for (let i = 0; i < 40 * 60; i++) {
    const b = r.sk.grind ? r.sk.grind.balance : 0;
    r.run(1 / 60, { steer: Math.max(-1, Math.min(1, -b * 3)) });
    if (r.sk.mode !== 'grind' && r.grindDist() > 0) break;
  }
  assert.ok(r.grindDist() > 100, `ground ${r.grindDist().toFixed(1)}m`);
});

test('every level has its collectibles and a spawn on solid ground', () => {
  for (const L of PARKS) {
    const t = new Terrain();
    const d = L.build(t);
    if (L.kind === 'street') {
      assert.equal(d.letters.length, 6, L.id);
      assert.equal(d.props.length, 5, L.id);
      const w = t.waterAt(d.tape.x, d.tape.z);
      assert.ok(w === null || t.height(d.tape.x, d.tape.z) > w, `${L.id} tape over water`);
    }
    assert.equal(t.waterAt(d.spawn.x, d.spawn.z), null, L.id);
    const n = t.normal(d.spawn.x, d.spawn.z, d.tape.clone());
    assert.ok(n.y > 0.999, `${L.id} spawn not flat`);
    for (const g of L.goals) if (g.kind === 'gap') assert.ok(d.gaps.some((x) => x.id === g.gap), `${L.id}: missing gap ${g.gap}`);
    for (const g of L.goals) if (g.kind === 'grind') assert.ok(t.rails.some((r) => r.tag === g.tag), `${L.id}: missing rail ${g.tag}`);
  }
});

test('the Big Gap at the Classic is clearable with a pop', () => {
  const { t } = level('arena');
  const r = rig(t, -40 + 3, 14, 8, 0);
  assert.ok(popAtLip(r, spec(0, 0)));
  r.run(2.5);
  const desc = r.events.map((e) => e.type + ('reason' in e ? ':' + e.reason : '')).join(',') + ` x=${r.sk.pos.x.toFixed(1)}`;
  assert.ok(r.events.some((e) => e.type === 'land'), desc);
  assert.ok(!r.events.some((e) => e.type === 'bail'), desc);
  assert.ok(r.sk.pos.x > -19.3, desc);
});

test('secret tapes sit somewhere reachable (on or just above a surface)', () => {
  for (const L of LEVELS) {
    if (!L.goals.some((g) => g.kind === 'tape')) continue;
    const t = new Terrain();
    const d = L.build(t);
    const h = t.height(d.tape.x, d.tape.z);
    assert.ok(d.tape.y - h < 1.4 || L.id === 'plaza', `${L.id}: tape ${d.tape.y} over ${h}`);
  }
});

test('the story chapters come first in the park list; free parks have no goals', () => {
  assert.deepEqual(PARKS.slice(0, LEVELS.length), LEVELS);
  for (const L of PARKS.slice(LEVELS.length)) {
    assert.equal(L.kind, 'free', L.id);
    assert.equal(L.goals.length, 0, L.id);
  }
  assert.equal(new Set(PARKS.map((L) => L.id)).size, PARKS.length);
});

test('Mega Park: drop in from the tower, pop the kicker and clear the Mega Gap', () => {
  const { t, data } = level('mega');
  const M = megaLine();
  for (const v0 of [2, 6]) {
    const r = rig(t, data.spawn.x, data.spawn.z - 9, 0, -v0);
    // ride down the 24 m roll-in, then pop at the kicker lip
    while (r.sk.pos.z > M.kickToe) r.run(1 / 240);
    assert.ok(popAtLip(r, spec(0, 0)));
    const takeoff = r.sk.pos.clone();
    r.events.length = 0;
    for (let i = 0; i < 4 * 240 && !r.events.some((e) => e.type === 'land' || e.type === 'bail'); i++) r.run(1 / 240);
    const desc = r.events.map((e) => e.type + ('reason' in e ? ':' + e.reason : '')).join(',') + ` z=${r.sk.pos.z.toFixed(1)}`;
    assert.ok(r.events.some((e) => e.type === 'land'), desc);
    const gap = data.gaps.find((g) => g.id === 'megagap')!;
    assert.ok(inRect(gap.from, takeoff.x, takeoff.z), `takeoff ${takeoff.z}`);
    assert.ok(inRect(gap.to, r.sk.pos.x, r.sk.pos.z), desc);
    assert.ok(r.sk.maxAirY - r.sk.takeoff.y > 6, `air ${(r.sk.maxAirY - r.sk.takeoff.y).toFixed(2)}`);
    // ride it out into the giant quarter pipe and back
    r.run(4);
    assert.ok(!r.events.some((e) => e.type === 'bail'), r.events.map((e) => e.type + ('reason' in e ? ':' + e.reason : '')).join(','));
  }
});

test('Mega Park: rolling the kicker without a pop lands on the knuckle table', () => {
  const { t, data } = level('mega');
  const M = megaLine();
  const r = rig(t, data.spawn.x, data.spawn.z - 9, 0, -3);
  r.run(9);
  assert.ok(!r.events.some((e) => e.type === 'bail'), r.events.map((e) => e.type + ('reason' in e ? ':' + e.reason : '')).join(','));
  assert.ok(r.sk.pos.z < M.landToe, `z=${r.sk.pos.z.toFixed(1)}`);
});

test('lifts drop you on flat, solid ground', () => {
  for (const L of PARKS) {
    const t = new Terrain();
    const d = L.build(t);
    for (const l of d.lifts ?? []) {
      const n = t.normal(l.to.x, l.to.z, d.tape.clone());
      assert.ok(n.y > 0.999, `${L.id}: ${l.name}`);
      const cx = (l.area.x0 + l.area.x1) / 2;
      const cz = (l.area.z0 + l.area.z1) / 2;
      assert.equal(t.height(cx, cz), 0, `${L.id}: pad for ${l.name} isn't on the ground`);
    }
  }
});

test('pumping a transition gains speed on the way down', () => {
  const { t } = level('mega');
  let pumped = false;
  // start high on the superpipe's east wall, rolling down it
  const speed = (pump: boolean) => {
    const r = rig(t, -59, 0, -2, 0);
    for (let i = 0; i < 0.35 * 240; i++) {
      r.run(1 / 240, { pushHold: pump });
      pumped ||= r.sk.pumping;
    }
    assert.ok(r.sk.groundN.y < 0.94, 'still on the wall: no flat-ground push');
    return r.sk.vel.length();
  };
  assert.ok(speed(false) + 0.3 < speed(true));
  assert.ok(pumped, 'the rider should know it is pumping');
});
