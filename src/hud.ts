import { GUIDE } from './tricks';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  root: HTMLElement;
  private score: HTMLElement;
  private best: HTMLElement;
  private combo: HTMLElement;
  private comboNames: HTMLElement;
  private comboPts: HTMLElement;
  private popups: HTMLElement;
  private balanceWrap: HTMLElement;
  private balanceNeedle: HTMLElement;
  private hint: HTMLElement;
  private speedo: HTMLElement;
  guide: HTMLElement;
  goalsBtn: HTMLButtonElement;
  menuBtn: HTMLButtonElement;
  starBtn: HTMLButtonElement;
  private toasts: HTMLElement;
  private timer: HTMLElement;
  private tracker: HTMLElement;
  private special: HTMLElement;
  private specialFill: HTMLElement;
  private lastTracker = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    const top = el('div', 'hud-top', this.root);
    const scoreBox = el('div', 'score-box', top);
    this.score = el('div', 'score', scoreBox, '0');
    this.best = el('div', 'best', scoreBox, 'best combo 0');
    const btns = el('div', 'hud-btns', top);
    this.goalsBtn = el('button', 'hud-btn goals-chip', btns, 'Goals') as HTMLButtonElement;
    this.menuBtn = el('button', 'hud-btn', btns, 'Menu') as HTMLButtonElement;
    for (const b of [this.goalsBtn, this.menuBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.combo = el('div', 'combo', this.root);
    this.comboNames = el('div', 'combo-names', this.combo);
    this.comboPts = el('div', 'combo-pts', this.combo);
    this.popups = el('div', 'popups', this.root);
    this.toasts = el('div', 'toasts', this.root);
    this.timer = el('div', 'timer', this.root);
    this.tracker = el('div', 'tracker', this.root);
    this.special = el('div', 'special', this.root);
    this.specialFill = el('div', 'special-fill', this.special);
    this.starBtn = el('button', 'star-btn', this.root, '★') as HTMLButtonElement;
    this.starBtn.setAttribute('aria-label', 'Special trick');

    this.balanceWrap = el('div', 'balance', this.root);
    el('div', 'balance-bar', this.balanceWrap);
    this.balanceNeedle = el('div', 'balance-needle', this.balanceWrap);
    this.balanceWrap.style.display = 'none';

    this.speedo = el('div', 'speedo', this.root);
    this.hint = el('div', 'hint', this.root);

    this.guide = this.buildGuide(parent);
  }

  setScore(total: number, best: number) {
    this.score.textContent = total.toLocaleString();
    this.best.textContent = `best combo ${best.toLocaleString()}`;
  }

  setGoals(done: number, total: number | null) {
    this.goalsBtn.style.display = total === null ? 'none' : '';
    if (total !== null) this.goalsBtn.textContent = `Goals ${done}/${total}`;
  }

  /** Run clock; null hides it. */
  setTimer(sec: number | null) {
    if (sec === null) {
      this.timer.classList.remove('on');
      return;
    }
    const s = Math.max(0, Math.ceil(sec));
    this.timer.classList.add('on');
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('low', sec <= 10);
  }

  bigText(text: string) {
    const t = el('div', 'timer-big', this.root, text);
    setTimeout(() => t.remove(), 1700);
  }

  /** Pinned goal + letters strip (rebuilt only when it changes). */
  setTracker(rows: { label: string; value: string }[], letters: boolean[] | null) {
    const key = JSON.stringify([rows, letters]);
    if (key === this.lastTracker) return;
    this.lastTracker = key;
    this.tracker.replaceChildren();
    for (const r of rows) {
      const d = el('div', 'track', this.tracker);
      el('span', '', d, r.label);
      if (r.value) el('b', '', d, r.value);
    }
    if (letters) {
      const strip = el('div', 'track letters-strip', this.tracker);
      'CLAUDE'.split('').forEach((c, i) => el('span', letters[i] ? 'on' : '', strip, c));
    }
  }

  setSpecial(v: number | null, ready: boolean) {
    this.special.classList.toggle('on', v !== null);
    if (v === null) {
      this.starBtn.classList.remove('on');
      return;
    }
    this.specialFill.style.width = `${Math.round(v * 100)}%`;
    this.special.classList.toggle('full', v >= 1);
    this.starBtn.classList.toggle('on', ready);
  }

  /** Big banner for goal completions and letters. */
  toast(title: string, sub: string, kind: 'goal' | 'letter' = 'goal') {
    const t = el('div', 'toast ' + kind, this.toasts);
    el('div', 'toast-title', t, title);
    el('div', 'toast-sub', t, sub);
    setTimeout(() => t.remove(), kind === 'goal' ? 3200 : 1800);
  }

  setSpeed(kmh: number) {
    this.speedo.textContent = `${Math.round(kmh)} km/h`;
  }

  showCombo(names: string[], points: number, mult: number, live: string | null) {
    if (names.length === 0 && !live) {
      this.combo.classList.remove('on');
      return;
    }
    this.combo.classList.add('on');
    const parts = names.slice(-4);
    const prefix = names.length > 4 ? '… + ' : '';
    this.comboNames.textContent = prefix + parts.join(' + ') + (live ? (parts.length ? ' + ' : '') + live : '');
    this.comboPts.textContent = mult > 1 ? `${points.toLocaleString()} × ${mult}` : `${points.toLocaleString()}`;
  }

  comboResult(text: string, good: boolean) {
    this.combo.classList.remove('on');
    const p = el('div', 'combo-result ' + (good ? 'good' : 'bad'), this.root, text);
    setTimeout(() => p.remove(), 1400);
  }

  popup(text: string, sub?: string, kind: 'perfect' | 'clean' | 'sketchy' | 'bail' | 'grind' = 'clean') {
    // keep at most 2 popups so fast lines don't spam the screen
    while (this.popups.children.length > 1) this.popups.firstChild!.remove();
    const p = el('div', 'popup ' + kind, this.popups);
    el('div', 'popup-main', p, text);
    if (sub) el('div', 'popup-sub', p, sub);
    setTimeout(() => p.remove(), 1300);
  }

  balance(v: number | null) {
    if (v === null) {
      this.balanceWrap.style.display = 'none';
      return;
    }
    this.balanceWrap.style.display = 'block';
    const c = Math.max(-1, Math.min(1, v));
    this.balanceNeedle.style.transform = `translateX(-50%) rotate(${c * 60}deg)`;
    this.balanceNeedle.classList.toggle('danger', Math.abs(c) > 0.7);
  }

  setHint(text: string | null) {
    this.hint.textContent = text ?? '';
    this.hint.classList.toggle('on', !!text);
  }

  private buildGuide(parent: HTMLElement) {
    const wrap = el('div', 'guide', parent);
    const card = el('div', 'guide-card', wrap);
    const head = el('div', 'guide-head', card);
    el('h2', '', head, 'Trick stick');
    const close = el('button', 'hud-btn', head, 'Close');
    close.addEventListener('click', () => wrap.classList.remove('on'));
    el(
      'p',
      'guide-p',
      card,
      'Right thumb: touch anywhere to place the stick. Pull DOWN to load the tail, then flick. ' +
        'The board keeps spinning until you TAP again to catch it — wait longer for doubles. ' +
        'Land without catching and you bail.',
    );
    el(
      'p',
      'guide-p',
      card,
      'Left thumb: tap to push, drag sideways to carve (push it hard in the air to spin, use it to balance on rails). Hold up to keep pushing — and to carry over a lip onto the deck or out of a bowl. Hold down to powerslide.',
    );
    el(
      'p',
      'guide-p',
      card,
      'Grinds: ollie onto a rail or ledge edge. Board angle picks the grind (straight = 50-50, sideways = boardslide/lipslide, in between = feeble). Hold the trick stick UP for nose variants, DOWN for tail variants. Flick to pop out.',
    );
    const grid = el('div', 'guide-grid', card);
    for (const g of GUIDE) {
      const item = el('div', 'guide-item', grid);
      item.innerHTML = gestureSvg(g.path);
      el('div', 'guide-name', item, g.name);
      if (g.note) el('div', 'guide-note', item, g.note);
    }
    el('p', 'guide-p small', card, 'Keyboard: A/D steer · W push · S brake · Space ollie/catch · J kickflip · L heelflip · U/O shove-its · 1–9 combos · Shift = nollie · N/M nose/tail grinds · R reset');
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) wrap.classList.remove('on');
    });
    return wrap;
  }
}

