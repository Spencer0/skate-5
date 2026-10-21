/**
 * Flick-stick trick grammar (inspired by the Skate series).
 *
 * The trick pad is a floating stick: touch sets the centre. Pull DOWN to load
 * the tail (or UP to load the nose for nollies), then flick. What the finger
 * does after loading decides the board's spin rates:
 *
 *   straight through the centre ->  ollie / kickflip (up-left) / heelflip (up-right)
 *   roll around the rim         ->  shove-its, varials, hardflips, tre flips ...
 *
 * The board keeps rotating until the player taps to catch it, so the same
 * flick can become a double or triple if you wait.
 */

export interface TrickSpec {
  flip: number; // revolutions per "beat" around long axis (+kick, -heel)
  shove: number; // half-turns per beat around normal (+FS / CCW from above, -BS)
  wrap: number; // revolutions per beat end-over-end (impossible)
  nollie: boolean;
  speed: number; // flick speed multiplier 0.85..1.2
  label: string; // the gesture's "intended" trick (for the trick guide/debug)
}

export interface StickSample {
  t: number;
  x: number; // -1..1 (right +), clamped to the stick ring
  y: number; // -1..1 (up +)
  rx?: number; // unclamped, in stick radii
  ry?: number;
}

const DEG = 180 / Math.PI;

function ang(x: number, y: number) {
  return Math.atan2(y, x) * DEG; // 0 = right, 90 = up
}

function wrap180(a: number) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

export const PREP = 0.42;

/**
 * Classify a finished gesture. Returns null when the gesture should cancel
 * (released back at the loaded side, or never loaded).
 */
export function classify(samples: StickSample[]): TrickSpec | null {
  if (samples.length < 2) return null;
  // find the loading point
  let prepIdx = -1;
  let nollie = false;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.y < -PREP) {
      prepIdx = i;
      break;
    }
    if (s.y > PREP) {
      prepIdx = i;
      nollie = true;
      break;
    }
  }
  if (prepIdx < 0) return null;
  // mirror nollies so the grammar is identical
  const pts = samples.slice(prepIdx).map((s) => ({ t: s.t, x: s.x, y: nollie ? -s.y : s.y, rx: s.rx ?? s.x, ry: nollie ? -(s.ry ?? s.y) : s.ry ?? s.y }));
  // keep loading while the finger stays down; the flick starts at the deepest point
  let deepest = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].ry < pts[deepest].ry - 0.02) deepest = i;
    if (pts[i].y > -0.2) break;
  }
  const path = pts.slice(deepest);
  const end = path[path.length - 1];
  const endMag = Math.hypot(end.x, end.y);

  // quick swipe fallback: finger went straight up with no down-load first.
  if (nollie) {
    const dur = end.t - samples[0].t;
    const raw = samples[samples.length - 1];
    const minY = Math.min(...samples.map((s) => s.y));
    if (dur < 0.3 && raw.y > PREP && minY > -0.25) {
      return direct(ang(raw.x, raw.y), false, flickSpeed(samples));
    }
  }

  // flick speed from the last ~70ms
  const speed = flickSpeed(path);

  // How much did the path *turn*? A flick is a straight line however far it
  // overshoots the ring; a roll curves around it. Resample by distance so
  // jitter doesn't count as turning.
  let sweep = 0;
  {
    const step = 0.14;
    let ax = path[0].rx;
    let ay = path[0].ry;
    let lastHeading: number | null = null;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].rx - ax;
      const dy = path[i].ry - ay;
      if (Math.hypot(dx, dy) < step) continue;
      const h = ang(dx, dy);
      if (lastHeading !== null) sweep += wrap180(h - lastHeading);
      lastHeading = h;
      ax = path[i].rx;
      ay = path[i].ry;
    }
  }
  // turning clockwise (through the left side when starting at the bottom) = backside
  const rollL = -sweep;

  let endAng: number;
  if (endMag > 0.38) endAng = ang(end.x, end.y);
  else {
    // released near the centre: use the motion direction
    const prev = path[Math.max(0, path.length - 4)];
    const dx = end.x - prev.x;
    const dy = end.y - prev.y;
    if (Math.hypot(dx, dy) < 0.15) return null;
    endAng = ang(dx, dy);
  }

  if (Math.abs(rollL) < 55) return direct(endAng, nollie, speed);
  // rolling the rim is naturally slower than a straight flick; don't punish it
  return rolled(rollL, nollie, Math.max(1, speed));
}

