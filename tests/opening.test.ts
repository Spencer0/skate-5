import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chunks, wordClass, captionAt, Cues } from '../src/captions';
import { F, STRIDE } from '../src/replay/clip';

const w = (s: string, t0: number) => ({ w: s, t0, t1: t0 + 0.2 });

test('captions break after punctuation and every three words', () => {
  const words = ["Who's", 'on', 'the', 'rail,', "What's", 'on'].map((s, i) => w(s, i * 0.2));
  assert.deepEqual(
    chunks(words).map((c) => c.map((x) => x.w).join(' ')),
    ["Who's on the", 'rail,', "What's on"],
  );
});

test('the three names get their colours, CAPS shout', () => {
  assert.equal(wordClass("Who's"), 'op-w who');
  assert.equal(wordClass('WHO?!'), 'op-w who shout');
  assert.equal(wordClass("What's"), 'op-w what');
  assert.equal(wordClass("Both's"), 'op-w both');
  assert.equal(wordClass('kicker.'), 'op-w');
});

test('a caption lights its words as they are spoken', () => {
  const cues: Cues = { duration: 1, lines: [{ who: 'a', text: 'Who is it', t0: 0, t1: 0.6, words: [w('Who', 0), w('is', 0.2), w('it', 0.4)] }] };
  assert.equal(captionAt(cues, 0.1)?.lit, 1);
  assert.equal(captionAt(cues, 0.45)?.lit, 3);
  assert.equal(captionAt(cues, 2), null);
});

test('the voiced dialogue matches its script and runs in order', () => {
  const cues = JSON.parse(fs.readFileSync('public/story/opening.json', 'utf8')) as Cues;
  assert.ok(cues.lines.length >= 10);
  assert.match(cues.lines[0].text, /^Who's on the rail/);
  let last = -1;
  for (const L of cues.lines) {
    assert.equal(L.words.map((x) => x.w).join(' '), L.text);
    assert.ok(L.t0 >= last - 0.1, L.text); // lines may overlap a touch, never jump back
    for (const x of L.words) {
      assert.ok(x.t0 >= L.t0 - 0.05 && x.t1 <= L.t1 + 0.05 && x.t1 >= x.t0, `${L.text}: ${x.w}`);
    }
    last = L.t1;
  }
  assert.ok(cues.duration >= last);
  // rapid dialogue: about ten seconds of talking all told
  const talk = cues.lines.reduce((n, L) => n + L.t1 - L.t0, 0);
  assert.ok(talk < 13, `${talk}s of talking`);
});

test('each cutaway shows the skater just named, in silence', () => {
  const cues = JSON.parse(fs.readFileSync('public/story/opening.json', 'utf8')) as Cues;
  assert.deepEqual(
    cues.cuts?.map((c) => c.name),
    ['rail', 'ramp', 'kicker'],
  );
  for (const c of cues.cuts ?? []) {
    assert.ok(c.t1 > c.t0 + 1.5, c.name);
    for (const L of cues.lines) assert.ok(L.t1 <= c.t0 + 0.05 || L.t0 >= c.t1 - 0.1, `${L.text} talks over the ${c.name} cutaway`);
  }
  // it ends on the last cutaway, straight into the run
  assert.equal(cues.cuts?.at(-1)?.t1, cues.duration);
});

test('the background skaters file holds every line the opening shoots', () => {
  const b = fs.readFileSync('public/story/ghosts.bin');
  const n = b.readUInt32LE(0);
  const head = JSON.parse(b.subarray(4, 4 + n).toString()) as { name: string; rider: string; frames: number }[];
  const off = 4 + n + ((4 - ((4 + n) % 4)) % 4);
  const frames = head.reduce((k, h) => k + h.frames, 0);
  assert.equal(b.length - off, frames * STRIDE * 4);
  for (const name of ['rail', 'ramp', 'kicker', 'stairs', 'flat']) assert.ok(head.some((h) => h.name === name), name);
  const data = new Float32Array(b.buffer.slice(b.byteOffset + off));
  // the skeleton was recorded, not the stand-in capsule
  let o = 0;
  for (const h of head) {
    assert.equal(data[o * STRIDE + F.poseOk], 1, h.name);
    o += h.frames;
  }
});

test('captions mark the words a scene asks for', () => {
  const marked = { naturally: 'hi', frame: 'hi' };
  assert.equal(wordClass('naturally?', marked), 'op-w hi');
  assert.equal(wordClass('frame.', marked), 'op-w hi');
  // the opening's names are only the opening's
  assert.equal(wordClass('what', marked), 'op-w');
});

test("chapter 2's cold open: the takes, in order, in silence", () => {
  const cues = JSON.parse(fs.readFileSync('public/story/plaza.json', 'utf8')) as Cues;
  assert.match(cues.lines[0].text, /^Yo, film this/);
  assert.match(cues.lines.at(-1)!.text, /texting my girl\.$/);
  assert.deepEqual(
    cues.cuts?.map((c) => c.name),
    ['take1', 'take2', 'take3', 'take4', 'final', 'leave'],
  );
  for (const L of cues.lines) assert.equal(L.words.map((x) => x.w).join(' '), L.text);
  for (const c of cues.cuts ?? []) {
    for (const L of cues.lines) assert.ok(L.t1 <= c.t0 + 0.05 || L.t0 >= c.t1 - 0.1, `${L.text} talks over ${c.name}`);
  }
  // TikTok length, and the punchline lands after the big trick
  assert.ok(cues.duration > 19 && cues.duration < 32, `${cues.duration}s`);
  const fin = cues.cuts!.find((c) => c.name === 'final')!;
  assert.ok(cues.lines.at(-1)!.t0 >= fin.t1);
  // it ends on him leaving, straight into the loop
  assert.equal(cues.cuts?.at(-1)?.t1, cues.duration);
});

test("the cold open's skater file has its lines: a take per kickflip", () => {
  const b = fs.readFileSync('public/story/plaza-ghosts.bin');
  const n = b.readUInt32LE(0);
  const head = JSON.parse(b.subarray(4, 4 + n).toString()) as { name: string; rider: string }[];
  assert.deepEqual(
    head.map((h) => h.name),
    ['rollin', 'kf1', 'kf2', 'kf3', 'kf4', 'leave', 'final'],
  );
  // one skater: every line on the same body
  assert.ok(head.every((h) => h.rider === head[0].rider));
});