function gestureSvg(path: [number, number][]) {
  const S = 64;
  const c = S / 2;
  const r = 22;
  const pts = path.map(([x, y]) => [c + x * r, c - y * r]);
  // first segment = loading the tail (dashed), the rest = the flick
  const load = `M${pts[0][0]} ${pts[0][1]} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;
  const d = pts
    .slice(1)
    .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
    .join(' ');
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? pts[0];
  const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
  const ah = 7;
  const a1 = [last[0] - Math.cos(ang - 0.5) * ah, last[1] - Math.sin(ang - 0.5) * ah];
  const a2 = [last[0] - Math.cos(ang + 0.5) * ah, last[1] - Math.sin(ang + 0.5) * ah];
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"/>
    <path d="${load}" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="3 4" stroke-linecap="round"/>
    <circle cx="${pts[1][0].toFixed(1)}" cy="${pts[1][1].toFixed(1)}" r="3.5" fill="currentColor" fill-opacity="0.6"/>
    <path d="${d}" fill="none" stroke="#D97757" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M${a1[0].toFixed(1)} ${a1[1].toFixed(1)} L${last[0].toFixed(1)} ${last[1].toFixed(1)} L${a2[0].toFixed(1)} ${a2[1].toFixed(1)}" fill="none" stroke="#D97757" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${c}" cy="${c}" r="3" fill="currentColor"/>
  </svg>`;
}