function flickSpeed(path: StickSample[]) {
  const end = path[path.length - 1];
  let j = path.length - 1;
  while (j > 0 && end.t - path[j].t < 0.07) j--;
  const p = path[j];
  const dt = Math.max(0.016, end.t - p.t);
  const v = Math.hypot(end.x - p.x, end.y - p.y) / dt; // stick-radii per second
  // ~6/s is a lazy flick, ~20/s is snappy
  return Math.min(1.2, Math.max(0.85, 0.85 + (v - 6) * 0.025));
}

function spec(flip: number, shove: number, wrap: number, nollie: boolean, speed: number, label: string): TrickSpec {
  return { flip, shove, wrap, nollie, speed, label };
}

function direct(a: number, nollie: boolean, speed: number): TrickSpec | null {
  // a: 90 = up
  if (a >= 62 && a <= 118) return spec(0, 0, 0, nollie, speed, 'Ollie');
  if (a > 118 && a <= 168) return spec(1, 0, 0, nollie, speed, 'Kickflip');
  if (a >= 12 && a < 62) return spec(-1, 0, 0, nollie, speed, 'Heelflip');
  if (a > 168 || a <= -150) return spec(0, -1, 0, nollie, speed, 'Pop Shove-it');
  if (a < 12 && a >= -30) return spec(0, 1, 0, nollie, speed, 'FS Pop Shove-it');
  return null; // released on the loaded side: cancel
}

function rolled(r: number, nollie: boolean, speed: number): TrickSpec | null {
  const s = Math.sign(r);
  const a = Math.abs(r);
  // positive r = rolled through the left side = backside spin
  if (a < 115) return spec(0, -s, 0, nollie, speed, s > 0 ? 'Pop Shove-it' : 'FS Pop Shove-it');
  if (a < 160) return s > 0 ? spec(1, -1, 0, nollie, speed, 'Varial Kickflip') : spec(-1, 1, 0, nollie, speed, 'Varial Heelflip');
  if (a < 205) return spec(0, -2 * s, 0, nollie, speed, s > 0 ? '360 Shove-it' : 'FS 360 Shove-it');
  if (a < 252) return s > 0 ? spec(-1, -1, 0, nollie, speed, 'Inward Heelflip') : spec(1, 1, 0, nollie, speed, 'Hardflip');
  if (a < 315) return s > 0 ? spec(1, -2, 0, nollie, speed, '360 Flip') : spec(-1, 2, 0, nollie, speed, 'Laser Flip');
  return spec(0, 0, s, nollie, speed, 'Impossible');
}

/* ------------------------------------------------------------------ */
/* Naming + scoring                                                    */
/* ------------------------------------------------------------------ */

export interface TrickResult {
  flips: number; // signed whole revolutions (+kick)
  shoves: number; // signed half turns (+FS)
  wraps: number; // signed revolutions
  body: number; // signed half turns of body spin (+FS)
  nollie: boolean;
  fakie: boolean;
}

const MULT = ['', '', 'Double ', 'Triple ', 'Quad ', 'Quint '];

export function trickName(r: TrickResult): string {
  const f = Math.abs(r.flips);
  const kick = r.flips > 0;
  const sh = r.shoves;
  const ash = Math.abs(sh);
  const fs = sh > 0;
  let core = '';
  if (r.wraps !== 0) {
    core = (Math.abs(r.wraps) > 1 ? MULT[Math.min(5, Math.abs(r.wraps))] : '') + 'Impossible';
    if (f > 0) core += kick ? ' Kickflip' : ' Heelflip';
  } else if (f === 0) {
    if (ash === 0) core = r.body === 0 ? 'Ollie' : '';
    else if (ash === 1) core = fs ? 'FS Pop Shove-it' : 'Pop Shove-it';
    else core = (fs ? 'FS ' : '') + ash * 180 + ' Shove-it';
  } else {
    const m = MULT[Math.min(5, f)];
    if (ash === 0) core = m + (kick ? 'Kickflip' : 'Heelflip');
    else if (ash === 1) {
      if (kick) core = fs ? m + 'Hardflip' : m + 'Varial Kickflip';
      else core = fs ? m + 'Varial Heelflip' : m + 'Inward Heelflip';
    } else if (ash === 2) {
      if (kick) core = fs ? '360 Hardflip' : m + '360 Flip';
      else core = fs ? m + 'Laser Flip' : '360 Inward Heelflip';
      if (f > 1 && (fs ? kick : !kick)) core = m + core;
    } else {
      core = ash * 180 + ' ' + (fs ? 'FS ' : '') + m + (kick ? 'Flip' : 'Heelflip');
    }
  }
  // body spin
  let prefix = '';
  if (r.body !== 0) {
    const deg = Math.abs(r.body) * 180;
    const dir = r.body > 0 ? 'FS' : 'BS';
    // bigspin: 360 shove + 180 body in the same direction
    if (Math.abs(r.body) === 1 && ash === 2 && Math.sign(sh) === Math.sign(r.body) && r.wraps === 0) {
      core = f === 0 ? 'Bigspin' : 'Bigspin ' + (kick ? 'Flip' : 'Heelflip');
      prefix = dir + ' ';
    } else {
      prefix = `${dir} ${deg} `;
    }
  }
  let stance = '';
  if (r.nollie && !r.fakie) stance = 'Nollie ';
  else if (r.fakie && !r.nollie) stance = 'Fakie ';
  else if (r.fakie && r.nollie) stance = 'Switch ';
  let name = (stance + prefix + core).trim();
  if (!core) name = (stance + prefix).trim() || 'Ollie';
  return name.replace(/\s+/g, ' ');
}

