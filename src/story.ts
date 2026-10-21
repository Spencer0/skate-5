import { LEVELS, Level, GoalDef, GapDef } from './levels';
import type { TrickRecord } from './skater';

const KEY = 'skate5.story';

interface SaveData {
  done: Record<string, string[]>;
  letters: Record<string, number[]>;
}

/** Story progress, persisted in localStorage (best effort). */
export class Progress {
  data: SaveData = { done: {}, letters: {} };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<SaveData>;
        this.data = { done: d.done ?? {}, letters: d.letters ?? {} };
      }
    } catch {
      /* private mode etc: progress lives for this session only */
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  isDone(level: Level, goalId: string) {
    return (this.data.done[level.id] ?? []).includes(goalId);
  }

  doneCount(level: Level) {
    return level.goals.filter((g) => this.isDone(level, g.id)).length;
  }

  /** Returns true when this completes the goal for the first time. */
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

  letters(level: Level) {
    return this.data.letters[level.id] ?? [];
  }

  collect(level: Level, idx: number) {
    const arr = (this.data.letters[level.id] ??= []);
    if (arr.includes(idx)) return false;
    arr.push(idx);
    this.save();
    return true;
  }

  reset() {
    this.data = { done: {}, letters: {} };
    this.save();
  }
}

function matches(name: string, want?: string) {
  return !want || name.toLowerCase().includes(want.toLowerCase());
}

/**
 * Watches play events and ticks off the current chapter's goals.
 * `onComplete` fires once per newly completed goal.
 */
export class GoalTracker {
  constructor(
    public level: Level,
    public progress: Progress,
    public onComplete: (g: GoalDef) => void,
  ) {}

  private tick(g: GoalDef) {
    if (this.progress.complete(this.level, g.id)) this.onComplete(g);
  }

  private open() {
    return this.level.goals.filter((g) => !this.progress.isDone(this.level, g.id));
  }

  /** A clean landing, with the gaps it cleared and how high the air went. */
  landed(tricks: TrickRecord[], gaps: GapDef[], airHeight: number) {
    for (const g of this.open()) {
      if (g.kind === 'gap' && gaps.some((x) => x.id === g.gap) && (!g.trick || tricks.some((t) => matches(t.name, g.trick)))) this.tick(g);
      else if (g.kind === 'trick' && tricks.some((t) => matches(t.name, g.trick))) this.tick(g);
      else if (g.kind === 'air' && airHeight >= g.height) this.tick(g);
    }
  }

  grinding(tag: string | undefined, dist: number, name: string) {
    if (!tag) return;
    for (const g of this.open()) {
      if (g.kind === 'grind' && g.tag === tag && dist >= g.dist && matches(name, g.trick)) this.tick(g);
    }
  }

  comboBanked(points: number) {
    for (const g of this.open()) if (g.kind === 'combo' && points >= g.points) this.tick(g);
  }

  letters(count: number) {
    for (const g of this.open()) if (g.kind === 'letters' && count >= 6) this.tick(g);
  }
}
