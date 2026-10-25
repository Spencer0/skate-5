import { LEVELS, Level, GoalDef, GapDef } from './levels';
import { TUNE } from './skater';
import type { TrickRecord } from './skater';
import { RIDERS, RiderId } from './rider';
import { CustomLook, sanitizeLook } from './custom';
import { FLAGS } from './flags';

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export type StatId = 'speed' | 'ollie' | 'spin' | 'flip' | 'balance';

export const STATS: { id: StatId; name: string; desc: string }[] = [
  { id: 'speed', name: 'Speed', desc: 'Top pushing speed' },
  { id: 'ollie', name: 'Ollie', desc: 'Pop height' },
  { id: 'spin', name: 'Spin', desc: 'Body spin speed in the air' },
  { id: 'flip', name: 'Flip', desc: 'How fast the board flips and shoves' },
  { id: 'balance', name: 'Rail Balance', desc: 'Steadier grinds and slides' },
];

export const STAT_START = 4;
export const STAT_MAX = 10;

const BASE = { ...TUNE };

/** Stat 5 is the stock tuning; each point nudges it. */
export function applyStats(s: Record<StatId, number>) {
  const d = (k: StatId) => s[k] - 5;
  TUNE.pushMaxSpeed = BASE.pushMaxSpeed + d('speed') * 0.2;
  TUNE.pushAccel = BASE.pushAccel + d('speed') * 0.3;
  TUNE.popSpeed = BASE.popSpeed + d('ollie') * 0.07;
  TUNE.spinRate = BASE.spinRate + d('spin') * 0.4;
  TUNE.beat = BASE.beat - d('flip') * 0.009;
  TUNE.balance = BASE.balance * (1 - d('balance') * 0.09);
}

/* ------------------------------------------------------------------ */
/* Unlockables                                                         */
/* ------------------------------------------------------------------ */

export interface DeckDef {
  id: string;
  name: string;
  /** total goals needed (or a medal) */
  needs: number | 'gold';
  /** 'flag' decks are open from the start; 'pro' decks are the career unlocks */
  set: 'pro' | 'flag';
}

export const DECKS: DeckDef[] = [
  { id: 'atlas', name: 'Atlas', needs: 0, set: 'pro' },
  { id: 'compass', name: 'Compass', needs: 3, set: 'pro' },
  { id: 'airmail', name: 'Airmail', needs: 9, set: 'pro' },
  { id: 'passport', name: 'Passport', needs: 16, set: 'pro' },
  { id: 'jetstream', name: 'Jet Stream', needs: 24, set: 'pro' },
  { id: 'mosaic', name: 'All Nations', needs: 32, set: 'pro' },
  { id: 'gold', name: 'Nations Cup Gold', needs: 'gold', set: 'pro' },
  ...FLAGS.map((f): DeckDef => ({ id: f.id, name: f.name, needs: 0, set: 'flag' })),
];

export interface SpecialDef {
  id: string;
  name: string;
  flip: number;
  shove: number;
  wrap: number;
  needs: number;
  desc: string;
}

/** Special tricks: the first is ready from the start, the rest unlock through the career. */
export const SPECIALS: SpecialDef[] = [
  { id: 'samba', name: 'Samba Flip', flip: 3, shove: -2, wrap: 0, needs: 0, desc: 'Triple kickflip wrapped in a 360 shove. All rhythm.' },
  { id: 'bullet', name: 'Bullet Train', flip: 0, shove: 6, wrap: 0, needs: 11, desc: 'A 1080 shove-it. It just keeps going.' },
  { id: 'aurora', name: 'Aurora Impossible', flip: 0, shove: 0, wrap: 2, needs: 19, desc: 'Double impossible, wrapping like the northern lights.' },
  { id: 'southern', name: 'Southern Cross', flip: -2, shove: 4, wrap: 0, needs: 27, desc: 'Double laser flip. The big one.' },
];

export type Medal = 'bronze' | 'silver' | 'gold';

/* ------------------------------------------------------------------ */
/* Save data                                                           */
/* ------------------------------------------------------------------ */

const KEY = 'skate5.career.v1';

/** Saves from before the Skate Nations rebrand used these deck and special ids. */
const OLD_DECKS: Record<string, string> = { claude: 'atlas', haiku: 'compass', sonnet: 'airmail', opus: 'passport', spark: 'jetstream', constitution: 'mosaic' };
const OLD_SPECIALS: Record<string, string> = { haiku: 'samba', context: 'bullet', constitution: 'aurora', spark: 'southern' };

