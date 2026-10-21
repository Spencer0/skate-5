import * as THREE from 'three';

export const PALETTE = {
  clay: '#D97757',
  clayDark: '#B85C3E',
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

function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
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

/** The Claude spark: a hand-drawn-feeling starburst of rounded rays. */
export function drawSpark(g: CanvasRenderingContext2D, x: number, y: number, R: number, color: string, seed = 7, rot = 0) {
  const r = rng(seed);
  const rays = 12;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (r() - 0.5) * 0.18;
    const len = R * (0.72 + r() * 0.28);
    const w = R * (0.13 + r() * 0.05);
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
  }
  g.restore();
}

/**
 * Bottom graphic of the deck. Canvas x = board length (tail -> nose),
 * canvas y = board width.
 */
export function boardBottomTexture() {
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W, H);
  // base clay with a soft sheen toward the middle
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, PALETTE.clayDark);
  grd.addColorStop(0.5, PALETTE.clay);
  grd.addColorStop(1, PALETTE.clayDark);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);

  // cream band between the trucks
  const b0 = W * 0.285;
  const b1 = W * 0.715;
  g.fillStyle = PALETTE.cream;
  g.fillRect(b0, 0, b1 - b0, H);
  g.fillStyle = PALETTE.slate;
  g.fillRect(b0 - 9, 0, 4, H);
  g.fillRect(b1 + 5, 0, 4, H);

  // spark + wordmark, reading tail -> nose
  drawSpark(g, W * 0.36, H * 0.5, H * 0.3, PALETTE.clay, 7, 0.2);
  g.save();
  g.fillStyle = PALETTE.slate;
  g.font = 'bold 78px Georgia, "Times New Roman", serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('Claude', W * 0.43, H * 0.53);
  g.restore();

  // nose: a big faded spark bleeding off the edge
  g.save();
  g.beginPath();
  g.rect(b1 + 9, 0, W - b1, H);
  g.clip();
  drawSpark(g, W * 0.9, H * 0.5, H * 0.55, 'rgba(250,249,245,0.22)', 3, 0.5);
  drawSpark(g, W * 0.86, H * 0.5, 30, PALETTE.cream, 10);
  g.restore();

  // tail: lettering clear of the truck
  g.save();
  g.fillStyle = PALETTE.ivory;
  g.font = '700 25px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = 'ANTHROPIC';
  const spaced = text.split('').join(String.fromCharCode(8202));
  g.fillText(spaced, W * 0.125, H * 0.5);
  g.restore();
  drawSpark(g, W * 0.035, H * 0.5, 16, PALETTE.cream, 9);

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
  t.anisotropy = 16;
  return t;
}

