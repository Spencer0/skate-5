import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PARKS } from '../src/levels';
import { Terrain } from '../src/terrain';
import { NpcBrain, NpcStats, buildFeatures, seeded } from '../src/npcai';
import { npcSetting } from '../src/settings';

const SECONDS = 60;
const total: NpcStats = { pops: 0, lands: 0, bails: 0, grinds: 0, tricks: 0, respawns: 0, attempts: 0 };

for (const L of PARKS) {
  test(`NPCs session ${L.name}: stay on the map, never NaN, pop, land and grind`, () => {
    const t = new Terrain();
    const data = L.build(t);
    const feats = buildFeatures(t, data);
    assert.ok(feats.length >= 5, `only ${feats.length} features`);
    for (const f of feats) assert.ok(isFinite(f.sx + f.sz + f.dx + f.dz + f.at + f.speed), 'feature is finite');
    // the player stands at the spawn; nobody may respawn where the camera "sees"
    const player = new THREE.Vector3(data.spawn.x, t.height(data.spawn.x, data.spawn.z), data.spawn.z);
    const bots = [0, 1, 2].map((i) => new NpcBrain(t, feats, i, seeded(99 + i * 31 + L.chapter * 7), data.spawn));
    const world = { others: [{ pos: player, vel: new THREE.Vector3() }, ...bots.map((b) => ({ pos: b.sk.pos, vel: b.sk.vel }))], player, visible: () => false };
    for (const b of bots) b.respawnNow(world);
    let closest = Infinity;
    for (let i = 0; i < SECONDS * 240; i++) {
      for (const b of bots) {
        b.step(1 / 240, world);
        b.sk.events.length = 0;
        const p = b.sk.mode === 'bail' ? b.sk.bpos : b.sk.pos;
        assert.ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.z) && isFinite(b.sk.vel.x), 'NaN');
        assert.ok(Math.abs(p.x) <= t.bounds && Math.abs(p.z) <= t.bounds, `off the map at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        if (i > 240 * 5 && b.sk.mode === 'ground') closest = Math.min(closest, Math.hypot(p.x - player.x, p.z - player.z));
      }
    }
    const s = bots.map((b) => b.stats);
    const sum = (k: keyof NpcStats) => s.reduce((a, x) => a + x[k], 0);
    for (const k of Object.keys(total) as (keyof NpcStats)[]) total[k] += sum(k);
    assert.ok(sum('pops') >= 8, `pops ${sum('pops')}`);
    assert.ok(sum('lands') >= 6, `lands ${sum('lands')}`);
    assert.ok(sum('attempts') >= 4, `attempts ${sum('attempts')}`);
    assert.ok(closest > 0.8, `rode right through the player (${closest.toFixed(2)} m)`);
  });
}

test('NPCs across the parks grind rails and slam now and then', () => {
  assert.ok(total.grinds >= 10, `grinds ${total.grinds}`);
  assert.ok(total.bails >= 2, `bails ${total.bails}`);
  const rate = total.bails / (total.bails + total.lands);
  assert.ok(rate < 0.35, `bail rate ${rate.toFixed(2)}`);
  assert.ok(total.tricks > total.lands * 0.5, 'they do tricks, not just ollies off curbs');
});

test('NPC setting: Normal by default, Few on the low graphics tier, the player pick wins', () => {
  const o = { camera: 0, rider: 'solid' as const, autoRevert: true, recording: false, quality: 'auto' as const };
  assert.equal(npcSetting(o), 'normal');
  assert.equal(npcSetting(o, 'low'), 'few');
  assert.equal(npcSetting({ ...o, npcs: 'off' }, 'high'), 'off');
  assert.equal(npcSetting({ ...o, npcs: 'bogus' as never }), 'normal');
});
