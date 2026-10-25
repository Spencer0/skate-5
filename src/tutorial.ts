import { trickAnywhere } from './input';

const KEY = 'skate5.tutorial';

let played: boolean | null = null;
export function tutorialPlayed() {
  if (played === null) {
    try {
      played = localStorage.getItem(KEY) === '1';
    } catch {
      played = false;
    }
  }
  return played;
}
function markPlayed() {
  played = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Which animated hand the coach shows. */
type Gesture = 'tap' | 'drag' | 'ollie' | 'kickflip' | 'catch';

interface Step {
  title: string;
  touch: string;
  mouse: string;
  gesture: Gesture;
  side: 'left' | 'right';
  keys: string[];
}

const STEPS: Step[] = [
  { title: 'Roll forward', touch: 'Tap the left side of the screen to push.', mouse: 'Press W to push.', gesture: 'tap', side: 'left', keys: ['W'] },
  { title: 'Steer', touch: 'Hold your left thumb down and drag it left and right.', mouse: 'Hold A or D to steer.', gesture: 'drag', side: 'left', keys: ['A', 'D'] },
  { title: 'Ollie', touch: 'Right thumb: pull down, then flick straight up.', mouse: 'Drag down, then flick straight up. Or press Space.', gesture: 'ollie', side: 'right', keys: ['Space'] },
  { title: 'Kickflip', touch: 'Pull down, then flick up and to the left.', mouse: 'Drag down, then flick up and to the left. Or press J.', gesture: 'kickflip', side: 'right', keys: ['J'] },
];
const CATCH: Step = { title: 'Catch it!', touch: 'Tap anywhere before you land.', mouse: 'Click or press Space before you land.', gesture: 'catch', side: 'right', keys: ['Space'] };

const PUSHES = 3;
const STEER_TIME = 1.2;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const HAND = `<svg viewBox="0 0 44 58" width="44" height="58" aria-hidden="true">
  <g class="tut-hand-shape">
    <rect x="10" y="1" width="11" height="34" rx="5.5"/>
    <rect x="19" y="20" width="10" height="17" rx="5"/>
    <rect x="27" y="24" width="10" height="16" rx="5"/>
    <rect x="34" y="29" width="9" height="14" rx="4.5"/>
    <rect x="7" y="27" width="34" height="28" rx="12"/>
    <rect x="-2" y="30" width="17" height="10" rx="5" transform="rotate(-35 6 35)"/>
  </g>
</svg>`;

/** Trail art per gesture, drawn around the coach's anchor (100, 100). */
const TRAIL: Record<Gesture, string> = {
  tap: '',
  drag: `<path class="tut-line" d="M48 100 H152"/><path class="tut-head" d="M58 90 L46 100 L58 110 M142 90 L154 100 L142 110"/>`,
  ollie: `<path class="tut-load" pathLength="1" d="M100 100 V140"/><path class="tut-flick" pathLength="1" d="M100 140 V34"/><path class="tut-head" d="M88 46 L100 32 L112 46"/>`,
  kickflip: `<path class="tut-load" pathLength="1" d="M100 100 V140"/><path class="tut-flick" pathLength="1" d="M100 140 L42 46"/><path class="tut-head" d="M41 60 L40 44 L54 52"/>`,
  catch: '',
};

/**
 * The guided first ride: push, steer, ollie, kickflip and catch. Each step
 * shows an animated hand doing the motion where your thumb goes, and moves on
 * once you've done it.
 */
export class Tutorial {
  active = false;
  private step = 0;
  private count = 0;
  private finished = false;
  private catching = false;
  private noteT = 0;
  private root: HTMLElement;
  private card: HTMLElement;
  private dots: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private note: HTMLElement;
  private progress: HTMLElement;
  private coach: HTMLElement;
  private trail: SVGSVGElement;
  private keys: HTMLElement;
  private done: HTMLElement;

  constructor(
    parent: HTMLElement,
    private hooks: { stepDone(): void; finish(next: 'career' | 'again' | 'menu'): void; skip(): void },
  ) {
    this.root = el('div', 'tut', parent);
    this.card = el('div', 'tut-card', this.root);
    const head = el('div', 'tut-head', this.card);
    this.dots = el('div', 'tut-dots', head);
    for (let i = 0; i < STEPS.length; i++) el('span', '', this.dots);
    const skip = el('button', 'tut-skip', head, 'Skip') as HTMLButtonElement;
    skip.addEventListener('click', () => {
      this.stop();
      markPlayed();
      this.hooks.skip();
    });
    this.title = el('div', 'tut-title', this.card);
    this.text = el('div', 'tut-text', this.card);
    this.progress = el('div', 'tut-progress', this.card);
    this.note = el('div', 'tut-note', this.card);

    this.coach = el('div', 'tut-coach', this.root);
    this.trail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.trail.setAttribute('class', 'tut-trail');
    this.trail.setAttribute('viewBox', '0 0 200 200');
    this.coach.appendChild(this.trail);
    el('div', 'tut-ripple', this.coach);
    el('div', 'tut-ripple r2', this.coach);
    el('div', 'tut-tap', this.coach, 'TAP!');
    const hand = el('div', 'tut-hand', this.coach);
    hand.innerHTML = HAND;
    this.keys = el('div', 'tut-keys', this.root);

    this.done = el('div', 'tut-done', this.root);
    el('div', 'tut-done-title', this.done, 'You can skate!');
    el('div', 'tut-text', this.done, 'Push, steer, ollie, kickflip, catch. That’s the core of every trick. The full trick list lives under How to play.');
    el('div', 'tut-text', this.done, 'Specials: land tricks to fill the meter under your score. When it glows, hit ★ (or E) for your special and catch it like a flip. Your first one unlocks after 4 career goals.');
    const btns = el('div', 'tut-done-btns', this.done);
    const mk = (label: string, next: 'career' | 'again' | 'menu', cls = '') => {
      const b = el('button', 'menu-btn ' + cls, btns, label) as HTMLButtonElement;
      b.addEventListener('click', () => this.hooks.finish(next));
    };
    mk('Start career', 'career', 'primary');
    mk('Keep practicing', 'again');
    mk('Main menu', 'menu');

    for (const b of this.root.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  start() {
    this.active = true;
    this.finished = false;
    this.step = 0;
    this.count = 0;
    this.catching = false;
    this.root.classList.add('on');
    this.done.classList.remove('on');
    this.render();
  }

  stop() {
    this.active = false;
    this.root.classList.remove('on');
  }

  /** Per frame while the tutorial runs. */
  update(dt: number, st: { playing: boolean; steer: number; uncaught: boolean }) {
    if (!this.active) return;
    this.root.classList.toggle('paused', !st.playing);
    if (!st.playing || this.finished) return;
    if (this.noteT > 0) {
      this.noteT -= dt;
      if (this.noteT <= 0) this.note.classList.remove('on');
    }
    if (this.step === 1 && Math.abs(st.steer) > 0.35) {
      this.count += dt;
      this.renderProgress();
      if (this.count >= STEER_TIME) this.next();
    }
    // a flip in the air at any step gets the catch prompt
    const catching = st.uncaught;
    if (catching !== this.catching) {
      this.catching = catching;
      this.render();
    }
  }

  push() {
    if (!this.active || this.step !== 0) return;
    this.count++;
    this.renderProgress();
    if (this.count >= PUSHES) this.next();
  }

  land(names: string[]) {
    if (!this.active || this.finished || !names.length) return;
    if (this.step === 2) this.next();
    else if (this.step === 3) {
      if (names.some((n) => /kickflip/i.test(n))) this.next();
      else this.say(`That was ${/^[aeiou]/i.test(names[names.length - 1]) ? 'an' : 'a'} ${names[names.length - 1]}. Flick up and to the LEFT.`);
    }
  }

  bail(reason: string) {
    if (!this.active || this.finished) return;
    if (reason === 'uncaught') this.say(trickAnywhere() ? 'Click while the board flips to catch it, then land.' : 'Tap the screen while the board flips to catch it, then land.');
    else this.say('Bailed. Shake it off and try again.');
  }

  private say(msg: string) {
    this.note.textContent = msg;
    this.note.classList.add('on');
    this.noteT = 3.2;
  }

  private next() {
    this.hooks.stepDone();
    this.card.classList.remove('ok');
    void this.card.offsetWidth;
    this.card.classList.add('ok');
    this.step++;
    this.count = 0;
    this.catching = false;
    this.note.classList.remove('on');
    if (this.step >= STEPS.length) {
      this.finished = true;
      markPlayed();
      this.card.style.display = 'none';
      this.coach.className = 'tut-coach';
      this.keys.replaceChildren();
      this.done.classList.add('on');
      return;
    }
    this.render();
  }

  private renderProgress() {
    if (this.step === 0) this.progress.textContent = `${this.count}/${PUSHES}`;
    else if (this.step === 1) this.progress.innerHTML = `<i style="width:${Math.min(100, (this.count / STEER_TIME) * 100)}%"></i>`;
    else this.progress.textContent = '';
    this.progress.className = 'tut-progress' + (this.step === 1 ? ' bar' : '');
  }

  private render() {
    const s = this.catching ? CATCH : STEPS[this.step];
    const mouse = trickAnywhere();
    this.card.style.display = '';
    [...this.dots.children].forEach((d, i) => (d.className = i < this.step ? 'done' : i === this.step ? 'on' : ''));
    this.title.textContent = s.title;
    this.text.textContent = mouse ? s.mouse : s.touch;
    this.renderProgress();
    // the mouse has no steer side: keyboard steps show keys, trick steps show the gesture mid-screen
    const keysOnly = mouse && (s.gesture === 'tap' || s.gesture === 'drag');
    const side = s.gesture === 'catch' || mouse ? 'center' : s.side;
    this.coach.className = keysOnly ? 'tut-coach' : `tut-coach on g-${s.gesture} at-${side}`;
    this.trail.innerHTML = TRAIL[s.gesture];
    this.keys.replaceChildren();
    if (mouse) for (const k of s.keys) el('kbd', k.length > 1 ? 'wide' : '', this.keys, k);
    this.keys.className = 'tut-keys' + (mouse ? ' on' : '') + (keysOnly ? ' big' : '');
  }
}