interface SaveData {
  done: Record<string, string[]>;
  gaps: Record<string, string[]>;
  stats: Record<StatId, number>;
  deck: string;
  special: string | null;
  seen: string[];
  medal: Medal | null;
  best: Record<string, number>;
  rider: RiderId | null;
  custom: CustomLook | null;
}

function fresh(): SaveData {
  return {
    done: {},
    gaps: {},
    stats: { speed: STAT_START, ollie: STAT_START, spin: STAT_START, flip: STAT_START, balance: STAT_START },
    deck: 'atlas',
    special: null,
    seen: [],
    medal: null,
    best: {},
    rider: null,
    custom: null,
  };
}

export class Career {
  data: SaveData = fresh();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...fresh(), ...(JSON.parse(raw) as Partial<SaveData>) };
      this.data.deck = OLD_DECKS[this.data.deck] ?? this.data.deck;
      if (this.data.special) this.data.special = OLD_SPECIALS[this.data.special] ?? this.data.special;
      if (!DECKS.some((d) => d.id === this.data.deck)) this.data.deck = 'atlas';
    } catch {
      /* private mode: progress lives for this session */
    }
  }

  /** The create-a-skater look, always safe to dress a model with. */
  customLook(): CustomLook | null {
    return this.data.custom ? sanitizeLook(this.data.custom) : null;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  reset() {
    this.data = fresh();
    this.save();
  }

  /* goals */
  isDone(level: Level, goalId: string) {
    return (this.data.done[level.id] ?? []).includes(goalId);
  }
  doneCount(level: Level) {
    return level.goals.filter((g) => this.isDone(level, g.id)).length;
  }
  totalDone() {
    return LEVELS.reduce((n, L) => n + this.doneCount(L), 0);
  }
  totalGoals() {
    return LEVELS.reduce((n, L) => n + L.goals.length, 0);
  }
  /** Returns true the first time a goal is completed. */
  complete(level: Level, goalId: string) {
    if (this.isDone(level, goalId)) return false;
    (this.data.done[level.id] ??= []).push(goalId);
    this.save();
    return true;
  }
  isUnlocked(index: number): boolean {
    if (index === 0) return true;
    const prev = LEVELS[index - 1];
    return this.isUnlocked(index - 1) && this.doneCount(prev) >= prev.unlockAt;
  }

  /* gaps found (checklist) */
  foundGap(level: Level, gapId: string) {
    const arr = (this.data.gaps[level.id] ??= []);
    if (arr.includes(gapId)) return false;
    arr.push(gapId);
    this.save();
    return true;
  }
  gapsFound(level: Level) {
    return this.data.gaps[level.id] ?? [];
  }

  /* stats */
  statPointsEarned() {
    return this.totalDone();
  }
  statPointsSpent() {
    return Object.values(this.data.stats).reduce((a, b) => a + b - STAT_START, 0);
  }
  statPointsFree() {
    return Math.max(0, this.statPointsEarned() - this.statPointsSpent());
  }
  addStat(id: StatId, delta: 1 | -1) {
    const v = this.data.stats[id] + delta;
    if (v < STAT_START || v > STAT_MAX) return false;
    if (delta > 0 && this.statPointsFree() <= 0) return false;
    this.data.stats[id] = v;
    this.save();
    applyStats(this.data.stats);
    return true;
  }

  /** Career stats plus the chosen rider's strengths and weaknesses. */
  effectiveStats(): Record<StatId, number> {
    const r = RIDERS.find((x) => x.id === (this.data.rider ?? 'brock'))!;
    const out = { ...this.data.stats };
    for (const k of Object.keys(out) as StatId[]) out[k] = Math.max(1, Math.min(STAT_MAX + 2, out[k] + (r.bias[k] ?? 0)));
    return out;
  }

  /* unlockables */
  deckUnlocked(d: DeckDef) {
    return d.needs === 'gold' ? this.data.medal === 'gold' : this.totalDone() >= d.needs;
  }
  specialUnlocked(s: SpecialDef) {
    return this.totalDone() >= s.needs;
  }
  equippedSpecial(): SpecialDef | null {
    const s = SPECIALS.find((x) => x.id === this.data.special);
    if (s && this.specialUnlocked(s)) return s;
    return SPECIALS.find((x) => this.specialUnlocked(x)) ?? null;
  }
  /** Everything newly unlocked going from `before` to the current goal total. */
  unlocksBetween(before: number) {
    const after = this.totalDone();
    const out: string[] = [];
    for (const d of DECKS) if (typeof d.needs === 'number' && d.needs > before && d.needs <= after) out.push(`${d.name} deck`);
    for (const s of SPECIALS) if (s.needs > before && s.needs <= after) out.push(`Special: ${s.name}`);
    return out;
  }

  /* misc */
  seen(id: string) {
    return this.data.seen.includes(id);
  }
  markSeen(id: string) {
    if (!this.seen(id)) {
      this.data.seen.push(id);
      this.save();
    }
  }
  bestScore(level: Level) {
    return this.data.best[level.id] ?? 0;
  }
  recordScore(level: Level, score: number) {
    if (score > this.bestScore(level)) {
      this.data.best[level.id] = score;
      this.save();
      return true;
    }
    return false;
  }
  awardMedal(m: Medal) {
    const rank = { bronze: 1, silver: 2, gold: 3 };
    if (!this.data.medal || rank[m] > rank[this.data.medal]) {
      this.data.medal = m;
      this.save();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Goal tracking                                                       */
/* ------------------------------------------------------------------ */

function matches(name: string, want?: string) {
  return !want || name.toLowerCase().includes(want.toLowerCase());
}

/** Watches one run and ticks off goals; `onComplete` fires once per new goal. */
export class GoalTracker {
  constructor(
    public level: Level,
    public career: Career,
    public onComplete: (g: GoalDef) => void,
  ) {}

  private tick(g: GoalDef) {
    if (this.career.complete(this.level, g.id)) this.onComplete(g);
  }

  private open() {
    return this.level.goals.filter((g) => !this.career.isDone(this.level, g.id));
  }

  landed(tricks: TrickRecord[], gaps: GapDef[], airHeight: number) {
    for (const g of this.open()) {
      if (g.kind === 'gap' && gaps.some((x) => x.id === g.gap) && (!g.trick || tricks.some((t) => matches(t.name, g.trick)))) this.tick(g);
      else if (g.kind === 'trick' && tricks.some((t) => matches(t.name, g.trick))) this.tick(g);
      else if (g.kind === 'air' && airHeight >= g.height) this.tick(g);
    }
  }

  grinding(tag: string | undefined, dist: number, name: string) {
    if (!tag) return;
    for (const g of this.open()) if (g.kind === 'grind' && g.tag === tag && dist >= g.dist && matches(name, g.trick)) this.tick(g);
  }

  comboBanked(points: number, count: number) {
    for (const g of this.open()) {
      if (g.kind === 'combo' && points >= g.points) this.tick(g);
      else if (g.kind === 'comboCount' && count >= g.count) this.tick(g);
    }
  }

  runScore(score: number) {
    for (const g of this.open()) if (g.kind === 'score' && score >= g.points) this.tick(g);
  }

  letters(count: number) {
    for (const g of this.open()) if (g.kind === 'letters' && count >= 6) this.tick(g);
  }

  objects(count: number) {
    for (const g of this.open()) if (g.kind === 'objects' && count >= g.count) this.tick(g);
  }

  tape() {
    for (const g of this.open()) if (g.kind === 'tape') this.tick(g);
  }

  medal(m: Medal) {
    const rank = { bronze: 1, silver: 2, gold: 3 };
    for (const g of this.open()) if (g.kind === 'medal' && rank[m] >= rank[g.medal]) this.tick(g);
  }

  /** Live progress text for the pinned-goal tracker. */
  progressText(g: GoalDef, run: { score: number; letters: number; objects: number; grind: { tag?: string; dist: number } | null }) {
    switch (g.kind) {
      case 'score':
        return `${Math.min(run.score, g.points).toLocaleString('en-US')} / ${g.points.toLocaleString('en-US')}`;
      case 'letters':
        return `${run.letters}/6`;
      case 'objects':
        return `${Math.min(run.objects, g.count)}/${g.count}`;
      case 'grind':
        return run.grind && run.grind.tag === g.tag ? `${run.grind.dist.toFixed(1)} / ${g.dist} m` : `${g.dist} m`;
      default:
        return '';
    }
  }
}
