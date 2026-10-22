/**
 * Country flags drawn procedurally onto a canvas rect. Every flag is drawn
 * to fill (w, h): stripes, bands and cantons stretch with the rect, while
 * discs, stars and crosses are sized off the height so they keep their shape
 * on a long deck as well as on a flagpole.
 *
 * Flags whose national arms are too detailed to draw well (Mexico, Portugal…)
 * are left out rather than shown wrong. Spain uses its civil flag (no arms).
 */

type Ctx = CanvasRenderingContext2D;

export interface FlagDef {
  id: string;
  name: string;
  /** natural width / height, for flagpoles */
  ratio: number;
  draw: (g: Ctx, w: number, h: number) => void;
}

function rect(g: Ctx, col: string, x: number, y: number, w: number, h: number) {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
}

/** Horizontal stripes, top to bottom, with optional relative weights. */
function hStripes(g: Ctx, w: number, h: number, cols: string[], weights = cols.map(() => 1)) {
  const total = weights.reduce((a, b) => a + b, 0);
  let y = 0;
  cols.forEach((c, i) => {
    const sh = (h * weights[i]) / total;
    rect(g, c, 0, Math.floor(y), w, Math.ceil(sh) + 1);
    y += sh;
  });
}

/** Vertical bands, hoist to fly. */
function vBands(g: Ctx, w: number, h: number, cols: string[]) {
  cols.forEach((c, i) => rect(g, c, Math.floor((w * i) / cols.length), 0, Math.ceil(w / cols.length) + 1, h));
}

export function star(g: Ctx, cx: number, cy: number, R: number, col: string, points = 5, inner = 0.382, rot = -Math.PI / 2) {
  g.fillStyle = col;
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? R * inner : R;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
}

