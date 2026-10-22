// Scripted "players": each scene drives the game with real touch gestures.
const W = 540, H = 960;
const L = { x: 130, y: 760 };      // left thumb (steer / push)
const R = { x: 410, y: 700 };      // right thumb (tricks)

export const stat = (g) => g.sk(() => {
  const k = window.__skate.skater;
  return { m: k.mode, x: +k.pos.x.toFixed(2), y: +k.pos.y.toFixed(2), z: +k.pos.z.toFixed(2), v: +k.speed.toFixed(2), g: k.grind ? k.grind.rail.tag ?? 'rail' : null, bail: k.bailT };
});

/** hold the left thumb forward = keep pushing; steer by x offset (-1..1) */
export async function leftStick(g, steer = 0, push = true) {
  await g.touch('pointerdown', 1, L.x, L.y);
  await g.touch('pointermove', 1, L.x + steer * 56, L.y - (push ? 60 : 0));
}
export const leftSet = (g, steer, push = true) => g.touch('pointermove', 1, L.x + steer * 56, L.y - (push ? 60 : 0));
export const leftUp = (g) => g.touch('pointerup', 1, L.x, L.y);

/** a flick on the right pad, as a list of stick-space points (x right, y up, in radii) */
export async function flick(g, pts, frames = 1) {
  const r = 56;
  await g.touch('pointerdown', 2, R.x, R.y);
  for (const [x, y] of pts) {
    await g.touch('pointermove', 2, R.x + x * r, R.y - y * r);
    await g.tick();
  }
  await g.touch('pointerup', 2, R.x + pts[pts.length - 1][0] * r, R.y - pts[pts.length - 1][1] * r);
}
export const arc = (a0, a1, n = 10, rad = 1.4) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180;
  return [Math.cos(a) * rad, Math.sin(a) * rad];
});
export const tap = async (g, x = 300, y = 500) => { await g.touch('pointerdown', 3, x, y); await g.tick(); await g.touch('pointerup', 3, x, y); };
