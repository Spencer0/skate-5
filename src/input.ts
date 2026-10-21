import { classify, StickSample, TrickSpec, PREP } from './tricks';
import { GrindMod } from './tricks';

export type Action = { type: 'flick'; spec: TrickSpec } | { type: 'catch' } | { type: 'respawn' };

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  t0: number;
  travel: number;
  samples: StickSample[];
}

/**
 * Two floating thumb sticks:
 *  - left half: steer (drag), push (tap), hold up = keep pushing, hold down = powerslide
 *  - right half: the flick trick stick. Tap in the air to catch.
 */
export class Input {
  steer = 0;
  pushHold = false;
  brake = false;
  grindMod: GrindMod = 'none';
  crouch = false;
  actions: Action[] = [];
  private pushQueued = false;
  private left: Stick | null = null;
  private right: Stick | null = null;
  private keys = new Set<string>();
  private R = 56;
  private ctx: CanvasRenderingContext2D;
  private trail: { x: number; y: number; t: number }[] = [];
  private fading: { stick: Stick; t: number; side: 'l' | 'r' }[] = [];
  onFirstInput: (() => void) | null = null;
  enabled = true;

  constructor(private overlay: HTMLCanvasElement) {
    this.ctx = overlay.getContext('2d')!;
    const el = overlay;
    el.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.up(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.up(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.left = this.right = null;
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(window.innerWidth * dpr);
    this.overlay.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.R = Math.max(42, Math.min(68, Math.min(window.innerWidth, window.innerHeight) * 0.1));
  }

  private now() {
    return performance.now() / 1000;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (!this.enabled) return;
    this.onFirstInput?.();
    try {
      this.overlay.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const isLeft = e.clientX < window.innerWidth * 0.5;
    const s: Stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, t0: this.now(), travel: 0, samples: [] };
    s.samples.push({ t: s.t0, x: 0, y: 0 });
    if (isLeft) {
      if (this.left) return;
      this.left = s;
    } else {
      if (this.right) return;
      this.right = s;
      this.trail = [{ x: e.clientX, y: e.clientY, t: s.t0 }];
      // a fresh touch on the trick pad catches the board
      this.actions.push({ type: 'catch' });
    }
  }

  private move(e: PointerEvent) {
    const s = this.left?.id === e.pointerId ? this.left : this.right?.id === e.pointerId ? this.right : null;
    if (!s) return;
    e.preventDefault();
    // coalesced events give a smoother gesture path on fast flicks
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = evs.length ? evs : [e];
    for (const ev of list) {
      const dx = ev.clientX - s.ox;
      const dy = ev.clientY - s.oy;
      s.travel = Math.max(s.travel, Math.hypot(dx, dy));
      const rx = dx / this.R;
      const ry = -dy / this.R;
      let x = rx;
      let y = ry;
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      s.x = x;
      s.y = y;
      const t = this.now();
      s.samples.push({ t, x, y, rx, ry });
      if (s === this.right) this.trail.push({ x: ev.clientX, y: ev.clientY, t });
    }
    // left stick follows the thumb if it drifts far away (floating stick)
    if (s === this.left) {
      const dx = e.clientX - s.ox;
      const dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      const lim = this.R * 1.6;
      if (d > lim) {
        s.ox += (dx / d) * (d - lim);
        s.oy += (dy / d) * (d - lim);
      }
    }
  }

  private up(e: PointerEvent) {
    if (this.left?.id === e.pointerId) {
      const s = this.left;
      const dur = this.now() - s.t0;
      if (dur < 0.25 && s.travel < 16) this.pushQueued = true;
      this.fading.push({ stick: s, t: this.now(), side: 'l' });
      this.left = null;
    } else if (this.right?.id === e.pointerId) {
      const s = this.right;
      const spec = classify(s.samples);
      if (spec) this.actions.push({ type: 'flick', spec });
      this.fading.push({ stick: s, t: this.now(), side: 'r' });
      this.right = null;
    }
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (down && !this.keys.has(k)) {
      this.onFirstInput?.();
      const nollie = e.shiftKey;
      const mk = (flip: number, shove: number, wrap = 0): TrickSpec => ({ flip, shove, wrap, nollie, speed: 1, label: '' });
      const map: Record<string, TrickSpec> = {
        ' ': mk(0, 0),
        i: mk(0, 0),
        j: mk(1, 0),
        l: mk(-1, 0),
        u: mk(0, -1),
        o: mk(0, 1),
        '1': mk(1, -1),
        '2': mk(-1, 1),
        '3': mk(1, -2),
        '4': mk(-1, 2),
        '5': mk(1, 1),
        '6': mk(-1, -1),
        '7': mk(0, -2),
        '8': mk(0, 2),
        '9': mk(0, 0, 1),
      };
      if (k === 'k' || k === 'enter') this.actions.push({ type: 'catch' });
      else if (k === 'r') this.actions.push({ type: 'respawn' });
      else if (map[k]) {
        // keyboard: space catches if something is spinning, otherwise pops
        if (k === ' ') this.actions.push({ type: 'catch' });
        this.actions.push({ type: 'flick', spec: map[k] });
      }
      if (k === 'w' || k === 'arrowup') this.pushQueued = true;
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  /** Called once per frame before stepping the game. */
  poll() {
    let steer = 0;
    if (this.left) {
      const dz = 0.1;
      const x = this.left.x;
      const a = Math.max(0, Math.abs(x) - dz) / (1 - dz);
      steer = Math.sign(x) * Math.pow(a, 1.35);
    }
    if (this.keys.has('a') || this.keys.has('arrowleft')) steer -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) steer += 1;
    this.steer = Math.max(-1, Math.min(1, steer));
    this.pushHold = (this.left !== null && this.left.y > 0.6) || this.keys.has('w') || this.keys.has('arrowup');
    this.brake = (this.left !== null && this.left.y < -0.6) || this.keys.has('s') || this.keys.has('arrowdown');
    const r = this.right;
    let mod: GrindMod = 'none';
    if (r) {
      if (r.y > 0.5) mod = 'nose';
      else if (r.y < -0.5) mod = 'tail';
    }
    if (this.keys.has('n')) mod = 'nose';
    if (this.keys.has('m')) mod = 'tail';
    this.grindMod = mod;
    this.crouch = !!r && r.samples.some((s) => Math.abs(s.y) > PREP) && Math.abs(r.y) > PREP;
    const push = this.pushQueued;
    this.pushQueued = false;
    return push;
  }

  /** Draw stick rings and the gesture trail. */
  draw() {
    const g = this.ctx;
    const W = window.innerWidth;
    const H = window.innerHeight;
    g.clearRect(0, 0, W, H);
    const now = this.now();
    const R = this.R;
    const ring = (x: number, y: number, a: number, accent: boolean) => {
      g.globalAlpha = a;
      g.lineWidth = 2;
      g.strokeStyle = accent ? 'rgba(217,119,87,0.9)' : 'rgba(250,249,245,0.75)';
      g.fillStyle = 'rgba(20,20,19,0.12)';
      g.beginPath();
      g.arc(x, y, R, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      // load zone hint
      g.strokeStyle = 'rgba(250,249,245,0.25)';
      g.beginPath();
      g.moveTo(x - R, y);
      g.lineTo(x + R, y);
      g.stroke();
      g.globalAlpha = 1;
    };
    const knob = (x: number, y: number, a: number, col: string) => {
      g.globalAlpha = a;
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, R * 0.36, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    };
    for (const f of this.fading) {
      const age = now - f.t;
      const a = Math.max(0, 1 - age / 0.25);
      ring(f.stick.ox, f.stick.oy, a * 0.6, f.side === 'r');
    }
    this.fading = this.fading.filter((f) => now - f.t < 0.25);
    if (this.left) {
      const s = this.left;
      ring(s.ox, s.oy, 0.9, false);
      knob(s.ox + s.x * R, s.oy - s.y * R, 0.85, 'rgba(250,249,245,0.85)');
    }
    if (this.right) {
      const s = this.right;
      ring(s.ox, s.oy, 0.9, true);
      knob(s.ox + s.x * R, s.oy - s.y * R, 0.9, 'rgba(217,119,87,0.95)');
    }
    // gesture trail
    this.trail = this.trail.filter((p) => now - p.t < 0.45);
    if (this.trail.length > 1) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        const q = this.trail[i - 1];
        const a = Math.max(0, 1 - (now - p.t) / 0.45);
        g.strokeStyle = `rgba(217,119,87,${a * 0.85})`;
        g.lineWidth = 3 + a * 7;
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
    }
  }
}
