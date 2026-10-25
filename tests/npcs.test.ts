import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PARKS } from '../src/levels';
import { Terrain } from '../src/terrain';
import type { SkaterEvent } from '../src/skater';
import { NpcBrain, NpcStats, StyleId, buildFeatures, npcLimit, seeded } from '../src/npcai';
import { npcSetting } from '../src/settings';

const SECONDS = 60;
const STEP = 1 / 240;

/** What a crew got up to, read off the skaters' own events (the same ones the HUD would score). */
interface Session {
  stats: NpcStats;
  /** trick and grind names landed */
  names: Map<string, number>;
  grinds: Set<string>;
  /** elements per combo (linked like the player's: less than 0.75 s on the ground between them) */
  combos: number[];
  closest: number;
  byStyle: Record<StyleId, NpcStats>;
}

const zero = (): NpcStats => ({ pops: 0, lands: 0, bails: 0, grinds: 0, tricks: 0, respawns: 0, attempts: 0, vert: 0, megas: 0, megaGaps: 0, transfers: 0, specials: 0, lifts: 0, seenRespawns: 0 });
const add = (a: NpcStats, b: NpcStats) => {
  for (const k of Object.keys(a) as (keyof NpcStats)[]) a[k] += b[k];
};

function ride(L: (typeof PARKS)[number], seed: number, seconds: number, styles?: StyleId[]): Session {
  const t = new Terrain();
  const data = L.build(t);
  const feats = buildFeatures(t, data);
  assert.ok(feats.length >= 5, `only ${feats.length} features`);
  for (const f of feats) assert.ok(isFinite(f.sx + f.sz + f.dx + f.dz + f.at + f.speed), 'feature is finite');
  // the player stands at the spawn (by the lifts on a lift park: the mega ramp tower is where everyone drops in)
  const lift = data.lifts?.[0];
  const px = lift ? (lift.area.x0 + lift.area.x1) / 2 + 12 : data.spawn.x;
  const pz = lift ? (lift.area.z0 + lift.area.z1) / 2 : data.spawn.z;
  const player = new THREE.Vector3(px, t.height(px, pz), pz);
  const bots = [0, 1, 2].map((i) => new NpcBrain(t, feats, i, seeded(seed + i * 31 + L.chapter * 7), data.spawn, styles?.[i]));
  const world = { others: [{ pos: player, vel: new THREE.Vector3() }, ...bots.map((b) => ({ pos: b.sk.pos, vel: b.sk.vel }))], player, visible: () => false };
  for (const b of bots) b.respawnNow(world);
  const lim = npcLimit(t);
  const s: Session = { stats: zero(), names: new Map(), grinds: new Set(), combos: [], closest: Infinity, byStyle: { street: zero(), vert: zero(), tech: zero() } };
  const combo = bots.map(() => ({ n: 0, ground: 0 }));
  const name = (n: string) => s.names.set(n, (s.names.get(n) ?? 0) + 1);
  for (let i = 0; i < seconds * 240; i++) {
    for (let k = 0; k < bots.length; k++) {
      const b = bots[k];
      const c = combo[k];
      b.step(STEP, world);
      for (const e of b.sk.events as SkaterEvent[]) {
        if (e.type === 'land' || e.type === 'grindStart') {
          for (const r of e.tricks) name(r.name);
          c.n += e.tricks.length;
          c.ground = 0;
        } else if (e.type === 'grindEnd') {
          name(e.record.name);
          s.grinds.add(e.record.name);
          c.n++;
        } else if (e.type === 'revert') c.n++;
        else if (e.type === 'bail') c.n = 0;
      }
      b.sk.events.length = 0;
      if (b.sk.mode === 'ground' && (c.ground += STEP) > 0.75) {
        if (c.n > 0) s.combos.push(c.n);
        c.n = 0;
      }
      const p = b.sk.mode === 'bail' ? b.sk.bpos : b.sk.pos;
      assert.ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.z) && isFinite(b.sk.vel.x), 'NaN');
      assert.ok(Math.abs(p.x) <= lim && Math.abs(p.z) <= lim, `off the map at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      if (i > 240 * 5 && b.sk.mode === 'ground') s.closest = Math.min(s.closest, Math.hypot(p.x - player.x, p.z - player.z));
    }
  }
  for (const b of bots) {
    add(s.stats, b.stats);
    add(s.byStyle[b.style.id], b.stats);
  }
  return s;
}

const all: Session[] = [];
const total = zero();
const names = new Map<string, number>();
const grinds = new Set<string>();
const combos: number[] = [];
const byStyle: Record<StyleId, NpcStats> = { street: zero(), vert: zero(), tech: zero() };

for (const L of PARKS) {
  test(`NPCs session ${L.name}: stay on the map, never NaN, pop, land and grind`, () => {
    const s = ride(L, 99, SECONDS);
    all.push(s);
    add(total, s.stats);
    for (const [n, v] of s.names) names.set(n, (names.get(n) ?? 0) + v);
    for (const g of s.grinds) grinds.add(g);
    combos.push(...s.combos);
    for (const k of Object.keys(byStyle) as StyleId[]) add(byStyle[k], s.byStyle[k]);
    const st = s.stats;
    assert.ok(st.pops >= 8, `pops ${st.pops}`);
    assert.ok(st.lands >= 6, `lands ${st.lands}`);
    assert.ok(st.attempts >= 4, `attempts ${st.attempts}`);
    assert.ok(s.closest > 0.8, `rode right through the player (${s.closest.toFixed(2)} m)`);
    assert.equal(st.seenRespawns, 0, 'popped back up in view of the camera');
  });
}

const count = (re: RegExp) => [...names].filter(([n]) => re.test(n)).reduce((a, [, v]) => a + v, 0);

test('NPCs across the parks: grinds of every kind, lines that link, tricks with some size, the odd slam', () => {
  assert.ok(total.grinds >= 20, `grinds ${total.grinds}`);
  assert.ok(grinds.size >= 5, `grind types: ${[...grinds].join(', ')}`);
  assert.ok(total.bails >= 3, `bails ${total.bails}`);
  const rate = total.bails / (total.bails + total.lands);
  assert.ok(rate > 0.04 && rate < 0.3, `bail rate ${rate.toFixed(2)}`);
  assert.ok(total.tricks > total.lands * 0.6, 'they do tricks, not just ollies off curbs');
  assert.ok(names.size >= 30, `only ${names.size} different tricks`);
  // lines: grind, pop out with a flip, land into the next...
  const linked = combos.filter((n) => n >= 3).length;
  assert.ok(linked >= 15, `${linked} combos of 3+ (of ${combos.length})`);
  assert.ok(Math.max(...combos) >= 5, `longest combo ${Math.max(...combos)}`);
  // flips, spins and grabs all show up
  assert.ok(count(/Kickflip|Heelflip|360 Flip|Hardflip|Impossible|Varial|Laser|Shove-it/) >= 30, 'flip tricks');
  assert.ok(count(/^(Nosegrab|Mute|Indy|Japan|Tailgrab|Stalefish|Melon|Method)$/) >= 8, 'grabs');
  assert.ok(count(/\b(180|360|540|720|900|1080)\b/) >= 10, 'spins');
});

test('NPCs go big on the big stuff: the mega ramp, vert airs, 540s and doubles', () => {
  // a crew of vert skaters at the Mega Park, a bit longer: they ride the lifts and drop in
  const mega = PARKS.find((L) => L.id === 'mega')!;
  const s = ride(mega, 7, 100, ['vert', 'vert', 'tech']);
  assert.ok(s.stats.lifts >= 1, `lifts ${s.stats.lifts}`);
  assert.ok(s.stats.megas >= 1, `mega ramp runs ${s.stats.megas}`);
  assert.ok(s.stats.megaGaps >= 1, `mega gaps ${s.stats.megaGaps}`);
  assert.ok(s.stats.vert >= 1, `vert airs ${s.stats.vert}`);
  // ...and the street parks' transitions get sessioned too
  assert.ok(total.vert >= 5, `vert airs in the parks ${total.vert}`);
  let big = 0;
  for (const [n, v] of s.names) if (/\b(540|720|900|1080)\b|Double|Triple|Samba|Bullet|Aurora|Southern/.test(n)) big += v;
  big += count(/\b(540|720|900|1080)\b|Double|Triple|Samba|Bullet|Aurora|Southern/);
  assert.ok(big >= 3, `big tricks ${big}`);
});

test('NPC styles: street skaters grind more, vert skaters air more', () => {
  const { street, vert } = byStyle;
  assert.ok(street.grinds > vert.grinds, `grinds street ${street.grinds} vs vert ${vert.grinds}`);
  assert.ok(vert.vert > street.vert, `vert airs vert ${vert.vert} vs street ${street.vert}`);
});

test('NPCs throw bigger tricks when the player is close and watching', () => {
  const L = PARKS[0];
  const t = new Terrain();
  const data = L.build(t);
  const b = new NpcBrain(t, buildFeatures(t, data), 0, seeded(3), data.spawn, 'tech');
  const size = (show: boolean) => {
    const bb = b as unknown as { showing: boolean; planAir(T: number, ctx: string): { spec: { flip: number; shove: number; wrap: number; special?: string }; catchAt: number; spin: number; late: unknown } };
    bb.showing = show;
    let n = 0;
    for (let i = 0; i < 3000; i++) {
      const p = bb.planAir(1.3, 'ramp');
      if (p.spec.special) n += 3;
      if (p.catchAt > 0.6) n++; // a double
      if (Math.abs(p.spin) > 3.5) n++; // 360+
      if (p.late) n++;
    }
    return n;
  };
  const calm = size(false);
  const show = size(true);
  assert.ok(show > calm * 1.15, `showing off ${show} vs ${calm}`);
});

test('NPC setting: Normal by default, Few on the low graphics tier, the player pick wins', () => {
  const o = { camera: 0, rider: 'solid' as const, autoRevert: true, recording: false, quality: 'auto' as const };
  assert.equal(npcSetting(o), 'normal');
  assert.equal(npcSetting(o, 'low'), 'few');
  assert.equal(npcSetting({ ...o, npcs: 'off' }, 'high'), 'off');
  assert.equal(npcSetting({ ...o, npcs: 'bogus' as never }), 'normal');
});
