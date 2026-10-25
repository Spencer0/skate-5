import { LEVELS, PARKS, Level, GoalDef } from './levels';
import { Career, STATS, STAT_MAX, DECKS, SPECIALS, Medal } from './career';
import { deckTexture } from './textures';
import { RIDERS, RiderId, RiderStyle } from './rider';
import { RiderStage } from './stage';
import { CAMERAS, NPC_SETTINGS, NpcSetting } from './settings';
import { Creator } from './creator';
import { EXTRA_AUTHORS, defaultLook } from './custom';
import { OPENING_ID } from './opening';
import { FILM_ID } from './filmthis';

export type RunMode = 'career' | 'free' | 'comp';

export interface UIHooks {
  startRun(levelIndex: number, mode: RunMode): void;
  resume(): void;
  restartRun(): void;
  endRun(): void;
  quit(): void;
  playIntro(levelIndex: number, then: () => void): void;
  /** the story opening; with no `then` it drops you straight into a chapter 1 run */
  playOpening(then?: () => void): void;
  /** chapter 2's cold open; with no `then` it drops you straight into a chapter 2 run */
  playFilmThis(then?: () => void): void;
  previewGoal(levelIndex: number, goal: GoalDef, back: () => void): void;
  toggleSound(): boolean;
  isMuted(): boolean;
  showTricks(): void;
  firstTap(): void;
  startTutorial(): void;
  tutorialPlayed(): boolean;
  inTutorial(): boolean;
  deckChanged(id: string): void;
  statsChanged(): void;
  riderChanged(): void;
  getCamera(): number;
  setCamera(i: number): void;
  getRiderStyle(): RiderStyle;
  getAutoRevert(): boolean;
  setAutoRevert(v: boolean): void;
  setRiderStyle(s: RiderStyle): void;
  getRecording(): boolean;
  setRecording(v: boolean): void;
  getNpcs(): NpcSetting;
  setNpcs(v: NpcSetting): void;
  openStudio(): void;
}

export interface RunReport {
  levelIndex: number;
  score: number;
  bestCombo: number;
  goals: GoalDef[];
  unlocks: string[];
  newBest: boolean;
  chapterUnlocked: boolean;
  timeUp: boolean;
}

export interface Standing {
  name: string;
  heats: number[];
  you?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const ICON: Record<GoalDef['kind'], string> = {
  score: '★',
  combo: '✕',
  comboCount: '✕',
  letters: 'C',
  tape: '▣',
  objects: '◎',
  gap: '⤴',
  grind: '═',
  air: '↑',
  trick: '↻',
  medal: '◆',
};

export function bestTwo(heats: number[]) {
  const s = [...heats].sort((a, b) => b - a);
  if (s.length === 0) return 0;
  if (s.length === 1) return s[0];
  return Math.round((s[0] + s[1]) / 2);
}

/** All the full-screen menus. One card at a time, rebuilt on every view. */
export class UI {
  root: HTMLElement;
  private card: HTMLElement;
  open = true;
  private tapped = false;
  private deckThumbs = new Map<string, string>();

