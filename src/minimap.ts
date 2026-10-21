import { Terrain } from './terrain';

/** Small north-up map of the park with the player's position and heading. */
export class Minimap {
  canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private half = 80;

  constructor(parent: HTMLElement, terrain: Terrain, size = 96) {
    this.size = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = Math.round(size * dpr);
    const g = this.base.getContext('2d')!;
    g.scale(dpr, dpr);
    this.drawBase(g, terrain);
  }

  private toMap(x: number, z: number): [number, number] {
    const s = this.size / (this.half * 2);
    return [(x + this.half) * s, (z + this.half) * s];
  }

  private drawBase(g: CanvasRenderingContext2D, t: Terrain) {
    const S = this.size;
    g.fillStyle = 'rgba(250,249,245,0.82)';
    g.beginPath();
    g.roundRect(0, 0, S, S, 12);
    g.fill();
    const s = S / (this.half * 2);
    for (const e of t.elements) {
      if (e.mat === 'wall') continue;
      g.save();
      const [cx, cz] = this.toMap(e.cx, e.cz);
      g.translate(cx, cz);
      g.rotate(e.rot);
      g.fillStyle = e.mat === 'ramp' ? 'rgba(184,92,62,0.55)' : 'rgba(20,20,19,0.35)';
      g.fillRect(-e.hx * s, -e.hz * s, e.hx * 2 * s, e.hz * 2 * s);
      g.restore();
    }
    for (const b of t.bowls) {
      const [cx, cz] = this.toMap(b.cx, b.cz);
      g.fillStyle = 'rgba(184,92,62,0.55)';
      g.beginPath();
      g.arc(cx, cz, b.radius * s, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(20,20,19,0.7)';
    g.lineWidth = 1;
    for (const r of t.rails) {
      if (r.kind !== 'rail') continue;
      const a = this.toMap(r.a.x, r.a.z);
      const b = this.toMap(r.b.x, r.b.z);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }

  draw(x: number, z: number, yaw: number) {
    const g = this.ctx;
    g.clearRect(0, 0, this.size, this.size);
    g.drawImage(this.base, 0, 0, this.size, this.size);
    const [px, pz] = this.toMap(x, z);
    g.save();
    g.translate(px, pz);
    g.rotate(yaw);
    g.fillStyle = '#D97757';
    g.strokeStyle = '#141413';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(6, 0);
    g.lineTo(-4, 4);
    g.lineTo(-2, 0);
    g.lineTo(-4, -4);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
