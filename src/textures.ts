import * as THREE from 'three';
import { limits } from './quality';
import { FLAGS, flagDef } from './flags';

export const PALETTE = {
  accent: '#E04A3B',
  accentDark: '#B23427',
  navy: '#1D2F5C',
  gold: '#E8B547',
  cream: '#F0EEE6',
  ivory: '#FAF9F5',
  slate: '#141413',
  oat: '#E3DACC',
  cloud: '#BFB8AA',
  olive: '#788C5D',
  sky: '#6A9BCC',
};

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

/** Deterministic PRNG so the park looks the same every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseFill(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: number) {
  const img = g.createImageData(w, h);
  const r = rng(seed);
  for (let i = 0; i < w * h; i++) {
    const n = (r() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function blotches(g: CanvasRenderingContext2D, w: number, h: number, count: number, color: string, maxR: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = maxR * (0.3 + r() * 0.7);
    // draw wrapped so the texture tiles
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grd.addColorStop(0, color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
}

/** Ask for `want` taps of anisotropic filtering, within the graphics tier's cap. */
function aniso(t: THREE.Texture, want: number) {
  t.userData.anisotropy = want;
  t.anisotropy = Math.min(want, limits.anisotropy);
}

function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  aniso(t, 8);
  return t;
}

/** Ground concrete: 1 tile = 4m, with expansion joints on the tile border. */
export function concreteTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [196, 191, 182], 18, 1);
  blotches(g, S, S, 18, 'rgba(120,110,95,0.035)', 110, 2);
  blotches(g, S, S, 20, 'rgba(255,250,240,0.05)', 90, 3);
  // fine aggregate speckles
  const r = rng(4);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(90,85,78,0.25)' : 'rgba(255,255,255,0.25)';
    g.fillRect(r() * S, r() * S, 1.2, 1.2);
  }
  // joints
  g.fillStyle = 'rgba(70,64,58,0.55)';
  g.fillRect(0, 0, S, 3);
  g.fillRect(0, 0, 3, S);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 3, S, 1);
  g.fillRect(3, 0, 1, S);
  return tex(c);
}

/** Smooth, slightly warmer concrete for ramps. 1 tile = 3m. */
export function rampTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [214, 206, 192], 10, 11);
  blotches(g, S, S, 18, 'rgba(140,120,100,0.07)', 140, 12);
  blotches(g, S, S, 10, 'rgba(60,50,40,0.06)', 60, 13); // wheel marks
  const r = rng(14);
  g.strokeStyle = 'rgba(60,50,40,0.06)';
  g.lineWidth = 6;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const x = r() * S;
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 80, S * 0.3, x + (r() - 0.5) * 80, S * 0.7, x + (r() - 0.5) * 40, S);
    g.stroke();
  }
  return tex(c);
}

export function boxTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [200, 194, 184], 10, 21);
  blotches(g, S, S, 10, 'rgba(60,50,40,0.035)', 70, 22);
  blotches(g, S, S, 8, 'rgba(255,250,240,0.05)', 60, 23);
  return tex(c);
}

export function wallTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [226, 218, 204], 10, 31);
  // block wall courses
  g.strokeStyle = 'rgba(120,110,95,0.35)';
  g.lineWidth = 3;
  const bh = S / 8;
  for (let y = 0; y <= S; y += bh) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y);
    g.stroke();
    const off = (y / bh) % 2 === 0 ? 0 : S / 8;
    for (let x = off; x <= S; x += S / 4) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + bh);
      g.stroke();
    }
  }
  return tex(c);
}

export function gripTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [34, 33, 32], 34, 41);
  const r = rng(42);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.08})`;
    g.fillRect(r() * S, r() * S, 1, 1);
  }
  return tex(c);
}

/** The Atlas globe: a ring with a meridian grid. Line weight scales with R. */
export function drawGlobe(g: CanvasRenderingContext2D, x: number, y: number, R: number, color: string, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.strokeStyle = color;
  g.lineWidth = R * 0.09;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = R * 0.06;
  // meridians: ellipses squeezed toward the axis
  for (const k of [0.38, 0.75]) {
    g.beginPath();
    g.ellipse(0, 0, R * k, R, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, -R);
  g.lineTo(0, R);
  g.stroke();
  // parallels
  for (const t of [-0.5, 0, 0.5]) {
    const yy = t * R;
    const hw = Math.sqrt(R * R - yy * yy);
    g.beginPath();
    g.moveTo(-hw, yy);
    g.lineTo(hw, yy);
    g.stroke();
  }
  g.restore();
}

/** Eight-point compass rose, north up (or along `rot`). */
export function drawCompass(g: CanvasRenderingContext2D, x: number, y: number, R: number, main: string, light: string, rot = 0, label = true) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const point = (a: number, len: number, wid: number, colL: string, colR: string) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tip = [c * len, s * len];
    const l = [-s * wid, c * wid];
    g.fillStyle = colL;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(tip[0], tip[1]);
    g.lineTo(l[0], l[1]);
    g.closePath();
    g.fill();
    g.fillStyle = colR;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(tip[0], tip[1]);
    g.lineTo(-l[0], -l[1]);
    g.closePath();
    g.fill();
  };
  g.strokeStyle = main;
  g.lineWidth = R * 0.03;
  g.beginPath();
  g.arc(0, 0, R * 0.78, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, R * 0.6, R * 0.1, light, main);
  for (let i = 0; i < 4; i++) point(-Math.PI / 2 + (i * Math.PI) / 2, R, R * 0.16, main, light);
  if (label) {
    g.fillStyle = main;
    g.font = `bold ${R * 0.2}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', 0, -R * 1.14);
  }
  g.restore();
}

