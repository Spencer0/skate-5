/**
 * Burned-in, phone-video captions for the story opening: a few words at a
 * time, each lighting up as it's spoken. Times come from the voice pipeline
 * (tools/story/voices.py writes public/story/opening.json).
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

export interface Cues {
  duration: number;
  lines: CueLine[];
}

/** CSS classes for a word: the bit's three "names" get a colour each, CAPS shout. */
export function wordClass(w: string) {
  const bare = w.replace(/[^A-Za-z']/g, '');
  const k = bare.toLowerCase().replace(/'s$/, '');
  if (k === 'who') return bare === 'WHO' ? 'op-w who shout' : 'op-w who';
  if (k === 'what') return 'op-w what';
  if (k === 'both') return 'op-w both';
  return 'op-w';
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