  constructor(
    parent: HTMLElement,
    private career: Career,
    private hooks: UIHooks,
  ) {
    this.root = el('div', 'menu', parent);
    this.card = el('div', 'menu-card', this.root);
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.tapped) {
        this.tapped = true;
        this.hooks.firstTap();
      }
    });
  }

  /** Tears down whatever the current screen owns (a 3D preview). */
  private cleanup: (() => void) | null = null;

  private reset(cls = '') {
    this.cleanup?.();
    this.cleanup = null;
    this.open = true;
    this.root.classList.add('on');
    this.card.className = 'menu-card ' + cls;
    this.card.replaceChildren();
    this.card.scrollTop = 0;
  }

  hide() {
    this.cleanup?.();
    this.cleanup = null;
    this.open = false;
    this.root.classList.remove('on');
  }

  private button(parent: HTMLElement, text: string, fn: () => void, cls = '') {
    const b = el('button', 'menu-btn ' + cls, parent, text) as HTMLButtonElement;
    b.addEventListener('click', fn);
    return b;
  }

  private header(title: string, back: (() => void) | null, right?: HTMLElement) {
    const h = el('div', 'menu-head', this.card);
    if (back) {
      const b = el('button', 'menu-back', h, '‹') as HTMLButtonElement;
      b.setAttribute('aria-label', 'Back');
      b.addEventListener('click', back);
    }
    el('h2', 'menu-h', h, title);
    if (right) h.appendChild(right);
  }

  /* -------------------------------------------------------------- */

  showTitle() {
    this.reset('title');
    el('div', 'menu-title', this.card, 'Skate Nations');
    el('div', 'menu-sub', this.card, 'flick-stick skateboarding');
    const btns = el('div', 'menu-btns', this.card);
    // the tutorial leads the menu and glows until it's been played once
    const fresh = !this.hooks.tutorialPlayed();
    const tut = this.button(btns, 'Tutorial', () => this.hooks.startTutorial(), fresh ? 'primary tut-new' : '');
    if (fresh) el('span', 'menu-badge', tut, 'New');
    this.button(btns, 'Career', () => this.showCareer(), fresh ? '' : 'primary');
    this.button(btns, 'Free Skate', () => this.showFree());
    this.button(btns, 'Skater', () => this.showSkater('rider', () => this.showTitle()));
    this.button(btns, 'Options', () => this.showOptions(() => this.showTitle()));
    this.button(btns, 'Studio', () => this.hooks.openStudio());
    this.button(btns, 'How to play', () => this.hooks.showTricks());
    const done = this.career.totalDone();
    el('div', 'menu-foot', this.card, done ? `Career: ${done}/${this.career.totalGoals()} goals` : 'Best in landscape · headphones on');
  }

  showCareer() {
    if (!this.career.data.rider) return this.showRiderPick(() => this.showCareer());
    this.reset('wide');
    const pts = this.career.statPointsFree();
    const chip = el('button', 'menu-chip' + (pts ? ' hot' : ''), document.createElement('div'), pts ? `Skater · ${pts} pts` : 'Skater') as HTMLButtonElement;
    chip.addEventListener('click', () => this.showSkater(pts ? 'stats' : 'rider', () => this.showCareer()));
    this.header('Career', () => this.showTitle(), chip);
    const total = this.career.totalDone();
    const sum = el('div', 'career-sum', this.card);
    el('span', '', sum, `${total}/${this.career.totalGoals()} goals`);
    const bar = el('div', 'chapter-bar', sum);
    el('div', 'chapter-fill', bar).style.width = `${(total / this.career.totalGoals()) * 100}%`;
    const list = el('div', 'chapter-grid', this.card);
    LEVELS.forEach((L, i) => {
      const unlocked = this.career.isUnlocked(i);
      const done = this.career.doneCount(L);
      const item = el('button', 'chapter' + (unlocked ? '' : ' locked') + (L.kind === 'comp' ? ' comp' : ''), list) as HTMLButtonElement;
      el('div', 'chapter-tag', item, L.tagline);
      el('div', 'chapter-name', item, L.name);
      el('div', 'chapter-blurb', item, unlocked ? L.blurb : '');
      const meta = el('div', 'chapter-meta', item);
      if (unlocked) {
        meta.textContent = `${done}/${L.goals.length} goals` + (L.kind === 'comp' && this.career.data.medal ? ` · ${this.career.data.medal} medal` : '');
        const b = el('div', 'chapter-bar', item);
        el('div', 'chapter-fill', b).style.width = `${(done / L.goals.length) * 100}%`;
        item.addEventListener('click', () => {
          // a brand new story starts with the opening and goes straight into a run;
          // chapter 1's intro then plays after that first run. Chapter 2 does the same with its cold open.
          if (i === 0 && !this.career.seen(L.intro.id) && !this.career.seen(OPENING_ID)) this.hooks.playOpening();
          else if (i === 1 && !this.career.seen(L.intro.id) && !this.career.seen(FILM_ID)) this.hooks.playFilmThis();
          else if (!this.career.seen(L.intro.id) && i !== 0) this.hooks.playIntro(i, () => this.showLevel(i));
          else this.showLevel(i);
        });
      } else {
        const prev = LEVELS[i - 1];
        meta.textContent = `🔒 Complete ${prev.unlockAt} goals in ${prev.name} (${this.career.doneCount(prev)}/${prev.unlockAt})`;
        item.disabled = true;
      }
    });
  }

  showLevel(i: number, tab: 'goals' | 'gaps' = 'goals') {
    const L = LEVELS[i];
    this.reset('wide');
    this.header(L.name, () => this.showCareer());
    el('div', 'menu-tag', this.card, L.tagline);
    const tabs = el('div', 'tabs', this.card);
    const t1 = el('button', 'tab' + (tab === 'goals' ? ' on' : ''), tabs, `Goals ${this.career.doneCount(L)}/${L.goals.length}`);
    t1.addEventListener('click', () => this.showLevel(i, 'goals'));
    if (L.kind === 'street' || L.id === 'arena') {
      const t2 = el('button', 'tab' + (tab === 'gaps' ? ' on' : ''), tabs, 'Gaps');
      t2.addEventListener('click', () => this.showLevel(i, 'gaps'));
    }
    if (tab === 'goals') this.goalList(this.card, L, i, true);
    else this.gapList(this.card, L);
    const btns = el('div', 'menu-btns row', this.card);
    if (L.kind === 'comp') this.button(btns, 'Enter the contest · 3 heats', () => this.hooks.startRun(i, 'comp'), 'primary');
    else this.button(btns, `Start run · ${Math.floor(L.runTime / 60)}:${String(L.runTime % 60).padStart(2, '0')}`, () => this.hooks.startRun(i, 'career'), 'primary');
    this.button(btns, 'Free skate here', () => this.hooks.startRun(i, 'free'));
    if (i === 0) this.button(btns, 'Replay opening', () => this.hooks.playOpening(() => this.showLevel(i)));
    if (i === 1) this.button(btns, 'Replay cold open', () => this.hooks.playFilmThis(() => this.showLevel(i)));
    this.button(btns, 'Replay intro', () => this.hooks.playIntro(i, () => this.showLevel(i)));
    if (L.kind === 'street') el('p', 'menu-p small', this.card, i < LEVELS.length - 1 ? `Complete ${L.unlockAt} goals to unlock ${LEVELS[i + 1].name}. Every goal earns a stat point.` : '');
  }

  goalList(parent: HTMLElement, L: Level, i: number, interactive: boolean) {
    const ul = el('ul', 'goal-list', parent);
    for (const g of L.goals) {
      const done = this.career.isDone(L, g.id);
      const li = el('li', done ? 'done' : '', ul);
      el('span', 'goal-icon k-' + g.kind, li, ICON[g.kind]);
      const txt = el('div', 'goal-body', li);
      el('div', 'goal-text', txt, g.text);
      if (interactive && g.hint) el('div', 'goal-hint', txt, g.hint);
      el('span', 'goal-check', li, done ? '✓' : '');
      if (interactive && this.canPreview(L, g)) {
        const eye = el('button', 'goal-eye', li, 'Show') as HTMLButtonElement;
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hooks.previewGoal(i, g, () => this.showLevel(i));
        });
      }
    }
  }

  private canPreview(L: Level, g: GoalDef) {
    return !!g.view || g.kind === 'gap' || g.kind === 'letters' || g.kind === 'objects' || (L.kind === 'street' && g.kind === 'tape');
  }

  private gapList(parent: HTMLElement, L: Level) {
    const found = this.career.gapsFound(L);
    // gap ids repeat for two-way gaps: list each name once
    const seen = new Set<string>();
    const names = GAP_NAMES[L.id] ?? [];
    el('p', 'menu-p small', parent, `${found.length}/${names.length} gaps found. Gaps add bonus points to your combo.`);
    const ul = el('ul', 'goal-list', parent);
    for (const [id, name, pts] of names) {
      if (seen.has(id)) continue;
      seen.add(id);
      const got = found.includes(id);
      const li = el('li', got ? 'done' : '', ul);
      el('span', 'goal-icon k-gap', li, '⤴');
      const body = el('div', 'goal-body', li);
      el('div', 'goal-text', body, got ? name : '? ? ?');
      el('div', 'goal-hint', body, got ? `${fmt(pts)} pts` : 'Not found yet');
      el('span', 'goal-check', li, got ? '✓' : '');
    }
  }

  showFree() {
    this.reset();
    this.header('Free Skate', () => this.showTitle());
    el('p', 'menu-p', this.card, 'No clock, no goals. Every spot is open.');
    const list = el('div', 'chapter-list', this.card);
    PARKS.forEach((L, i) => {
      const item = el('button', 'chapter', list) as HTMLButtonElement;
      el('div', 'chapter-name', item, L.name);
      el('div', 'chapter-meta', item, L.kind === 'free' ? L.tagline : `Best run: ${fmt(this.career.bestScore(L))}`);
      item.addEventListener('click', () => this.hooks.startRun(i, 'free'));
    });
  }

  /* -------------------------------------------------------------- */

  showSkater(tab: 'rider' | 'stats' | 'decks' | 'specials', back: () => void) {
    this.reset('wide');
    this.header('Skater', back);
    const tabs = el('div', 'tabs', this.card);
    for (const [id, label] of [
      ['rider', 'Rider'],
      ['stats', 'Stats'],
      ['decks', 'Decks'],
      ['specials', 'Specials'],
    ] as const) {
      const b = el('button', 'tab' + (tab === id ? ' on' : ''), tabs, label);
      b.addEventListener('click', () => this.showSkater(id, back));
    }
    if (tab === 'rider') this.riderCards(this.card, () => this.showSkater('rider', back));
    else if (tab === 'stats') this.statsTab(back);
    else if (tab === 'decks') this.decksTab(back);
    else this.specialsTab(back);
  }

  private statsTab(back: () => void) {
    const free = this.career.statPointsFree();
    el('p', 'menu-p', this.card, free ? `${free} stat point${free > 1 ? 's' : ''} to spend. Earn one for every goal.` : 'Earn a stat point for every goal you complete.');
    const box = el('div', 'stats', this.card);
    for (const s of STATS) {
      const v = this.career.data.stats[s.id];
      const row = el('div', 'stat', box);
      const lab = el('div', 'stat-label', row);
      el('div', 'stat-name', lab, s.name);
      el('div', 'stat-desc', lab, s.desc);
      const minus = el('button', 'stat-btn', row, '−') as HTMLButtonElement;
      const pips = el('div', 'stat-pips', row);
      for (let i = 1; i <= STAT_MAX; i++) el('span', 'pip' + (i <= v ? ' on' : ''), pips);
      const plus = el('button', 'stat-btn', row, '+') as HTMLButtonElement;
      minus.disabled = v <= 4;
      plus.disabled = v >= STAT_MAX || free <= 0;
      minus.addEventListener('click', () => {
        if (this.career.addStat(s.id, -1)) this.hooks.statsChanged();
        this.showSkater('stats', back);
      });
      plus.addEventListener('click', () => {
        if (this.career.addStat(s.id, 1)) this.hooks.statsChanged();
        this.showSkater('stats', back);
      });
    }
    const reset = el('button', 'menu-link', this.card, 'Reset career…') as HTMLButtonElement;
    reset.addEventListener('click', () => {
      if (confirm('Erase all career progress?')) {
        this.career.reset();
        this.hooks.statsChanged();
        this.hooks.deckChanged('atlas');
        this.showTitle();
      }
    });
  }

  private thumb(id: string) {
    let url = this.deckThumbs.get(id);
    if (!url) {
      const t = deckTexture(id);
      url = (t.image as HTMLCanvasElement).toDataURL('image/jpeg', 0.7);
      t.dispose();
      this.deckThumbs.set(id, url);
    }
    return url;
  }

  private decksTab(back: () => void) {
    el('p', 'menu-p', this.card, 'Rep your country, or unlock pro graphics as you complete goals. Flip a trick to see them.');
    for (const [set, title] of [
      ['pro', 'Pro decks'],
      ['flag', 'Flags'],
    ] as const)
      this.deckSet(set, title, back);
  }

  private deckSet(set: 'pro' | 'flag', title: string, back: () => void) {
    el('div', 'deck-set', this.card, title);
    const grid = el('div', 'deck-grid', this.card);
    for (const d of DECKS.filter((x) => x.set === set)) {
      const ok = this.career.deckUnlocked(d);
      const item = el('button', 'deck' + (ok ? '' : ' locked') + (this.career.data.deck === d.id ? ' on' : ''), grid) as HTMLButtonElement;
      const img = el('img', 'deck-img', item) as HTMLImageElement;
      img.src = this.thumb(d.id);
      el('div', 'deck-name', item, d.name);
      el('div', 'deck-need', item, ok ? (this.career.data.deck === d.id ? 'Riding' : 'Tap to ride') : d.needs === 'gold' ? 'Win gold at the Nations Cup' : `${d.needs} goals`);
      if (ok)
        item.addEventListener('click', () => {
          this.career.data.deck = d.id;
          this.career.save();
          this.hooks.deckChanged(d.id);
          this.showSkater('decks', back);
        });
      else item.disabled = true;
    }
  }

  private specialsTab(back: () => void) {
    el('p', 'menu-p', this.card, 'Land tricks to fill the special meter. When it glows, tap ★ in the air for your special. Catch it like any flip!');
    const list = el('div', 'chapter-list', this.card);
    const eq = this.career.equippedSpecial();
    for (const s of SPECIALS) {
      const ok = this.career.specialUnlocked(s);
      const item = el('button', 'chapter' + (ok ? '' : ' locked') + (eq?.id === s.id ? ' picked' : ''), list) as HTMLButtonElement;
      el('div', 'chapter-name', item, (eq?.id === s.id ? '★ ' : '') + s.name);
      el('div', 'chapter-blurb', item, ok ? s.desc : `Unlocks at ${s.needs} goals`);
      if (ok)
        item.addEventListener('click', () => {
          this.career.data.special = s.id;
          this.career.save();
          this.showSkater('specials', back);
        });
      else item.disabled = true;
    }
  }

  /* -------------------------------------------------------------- */

  /** First time into the career: pick who you are. */
  showRiderPick(then: () => void) {
    this.reset('wide');
    this.header('Choose your skater', () => this.showTitle());
    el('p', 'menu-p', this.card, 'Each rider has their own strengths. You can switch any time from the Skater menu.');
    this.riderCards(this.card, then);
  }

  /**
   * The skater picker: a roster on the right, a turntable preview of the
   * highlighted skater on the left (wide screens only). Picking a row only
   * highlights it; the button underneath commits.
   */
  private riderCards(parent: HTMLElement, onPick: () => void) {
    const statName: Record<string, string> = { speed: 'Speed', ollie: 'Ollie', spin: 'Spin', flip: 'Flip', balance: 'Balance' };
    const cur = this.career.data.rider ?? 'brock';
    let sel: RiderId = cur;
    const wrap = el('div', 'roster', parent);
    let stage: RiderStage | null = null;
    if (window.matchMedia('(min-width: 760px) and (min-height: 480px)').matches) {
      stage = new RiderStage(el('div', 'roster-stage', wrap));
      this.cleanup = () => stage?.dispose();
    }
    const side = el('div', 'roster-side', wrap);
    const list = el('div', 'roster-list', side);
    const actions = el('div', 'menu-btns row roster-actions', side);

    const preview = () => {
      if (!stage) return;
      stage.show(sel, sel === 'custom' ? (this.career.customLook() ?? defaultLook()) : null);
    };
    const ride = (id: RiderId) => {
      this.career.data.rider = id;
      this.career.save();
      this.hooks.riderChanged();
      onPick();
    };
    const draw = () => {
      list.replaceChildren();
      actions.replaceChildren();
      for (const r of RIDERS) {
        const row = el('button', 'roster-row' + (sel === r.id ? ' sel' : '') + (cur === r.id ? ' riding' : ''), list) as HTMLButtonElement;
        row.style.setProperty('--accent', r.color);
        const top = el('div', 'roster-top', row);
        el('div', 'rider-title', top, r.id === 'custom' && this.career.data.custom ? 'Custom' : r.title);
        if (cur === r.id) el('div', 'roster-badge', top, 'Riding');
        el('div', 'rider-name', row, r.id === 'custom' && this.career.data.custom ? 'Your skater' : r.name);
        if (sel === r.id) {
          el('div', 'rider-desc', row, r.desc);
          const chips = el('div', 'rider-chips', row);
          const bias = Object.entries(r.bias);
          if (!bias.length) el('span', 'chip', chips, 'No strengths, no weaknesses');
          for (const [k, v] of bias) el('span', 'chip ' + (v! > 0 ? 'up' : 'down'), chips, `${statName[k]} ${v! > 0 ? '+' : ''}${v}`);
        }
        row.addEventListener('click', () => {
          if (sel === r.id) return;
          sel = r.id;
          preview();
          draw();
        });
      }
      const r = RIDERS.find((x) => x.id === sel)!;
      if (sel === 'custom') {
        const saved = !!this.career.data.custom;
        this.button(actions, saved ? 'Edit' : 'Create your skater', () => this.showCreator(onPick), saved ? '' : 'primary');
        if (saved) this.button(actions, cur === 'custom' ? 'Riding ✓' : 'Ride as this skater', () => ride('custom'), 'primary');
      } else {
        this.button(actions, cur === sel ? 'Riding ✓' : `Ride as ${r.name.replace(/^Dr\. /, '').split(' ')[0]}`, () => ride(sel), 'primary');
      }
    };
    draw();
    preview();
  }

  /** Build your own skater; Ride saves the look and makes it the active rider. */
  showCreator(back: () => void) {
    this.reset('creator-card');
    let look = this.career.customLook() ?? defaultLook();
    this.header('Create your skater', () => {
      creator.dispose();
      back();
    });
    const creator = new Creator(this.card, look, (l) => (look = l));
    const done = el('div', 'menu-btns row', this.card);
    this.button(
      done,
      'Ride as this skater',
      () => {
        creator.dispose();
        this.career.data.custom = look;
        this.career.data.rider = 'custom';
        this.career.save();
        this.hooks.riderChanged();
        back();
      },
      'primary',
    );
  }

  showOptions(back: () => void) {
    this.reset();
    this.header('Options', back);
    const seg = (label: string, items: { id: string; name: string }[], cur: string, set: (id: string) => void) => {
      el('div', 'opt-label', this.card, label);
      const row = el('div', 'seg', this.card);
      for (const it of items) {
        const b = el('button', 'seg-btn' + (it.id === cur ? ' on' : ''), row, it.name);
        b.addEventListener('click', () => {
          set(it.id);
          this.showOptions(back);
        });
      }
    };
    seg(
      'Camera',
      CAMERAS.map((c, i) => ({ id: String(i), name: c.name })),
      String(this.hooks.getCamera()),
      (id) => this.hooks.setCamera(Number(id)),
    );
    el('p', 'menu-p small', this.card, 'Tip: the camera button in the corner cycles views while you skate.');
    seg(
      'Skater on the board',
      [
        { id: 'ghost', name: 'Ghost' },
        { id: 'solid', name: 'Solid' },
        { id: 'off', name: 'Board only' },
      ],
      this.hooks.getRiderStyle(),
      (id) => this.hooks.setRiderStyle(id as RiderStyle),
    );
    el('p', 'menu-p small', this.card, 'Ghost keeps the rider see-through so you can always read the board.');
    seg(
      'Auto-revert',
      [
        { id: 'on', name: 'On' },
        { id: 'off', name: 'Off (ride fakie)' },
      ],
      this.hooks.getAutoRevert() ? 'on' : 'off',
      (id) => this.hooks.setAutoRevert(id === 'on'),
    );
    el('p', 'menu-p small', this.card, 'Pivot to face forward after rolling back down a ramp. Vert airs always turn you around.');
    seg(
      'Recording',
      [
        { id: 'off', name: 'Off' },
        { id: 'on', name: 'On' },
      ],
      this.hooks.getRecording() ? 'on' : 'off',
      (id) => this.hooks.setRecording(id === 'on'),
    );
    el('p', 'menu-p small', this.card, 'Adds a ● REC button while you skate (or press V). Saved clips go to the Studio on the title screen, where you cut them into a video and export an MP4.');
    seg('Park locals', NPC_SETTINGS, this.hooks.getNpcs(), (id) => this.hooks.setNpcs(id as NpcSetting));
    el('p', 'menu-p small', this.card, 'Other skaters sessioning the park with you. Turn them down on slower phones.');
    seg(
      'Sound',
      [
        { id: 'on', name: 'On' },
        { id: 'off', name: 'Off' },
      ],
      this.hooks.isMuted() ? 'off' : 'on',
      (id) => {
        if ((id === 'off') !== this.hooks.isMuted()) this.hooks.toggleSound();
      },
    );
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Done', back, 'primary');
  }

  showPause(i: number, mode: RunMode) {
    const L = PARKS[i];
    this.reset();
    const tut = this.hooks.inTutorial();
    this.header(tut ? 'Tutorial' : mode === 'free' ? `${L.name} · Free Skate` : L.name, null);
    if (mode !== 'free') this.goalList(this.card, L, i, false);
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Resume', () => this.hooks.resume(), 'primary');
    if (tut) {
      this.button(btns, 'Restart tutorial', () => this.hooks.restartRun());
      this.button(btns, 'Quit tutorial', () => this.hooks.quit());
      return;
    }
    if (mode === 'career') this.button(btns, 'Restart run', () => this.hooks.restartRun());
    if (mode === 'career') this.button(btns, 'End run', () => this.hooks.endRun());
    if (mode === 'free') this.button(btns, 'Back to start', () => this.hooks.restartRun());
    this.button(btns, 'Trick list', () => this.hooks.showTricks());
    this.button(btns, 'Options', () => this.showOptions(() => this.showPause(i, mode)));
    this.button(btns, mode === 'comp' ? 'Withdraw from contest' : 'Quit to menu', () => this.hooks.quit());
  }

  showRunEnd(r: RunReport, next: { retry: () => void; level: () => void; nextChapter: (() => void) | null }) {
    const L = LEVELS[r.levelIndex];
    this.reset('summary');
    el('div', 'menu-tag', this.card, r.timeUp ? "Time's up" : 'Run ended');
    el('div', 'menu-title small', this.card, L.name);
    const score = el('div', 'sum-score', this.card, '0');
    let shown = 0;
    const step = () => {
      shown = Math.min(r.score, shown + Math.max(37, r.score / 40));
      score.textContent = fmt(shown);
      if (shown < r.score && this.open) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    const stats = el('div', 'sum-stats', this.card);
    el('div', '', stats, `Best combo ${fmt(r.bestCombo)}`);
    if (r.newBest) el('div', 'hot', stats, 'New best run!');
    if (r.goals.length) {
      el('div', 'sum-h', this.card, `Goals completed · +${r.goals.length} stat point${r.goals.length > 1 ? 's' : ''}`);
      const ul = el('ul', 'goal-list stamps', this.card);
      r.goals.forEach((g, k) => {
        const li = el('li', 'done stamp', ul);
        li.style.animationDelay = `${0.25 + k * 0.18}s`;
        el('span', 'goal-icon k-' + g.kind, li, ICON[g.kind]);
        el('div', 'goal-text', li, g.text);
      });
    } else el('p', 'menu-p small', this.card, 'No new goals this run. Check the goal list for hints.');
    if (r.unlocks.length) {
      el('div', 'sum-h', this.card, 'Unlocked');
      const u = el('div', 'unlocks', this.card);
      for (const x of r.unlocks) el('span', 'unlock', u, x);
    }
    const left = L.goals.length - this.career.doneCount(L);
    el('p', 'menu-p small', this.card, `${L.name}: ${this.career.doneCount(L)}/${L.goals.length} goals${left ? '' : ' — 100%!'}`);
    const btns = el('div', 'menu-btns row', this.card);
    if (next.nextChapter) this.button(btns, `Continue: ${LEVELS[r.levelIndex + 1].name}`, next.nextChapter, 'primary');
    this.button(btns, 'Run again', next.retry, next.nextChapter ? '' : 'primary');
    this.button(btns, 'Goals', next.level);
  }

  showStandings(title: string, standings: Standing[], heat: number, final: boolean, onNext: () => void, medal: Medal | null) {
    this.reset('summary');
    el('div', 'menu-tag', this.card, 'The Nations Cup');
    el('div', 'menu-title small', this.card, title);
    if (final) {
      el('div', 'medal ' + (medal ?? 'none'), this.card, medal ? medal.toUpperCase() : 'NO MEDAL');
    }
    const table = el('table', 'standings', this.card);
    const head = el('tr', '', table);
    el('th', '', head, '');
    el('th', '', head, 'Rider');
    for (let h = 0; h < 3; h++) el('th', '', head, `H${h + 1}`);
    el('th', '', head, 'Final');
    const rows = [...standings].sort((a, b) => bestTwo(b.heats) - bestTwo(a.heats));
    rows.forEach((s, k) => {
      const tr = el('tr', s.you ? 'you' : '', table);
      el('td', 'pos', tr, String(k + 1));
      el('td', 'name', tr, s.name);
      for (let h = 0; h < 3; h++) el('td', '', tr, s.heats[h] !== undefined ? fmt(s.heats[h]) : '—');
      el('td', 'fin', tr, fmt(bestTwo(s.heats)));
    });
    el('p', 'menu-p small', this.card, final ? 'Final score is the average of your best two heats.' : `Heat ${heat} of 3 done. Best two heats count.`);
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, final ? 'Continue' : `Start heat ${heat + 1}`, onNext, 'primary');
    if (!final) this.button(btns, 'Withdraw', () => this.hooks.quit());
  }

  showCredits(onDone: () => void) {
    this.reset('credits');
    const roll = el('div', 'credits-roll', this.card);
    const lines: [string, string][] = [
      ['', 'Skate Nations'],
      ['Starring', 'You — the kid with the flick'],
      ['', 'Mara · Dex · Kai Moreno · Officer Pete'],
      ['Spots', 'Brazil Park · Plaza de España · Australia Pier · Japan Arena'],
      ['Characters', 'MakeHuman · MPFB (CC0)'],
      ['Outfits', `${EXTRA_AUTHORS.join(' · ')} (CC BY)`],
      ['Rendering', 'three.js'],
      ['Sound', 'Procedural WebAudio — no samples were harmed'],
      ['Special thanks', 'Everyone who ever got kicked out of a plaza'],
      ['', 'Thanks for playing. Go skate.'],
    ];
    for (const [a, b] of lines) {
      const row = el('div', 'credit', roll);
      if (a) el('div', 'credit-a', row, a);
      el('div', 'credit-b', row, b);
    }
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Keep skating', onDone, 'primary');
  }
}

/** Gap checklist names per level (id, name, points). Filled in by main on load. */
export const GAP_NAMES: Record<string, [string, string, number][]> = {};
