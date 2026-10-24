/**
 * Burned-in, phone-video captions for the story scenes: a few words at a
 * time, each lighting up as it's spoken. Times come from the voice pipeline
 * (tools/story/voices.py writes public/story/<scene>.json).
 */

export interface Word {
  w: string;
  t0: number;
  t1: number;
}

export interface CueLine {
  who: 'a' | 'b';
  text: string;
  t0: number;
  t1: number;
  words: Word[];
}

/** A silent stretch of the dialogue track where the opening cuts away to a skater. */
export interface Cutaway {
  name: string;
  t0: number;
  t1: number;
}

export interface Cues {
  duration: number;
  lines: CueLine[];
  cuts?: Cutaway[];
}

/** The opening's three "names", each with its own colour. */
export const OPENING_WORDS: Record<string, string> = { who: 'who', what: 'what', both: 'both' };

/** CSS classes for a word: words in `marked` get their class (the bit's "names" in the opening), CAPS shout. */
export function wordClass(w: string, marked: Record<string, string> = OPENING_WORDS) {
  const bare = w.replace(/[^A-Za-z']/g, '');
  const k = bare.toLowerCase().replace(/'s$/, '');
  const c = marked[k];
  if (!c) return 'op-w';
  return bare.length > 1 && bare === bare.toUpperCase() ? `op-w ${c} shout` : `op-w ${c}`;
}

/** Split a line into caption chunks of up to three words, breaking after punctuation. */
export function chunks(words: Word[]) {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 3 || /[,.?!]$/.test(w.w)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** What's on screen at dialogue time d: which line, which chunk of it, and how many of its words are lit. */
export function captionAt(cues: Cues, d: number): { line: number; chunk: Word[]; lit: number } | null {
  let hit: { line: number; chunk: Word[]; lit: number } | null = null;
  cues.lines.forEach((line, i) => {
    if (d < line.t0 - 0.02 || d > line.t1 + 0.12) return;
    const parts = chunks(line.words);
    let p = parts.findIndex((c) => d < c[c.length - 1].t1 + 0.02);
    if (p < 0) p = parts.length - 1;
    const chunk = parts[p];
    hit = { line: i, chunk, lit: chunk.filter((w) => d >= w.t0 - 0.03).length };
  });
  return hit;
}