export function trickPoints(r: TrickResult): number {
  let p = 100;
  p += Math.abs(r.flips) * 220;
  p += Math.abs(r.shoves) * 140;
  p += Math.abs(r.wraps) * 400;
  p += Math.abs(r.body) * 180;
  if (r.flips !== 0 && r.shoves !== 0) p += 150; // combo-axis bonus
  if (r.nollie || r.fakie) p = Math.round(p * 1.2);
  return p;
}

/* ------------------------------------------------------------------ */
/* Grinds                                                              */
/* ------------------------------------------------------------------ */

export type GrindFamily = 'parallel' | 'angled' | 'slide';
export type GrindMod = 'nose' | 'tail' | 'none';

export function grindName(fam: GrindFamily, mod: GrindMod, lip: boolean, ledge: boolean): string {
  if (fam === 'parallel') return mod === 'nose' ? 'Nosegrind' : mod === 'tail' ? '5-0 Grind' : '50-50 Grind';
  if (fam === 'angled') return mod === 'nose' ? 'Crooked Grind' : mod === 'tail' ? 'Smith Grind' : 'Feeble Grind';
  if (mod === 'nose') return 'Noseslide';
  if (mod === 'tail') return 'Tailslide';
  return lip ? 'Lipslide' : ledge ? 'Boardslide' : 'Boardslide';
}

export function grindBasePoints(fam: GrindFamily, mod: GrindMod) {
  let p = fam === 'parallel' ? 150 : fam === 'angled' ? 250 : 220;
  if (mod !== 'none') p += 80;
  return p;
}

/* ------------------------------------------------------------------ */
/* Trick guide data                                                    */
/* ------------------------------------------------------------------ */

export interface GuideEntry {
  name: string;
  path: [number, number][]; // stick coords, y up
  note?: string;
}

function arcPts(fromDeg: number, toDeg: number, n = 14): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

const C: [number, number] = [0, 0];
const Sx: [number, number] = [0, -1];

export const GUIDE: GuideEntry[] = [
  { name: 'Ollie', path: [C, Sx, [0, 1]], note: 'down, then flick up' },
  { name: 'Kickflip', path: [C, Sx, [-0.72, 0.72]], note: 'down, flick up-left' },
  { name: 'Heelflip', path: [C, Sx, [0.72, 0.72]], note: 'down, flick up-right' },
  { name: 'Pop Shove-it', path: [C, ...arcPts(-90, -180, 8)], note: 'roll down → left' },
  { name: 'FS Pop Shove-it', path: [C, ...arcPts(-90, 0, 8)], note: 'roll down → right' },
  { name: 'Varial Kickflip', path: [C, ...arcPts(-90, -225, 10)], note: 'roll down → up-left' },
  { name: 'Varial Heelflip', path: [C, ...arcPts(-90, 45, 10)], note: 'roll down → up-right' },
  { name: '360 Shove-it', path: [C, ...arcPts(-90, -270, 14)], note: 'roll left to the top' },
  { name: 'FS 360 Shove-it', path: [C, ...arcPts(-90, 90, 14)], note: 'roll right to the top' },
  { name: 'Hardflip', path: [C, ...arcPts(-90, 135, 16)], note: 'roll right, past the top' },
  { name: 'Inward Heelflip', path: [C, ...arcPts(-90, -315, 16)], note: 'roll left, past the top' },
  { name: '360 Flip', path: [C, ...arcPts(-90, -360, 18)], note: 'roll left ¾ to the right' },
  { name: 'Laser Flip', path: [C, ...arcPts(-90, 180, 18)], note: 'roll right ¾ to the left' },
  { name: 'Impossible', path: [C, ...arcPts(-90, -440, 24)], note: 'full circle' },
  { name: 'Nollie ___', path: [C, [0, 1], [0, -1]], note: 'load UP, flick down (mirrored)' },
];