export function boardTopTexture() {
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W, H);
  noiseFill(g, W, H, [32, 31, 30], 30, 51);
  // a small globe cut into the griptape near the tail
  drawGlobe(g, W * 0.16, H * 0.5, H * 0.24, 'rgba(224,74,59,0.9)', 0.3);
  const r = rng(52);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.07})`;
    g.fillRect(r() * W, r() * H, 1, 1);
  }
  // scuffs where feet go
  blotches(g, W, H, 6, 'rgba(255,255,255,0.05)', 80, 53);
  const t = tex(c, false);
  aniso(t, 16);
  return t;
}

export function woodTexture() {
  const W = 256;
  const H = 32;
  const { c, g } = canvas(W, H);
  const plies = ['#e9d3a8', PALETTE.accent, '#e9d3a8', '#2d2a26', '#e9d3a8', PALETTE.navy, '#e9d3a8'];
  for (let i = 0; i < plies.length; i++) {
    g.fillStyle = plies[i];
    g.fillRect(0, (i * H) / plies.length, W, H / plies.length + 1);
  }
  return tex(c);
}


/** Radial blob for the contact shadow. */
export function shadowTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

/** Large painted compass rose for the park floor. */
export function groundCompassTexture() {
  const S = 1024;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  drawCompass(g, S / 2, S / 2 + S * 0.03, S * 0.4, 'rgba(224,74,59,0.88)', 'rgba(250,249,245,0.8)', 0.3);
  // weathering: knock out speckles
  g.globalCompositeOperation = 'destination-out';
  const r = rng(91);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.6})`;
    g.fillRect(r() * S, r() * S, 2 + r() * 4, 2 + r() * 4);
  }
  const t = tex(c, false);
  return t;
}


export function textTexture(text: string, color: string, bg: string, w = 1024, h = 256, font = 'bold 150px Georgia, serif') {
  const { c, g } = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 6);
  return tex(c, false);
}

/** The Atlas Skateboards billboard: navy, globe and wordmark. */
export function atlasBillboardTexture() {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = PALETTE.navy;
  g.fillRect(0, 0, W, H);
  g.fillStyle = PALETTE.accent;
  g.fillRect(0, H - 34, W, 34);
  drawGlobe(g, H * 0.5, H * 0.47, H * 0.3, PALETTE.cream, 0.25);
  g.fillStyle = PALETTE.cream;
  g.font = 'bold 150px Georgia, serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('ATLAS', H * 0.95, H * 0.44);
  g.font = '600 40px "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = PALETTE.accent;
  g.fillText('S K A T E B O A R D S', H * 0.98, H * 0.72);
  return tex(c, false);
}


