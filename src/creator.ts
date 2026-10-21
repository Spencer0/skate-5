import { RiderStage } from './stage';
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
  SHAPES,
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
  private stage: RiderStage;

  constructor(
    parent: HTMLElement,
    private look: CustomLook,
    private onChange: (look: CustomLook) => void,
  ) {
    this.root = el('div', 'creator', parent);
    this.stage = new RiderStage(el('div', 'creator-stage', this.root));
    this.panel = el('div', 'creator-panel', this.root);
    this.rebuildRider();
    this.renderPanel();
  }

  dispose() {
    this.stage.dispose();
    this.root.remove();
  }

  private rebuildRider() {
    this.stage.show('custom', this.look);
  }

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
        this.slider(body, 'Height', L.height, `${Math.round(heightOf(L) * 100)} cm`, (v) => this.quiet({ height: v }), true);
        for (const d of SHAPES) {
          this.slider(body, d.label, L.shape[d.id] ?? 0.5, '', (v) => this.shape(d.id, v), false, [d.lo, d.hi]);
        }
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

  /** A body shape slider: blends morph targets in place, no rebuild. */
  private shape(id: string, v: number) {
    this.look = { ...this.look, shape: { ...this.look.shape, [id]: v } };
    this.stage.reshape(this.look);
    this.onChange(this.look);
  }

  private slider(parent: HTMLElement, label: string, v: number, text: string, change: (v: number) => void, isHeight = false, ends?: [string, string]) {
    const head = el('div', 'opt-label', parent, label + (text ? ' · ' : ''));
    const val = el('span', 'creator-val', head, text);
    const input = el('input', 'creator-range', parent) as HTMLInputElement;
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(v);
    input.addEventListener('input', () => {
      const n = Number(input.value);
      change(n);
      if (isHeight) {
        val.textContent = `${Math.round(heightOf(this.look) * 100)} cm`;
        this.stage.setHeight(heightOf(this.look));
      }
    });
    if (isHeight) {
      input.addEventListener('change', () => {
        this.rebuildRider();
        this.onChange(this.look);
      });
      input.setAttribute('aria-label', `${label} (${HEIGHT_MIN}–${HEIGHT_MAX} m)`);
    } else if (ends) {
      const row = el('div', 'creator-ends', parent);
      el('span', '', row, ends[0]);
      el('span', '', row, ends[1]);
      input.setAttribute('aria-label', `${label}: ${ends[0]} to ${ends[1]}`);
    }
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
    this.stage.recolor(this.look);
  }
}
