import * as THREE from 'three';
import { BoardModel } from './board';
import { HumanRider } from './humanrider';
import {
  BOTTOMS,
  CLOTH_COLORS,
  CustomLook,
  HAIR,
  HAIR_COLORS,
  HATS,
  HEIGHT_MAX,
  HEIGHT_MIN,
  Option,
  SHOES,
  SKIN_TONES,
  TOPS,
  heightOf,
} from './custom';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

type Tab = 'body' | 'hair' | 'hat' | 'top' | 'bottom' | 'shoes';
const TABS: [Tab, string][] = [
  ['body', 'Body'],
  ['hair', 'Hair'],
  ['hat', 'Hat'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['shoes', 'Shoes'],
];

/**
 * The create-a-skater screen: a live 3D preview (the same HumanRider the game
 * uses, standing on a board) next to the option panel. Calls onChange with the
 * look after every edit; the owner decides when to save it.
 */
export class Creator {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private tab: Tab = 'body';
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
  private board = new BoardModel();
  private rider: HumanRider | null = null;
  private pending: HumanRider | null = null;
  private yaw = -0.5;
  private dragging = false;
  private raf = 0;
  private last = 0;
  private t = 0;
  private ro: ResizeObserver;

  constructor(
    parent: HTMLElement,
    private look: CustomLook,
    private onChange: (look: CustomLook) => void,
  ) {
    this.root = el('div', 'creator', parent);
    const stage = el('div', 'creator-stage', this.root);
    this.canvas = el('canvas', 'creator-canvas', stage);
    this.panel = el('div', 'creator-panel', this.root);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7d6c, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    this.scene.add(this.board.root);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshBasicMaterial({ color: 0x141413, transparent: true, opacity: 0.08 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.002;
    this.scene.add(disc);

    // drag to turn the skater around
    let lx = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      lx = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - lx) * 0.012;
      lx = e.clientX;
    });
    const up = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    this.rebuildRider();
    this.renderPanel();
    this.frame(performance.now());
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.rider?.dispose();
    this.pending?.dispose();
    this.renderer.dispose();
    this.root.remove();
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Dress a fresh model; it replaces the shown one the moment it's loaded, so edits don't flash. */
  private rebuildRider() {
    this.pending?.dispose();
    this.pending = new HumanRider('custom', this.look);
    this.pending.group.visible = true;
    this.scene.add(this.pending.group);
    this.pending.group.visible = false;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.t += dt;
    if (this.pending?.ready) {
      if (this.rider) {
        this.scene.remove(this.rider.group);
        this.rider.dispose();
      }
      this.rider = this.pending;
      this.pending = null;
      this.rider.setStyle('solid');
      this.rider.group.visible = true;
    }
    if (!this.dragging) this.yaw += dt * 0.35;
    const h = heightOf(this.look);
    // fit the whole skater (and the board under their feet) in the frame, tall or narrow
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = this.camera.aspect || 1;
    const dist = Math.max((h + 0.3) / 2 / half, 0.9 / aspect / half);
    this.camera.position.set(Math.sin(this.yaw) * dist, h * 0.5 + 0.15, Math.cos(this.yaw) * dist);
    this.camera.lookAt(0, h * 0.5 - 0.02, 0);
    this.rider?.update(dt, { crouch: 0.1, tuck: 0, lean: 0, push: -1, grind: null, air: false, time: this.t });
    this.renderer.render(this.scene, this.camera);
  };

  /** A structural edit (different part, body or height): rebuild the model and the panel. */
  private set(patch: Partial<CustomLook>) {
    this.look = { ...this.look, ...patch };
    this.rebuildRider();
    this.onChange(this.look);
    this.renderPanel();
  }

  /** A colour edit: no rebuild, and the panel stays put so pickers and sliders keep their drag. */
  private quiet(patch: Partial<CustomLook>) {
    this.look = { ...this.look, ...patch };
  }

  /* ---------------------------------------------------------------- */

  private renderPanel() {
    const keep = this.panel.scrollTop;
    this.panel.replaceChildren();
    const tabs = el('div', 'tabs creator-tabs', this.panel);
    for (const [id, label] of TABS) {
      const b = el('button', 'tab' + (this.tab === id ? ' on' : ''), tabs, label);
      b.addEventListener('click', () => {
        this.tab = id;
        this.renderPanel();
      });
    }
    const body = el('div', 'creator-body', this.panel);
    const L = this.look;
    switch (this.tab) {
      case 'body':
        this.seg(body, 'Build', [{ id: 'm', label: 'Masculine' }, { id: 'f', label: 'Feminine' }], L.body, (id) => this.set({ body: id as CustomLook['body'] }));
        this.slider(body, 'Height', L.height, `${Math.round(heightOf(L) * 100)} cm`, (v) => this.quiet({ height: v }));
        this.swatches(body, 'Skin tone', SKIN_TONES, L.skin, (c) => this.quiet({ skin: c }), true);
        break;
      case 'hair':
        this.seg(body, 'Style', [{ id: '', label: 'Bald' }, ...HAIR], L.hair ?? '', (id) => this.set({ hair: id || null }));
        this.swatches(body, 'Hair colour', HAIR_COLORS, L.hairColor, (c) => this.quiet({ hairColor: c }), true);
        break;
      case 'hat':
        this.seg(body, 'Hat', [{ id: '', label: 'None' }, ...HATS], L.hat ?? '', (id) => this.set({ hat: id || null }));
        if (L.hat) this.swatches(body, 'Hat colour', CLOTH_COLORS, L.hatColor, (c) => this.quiet({ hatColor: c }), true);
        break;
      case 'top':
        this.seg(body, 'Top', TOPS, L.top, (id) => this.set({ top: id }));
        this.swatches(body, 'Colour', CLOTH_COLORS, L.topColor, (c) => this.quiet({ topColor: c }), true);
        break;
      case 'bottom':
        this.seg(body, 'Bottoms', BOTTOMS, L.bottom, (id) => this.set({ bottom: id }));
        this.swatches(body, 'Colour', CLOTH_COLORS, L.bottomColor, (c) => this.quiet({ bottomColor: c }), true);
        break;
      case 'shoes':
        this.seg(body, 'Shoes', SHOES, L.shoes, (id) => this.set({ shoes: id }));
        this.swatches(body, 'Colour', CLOTH_COLORS, L.shoesColor, (c) => this.quiet({ shoesColor: c }), true);
        break;
    }
    this.panel.scrollTop = keep;
  }

  private seg(parent: HTMLElement, label: string, items: Option[], cur: string, pick: (id: string) => void) {
    el('div', 'opt-label', parent, label);
    const row = el('div', 'seg', parent);
    for (const it of items) {
      const b = el('button', 'seg-btn' + (it.id === cur ? ' on' : ''), row, it.label);
      b.addEventListener('click', () => pick(it.id));
    }
  }

  private slider(parent: HTMLElement, label: string, v: number, text: string, change: (v: number) => void) {
    const head = el('div', 'opt-label', parent, label + ' · ');
    const val = el('span', 'creator-val', head, text);
    const input = el('input', 'creator-range', parent) as HTMLInputElement;
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(v);
    input.addEventListener('input', () => {
      const n = Number(input.value);
      this.look = { ...this.look, height: n };
      val.textContent = `${Math.round(heightOf(this.look) * 100)} cm`;
      change(n);
    });
    input.addEventListener('change', () => {
      this.rebuildRider();
      this.onChange(this.look);
    });
    input.setAttribute('aria-label', `${label} (${HEIGHT_MIN}–${HEIGHT_MAX} m)`);
  }

  /** Palette swatches plus a free colour picker. Colour edits tint the live materials, so no model rebuild. */
  private swatches(parent: HTMLElement, label: string, colors: string[], cur: string, pick: (c: string) => void, custom: boolean) {
    el('div', 'opt-label', parent, label);
    const row = el('div', 'swatches', parent);
    const mark = () => {
      for (const b of row.querySelectorAll<HTMLElement>('.swatch')) b.classList.toggle('on', b.dataset.c === this.currentColor());
    };
    const apply = (c: string) => {
      pick(c);
      this.recolor();
    };
    for (const c of colors) {
      const b = el('button', 'swatch', row);
      b.dataset.c = c;
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', () => {
        apply(c);
        mark();
      });
    }
    if (custom) {
      const lab = el('label', 'swatch picker', row, '+');
      const input = el('input', '', lab) as HTMLInputElement;
      input.type = 'color';
      input.value = cur;
      input.addEventListener('input', () => {
        apply(input.value);
        mark();
      });
    }
    mark();
  }

  private currentColor() {
    const L = this.look;
    return { body: L.skin, hair: L.hairColor, hat: L.hatColor, top: L.topColor, bottom: L.bottomColor, shoes: L.shoesColor }[this.tab];
  }

  /** Re-tint the visible model in place. */
  private recolor() {
    this.onChange(this.look);
    this.rider?.recolor(this.look);
    this.pending?.recolor(this.look);
  }
}