/** Weathered boardwalk planks running along u. 1 tile = 3m. */
export function plankTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rng(61);
  const rows = 12;
  const h = S / rows;
  for (let i = 0; i < rows; i++) {
    const base = 150 + r() * 30;
    g.fillStyle = `rgb(${base + 20},${base - 5},${base - 40})`;
    g.fillRect(0, i * h, S, h);
    // grain
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(80,55,30,${0.05 + r() * 0.08})`;
      g.lineWidth = 1;
      const y = i * h + r() * h;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 6, S * 0.7, y + (r() - 0.5) * 6, S, y);
      g.stroke();
    }
    // butt joints
    const off = r() * S;
    g.fillStyle = 'rgba(40,28,18,0.6)';
    g.fillRect(off, i * h, 3, h);
    g.fillRect((off + S / 2) % S, i * h, 3, h);
    // gaps between planks
    g.fillStyle = 'rgba(30,20,12,0.75)';
    g.fillRect(0, i * h, S, 3);
  }
  // nails
  g.fillStyle = 'rgba(60,60,60,0.7)';
  for (let i = 0; i < rows; i++) for (const x of [S * 0.25, S * 0.75]) g.fillRect(x, i * h + h * 0.3, 3, 3), g.fillRect(x, i * h + h * 0.7, 3, 3);
  return tex(c);
}

/**
 * Skatepark plywood: one tile is a 2.44m square, two 1.22m sheets wide with
 * staggered butt joints, grain running up the transition, screw lines along
 * every seam and a darker polished lane where the wheels go.
 */
export function plywoodTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rng(81);
  const half = S / 2;
  for (let col = 0; col < 2; col++) {
    const x0 = col * half;
    const tone = [198, 158, 112].map((v) => v + (r() - 0.5) * 14);
    g.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;
    g.fillRect(x0, 0, half, S);
    // long grain streaks with the odd wavy figure
    for (let k = 0; k < 90; k++) {
      const x = x0 + r() * half;
      const dark = r() > 0.35;
      g.strokeStyle = dark ? `rgba(120,78,38,${0.06 + r() * 0.12})` : `rgba(255,230,190,${0.05 + r() * 0.08})`;
      g.lineWidth = 0.6 + r() * 2.2;
      const wob = (r() - 0.5) * 18;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + wob, S * 0.33, x - wob, S * 0.66, x, S);
      g.stroke();
    }
    // a couple of knots / patches per sheet
    for (let k = 0; k < 2; k++) {
      const kx = x0 + 20 + r() * (half - 40);
      const ky = r() * S;
      const grd = g.createRadialGradient(kx, ky, 0, kx, ky, 10 + r() * 8);
      grd.addColorStop(0, 'rgba(110,70,35,0.45)');
      grd.addColorStop(1, 'rgba(110,70,35,0)');
      g.fillStyle = grd;
      g.fillRect(kx - 20, ky - 20, 40, 40);
    }
  }
  // wheel wear: a darker, smoother lane down the middle of each sheet
  for (let col = 0; col < 2; col++) {
    const cx = col * half + half / 2;
    const grd = g.createLinearGradient(cx - half * 0.45, 0, cx + half * 0.45, 0);
    grd.addColorStop(0, 'rgba(70,45,25,0)');
    grd.addColorStop(0.5, 'rgba(70,45,25,0.12)');
    grd.addColorStop(1, 'rgba(70,45,25,0)');
    g.fillStyle = grd;
    g.fillRect(cx - half * 0.45, 0, half * 0.9, S);
  }
  blotches(g, S, S, 14, 'rgba(60,40,20,0.06)', 70, 82);
  // seams: between the two sheets, and staggered butt joints
  g.fillStyle = 'rgba(60,38,20,0.7)';
  g.fillRect(0, 0, 3, S);
  g.fillRect(half - 1, 0, 3, S);
  g.fillRect(0, 0, half, 3);
  g.fillRect(half, half - 1, half, 3);
  g.fillStyle = 'rgba(255,235,200,0.25)';
  g.fillRect(3, 0, 1, S);
  g.fillRect(half + 2, 0, 1, S);
  // screws along every seam
  g.fillStyle = 'rgba(70,66,60,0.8)';
  const step = S / 16;
  for (let y = step / 2; y < S; y += step) {
    for (const x of [8, half - 9, half + 7, S - 10]) g.fillRect(x, y, 3, 3);
  }
  for (let x = step / 2; x < S; x += step) {
    if (x < half) g.fillRect(x, 8, 3, 3), g.fillRect(x, S - 10, 3, 3);
    else g.fillRect(x, half - 10, 3, 3), g.fillRect(x, half + 7, 3, 3);
  }
  return tex(c);
}

/** Granite plaza pavers. 1 tile = 3m. */
export function paverTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [196, 188, 176], 16, 71);
  const r = rng(72);
  const n = 6;
  const w = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const t = (r() - 0.5) * 22;
      g.fillStyle = `rgba(${t > 0 ? 255 : 0},${t > 0 ? 250 : 0},${t > 0 ? 240 : 0},${Math.abs(t) / 255})`;
      const off = j % 2 ? w / 2 : 0;
      g.fillRect(i * w + off, j * w, w, w);
      g.fillRect(i * w + off - S, j * w, w, w);
    }
  }
  g.strokeStyle = 'rgba(90,82,72,0.6)';
  g.lineWidth = 3;
  for (let j = 0; j <= n; j++) {
    g.beginPath();
    g.moveTo(0, j * w);
    g.lineTo(S, j * w);
    g.stroke();
    const off = j % 2 ? w / 2 : 0;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * w + off, j * w);
      g.lineTo(i * w + off, j * w + w);
      g.stroke();
    }
  }
  return tex(c);
}

export function waterTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#3f8a9c';
  g.fillRect(0, 0, S, S);
  const r = rng(81);
  for (let i = 0; i < 160; i++) {
    const x = r() * S;
    const y = r() * S;
    const l = 8 + r() * 24;
    g.strokeStyle = `rgba(255,255,255,${0.06 + r() * 0.16})`;
    g.lineWidth = 1.5;
    for (const ox of [-S, 0, S]) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.quadraticCurveTo(x + ox + l / 2, y - 3, x + ox + l, y);
      g.stroke();
    }
  }
  blotches(g, S, S, 10, 'rgba(20,70,90,0.25)', 60, 82);
  return tex(c);
}

/** Building facade: rows of windows. 1 tile = 6m. */
export function facadeTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  noiseFill(g, S, S, [222, 208, 188], 10, 91);
  const r = rng(92);
  const cols = 4;
  const rows = 2;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i + 0.2) * (S / cols);
      const y = (j + 0.18) * (S / rows);
      const w = S / cols * 0.6;
      const h = S / rows * 0.55;
      g.fillStyle = '#6f6a63';
      g.fillRect(x - 4, y - 4, w + 8, h + 8);
      const lit = r() > 0.6;
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, lit ? '#f3d9a8' : '#7d97a8');
      grd.addColorStop(1, lit ? '#d9a86c' : '#45596a');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x + w * 0.48, y, 3, h);
    }
  }
  return tex(c);
}


/** A collectible letter: red disc with a cream serif letter. */
export function letterTexture(ch: string) {
  const S = 256;
  const { c, g } = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,214,170,0.9)');
  grd.addColorStop(0.7, 'rgba(224,74,59,0.55)');
  grd.addColorStop(1, 'rgba(224,74,59,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.fillStyle = PALETTE.accent;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.34, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = PALETTE.ivory;
  g.stroke();
  g.fillStyle = PALETTE.ivory;
  g.font = 'bold 130px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, S / 2, S / 2 + 8);
  const t = tex(c, false);
  return t;
}

type Ctx = CanvasRenderingContext2D;

/** Airmail envelope border: red and blue slanted dashes. */
function airmailBorder(g: Ctx, W: number, H: number, band: number) {
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.rect(band, band, W - band * 2, H - band * 2);
  g.clip('evenodd');
  const step = band * 1.6;
  for (let i = -4, k = 0; i * step < W + H; i++, k++) {
    g.fillStyle = k % 2 === 0 ? '#C8312B' : k % 4 === 1 ? '#FAF9F5' : '#21468B';
    g.beginPath();
    const x = i * step;
    g.moveTo(x, 0);
    g.lineTo(x + step, 0);
    g.lineTo(x + step - H, H);
    g.lineTo(x - H, H);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** A round passport stamp with a word round the rim. */
function stamp(g: Ctx, x: number, y: number, R: number, word: string, inner: string, col: string, rot: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = R * 0.06;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = R * 0.03;
  g.beginPath();
  g.arc(0, 0, R * 0.68, 0, Math.PI * 2);
  g.stroke();
  g.font = `bold ${R * 0.22}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const span = Math.min(Math.PI * 1.6, word.length * 0.32);
  for (let i = 0; i < word.length; i++) {
    const a = -Math.PI / 2 - span / 2 + (span * (i + 0.5)) / word.length;
    g.save();
    g.translate(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
    g.rotate(a + Math.PI / 2);
    g.fillText(word[i], 0, 0);
    g.restore();
  }
  g.font = `bold ${R * 0.34}px Georgia, serif`;
  g.fillText(inner, 0, R * 0.04);
  g.restore();
}

/** Unlockable art decks. Canvas x = tail -> nose, y = width. */
function drawProDeck(g: Ctx, id: string, W: number, H: number) {
  const serif = (size: number) => `bold ${size}px Georgia, "Times New Roman", serif`;
  const word = (t: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'center') => {
    g.fillStyle = col;
    g.font = serif(size);
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(t, x, y);
  };
  if (id === 'atlas') {
    // house deck: navy, a red band between the trucks, the globe and wordmark
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#16244a');
    grd.addColorStop(0.5, PALETTE.navy);
    grd.addColorStop(1, '#16244a');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    const b0 = W * 0.285;
    const b1 = W * 0.715;
    g.fillStyle = PALETTE.cream;
    g.fillRect(b0, 0, b1 - b0, H);
    g.fillStyle = PALETTE.accent;
    g.fillRect(b0 - 9, 0, 5, H);
    g.fillRect(b1 + 4, 0, 5, H);
    drawGlobe(g, W * 0.35, H * 0.5, H * 0.26, PALETTE.accent, 0.25);
    word('ATLAS', W * 0.43, H * 0.53, 82, PALETTE.navy, 'left');
    // nose: a big faded globe bleeding off the edge
    g.save();
    g.beginPath();
    g.rect(b1 + 9, 0, W - b1, H);
    g.clip();
    drawGlobe(g, W * 0.9, H * 0.5, H * 0.6, 'rgba(250,249,245,0.16)', 0.4);
    drawCompass(g, W * 0.86, H * 0.5, 34, PALETTE.cream, 'rgba(250,249,245,0.4)', 0, false);
    g.restore();
    // tail lettering clear of the truck
    g.fillStyle = PALETTE.ivory;
    g.font = '700 24px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SKATEBOARDS'.split('').join(String.fromCharCode(8202)), W * 0.135, H * 0.5);
  } else if (id === 'compass') {
    g.fillStyle = '#efe4c8';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, 30, 'rgba(140,110,60,0.08)', 90, 99);
    // map grid
    g.strokeStyle = 'rgba(90,61,30,0.18)';
    g.lineWidth = 1.5;
    for (let x = 32; x < W; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 32; y < H; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    drawCompass(g, W * 0.5, H * 0.52, H * 0.4, '#5a3d1e', '#c9a45c', 0);
    word('NORTH', W * 0.18, H * 0.5, 50, '#5a3d1e');
    word('SOUTH', W * 0.82, H * 0.5, 50, '#5a3d1e');
  } else if (id === 'airmail') {
    g.fillStyle = '#f6f1e3';
    g.fillRect(0, 0, W, H);
    airmailBorder(g, W, H, 26);
    word('PAR AVION', W * 0.5, H * 0.43, 72, '#21468B');
    g.font = 'italic 24px Georgia, serif';
    g.fillStyle = '#C8312B';
    g.textAlign = 'center';
    g.fillText('by air mail · por avión · mit Luftpost', W * 0.5, H * 0.7);
    // a postage stamp at the nose
    g.fillStyle = '#FAF9F5';
    g.fillRect(W * 0.84, H * 0.22, 92, 112);
    g.fillStyle = PALETTE.accent;
    g.fillRect(W * 0.84 + 8, H * 0.22 + 8, 76, 96);
    drawGlobe(g, W * 0.84 + 46, H * 0.22 + 56, 28, PALETTE.cream);
  } else if (id === 'passport') {
    g.fillStyle = '#5a1f2a';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, 24, 'rgba(0,0,0,0.12)', 120, 41);
    g.strokeStyle = '#d9b45a';
    g.lineWidth = 3;
    g.strokeRect(W * 0.05, H * 0.1, W * 0.9, H * 0.8);
    drawGlobe(g, W * 0.5, H * 0.5, H * 0.3, '#d9b45a', 0);
    word('PASSPORT', W * 0.23, H * 0.5, 54, '#d9b45a');
    word('SKATE NATIONS', W * 0.77, H * 0.5, 40, '#d9b45a');
    stamp(g, W * 0.37, H * 0.74, 40, 'BRAZIL', '✓', 'rgba(140,215,160,0.85)', -0.3);
    stamp(g, W * 0.64, H * 0.27, 38, 'JAPAN', '★', 'rgba(160,190,240,0.85)', 0.4);
  } else if (id === 'jetstream') {
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#1b2a55');
    grd.addColorStop(0.55, '#c75b6a');
    grd.addColorStop(1, '#f2b45e');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    const r = rng(303);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`;
      g.fillRect(r() * W * 0.45, r() * H, 2, 2);
    }
    // contrail and a little jet
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(W * 0.04, H * 0.85);
    g.bezierCurveTo(W * 0.3, H * 0.95, W * 0.55, H * 0.2, W * 0.78, H * 0.3);
    g.stroke();
    g.save();
    g.translate(W * 0.8, H * 0.3);
    g.rotate(0.08);
    g.fillStyle = '#FAF9F5';
    g.beginPath();
    g.ellipse(0, 0, 34, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-4, 0);
    g.lineTo(-16, -30);
    g.lineTo(6, -2);
    g.lineTo(6, 2);
    g.lineTo(-16, 30);
    g.closePath();
    g.fill();
    g.restore();
    word('JET STREAM', W * 0.3, H * 0.36, 66, 'rgba(250,249,245,0.95)');
  } else if (id === 'mosaic') {
    // every flag in the game, tiled
    const cols = 10;
    const rows = 4;
    const cw = W / cols;
    const ch = H / rows;
    for (let i = 0; i < cols * rows; i++) {
      const f = FLAGS[i % FLAGS.length];
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.rect(0, 0, cw, ch);
      g.clip();
      f.draw(g, cw, ch);
      g.restore();
    }
    g.strokeStyle = 'rgba(20,20,19,0.35)';
    g.lineWidth = 2;
    for (let i = 1; i < cols; i++) {
      g.beginPath();
      g.moveTo(i * cw, 0);
      g.lineTo(i * cw, H);
      g.stroke();
    }
    for (let j = 1; j < rows; j++) {
      g.beginPath();
      g.moveTo(0, j * ch);
      g.lineTo(W, j * ch);
      g.stroke();
    }
  } else if (id === 'gold') {
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#a37b2c');
    grd.addColorStop(0.5, '#f3d27a');
    grd.addColorStop(1, '#a37b2c');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    drawGlobe(g, W * 0.5, H * 0.5, H * 0.4, 'rgba(255,255,255,0.7)', 0.2);
    word('NATIONS', W * 0.2, H * 0.52, 60, '#4a3510');
    word('CUP GOLD', W * 0.8, H * 0.52, 56, '#4a3510');
  }
}

/** Unlockable deck bottoms. Canvas x = tail -> nose, y = width. */
export function deckTexture(id: string): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W, H);
  const flag = flagDef(id);
  if (flag) {
    flag.draw(g, W, H);
    // a soft sheen down the middle so it reads as a printed deck
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(0,0,0,0.1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(0,0,0,0.1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  } else drawProDeck(g, id, W, H);
  // subtle wear scratches
  const r = rng(77);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = r() * H;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 8);
    g.stroke();
  }
  const t = tex(c, false);
  aniso(t, 16);
  return t;
}

/** A flag at its natural proportions, for flagpoles. */
export function flagTexture(id: string): THREE.CanvasTexture {
  const f = flagDef(id) ?? FLAGS[0];
  const W = 512;
  const H = Math.round(W / f.ratio);
  const { c, g } = canvas(W, H);
  f.draw(g, W, H);
  return tex(c, false);
}

/* ------------------------------------------------------------------ */
/* Ambience: sky, grime, graffiti, tiles                               */
/* ------------------------------------------------------------------ */

/**
 * Equirectangular sky for a dome: the horizon colour (matches the fog) fading
 * up to `zenith`, with a band of soft clouds.
 */
export function skyTexture(horizon: string, zenith: string, seed: number) {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, zenith);
  grd.addColorStop(0.32, zenith);
  grd.addColorStop(0.5, horizon);
  grd.addColorStop(1, horizon);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // clouds: clusters of soft puffs, flatter and denser near the horizon
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const cx = r() * W;
    const cy = H * (0.22 + r() * 0.24);
    const near = (cy / H - 0.22) / 0.24; // 0 high .. 1 at the horizon
    const s = 30 + r() * 50 * (1 - near * 0.5);
    for (let k = 0; k < 9; k++) {
      const x = cx + (r() - 0.5) * s * 3.2;
      const y = cy + (r() - 0.5) * s * 0.5;
      const rad = s * (0.5 + r() * 0.6);
      for (const ox of [-W, 0, W]) {
        const pg = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
        pg.addColorStop(0, `rgba(255,255,255,${0.32 - near * 0.12})`);
        pg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = pg;
        g.save();
        g.translate(x + ox, y);
        g.scale(1, 0.45);
        g.translate(-(x + ox), -y);
        g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
        g.restore();
      }
    }
  }
  const t = tex(c, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Cells of the grime atlas (4 × 4). */
export const GRIME = { oil: [0, 1, 2], dirt: [3], skid: [4, 5], crack: [6, 7], wax: [8], gum: [9], stain: [10], leaves: [11], tag: [12, 13], drain: [14], chalk: [15] };

/**
 * Street wear for the ground, in a 4×4 atlas: oil, dirt, skid marks, cracks,
 * wax, gum, water stains, leaves, spray tags, a drain and chalk doodles.
 */
export function grimeAtlas(tagColors: string[], seed: number) {
  const C = 256;
  const { c, g } = canvas(C * 4, C * 4);
  const r = rng(seed);
  const cell = (i: number, draw: () => void) => {
    g.save();
    g.translate((i % 4) * C, Math.floor(i / 4) * C);
    g.beginPath();
    g.rect(0, 0, C, C);
    g.clip();
    draw();
    g.restore();
  };
  const blob = (x: number, y: number, rad: number, col: string) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  for (const i of GRIME.oil) {
    cell(i, () => {
      for (let k = 0; k < 10; k++) blob(C / 2 + (r() - 0.5) * 110, C / 2 + (r() - 0.5) * 110, 18 + r() * 44, `rgba(34,30,26,${0.05 + r() * 0.07})`);
    });
  }
  cell(GRIME.dirt[0], () => {
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2;
      const d = r() * 80;
      blob(C / 2 + Math.cos(a) * d, C / 2 + Math.sin(a) * d, 30 + r() * 40, `rgba(110,92,64,${0.012 + r() * 0.014})`);
    }
  });
  for (const i of GRIME.skid) {
    cell(i, () => {
      const bend = (r() - 0.5) * 120;
      for (const off of [-22, 22]) {
        const grd = g.createLinearGradient(20, 0, C - 20, 0);
        grd.addColorStop(0, 'rgba(20,18,16,0)');
        grd.addColorStop(0.25, 'rgba(20,18,16,0.5)');
        grd.addColorStop(1, 'rgba(20,18,16,0)');
        g.strokeStyle = grd;
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(20, C / 2 + off);
        g.quadraticCurveTo(C / 2, C / 2 + off + bend, C - 20, C / 2 + off + bend * 0.4);
        g.stroke();
      }
    });
  }
  for (const i of GRIME.crack) {
    cell(i, () => {
      g.strokeStyle = 'rgba(40,36,30,0.55)';
      g.lineCap = 'round';
      const walk = (x: number, y: number, a: number, n: number, w: number) => {
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < n; k++) {
          a += (r() - 0.5) * 0.9;
          x += Math.cos(a) * 12;
          y += Math.sin(a) * 12;
          g.lineTo(x, y);
          if (w > 1.5 && r() < 0.15) {
            g.stroke();
            walk(x, y, a + (r() < 0.5 ? 1 : -1) * (0.6 + r()), 4 + Math.floor(r() * 5), w * 0.6);
            g.lineWidth = w;
            g.beginPath();
            g.moveTo(x, y);
          }
        }
        g.stroke();
      };
      walk(14, C / 2 + (r() - 0.5) * 80, (r() - 0.5) * 0.6, 18, 3.5);
    });
  }
  cell(GRIME.wax[0], () => {
    g.lineCap = 'round';
    for (let k = 0; k < 22; k++) {
      g.strokeStyle = `rgba(30,26,22,${0.12 + r() * 0.2})`;
      g.lineWidth = 2 + r() * 5;
      const y = 40 + r() * (C - 80);
      g.beginPath();
      g.moveTo(10 + r() * 40, y);
      g.quadraticCurveTo(C / 2, y + (r() - 0.5) * 30, C - 10 - r() * 40, y + (r() - 0.5) * 20);
      g.stroke();
    }
  });
  cell(GRIME.gum[0], () => {
    for (let k = 0; k < 26; k++) {
      const x = 20 + r() * (C - 40);
      const y = 20 + r() * (C - 40);
      g.fillStyle = `rgba(${70 + r() * 40},${66 + r() * 30},${60 + r() * 30},0.75)`;
      g.beginPath();
      g.ellipse(x, y, 4 + r() * 5, 3 + r() * 4, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  cell(GRIME.stain[0], () => {
    blob(C / 2, C / 2, 110, 'rgba(60,50,40,0.05)');
    g.strokeStyle = 'rgba(60,50,40,0.16)';
    g.lineWidth = 5;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) {
      const rad = 95 + Math.sin(a * 3 + 1) * 10 + Math.sin(a * 7) * 5;
      const x = C / 2 + Math.cos(a) * rad;
      const y = C / 2 + Math.sin(a) * rad;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
  cell(GRIME.leaves[0], () => {
    const cols = ['#8a6a2c', '#a8742a', '#6f7d3a', '#b5562d', '#7a5a30'];
    for (let k = 0; k < 34; k++) {
      const a = r() * Math.PI * 2;
      const d = r() * 100;
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.globalAlpha = 0.85;
      g.beginPath();
      g.ellipse(C / 2 + Math.cos(a) * d, C / 2 + Math.sin(a) * d, 10 + r() * 6, 4 + r() * 3, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
  GRIME.tag.forEach((i, n) => {
    cell(i, () => {
      g.translate(C / 2, C / 2);
      g.rotate((r() - 0.5) * 0.5);
      g.font = 'italic bold 92px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const word = n ? 'SK8' : 'RIP';
      g.lineJoin = 'round';
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(20,20,20,0.6)';
      g.strokeText(word, 0, 0);
      g.fillStyle = tagColors[n % tagColors.length];
      g.globalAlpha = 0.8;
      g.fillText(word, 0, 0);
      g.globalAlpha = 1;
      // a dribble of overspray
      for (let k = 0; k < 40; k++) blob((r() - 0.5) * 220, (r() - 0.5) * 120, 3 + r() * 5, 'rgba(20,20,20,0.25)');
    });
  });
  cell(GRIME.drain[0], () => {
    // kept small in its cell: an opaque cover would bleed into every decal's distant mips
    const R2 = 46;
    g.fillStyle = '#5a5652';
    g.beginPath();
    g.arc(C / 2, C / 2, R2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2f2d2a';
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = '#26241f';
    for (let k = -3; k <= 3; k++) g.fillRect(C / 2 - R2 * 0.7, C / 2 + k * 10 - 2.5, R2 * 1.4, 5);
  });
  cell(GRIME.chalk[0], () => {
    g.strokeStyle = 'rgba(250,248,240,0.7)';
    g.lineWidth = 6;
    g.lineCap = 'round';
    // a hopscotch-ish grid and a star
    g.strokeRect(40, 30, 70, 70);
    g.strokeRect(40, 100, 70, 70);
    g.strokeRect(110, 100, 70, 70);
    g.beginPath();
    for (let k = 0; k <= 5; k++) {
      const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5;
      const x = 190 + Math.cos(a) * 36;
      const y = 60 + Math.sin(a) * 36;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
  const t = tex(c, false);
  aniso(t, 8);
  return t;
}

/**
 * Four graffiti pieces stacked in one texture (each a 1024 × 256 row): wobbly
 * bubble letters with a 3D drop, outline, gradient fill, shines and drips.
 */
export function graffitiAtlas(words: string[], palettes: [string, string, string][], seed: number) {
  const W = 1024;
  const R = 256;
  const { c, g } = canvas(W, R * 4);
  const r = rng(seed);
  for (let row = 0; row < 4; row++) {
    const word = words[row % words.length];
    const [c1, c2, bg] = palettes[row % palettes.length];
    g.save();
    g.translate(0, row * R);
    // a sprayed cloud behind the letters
    for (let k = 0; k < 30; k++) {
      const x = 90 + r() * (W - 180);
      const y = R / 2 + (r() - 0.5) * 90;
      const rad = 50 + r() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, bg);
      grd.addColorStop(0.7, bg);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    let size = 170;
    g.font = `bold ${size}px "Arial Black", Impact, Arial, sans-serif`;
    const widths = () => word.split('').map((ch) => g.measureText(ch).width * 0.86);
    let ws = widths();
    let total = ws.reduce((a, b) => a + b, 0);
    if (total > W - 120) {
      size = Math.floor((size * (W - 120)) / total);
      g.font = `bold ${size}px "Arial Black", Impact, Arial, sans-serif`;
      ws = widths();
      total = ws.reduce((a, b) => a + b, 0);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const glyphs = word.split('').map((ch, i) => ({
      ch,
      x: (W - total) / 2 + ws.slice(0, i).reduce((a, b) => a + b, 0) + ws[i] / 2,
      y: R / 2 + (r() - 0.5) * 18,
      rot: (r() - 0.5) * 0.28,
    }));
    const each = (fn: (gl: (typeof glyphs)[number]) => void) => {
      for (const gl of glyphs) {
        g.save();
        g.translate(gl.x, gl.y);
        g.rotate(gl.rot);
        fn(gl);
        g.restore();
      }
    };
    // 3D drop
    for (let d = 12; d > 0; d -= 2) each((gl) => {
      g.fillStyle = '#1b1a2a';
      g.fillText(gl.ch, d, d);
    });
    each((gl) => {
      g.lineWidth = 22;
      g.strokeStyle = '#141413';
      g.strokeText(gl.ch, 0, 0);
      g.lineWidth = 9;
      g.strokeStyle = '#faf9f5';
      g.strokeText(gl.ch, 0, 0);
      const grd = g.createLinearGradient(0, -size / 2, 0, size / 2);
      grd.addColorStop(0, c1);
      grd.addColorStop(1, c2);
      g.fillStyle = grd;
      g.fillText(gl.ch, 0, 0);
    });
    // drips off the bottoms
    g.fillStyle = c2;
    for (let k = 0; k < 9; k++) {
      const gl = glyphs[Math.floor(r() * glyphs.length)];
      const x = gl.x + (r() - 0.5) * ws[0] * 0.5;
      const y0 = gl.y + size * 0.3;
      const len = 14 + r() * 40;
      g.fillRect(x - 2.5, y0, 5, len);
      g.beginPath();
      g.arc(x, y0 + len, 4.5, 0, Math.PI * 2);
      g.fill();
    }
    // shines
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 5; k++) {
      const gl = glyphs[Math.floor(r() * glyphs.length)];
      const x = gl.x + (r() - 0.5) * 40;
      const y = gl.y - size * 0.22 + (r() - 0.5) * 20;
      g.beginPath();
      g.moveTo(x, y - 14);
      g.lineTo(x + 4, y);
      g.lineTo(x, y + 14);
      g.lineTo(x - 4, y);
      g.closePath();
      g.fill();
      g.fillRect(x - 14, y - 1.5, 28, 3);
    }
    g.restore();
  }
  return tex(c, false);
}

/** Hand-painted azulejo tiles, Plaza de España style. 2 × 2 tiles per repeat. */
export function azulejoTexture() {
  const S = 256;
  const T = S / 2;
  const { c, g } = canvas(S, S);
  const blue = '#1f4e9c';
  const gold = '#e3a92b';
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      g.save();
      g.translate(i * T, j * T);
      g.fillStyle = '#f4efe2';
      g.fillRect(0, 0, T, T);
      // corner quarter-rosettes join up with the neighbouring tiles
      g.fillStyle = blue;
      for (const [x, y] of [
        [0, 0],
        [T, 0],
        [0, T],
        [T, T],
      ]) {
        g.beginPath();
        g.arc(x, y, T * 0.28, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = gold;
      for (const [x, y] of [
        [0, 0],
        [T, 0],
        [0, T],
        [T, T],
      ]) {
        g.beginPath();
        g.arc(x, y, T * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      // central flower
      g.translate(T / 2, T / 2);
      for (let k = 0; k < 8; k++) {
        g.rotate(Math.PI / 4);
        g.fillStyle = k % 2 ? gold : blue;
        g.beginPath();
        g.ellipse(0, -T * 0.2, T * 0.07, T * 0.16, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.arc(0, 0, T * 0.08, 0, Math.PI * 2);
      g.fill();
      g.restore();
      // grout
      g.strokeStyle = 'rgba(120,110,95,0.6)';
      g.lineWidth = 2;
      g.strokeRect(i * T + 1, j * T + 1, T - 2, T - 2);
    }
  }
  return tex(c);
}