function disc(g: Ctx, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

/** Off-centre (Nordic) cross. `x` is the centre of the upright, as a fraction of w. */
function nordic(g: Ctx, w: number, h: number, bg: string, cross: string, bar: number, x = 0.36, inner?: string, innerBar = 0) {
  rect(g, bg, 0, 0, w, h);
  const cx = w * x;
  rect(g, cross, cx - bar / 2, 0, bar, h);
  rect(g, cross, 0, h / 2 - bar / 2, w, bar);
  if (inner) {
    rect(g, inner, cx - innerBar / 2, 0, innerBar, h);
    rect(g, inner, 0, h / 2 - innerBar / 2, w, innerBar);
  }
}

/** The Union Flag, with its counterchanged red saltire. */
function unionJack(g: Ctx, w: number, h: number) {
  rect(g, '#012169', 0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.lineCap = 'butt';
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = h * 0.2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, h);
  g.moveTo(w, 0);
  g.lineTo(0, h);
  g.stroke();
  // each red arm sits off its centreline, all turning the same way (a pinwheel)
  const cx = w / 2;
  const cy = h / 2;
  const off = h / 30;
  for (const [ex, ey] of [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]) {
    const dx = ex - cx;
    const dy = ey - cy;
    const L = Math.hypot(dx, dy);
    const px = (dy / L) * off;
    const py = (-dx / L) * off;
    g.save();
    g.beginPath();
    g.rect(Math.min(cx, ex), Math.min(cy, ey), Math.abs(dx), Math.abs(dy));
    g.clip();
    g.strokeStyle = '#C8102E';
    g.lineWidth = h / 15;
    g.beginPath();
    g.moveTo(cx + px, cy + py);
    g.lineTo(ex + px, ey + py);
    g.stroke();
    g.restore();
  }
  g.restore();
  rect(g, '#FFFFFF', cx - h / 6, 0, h / 3, h);
  rect(g, '#FFFFFF', 0, cy - h / 6, w, h / 3);
  rect(g, '#C8102E', cx - h / 10, 0, h / 5, h);
  rect(g, '#C8102E', 0, cy - h / 10, w, h / 5);
}

/** Canada's maple leaf (the official 11-point leaf), centred, `s` = leaf height. */
const MAPLE =
  'm-90 2030 45-863a95 95 0 0 0-111-98l-859 151 116-320a65 65 0 0 0-20-73l-941-762 212-99a65 65 0 0 0 34-79l-186-572 542 115a65 65 0 0 0 73-38l105-247 423 454a65 65 0 0 0 111-57l-204-1052 327 189a65 65 0 0 0 91-27l332-652 332 652a65 65 0 0 0 91 27l327-189-204 1052a65 65 0 0 0 111 57l423-454 105 247a65 65 0 0 0 73 38l542-115-186 572a65 65 0 0 0 34 79l212 99-941 762a65 65 0 0 0-20 73l116 320-859-151a95 95 0 0 0-111 98l45 863z';

function mapleLeaf(g: Ctx, cx: number, cy: number, s: number, col: string) {
  g.save();
  g.translate(cx, cy);
  // the path spans about 4300 units tall, centred a little above its origin
  const k = s / 4300;
  g.scale(k, k);
  g.translate(0, -100);
  g.fillStyle = col;
  g.fill(new Path2D(MAPLE));
  g.restore();
}

function southernCross(g: Ctx, w: number, h: number, col: string, stars: [number, number, number, number][], outline?: string) {
  for (const [x, y, r, n] of stars) {
    if (outline) star(g, w * x, h * y, h * r * 1.35, outline, n, 0.45);
    star(g, w * x, h * y, h * r, col, n, n === 7 ? 4 / 9 : 0.42);
  }
}

function brazil(g: Ctx, w: number, h: number) {
  rect(g, '#009C3B', 0, 0, w, h);
  const mx = Math.min(w * 0.085, h * 0.3);
  const my = h * 0.12;
  g.fillStyle = '#FFDF00';
  g.beginPath();
  g.moveTo(mx, h / 2);
  g.lineTo(w / 2, my);
  g.lineTo(w - mx, h / 2);
  g.lineTo(w / 2, h - my);
  g.closePath();
  g.fill();
  const R = h * 0.25;
  const cx = w / 2;
  const cy = h / 2;
  disc(g, cx, cy, R, '#002776');
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  // the white band: an arc of a big circle centred below and left of the disc
  const bx = cx - R * 0.5;
  const by = cy + R * 3.6;
  const br = R * 3.75;
  const bw = R * 0.24;
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = bw;
  g.beginPath();
  g.arc(bx, by, br, Math.PI * 1.25, Math.PI * 1.75);
  g.stroke();
  // ORDEM E PROGRESSO along the band
  const motto = 'ORDEM E PROGRESSO';
  g.fillStyle = '#009C3B';
  g.font = `bold ${Math.max(5, bw * 0.72)}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const span = (R * 1.55) / br;
  const a0 = -Math.PI / 2 + Math.atan2(cx - bx, by - cy) - span / 2;
  for (let i = 0; i < motto.length; i++) {
    const a = a0 + (span * (i + 0.5)) / motto.length;
    g.save();
    g.translate(bx + Math.cos(a) * br, by + Math.sin(a) * br);
    g.rotate(a + Math.PI / 2);
    g.fillText(motto[i], 0, 0);
    g.restore();
  }
  // a sky of stars below the band
  const pts: [number, number, number][] = [
    [-0.55, 0.35, 1.3], [-0.3, 0.55, 1], [-0.62, 0.62, 0.8], [0.05, 0.42, 1.4], [0.2, 0.62, 0.9], [-0.1, 0.72, 1.1],
    [0.38, 0.45, 1], [0.55, 0.28, 0.8], [0.6, 0.55, 1.2], [0.3, 0.8, 0.8], [-0.35, 0.82, 0.9], [0.05, 0.92, 0.7],
    [-0.75, 0.2, 0.7], [0.75, 0.12, 0.7], [0.12, 0.2, 0.8], [-0.2, 0.25, 0.7], [0.45, 0.7, 0.7], [-0.5, 0.05, 0.7],
  ];
  for (const [x, y, s] of pts) star(g, cx + x * R, cy + y * R * 0.95 - R * 0.05, R * 0.06 * s, '#FFFFFF');
  star(g, cx + R * 0.35, cy - R * 0.38, R * 0.06, '#FFFFFF');
  g.restore();
}

function korea(g: Ctx, w: number, h: number) {
  rect(g, '#FFFFFF', 0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = h / 4;
  const ang = Math.atan2(h, w);
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  disc(g, 0, 0, R, '#003478');
  g.fillStyle = '#CD2E3A';
  g.beginPath();
  g.arc(0, 0, R, Math.PI, 0);
  g.fill();
  disc(g, -R / 2, 0, R / 2, '#CD2E3A');
  disc(g, R / 2, 0, R / 2, '#003478');
  g.restore();
  // trigrams on the diagonals: [solid bars] from inner to outer
  const bar = h / 24;
  const gap = h / 48;
  const len = h / 4;
  const trigram = (dx: number, dy: number, lines: boolean[]) => {
    const L = Math.hypot(dx, dy);
    const ux = dx / L;
    const uy = dy / L;
    const d0 = R + h / 8;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.atan2(uy, ux));
    g.fillStyle = '#000000';
    lines.forEach((solid, i) => {
      const x = d0 + i * (bar + gap);
      if (solid) g.fillRect(x, -len / 2, bar, len);
      else {
        g.fillRect(x, -len / 2, bar, len * 0.46);
        g.fillRect(x, len * 0.04, bar, len * 0.46);
      }
    });
    g.restore();
  };
  trigram(-w, -h, [true, true, true]); // geon
  trigram(w, h, [false, false, false]); // gon
  trigram(w, -h, [false, true, false]); // gam
  trigram(-w, h, [true, false, true]); // ri
}

function southAfrica(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, ['#E03C31', '#001489']);
  const cx = Math.min(w / 3, h * 0.9);
  g.save();
  g.lineJoin = 'miter';
  g.miterLimit = 10;
  // the Y: white borders outside, gold borders round the black triangle
  const arms = () => {
    g.beginPath();
    g.moveTo(-h * 0.1, -h * 0.05);
    g.lineTo(cx, h / 2);
    g.lineTo(w + 10, h / 2);
    g.moveTo(-h * 0.1, h + h * 0.05);
    g.lineTo(cx, h / 2);
  };
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = h / 3;
  arms();
  g.stroke();
  g.save();
  g.beginPath();
  g.moveTo(-h * 0.1, -h * 0.05);
  g.lineTo(cx, h / 2);
  g.lineTo(-h * 0.1, h + h * 0.05);
  g.closePath();
  g.clip();
  g.fillStyle = '#000000';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#FFB81C';
  g.lineWidth = h / 3;
  arms();
  g.stroke();
  g.restore();
  g.strokeStyle = '#007749';
  g.lineWidth = h / 5;
  arms();
  g.stroke();
  g.restore();
}

function argentina(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, ['#74ACDF', '#FFFFFF', '#74ACDF']);
  const cx = w / 2;
  const cy = h / 2;
  const r = h * 0.085;
  g.fillStyle = '#F6B40E';
  g.strokeStyle = '#85340A';
  g.lineWidth = Math.max(1, h * 0.004);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const long = i % 2 === 0;
    const L = r * (long ? 1.95 : 1.7);
    const sw = 0.07;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - sw) * r, cy + Math.sin(a - sw) * r);
    g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
    g.lineTo(cx + Math.cos(a + sw) * r, cy + Math.sin(a + sw) * r);
    g.closePath();
    g.fill();
    g.stroke();
  }
  disc(g, cx, cy, r, '#F6B40E');
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  // a simple face: eyes and a smile
  g.fillStyle = '#85340A';
  g.beginPath();
  g.arc(cx - r * 0.35, cy - r * 0.15, r * 0.1, 0, Math.PI * 2);
  g.arc(cx + r * 0.35, cy - r * 0.15, r * 0.1, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx, cy + r * 0.1, r * 0.38, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
}

function india(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, ['#FF9933', '#FFFFFF', '#138808']);
  const cx = w / 2;
  const cy = h / 2;
  const R = (h / 3) * 0.4;
  g.strokeStyle = '#000080';
  g.lineWidth = R * 0.1;
  g.beginPath();
  g.arc(cx, cy, R * 0.95, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = R * 0.05;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
    g.stroke();
  }
  disc(g, cx, cy, R * 0.18, '#000080');
}

function china(g: Ctx, w: number, h: number) {
  rect(g, '#EE1C25', 0, 0, w, h);
  const u = h / 20;
  star(g, 5 * u, 5 * u, 3 * u, '#FFFF00');
  for (const [x, y] of [
    [10, 2],
    [12, 4],
    [12, 7],
    [10, 9],
  ]) {
    // each small star points one tip at the big star's centre
    const rot = Math.atan2(5 - y, 5 - x);
    star(g, x * u, y * u, u, '#FFFF00', 5, 0.382, rot);
  }
}

function turkey(g: Ctx, w: number, h: number) {
  rect(g, '#E30A17', 0, 0, w, h);
  const H = h;
  const x0 = Math.min(H * 0.5, w * 0.33);
  disc(g, x0, h / 2, H / 4, '#FFFFFF');
  disc(g, x0 + H / 16, h / 2, H * 0.2, '#E30A17');
  star(g, x0 + H * 0.367, h / 2, H / 8, '#FFFFFF', 5, 0.382, Math.PI);
}

function greece(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, ['#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF']);
  const s = (h * 5) / 9;
  rect(g, '#0D5EAF', 0, 0, s, s);
  rect(g, '#FFFFFF', s / 2 - h / 18, 0, h / 9, s);
  rect(g, '#FFFFFF', 0, s / 2 - h / 18, s, h / 9);
}

function usa(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, Array.from({ length: 13 }, (_, i) => (i % 2 ? '#FFFFFF' : '#B22234')));
  const cw = w * 0.4;
  const ch = (h * 7) / 13;
  rect(g, '#3C3B6E', 0, 0, cw, ch);
  const R = h * 0.0308;
  for (let row = 0; row < 9; row++) {
    const six = row % 2 === 0;
    for (let j = 0; j < (six ? 6 : 5); j++) {
      const x = ((six ? 2 * j + 1 : 2 * j + 2) * cw) / 12;
      const y = ((row + 1) * ch) / 10;
      star(g, x, y, R, '#FFFFFF');
    }
  }
}

function czechia(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, ['#FFFFFF', '#D7141A']);
  g.fillStyle = '#11457E';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(Math.min(w / 2, h * 1.2), h / 2);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
}

function jamaica(g: Ctx, w: number, h: number) {
  rect(g, '#009B3A', 0, 0, w, h);
  g.fillStyle = '#000000';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w / 2, h / 2);
  g.lineTo(0, h);
  g.moveTo(w, 0);
  g.lineTo(w / 2, h / 2);
  g.lineTo(w, h);
  g.fill();
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.strokeStyle = '#FED100';
  g.lineWidth = h * 0.15;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, h);
  g.moveTo(w, 0);
  g.lineTo(0, h);
  g.stroke();
  g.restore();
}

function chile(g: Ctx, w: number, h: number) {
  hStripes(g, w, h, ['#FFFFFF', '#D52B1E']);
  rect(g, '#0039A6', 0, 0, h / 2, h / 2);
  star(g, h / 4, h / 4, h / 8, '#FFFFFF');
}

function australia(g: Ctx, w: number, h: number) {
  rect(g, '#012169', 0, 0, w, h);
  unionJack(g, w / 2, h / 2);
  star(g, w / 4, h * 0.75, h * 0.15, '#FFFFFF', 7, 4 / 9);
  southernCross(g, w, h, '#FFFFFF', [
    [0.75, 0.8333, 1 / 14, 7],
    [0.625, 0.4375, 1 / 14, 7],
    [0.75, 0.1667, 1 / 14, 7],
    [0.8693, 0.3792, 1 / 14, 7],
    [0.8063, 0.5583, 1 / 24, 5],
  ]);
}

function newZealand(g: Ctx, w: number, h: number) {
  rect(g, '#012169', 0, 0, w, h);
  unionJack(g, w / 2, h / 2);
  southernCross(
    g,
    w,
    h,
    '#C8102E',
    [
      [0.75, 0.8, 0.05, 5],
      [0.635, 0.47, 0.044, 5],
      [0.75, 0.2, 0.044, 5],
      [0.855, 0.39, 0.038, 5],
    ],
    '#FFFFFF',
  );
}

function swiss(g: Ctx, w: number, h: number) {
  rect(g, '#DA291C', 0, 0, w, h);
  const s = h * 0.625;
  const a = h * 0.1875;
  rect(g, '#FFFFFF', w / 2 - a / 2, h / 2 - s / 2, a, s);
  rect(g, '#FFFFFF', w / 2 - s / 2, h / 2 - a / 2, s, a);
}

function vietnam(g: Ctx, w: number, h: number) {
  rect(g, '#DA251D', 0, 0, w, h);
  star(g, w / 2, h / 2 + h * 0.03, h * 0.3, '#FFFF00');
}

export const FLAGS: FlagDef[] = [
  { id: 'argentina', name: 'Argentina', ratio: 1.6, draw: argentina },
  { id: 'australia', name: 'Australia', ratio: 2, draw: australia },
  { id: 'austria', name: 'Austria', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#C8102E', '#FFFFFF', '#C8102E']) },
  { id: 'belgium', name: 'Belgium', ratio: 1.15, draw: (g, w, h) => vBands(g, w, h, ['#000000', '#FDDA24', '#EF3340']) },
  { id: 'brazil', name: 'Brazil', ratio: 10 / 7, draw: brazil },
  {
    id: 'canada',
    name: 'Canada',
    ratio: 2,
    draw: (g, w, h) => {
      rect(g, '#FFFFFF', 0, 0, w, h);
      const band = Math.min(w / 4, h / 2);
      rect(g, '#D52B1E', 0, 0, band, h);
      rect(g, '#D52B1E', w - band, 0, band, h);
      mapleLeaf(g, w / 2, h / 2, h * 0.86, '#D52B1E');
    },
  },
  { id: 'chile', name: 'Chile', ratio: 1.5, draw: chile },
  { id: 'china', name: 'China', ratio: 1.5, draw: china },
  { id: 'colombia', name: 'Colombia', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#FCD116', '#003893', '#CE1126'], [2, 1, 1]) },
  { id: 'czechia', name: 'Czechia', ratio: 1.5, draw: czechia },
  { id: 'denmark', name: 'Denmark', ratio: 37 / 28, draw: (g, w, h) => nordic(g, w, h, '#C8102E', '#FFFFFF', h / 7) },
  { id: 'finland', name: 'Finland', ratio: 18 / 11, draw: (g, w, h) => nordic(g, w, h, '#FFFFFF', '#002F6C', (h * 3) / 11) },
  { id: 'france', name: 'France', ratio: 1.5, draw: (g, w, h) => vBands(g, w, h, ['#002395', '#FFFFFF', '#ED2939']) },
  { id: 'germany', name: 'Germany', ratio: 5 / 3, draw: (g, w, h) => hStripes(g, w, h, ['#000000', '#DD0000', '#FFCE00']) },
  { id: 'greece', name: 'Greece', ratio: 1.5, draw: greece },
  { id: 'india', name: 'India', ratio: 1.5, draw: india },
  { id: 'indonesia', name: 'Indonesia', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#FF0000', '#FFFFFF']) },
  { id: 'ireland', name: 'Ireland', ratio: 2, draw: (g, w, h) => vBands(g, w, h, ['#169B62', '#FFFFFF', '#FF883E']) },
  { id: 'italy', name: 'Italy', ratio: 1.5, draw: (g, w, h) => vBands(g, w, h, ['#009246', '#FFFFFF', '#CE2B37']) },
  { id: 'jamaica', name: 'Jamaica', ratio: 2, draw: jamaica },
  {
    id: 'japan',
    name: 'Japan',
    ratio: 1.5,
    draw: (g, w, h) => {
      rect(g, '#FFFFFF', 0, 0, w, h);
      disc(g, w / 2, h / 2, h * 0.3, '#BC002D');
    },
  },
  { id: 'netherlands', name: 'Netherlands', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#AE1C28', '#FFFFFF', '#21468B']) },
  { id: 'newzealand', name: 'New Zealand', ratio: 2, draw: newZealand },
  { id: 'nigeria', name: 'Nigeria', ratio: 2, draw: (g, w, h) => vBands(g, w, h, ['#008751', '#FFFFFF', '#008751']) },
  { id: 'norway', name: 'Norway', ratio: 22 / 16, draw: (g, w, h) => nordic(g, w, h, '#BA0C2F', '#FFFFFF', h / 4, 0.36, '#00205B', h / 8) },
  { id: 'poland', name: 'Poland', ratio: 1.6, draw: (g, w, h) => hStripes(g, w, h, ['#FFFFFF', '#DC143C']) },
  { id: 'southafrica', name: 'South Africa', ratio: 1.5, draw: southAfrica },
  { id: 'southkorea', name: 'South Korea', ratio: 1.5, draw: korea },
  { id: 'spain', name: 'Spain', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]) },
  { id: 'sweden', name: 'Sweden', ratio: 1.6, draw: (g, w, h) => nordic(g, w, h, '#006AA7', '#FECC02', h * 0.2) },
  { id: 'switzerland', name: 'Switzerland', ratio: 1, draw: swiss },
  { id: 'thailand', name: 'Thailand', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1]) },
  { id: 'turkey', name: 'Türkiye', ratio: 1.5, draw: turkey },
  { id: 'uk', name: 'United Kingdom', ratio: 2, draw: unionJack },
  { id: 'ukraine', name: 'Ukraine', ratio: 1.5, draw: (g, w, h) => hStripes(g, w, h, ['#0057B7', '#FFD700']) },
  { id: 'usa', name: 'United States', ratio: 1.9, draw: usa },
  { id: 'vietnam', name: 'Vietnam', ratio: 1.5, draw: vietnam },
];

export function flagDef(id: string) {
  return FLAGS.find((f) => f.id === id);
}