export function boardTopTexture() {
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W, H);
  noiseFill(g, W, H, [32, 31, 30], 30, 51);
  // a subtle spark cut into the griptape near the tail
  drawSpark(g, W * 0.16, H * 0.5, H * 0.3, 'rgba(217,119,87,0.9)', 7, 0.6);
  const r = rng(52);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.07})`;
    g.fillRect(r() * W, r() * H, 1, 1);
  }
  // scuffs where feet go
  blotches(g, W, H, 6, 'rgba(255,255,255,0.05)', 80, 53);
  const t = tex(c, false);
  t.anisotropy = 16;
  return t;
}

export function woodTexture() {
  const W = 256;
  const H = 32;
  const { c, g } = canvas(W, H);
  const plies = ['#e9d3a8', '#d97757', '#e9d3a8', '#2d2a26', '#e9d3a8', '#d97757', '#e9d3a8'];
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

/** Large painted spark for the plaza floor. */
export function groundSparkTexture() {
  const S = 1024;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  drawSpark(g, S / 2, S / 2, S * 0.46, 'rgba(217,119,87,0.85)', 7, 0.3);
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

export function sparkBillboardTexture() {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = PALETTE.clay;
  g.fillRect(0, 0, W, H);
  drawSpark(g, H * 0.5, H * 0.5, H * 0.36, PALETTE.cream, 7, 0.2);
  g.fillStyle = PALETTE.cream;
  g.font = 'bold 190px Georgia, serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('Claude', H * 0.95, H * 0.47);
  g.font = '600 44px "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = PALETTE.slate;
  g.fillText('S K A T E   P A R K', H * 0.98, H * 0.78);
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

/** A collectible letter: clay disc with a cream serif letter. */
export function letterTexture(ch: string) {
  const S = 256;
  const { c, g } = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,214,170,0.9)');
  grd.addColorStop(0.7, 'rgba(217,119,87,0.55)');
  grd.addColorStop(1, 'rgba(217,119,87,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.fillStyle = PALETTE.clay;
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

/** Unlockable deck bottoms. Canvas x = tail -> nose, y = width. */
export function deckTexture(id: string): THREE.CanvasTexture {
  if (id === 'claude') return boardBottomTexture();
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W, H);
  const serif = (size: number) => `bold ${size}px Georgia, "Times New Roman", serif`;
  const word = (t: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'center') => {
    g.fillStyle = col;
    g.font = serif(size);
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(t, x, y);
  };
  if (id === 'haiku') {
    g.fillStyle = '#e9ede1';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#788C5D';
    g.fillRect(0, H * 0.82, W, H * 0.18);
    // ensō brush circle
    g.strokeStyle = '#2f3a24';
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      g.lineWidth = 16 - i * 4;
      g.beginPath();
      g.arc(W * 0.5, H * 0.45, H * 0.3 + i * 2, 0.3 + i * 0.05, Math.PI * 1.85);
      g.stroke();
    }
    word('Haiku', W * 0.82, H * 0.45, 56, '#2f3a24');
    g.font = 'italic 22px Georgia, serif';
    g.fillStyle = '#2f3a24';
    g.textAlign = 'center';
    g.fillText('small and quick · lands clean', W * 0.17, H * 0.45);
  } else if (id === 'sonnet') {
    g.fillStyle = '#1f2a44';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(240,238,230,0.25)';
    g.lineWidth = 2;
    for (let i = 1; i < 14; i++) {
      g.beginPath();
      g.moveTo(W * 0.08, (H * i) / 14);
      g.lineTo(W * 0.92, (H * i) / 14);
      g.stroke();
    }
    word('Sonnet', W * 0.5, H * 0.5, 96, '#F0EEE6');
    drawSpark(g, W * 0.18, H * 0.5, 50, '#6A9BCC', 3);
    drawSpark(g, W * 0.82, H * 0.5, 50, '#6A9BCC', 4);
  } else if (id === 'opus') {
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#121110');
    grd.addColorStop(1, '#2b2722');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c9a45c';
    g.lineWidth = 4;
    g.strokeRect(W * 0.06, H * 0.12, W * 0.88, H * 0.76);
    g.lineWidth = 1.5;
    g.strokeRect(W * 0.07, H * 0.16, W * 0.86, H * 0.68);
    word('OPUS', W * 0.5, H * 0.52, 110, '#c9a45c');
    drawSpark(g, W * 0.16, H * 0.5, 44, '#c9a45c', 5);
    drawSpark(g, W * 0.84, H * 0.5, 44, '#c9a45c', 6);
  } else if (id === 'spark') {
    g.fillStyle = PALETTE.clay;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) drawSpark(g, (W * (i + 0.5)) / 9, H * (i % 2 ? 0.3 : 0.7), 70, i % 3 === 0 ? PALETTE.ivory : 'rgba(250,249,245,0.35)', 20 + i, i);
    word('SPARK', W * 0.5, H * 0.52, 100, PALETTE.slate);
  } else if (id === 'constitution') {
    g.fillStyle = '#efe4c8';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, 30, 'rgba(140,110,60,0.08)', 90, 99);
    g.fillStyle = 'rgba(60,45,25,0.55)';
    g.font = 'italic 15px Georgia, serif';
    g.textAlign = 'left';
    const words = 'be helpful be honest be harmless land your tricks catch the board respect the locals share the spot '.repeat(6);
    for (let row = 0; row < 11; row++) g.fillText(words.slice(row * 31, row * 31 + 150), W * 0.05, 26 + row * 20);
    g.fillStyle = 'rgba(239,228,200,0.85)';
    g.fillRect(W * 0.3, H * 0.28, W * 0.4, H * 0.44);
    word('Constitution', W * 0.5, H * 0.5, 54, '#5a3d1e');
  } else if (id === 'gold') {
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#a37b2c');
    grd.addColorStop(0.5, '#f3d27a');
    grd.addColorStop(1, '#a37b2c');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    drawSpark(g, W * 0.5, H * 0.5, H * 0.42, 'rgba(255,255,255,0.7)', 7, 0.2);
    word('CLASSIC', W * 0.2, H * 0.52, 60, '#4a3510');
    word('CHAMPION', W * 0.8, H * 0.52, 52, '#4a3510');
  }
  const t = tex(c, false);
  t.anisotropy = 16;
  return t;
}
