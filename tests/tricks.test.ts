import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, trickName, StickSample } from '../src/tricks';

/** Build a gesture from waypoints in stick radii (y up), sampled like a 60Hz touch screen. */
function gesture(points: [number, number][], perSeg = 5): StickSample[] {
  const out: StickSample[] = [];
  let t = 0;
  const push = (rx: number, ry: number) => {
    const m = Math.max(1, Math.hypot(rx, ry));
    out.push({ t, x: rx / m, y: ry / m, rx, ry });
    t += 1 / 60;
  };
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    for (let k = 0; k < perSeg; k++) push(ax + ((bx - ax) * k) / perSeg, ay + ((by - ay) * k) / perSeg);
  }
  const [lx, ly] = points[points.length - 1];
  push(lx, ly);
  return out;
}

function roll(fromDeg: number, toDeg: number, r = 1.1): [number, number][] {
  const pts: [number, number][] = [
    [0, 0],
    [0, -0.6],
  ];
  const n = Math.max(4, Math.round(Math.abs(toDeg - fromDeg) / 15));
  for (let i = 0; i <= n; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

const cases: [string, [number, number][], string | null, number?][] = [
  ['ollie', [[0, 0], [0, -1], [0, 1]], 'Ollie'],
  ['kickflip', [[0, 0], [0, -1], [-0.8, 0.8]], 'Kickflip'],
  ['heelflip', [[0, 0], [0, -1], [0.8, 0.8]], 'Heelflip'],
  // fast flicks overshoot the ring by a lot on small phones
  ['overshoot kickflip', [[0, 0], [0, -1.5], [-1.3, 1.5]], 'Kickflip', 2],
  ['overshoot heelflip', [[0, 0], [0.2, -1.5], [1.6, 1.8]], 'Heelflip', 2],
  ['pop shove-it', roll(-90, -180), 'Pop Shove-it', 1],
  ['fs pop shove-it', roll(-90, 0), 'FS Pop Shove-it', 1],
  ['varial kickflip', roll(-90, -225), 'Varial Kickflip', 1],
  ['varial heelflip', roll(-90, 45), 'Varial Heelflip', 1],
  ['360 shove-it', roll(-90, -270), '360 Shove-it', 1],
  ['fs 360 shove-it', roll(-90, 90), 'FS 360 Shove-it', 1],
  ['hardflip', roll(-90, 135), 'Hardflip', 1],
  ['inward heelflip', roll(-90, -315), 'Inward Heelflip', 1],
  ['360 flip', roll(-90, -360), '360 Flip', 1],
  ['laser flip', roll(-90, 180), 'Laser Flip', 1],
  ['impossible', roll(-90, -440), 'Impossible', 1],
  ['quick swipe up', [[0, 0], [0, 1.2]], 'Ollie', 3],
  ['released while loaded', [[0, 0], [0, -1], [0.1, -0.95]], null],
  ['tap', [[0, 0], [0.04, 0.03]], null],
];

for (const [name, pts, expected, per] of cases) {
  test(`gesture: ${name}`, () => {
    const spec = classify(gesture(pts, per ?? 5));
    assert.equal(spec ? spec.label : null, expected);
  });
}

test('nollie gestures mirror the tail grammar', () => {
  const spec = classify(gesture([[0, 0], [0, 1], [-0.8, -0.8]]));
  assert.ok(spec);
  assert.equal(spec.label, 'Kickflip');
  assert.equal(spec.nollie, true);
});

test('trick names compose from rotations', () => {
  const base = { wraps: 0, body: 0, nollie: false, fakie: false };
  assert.equal(trickName({ ...base, flips: 2, shoves: 0 }), 'Double Kickflip');
  assert.equal(trickName({ ...base, flips: 1, shoves: -2 }), '360 Flip');
  assert.equal(trickName({ ...base, flips: -1, shoves: 2 }), 'Laser Flip');
  assert.equal(trickName({ ...base, flips: 1, shoves: 1 }), 'Hardflip');
  assert.equal(trickName({ ...base, flips: 0, shoves: 0, body: 1 }), 'FS 180');
  assert.equal(trickName({ ...base, flips: 0, shoves: 2, body: 1 }), 'FS Bigspin');
  assert.equal(trickName({ ...base, flips: 1, shoves: 0, nollie: true }), 'Nollie Kickflip');
  assert.equal(trickName({ ...base, flips: -1, shoves: 0, fakie: true }), 'Fakie Heelflip');
});

test('grab directions map around the board', async () => {
  const { grabForDirection, GRABS } = await import('../src/tricks');
  const g = (a: number, c: number) => GRABS[grabForDirection(a, c)].name;
  assert.equal(g(1, 0), 'Nosegrab');
  assert.equal(g(-1, 0), 'Tailgrab');
  assert.equal(g(0, 1), 'Indy');
  assert.equal(g(0, -1), 'Melon');
  assert.equal(g(1, 1), 'Mute');
  assert.equal(g(-1, -1), 'Stalefish');
  assert.equal(g(1, -1), 'Method');
  assert.equal(g(-1, 1), 'Japan');
});
