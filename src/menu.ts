import { LEVELS } from './levels';
import { Progress } from './story';

export type PlayMode = 'story' | 'free';

export interface MenuHooks {
  onPlay(levelIndex: number, mode: PlayMode): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onToggleSound(): boolean; // returns muted
  onTricks(): void;
  onFirstTap(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Full-screen menus: title, chapter select, chapter intro, pause, chapter complete. */
export class Menu {
  root: HTMLElement;
  private card: HTMLElement;
  open = true;
  private tapped = false;

  constructor(
    parent: HTMLElement,
    private progress: Progress,
    private hooks: MenuHooks,
  ) {
    this.root = el('div', 'menu', parent);
    this.card = el('div', 'menu-card', this.root);
    // menus own their touches: keep them away from the game's touch layer
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.tapped) {
        this.tapped = true;
        this.hooks.onFirstTap();
      }
    });
    this.showTitle();
  }

  private reset(cls = '') {
    this.open = true;
    this.root.classList.add('on');
    this.card.className = 'menu-card ' + cls;
    this.card.replaceChildren();
    this.card.scrollTop = 0;
  }

  hide() {
    this.open = false;
    this.root.classList.remove('on');
  }

  private button(parent: HTMLElement, text: string, fn: () => void, cls = '') {
    const b = el('button', 'menu-btn ' + cls, parent, text) as HTMLButtonElement;
    b.addEventListener('click', fn);
    return b;
  }

  showTitle() {
    this.reset('title');
    el('div', 'menu-title', this.card, 'Claude Skate');
    el('div', 'menu-sub', this.card, 'flick-stick skateboarding');
    const rows = el('div', 'menu-rows', this.card);
    rows.innerHTML =
      '<div><b>Left thumb</b> tap to push · drag to steer</div>' +
      '<div><b>Right thumb</b> pull down, flick to pop a trick</div>' +
      '<div><b>Tap again</b> in the air to catch it — or bail</div>';
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Story Mode', () => this.showChapters(), 'primary');
    this.button(btns, 'Free Skate', () => this.showFree());
    el('div', 'menu-foot', this.card, 'Best in landscape · headphones on');
  }

  showChapters() {
    this.reset();
    this.header('Story Mode', () => this.showTitle());
    const list = el('div', 'chapter-list', this.card);
    LEVELS.forEach((L, i) => {
      const unlocked = this.progress.isUnlocked(i);
      const done = this.progress.doneCount(L);
      const item = el('button', 'chapter' + (unlocked ? '' : ' locked'), list) as HTMLButtonElement;
      el('div', 'chapter-tag', item, L.tagline);
      el('div', 'chapter-name', item, L.name);
      const meta = el('div', 'chapter-meta', item);
      if (unlocked) {
        meta.textContent = `${done}/${L.goals.length} goals`;
        const bar = el('div', 'chapter-bar', item);
        const fill = el('div', 'chapter-fill', bar);
        fill.style.width = `${(done / L.goals.length) * 100}%`;
        item.addEventListener('click', () => this.showIntro(i));
      } else {
        const prev = LEVELS[i - 1];
        meta.textContent = `Locked · complete ${prev.unlockAt} goals in ${prev.name}`;
        item.disabled = true;
      }
    });
  }

  showFree() {
    this.reset();
    this.header('Free Skate', () => this.showTitle());
    el('p', 'menu-p', this.card, 'No goals, no pressure. Unlock more spots in Story Mode.');
    const list = el('div', 'chapter-list', this.card);
    LEVELS.forEach((L, i) => {
      const unlocked = this.progress.isUnlocked(i);
      const item = el('button', 'chapter' + (unlocked ? '' : ' locked'), list) as HTMLButtonElement;
      el('div', 'chapter-name', item, L.name);
      el('div', 'chapter-meta', item, unlocked ? 'Skate' : 'Locked');
      if (unlocked) item.addEventListener('click', () => this.hooks.onPlay(i, 'free'));
      else item.disabled = true;
    });
  }

  showIntro(i: number) {
    const L = LEVELS[i];
    this.reset();
    this.header(L.name, () => this.showChapters());
    el('div', 'menu-tag', this.card, L.tagline);
    el('p', 'menu-story', this.card, L.story);
    this.goalList(this.card, i);
    if (i < LEVELS.length - 1) el('p', 'menu-p small', this.card, `Complete ${L.unlockAt} goals to unlock the next chapter.`);
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Skate', () => this.hooks.onPlay(i, 'story'), 'primary');
  }

  goalList(parent: HTMLElement, i: number) {
    const L = LEVELS[i];
    const ul = el('ul', 'goal-list', parent);
    for (const g of L.goals) {
      const done = this.progress.isDone(L, g.id);
      const li = el('li', done ? 'done' : '', ul);
      el('span', 'goal-check', li, done ? '✓' : '');
      el('span', 'goal-text', li, g.text);
    }
  }

  showPause(i: number, mode: PlayMode, muted: boolean) {
    const L = LEVELS[i];
    this.reset();
    this.header(mode === 'story' ? L.name : `${L.name} · Free Skate`, null);
    if (mode === 'story') this.goalList(this.card, i);
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Resume', () => this.hooks.onResume(), 'primary');
    this.button(btns, 'Back to start', () => this.hooks.onRestart());
    this.button(btns, 'Trick list', () => this.hooks.onTricks());
    const snd = this.button(btns, muted ? 'Sound: off' : 'Sound: on', () => {
      snd.textContent = this.hooks.onToggleSound() ? 'Sound: off' : 'Sound: on';
    });
    this.button(btns, 'Quit to menu', () => this.hooks.onQuit());
  }

  showComplete(i: number, onKeepSkating: () => void) {
    const L = LEVELS[i];
    this.reset('celebrate');
    el('div', 'menu-tag', this.card, 'Chapter unlocked');
    el('div', 'menu-title small', this.card, LEVELS[i + 1].name);
    el('p', 'menu-story', this.card, L.outro);
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, `Go to ${LEVELS[i + 1].name}`, () => this.showIntro(i + 1), 'primary');
    this.button(btns, 'Keep skating here', onKeepSkating);
  }

  showFinale(onKeepSkating: () => void) {
    const L = LEVELS[LEVELS.length - 1];
    this.reset('celebrate');
    el('div', 'menu-tag', this.card, 'Story complete');
    el('div', 'menu-title small', this.card, 'You made the team');
    el('p', 'menu-story', this.card, L.outro);
    el('p', 'menu-p', this.card, 'Every spot is open in Free Skate. Go find the lines nobody has thought of yet.');
    const btns = el('div', 'menu-btns', this.card);
    this.button(btns, 'Keep skating', onKeepSkating, 'primary');
    this.button(btns, 'Main menu', () => this.showTitle());
  }

  private header(title: string, back: (() => void) | null) {
    const h = el('div', 'menu-head', this.card);
    if (back) {
      const b = el('button', 'menu-back', h, '‹') as HTMLButtonElement;
      b.setAttribute('aria-label', 'Back');
      b.addEventListener('click', back);
    }
    el('h2', 'menu-h', h, title);
  }
}
