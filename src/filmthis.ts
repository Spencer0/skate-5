import * as THREE from 'three';
import { BoardModel } from './board';
import { F, STRIDE, clipDuration, sampleFrame } from './replay/clip';
import { Lens } from './replay/rig';
import { sanitizeLook } from './custom';
import { Cues, captionAt, wordClass } from './captions';
import { Ghost, Intent, Person, StoryHost, easeOut, flapJaw, handheld, headOf, person, phoneView, poseGhost, posePerson, smooth, talkLevel, unpackGhosts, wheels } from './storykit';

/**
 * Chapter 2's cold open, "Bro, can you film this?", shot like a TikTok: Nico
 * rolls up to the Plaza fountain and asks Theo to film one kickflip. Nico lands
 * it four times through the very same lens: the same trick, each a real take
 * (a little faster, a later catch...), every one fine. Theo has a new note each time,
 * each one more unreasonable than the last, until Nico sends a 360 laser flip
 * over the fountain (bullet time, trick callouts, replay). "Tell me you got
 * it!" Theo was texting. Nico skates off, back the way he rolled in, and the
 * clip loops to its first frame.
 *
 * Assets (public/story/, made by tools/story/ with --scene plaza / SCENE=plaza):
 * plaza-ghosts.bin (Nico's lines), plaza.mp3 and plaza.json (the dialogue,
 * with silent gaps for the takes).
 */

export const FILM_ID = 'story-film-this';

/** the first frame lands this far before the first line, Nico already rolling in */
const LEAD_IN = 0.15;
/** the loop: a hard cut back to the first shot that ends exactly on the first frame */
const TAIL = 0.6;

/** Nico is the rider the lines were recorded with (the pose was solved for that body). */
const NICO = 'brock';
/** Theo: film-school fedora, all black, no expression. */
const LOOK_THEO = sanitizeLook({
  body: 'm',
  height: 0.55,
  shape: { weight: 0.42, muscle: 0.35, shoulders: 0.45 },
  skin: '#c58c66',
  // all of his hair is under the hat (any hair pokes through the brim)
  hair: null,
  hat: 'fedora01',
  hatColor: '#2b2a28',
  top: 'crew',
  topColor: '#161616',
  bottom: 'trousers',
  bottomColor: '#1d1d1f',
  shoes: 'shoes04',
  shoesColor: '#ece8df',
});

/** Where it happens: just south of the fountain. Nico stops where the roll-in clip stops. */
const SPOT = {
  nico: new THREE.Vector3(2.45, 0, 14.25),
  theo: new THREE.Vector3(5.0, 0, 16.6),
  /** where Nico looks for "hit the big gap" */
  fountain: new THREE.Vector3(0, 1, 2),
};

/** roll-in clip time at dialogue time 0: he's sliding to a stop as the first line ends */
const ROLL_AT = 1.35;
/** the clip time every take starts from: the same trick through the same lens, each one landed a little differently */
const TAKE_AT = 0.7;
/** the storm-off: Nico stares a beat, then pushes away */
const STARE = 0.55;
/**
 * The last take, as (shot time, clip time) keys: the approach in real time, the
 * laser flip slowed right down over the fountain, a ramp back up to the landing,
 * then the replay from the landing side.
 */
const LIVE: [number, number][] = [
  [0, 1.9],
  [0.6, 2.5],
  [2.4, 3.1],
  [2.75, 3.95],
];
const REPLAY_AT = 2.75;
const REPLAY: [number, number][] = [
  [REPLAY_AT, 2.3],
  [3.5, 3.15],
  [4.0, 3.95],
];
const TAKES = ['take1', 'take2', 'take3', 'take4'] as const;

/** the words the captions pop in colour: every one of Theo's notes */
const MARKED: Record<string, string> = { naturally: 'hi', natural: 'hi', clean: 'hi', life: 'hi', creative: 'hi', harder: 'hi', sick: 'hi', texting: 'hi' };

const keyed = (keys: [number, number][], u: number) => {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [u1, c1] = keys[i];
    const [u0, c0] = keys[i - 1];
    if (u <= u1) return c0 + ((u - u0) / (u1 - u0)) * (c1 - c0);
  }
  return keys[keys.length - 1][1];
};

const std = (color: number, roughness = 0.5, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

/**
 * A skate filmer's camcorder, carried by the handle on top, with a fisheye on
 * the front. Origin at the handle grip; the lens looks down +Z (aim it with lookAt).
 */
function camcorder() {
  const g = new THREE.Group();
  const dark = std(0x2b2c30, 0.55, 0.3);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.2), dark);
  body.position.set(0, -0.085, 0.01);
  // the handle: a bar on two posts, the hand closes round the bar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.15), std(0x141416, 0.7));
  bar.position.set(0, 0, 0.01);
  const postA = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.018), dark);
  postA.position.set(0, -0.022, 0.075);
  const postB = postA.clone();
  postB.position.z = -0.055;
  // the lens barrel and the big fisheye on the end of it
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.06, 20), std(0x161618, 0.4, 0.4));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.08, 0.14);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.03, 24), std(0x101012, 0.35, 0.5));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, -0.08, 0.183);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x1a2a40, 0.05, 0.9));
  glass.rotation.x = Math.PI / 2;
  glass.position.set(0, -0.08, 0.195);
  // viewfinder out the back, and the red tally light
  const vf = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 12), std(0x141416, 0.7));
  vf.rotation.x = Math.PI / 2;
  vf.position.set(0.02, -0.05, -0.115);
  const tally = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1f }));
  tally.position.set(0.03, -0.045, 0.112);
  g.add(body, bar, postA, postB, barrel, ring, glass, vf, tally);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** What Theo was actually doing: his messages. */
function chatTexture() {
  const cv = document.createElement('canvas');
  cv.width = 300;
  cv.height = 620;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 300, 620);
  c.fillStyle = '#f2f2f5';
  c.fillRect(0, 0, 300, 96);
  c.fillStyle = '#c9c9d1';
  c.beginPath();
  c.arc(150, 38, 22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#111';
  c.font = '600 20px sans-serif';
  c.textAlign = 'center';
  c.fillText('babe <3', 150, 84);
  const bubble = (text: string, mine: boolean, y: number) => {
    c.font = '500 21px sans-serif';
    const w = c.measureText(text).width + 30;
    const x = mine ? 286 - w : 14;
    c.fillStyle = mine ? '#1e8bff' : '#e9e9ee';
    c.beginPath();
    c.roundRect(x, y, w, 42, 20);
    c.fill();
    c.fillStyle = mine ? '#fff' : '#111';
    c.textAlign = 'left';
    c.fillText(text, x + 15, y + 28);
  };
  bubble('what u doing', false, 130);
  bubble('nothing lol', true, 186);
  bubble('nico is skating', true, 236);
  bubble('omg hiii', false, 300);
  bubble('miss u', false, 350);
  bubble('miss u more', true, 414);
  bubble('fr fr', true, 464);
  // he's still typing
  c.fillStyle = '#e9e9ee';
  c.beginPath();
  c.roundRect(14, 534, 76, 42, 20);
  c.fill();
  c.fillStyle = '#8e8e96';
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(36 + i * 16, 555, 5, 0, Math.PI * 2);
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** His phone: the screen (his messages) faces him; the lens faces +Z, like the camcorder. */
function phoneModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.155, 0.01), std(0x18181a, 0.35, 0.4));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.145), new THREE.MeshBasicMaterial({ map: chatTexture() }));
  screen.position.z = -0.0055;
  screen.rotation.y = Math.PI;
  g.add(body, screen);
  return g;
}

type Shot = 'hook' | 'take' | 'line' | 'final' | 'insert' | 'leave' | 'tail';
interface At {
  shot: Shot;
  /** time into the shot */
  u: number;
  /** the line, for 'line' and 'insert' */
  i: number;
  /** which take, for 'take' */
  n: number;
}

export class FilmThis {
  private root: HTMLElement;
  private cap: HTMLElement;
  private flash: HTMLElement;
  private rec: HTMLElement;
  private tc: HTMLElement;
  private pov: HTMLElement;
  private slate: HTMLElement;
  private bars: HTMLElement;
  private tag: HTMLElement;
  private trick: HTMLElement;
  private group = new THREE.Group();
  private ghosts: Ghost[] = [];
  private nico: Person | null = null;
  private theo: Person | null = null;
  /** Nico's board, lying by his feet while he argues */
  private deck = new BoardModel();
  private cam = camcorder();
  private phone = phoneModel();
  private cues: Cues | null = null;
  private voice: AudioBuffer | null = null;
  private voiceAt = 0;
  private voiceStop: (() => void) | null = null;
  private loading: Promise<void> | null = null;
  private t = 0;
  private shotKey = '';
  private chunk = '';
  private onDone: (() => void) | null = null;
  private lens: Lens = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private scratch = new Float32Array(STRIDE);
  /** where the shadows should centre */
  focus = new THREE.Vector3();
  active = false;

  constructor(
    parent: HTMLElement,
    private host: StoryHost,
  ) {
    const div = (cls: string, html = '') => Object.assign(document.createElement('div'), { className: cls, innerHTML: html });
    this.root = div('op fm');
    parent.appendChild(this.root);
    // the camcorder's screen: corner marks, REC and the clock
    this.rec = div('fm-rec', '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="fm-recl"><b></b>REC <span class="fm-tc">00:00</span></span><span class="fm-hd">SP · 4:3</span>');
    this.tc = this.rec.querySelector('.fm-tc')!;
    this.bars = div('fm-bars', '<i></i><i></i>');
    this.pov = div('fm-pov', '<span>POV: filming your homie</span>');
    this.slate = div('fm-slate');
    this.tag = div('fm-tag', '<b></b>REPLAY');
    this.trick = div('fm-trick');
    this.cap = div('op-cap');
    this.flash = div('op-flash');
    const skip = document.createElement('button');
    skip.className = 'op-skip';
    skip.textContent = 'Skip ›';
    skip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.finish();
    });
    this.root.append(this.rec, this.bars, this.pov, this.slate, this.tag, this.trick, this.cap, this.flash, skip);
  }

  /** Fetch the clips, voice and models; resolves when everything is in (or gave up). */
  load(): Promise<void> {
    return (this.loading ??= this.fetchAll());
  }

  private async fetchAll() {
    const base = import.meta.env.BASE_URL + 'story/';
    const [bin, cues, mp3] = await Promise.all([
      fetch(base + 'plaza-ghosts.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
      fetch(base + 'plaza.json').then((r) => (r.ok ? (r.json() as Promise<Cues>) : null)),
      fetch(base + 'plaza.mp3').then((r) => (r.ok ? r.arrayBuffer() : null)),
    ]).catch(() => [null, null, null] as const);
    this.cues = cues;
    if (mp3) this.voice = await this.host.audio.decode(mp3);
    if (bin) this.ghosts = unpackGhosts(bin, this.group);
    this.nico = person(NICO, SPOT.nico);
    this.theo = person(LOOK_THEO, SPOT.theo);
    this.deck.setDeck('compass');
    this.group.add(this.nico.rider.group, this.theo.rider.group, this.deck.root, this.cam, this.phone);
    // models stream in; give them a few seconds before rolling anyway
    const riders = [...this.ghosts.map((g) => g.rider), this.nico.rider, this.theo.rider];
    const t0 = performance.now();
    while (riders.some((r) => !r.ready) && performance.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 100));
  }

  get ready() {
    return !!this.cues && !!this.nico?.rider.ready && !!this.theo?.rider.ready;
  }

  play(onDone: () => void) {
    this.onDone = onDone;
    this.active = true;
    this.t = 0;
    this.shotKey = '';
    this.chunk = '';
    this.voiceAt = 0;
    this.host.scene.add(this.group);
    const N = this.nico!.rider.group;
    const T = this.theo!.rider.group;
    for (const [g, at] of [
      [N, SPOT.nico],
      [T, SPOT.theo],
    ] as const) {
      g.position.set(at.x, this.host.groundAt(at.x, at.z), at.z);
    }
    // the two of them face each other
    N.rotation.set(0, Math.atan2(T.position.x - N.position.x, T.position.z - N.position.z), 0);
    T.rotation.set(0, Math.atan2(N.position.x - T.position.x, N.position.z - T.position.z), 0);
    // the board lies by Nico's feet, nose toward Theo
    const n = SPOT.nico;
    const toTheo = SPOT.theo.clone().sub(n).setY(0).normalize();
    const side = new THREE.Vector3(-toTheo.z, 0, toTheo.x);
    const at = n.clone().addScaledVector(side, -0.42).addScaledVector(toTheo, 0.1);
    this.deck.root.position.set(at.x, this.host.groundAt(at.x, at.z), at.z);
    this.deck.root.rotation.set(0, Math.atan2(toTheo.x, toTheo.z) - Math.PI / 2 + 0.25, 0);
    this.deck.pose(0, 0);
    for (const g of this.ghosts) g.sfxAt = -1;
    this.root.classList.add('on');
    this.cap.textContent = '';
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.voiceStop?.();
    this.voiceStop = null;
    this.host.scene.remove(this.group);
    this.root.classList.remove('on');
    this.host.audio.update(0, 'none', 0, false);
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  /** Free the clips, boards and models. */
  dispose() {
    for (const g of this.ghosts) {
      g.rider.dispose();
      g.board.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const p of [this.nico, this.theo]) {
      p?.jaw?.dispose();
      p?.rider.dispose();
    }
    this.ghosts = [];
    this.nico = this.theo = null;
    this.group.clear();
    this.loading = null;
  }

  private get end() {
    return LEAD_IN + (this.cues?.duration ?? 0) + TAIL;
  }

  /** Dialogue time: the voice's own clock when it's playing, so captions never drift. */
  private dialogT() {
    const ctx = this.host.audio.ctx;
    if (this.voiceStop && ctx) return this.host.audio.time - this.voiceAt;
    return this.t - LEAD_IN;
  }

  private cut(name: string) {
    return this.cues?.cuts?.find((c) => c.name === name) ?? null;
  }

  private ghost(name: string) {
    return this.ghosts.find((g) => g.clip.name === name) ?? null;
  }

  /** The line playing at dialogue time d (or the last one started) and time into it. */
  private lineAt(d: number) {
    const L = this.cues?.lines ?? [];
    let i = -1;
    for (let k = 0; k < L.length; k++) if (d >= L[k].t0 - 0.05) i = k;
    return { i, line: i >= 0 ? L[i] : null, u: i >= 0 ? d - L[i].t0 : d };
  }

  /** time the n-th word of line i starts (dialogue clock) */
  private wordT(i: number, n: number) {
    const w = this.cues?.lines[i]?.words;
    return w && w.length ? w[Math.min(n, w.length - 1)].t0 : Infinity;
  }

  /** the last line: "Oh, sorry dude. I was texting my girl." */
  private get lastLine() {
    return (this.cues?.lines.length ?? 0) - 1;
  }

  /** What's on screen at dialogue time d, and the time into that shot. */
  private shotAt(d: number): At {
    if (this.t >= this.end - TAIL) return { shot: 'tail', u: this.t - (this.end - TAIL), i: -1, n: -1 };
    for (let n = 0; n < TAKES.length; n++) {
      const c = this.cut(TAKES[n]);
      if (c && d >= c.t0 && d < c.t1) return { shot: 'take', u: d - c.t0, i: -1, n };
    }
    for (const name of ['final', 'leave'] as const) {
      const c = this.cut(name);
      if (c && d >= c.t0 && d < c.t1) return { shot: name, u: d - c.t0, i: -1, n: -1 };
    }
    // after the storm-off, before the tail: hold on him going
    const lv = this.cut('leave');
    if (lv && d >= lv.t1) return { shot: 'leave', u: d - lv.t0, i: -1, n: -1 };
    const { i, u } = this.lineAt(d);
    if (i <= 0) return { shot: 'hook', u: d + LEAD_IN, i: 0, n: -1 };
    // "I was texting my girl.": the insert of what he was really doing
    if (i === this.lastLine && d >= this.wordT(i, 3) - 0.1) return { shot: 'insert', u, i, n: -1 };
    return { shot: 'line', u, i, n: -1 };
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    if (this.t >= this.end) return this.finish();
    if (this.t >= LEAD_IN && !this.voiceStop && this.voice && this.host.audio.ctx && !this.host.audio.muted) {
      const v = this.host.audio.play(this.voice, 1.15);
      this.voiceAt = v.at;
      this.voiceStop = v.stop;
    }
    const d = this.dialogT();
    const s = this.shotAt(d);
    this.updateSkaters(s);
    this.updatePeople(dt, d, s);
    this.updateCamera(s);
    this.updateOverlay(d, s);
  }

  /* ---------------------------- skaters ---------------------------- */

  /** Which recorded line is on screen, and at what clip time. */
  private riding(s: At): [string, number] | null {
    if (s.shot === 'hook') return ['rollin', ROLL_AT - LEAD_IN + s.u];
    // the loop: runs up to the first frame exactly
    if (s.shot === 'tail') return ['rollin', ROLL_AT - LEAD_IN - TAIL + s.u];
    // every take: a kickflip, recorded take by take
    if (s.shot === 'take') return [`kf${s.n + 1}`, TAKE_AT + s.u];
    if (s.shot === 'final') return ['final', s.u < REPLAY_AT ? keyed(LIVE, s.u) : keyed(REPLAY, s.u)];
    if (s.shot === 'leave' && s.u >= STARE) return ['leave', s.u - STARE];
    return null;
  }

  private talking() {
    const d = this.dialogT();
    return (this.cues?.lines ?? []).some((L) => d >= L.t0 - 0.05 && d <= L.t1 + 0.05);
  }

  private updateSkaters(s: At) {
    const ride = this.riding(s);
    let on: Ghost | null = null;
    for (const g of this.ghosts) {
      const mine = ride?.[0] === g.clip.name;
      if (mine) {
        // the voices sit on top: skate sounds tuck under anyone talking
        const duck = this.talking() ? 0.35 : 1;
        const dist = poseGhost(g, Math.min(ride![1], clipDuration(g.clip)), this.host, 9, duck);
        wheels(g, this.host, Math.min(1, 7 / Math.max(1, dist)) * duck * 0.8);
        on = g;
      }
      g.board.root.visible = g.rider.group.visible = g.blob.visible = mine;
    }
    if (!on) this.host.audio.update(0, 'none', 0, false);
    // standing Nico is off while he's riding; so is his board
    this.nico!.rider.group.visible = !ride;
    this.deck.root.visible = !ride;
  }

  /* ---------------------------- the two ---------------------------- */

  private frame() {
    const T = this.theo!.rider.group;
    return {
      fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(T.quaternion),
      left: new THREE.Vector3(1, 0, 0).applyQuaternion(T.quaternion),
      at: T.position,
    };
  }

  /** where his right hand carries the camcorder by the handle: out in front of his chest, so it's in his close-ups */
  private camHand() {
    const { fwd, left, at } = this.frame();
    return at.clone().addScaledVector(fwd, 0.36).addScaledVector(left, -0.06).setY(at.y + 1.3);
  }

  /** the camcorder's lens (the camera for the filming shots), from where the hand holds it */
  private camLens() {
    const { fwd } = this.frame();
    return this.camHand().addScaledVector(fwd, 0.2).setY(this.camHand().y - 0.08);
  }

  /** his left hand with the phone up, reading it */
  private phoneHand() {
    const { fwd, left, at } = this.frame();
    return at.clone().addScaledVector(fwd, 0.3).addScaledVector(left, 0.06).setY(at.y + 1.22);
  }

  /** a hand's palm, a hand's length on from the wrist along the forearm */
  private palm(p: Person, side: 'l' | 'r') {
    const w = p.rider.joint(side === 'l' ? 'hand_l' : 'hand_r', new THREE.Vector3());
    const el = p.rider.joint(side === 'l' ? 'lowerarm_l' : 'lowerarm_r', new THREE.Vector3());
    return w.addScaledVector(w.clone().sub(el).normalize(), 0.06);
  }

  private intents(d: number, s: At): { a: Intent; b: Intent } {
    const N = this.nico!;
    const T = this.theo!;
    const hn = headOf(N);
    const ht = headOf(T);
    const a: Intent = { look: ht };
    const b: Intent = { look: hn, holdR: this.camHand() };
    const W = (n: number) => this.wordT(s.i, n);
    // from the last line on he's on his phone, the camcorder hanging off his other hand
    const texting = s.shot === 'insert' || s.shot === 'leave' || (s.shot === 'line' && s.i === this.lastLine);
    if (texting) {
      b.holdR = undefined;
      b.holdL = this.phoneHand();
      b.look = this.phoneHand();
    }
    switch (s.shot === 'line' ? s.i : -1) {
      case 1:
      case 2:
      case 3:
        // the notes: dead flat, a little point at him for emphasis
        if (d > W(1) && d < W(3)) b.palms = 0.4;
        break;
      case 4:
        // "Okay, now you're just too creative. Hit the big gap with something harder."
        if (d >= W(6)) {
          b.aim = { ang: 0.9, up: 0.25 };
          a.look = SPOT.fountain;
        }
        break;
      case 5:
        // "Dude, that was so sick! Tell me you got it!"
        if (d < W(4)) {
          a.fling = 1;
          a.lean = -0.08;
        } else {
          a.palms = 1;
          a.lean = 0.1;
        }
        break;
      case 6:
        a.look = ht;
        break;
    }
    if (s.shot === 'leave') a.look = ht;
    return { a, b };
  }

  private updatePeople(dt: number, d: number, s: At) {
    if (!this.nico || !this.theo) return;
    const { a, b } = this.intents(d, s);
    const N = this.nico;
    const T = this.theo;
    N.st.time = this.t;
    N.st.talk = talkLevel(this.cues, 'a', d);
    flapJaw(N, N.st.talk, d, 0);
    posePerson(N, a, dt, this.t);
    T.st.time = this.t + 1.7;
    // deadpan: he barely moves when he talks
    T.st.talk = talkLevel(this.cues, 'b', d) * 0.45;
    flapJaw(T, T.st.talk * 1.6, d, 1);
    // a fist round the camcorder's handle, all the time; fingers round the phone when it's out
    T.st.gripR = 1;
    T.st.gripL = b.holdL ? 0.7 : 0;
    posePerson(T, b, dt, this.t);
    // the camcorder hangs from his fist: aimed at Nico while filming, at the floor when he's texting
    const { fwd } = this.frame();
    const fist = this.palm(T, 'r');
    this.cam.position.copy(fist);
    if (b.holdR) this.cam.lookAt(headOf(N).setY(fist.y - 0.1));
    else this.cam.lookAt(fist.clone().addScaledVector(fwd, 0.25).setY(fist.y - 1));
    this.phone.visible = !!b.holdL;
    if (b.holdL) {
      // the screen toward his face
      const at = this.palm(T, 'l').setY(this.palm(T, 'l').y + 0.05);
      this.phone.position.copy(at);
      this.phone.lookAt(at.clone().multiplyScalar(2).sub(headOf(T)));
    }
  }

  /* ----------------------------- camera ----------------------------- */

  /** a smoothed board position for the lens to follow (from the clip, so every take frames the same) */
  private follow(name: string, ct: number, out: THREE.Vector3) {
    const g = this.ghost(name);
    out.set(0, 0, 0);
    if (!g) return out;
    for (let k = 0; k < 4; k++) {
      sampleFrame(g.clip, Math.max(0, ct - k * 0.08), this.scratch);
      out.x += this.scratch[F.boardPos];
      out.y += this.scratch[F.boardPos + 1];
      out.z += this.scratch[F.boardPos + 2];
    }
    return out.multiplyScalar(1 / 4);
  }

  private setShot(key: string, whoosh: boolean) {
    if (key === this.shotKey) return;
    const first = this.shotKey === '';
    this.shotKey = key;
    if (first || !whoosh) return;
    this.flash.classList.remove('go');
    void this.flash.offsetWidth;
    this.flash.classList.add('go');
    this.host.audio.whoosh();
  }

  private updateCamera(s: At) {
    const L = this.lens;
    const cam = this.host.camera;
    const ride = this.riding(s);
    const hn = headOf(this.nico!);
    const ht = headOf(this.theo!);
    let shake = 0.006;
    // Theo's own footage: he's behind the lens, keep him (and the camcorder) out of it
    let pov = false;
    switch (s.shot) {
      case 'hook':
      case 'tail':
      case 'take': {
        // through the camcorder, low, panning with him: identical for every take
        this.setShot(s.shot === 'take' ? 'take' + s.n : 'hook', s.shot === 'take');
        pov = true;
        const b = this.follow(ride![0], ride![1], new THREE.Vector3());
        L.pos.copy(this.camLens());
        L.look.copy(b).setY(b.y + 0.7);
        L.fov = 70;
        shake = 0.008;
        break;
      }
      case 'final':
        this.finalCamera(s.u);
        shake = s.u >= REPLAY_AT ? 0.012 : 0.004;
        break;
      case 'insert': {
        // over his shoulder, onto the screen
        this.setShot('insert', false);
        const p = this.phone.position;
        const toFace = ht.clone().sub(p).normalize();
        L.pos.copy(p).addScaledVector(toFace, 0.3);
        L.look.copy(p);
        L.fov = 38;
        shake = 0.002;
        break;
      }
      case 'leave':
        this.leaveCamera(s.u, hn, ht);
        break;
      default:
        this.dialogCamera(s.i, s.u, hn, ht);
    }
    this.theo!.rider.group.visible = !pov && s.shot !== 'insert';
    this.cam.visible = !pov;
    if (s.shot === 'final') this.focus.copy(this.ghost('final')?.board.root.position ?? SPOT.nico);
    else this.focus.copy(SPOT.nico).lerp(SPOT.theo, 0.5);
    this.rec.classList.toggle('on', pov);
    handheld(cam, L.pos, L.look, L.fov, this.t, shake);
  }

  /** Take 5: a crane off the deck, bullet time over the fountain, then the replay from the landing. */
  private finalCamera(u: number) {
    const L = this.lens;
    const ct = u < REPLAY_AT ? keyed(LIVE, u) : keyed(REPLAY, u);
    const b = this.follow('final', ct, new THREE.Vector3());
    if (u < 0.6) {
      this.setShot('final', true);
      // flat on the ground beside the kicker, rising as he comes
      const k = smooth(u / 0.6);
      L.pos.set(3.4, 0.2 + 0.5 * k, 8.2 - 2 * k);
      L.look.copy(b).setY(b.y + 0.55);
      L.fov = 64;
    } else if (u < REPLAY_AT) {
      this.setShot('bullet', true);
      // bullet time: swing round him over the water
      const k = smooth((u - 0.6) / (REPLAY_AT - 0.6));
      const a = 0.35 + k * 2.7;
      L.pos.set(b.x + Math.cos(a) * 3.4, b.y + 0.4 - 0.3 * k, b.z + Math.sin(a) * 3.4);
      L.look.copy(b).setY(b.y + 0.4);
      L.fov = 58;
    } else {
      this.setShot('replay', true);
      // the replay: fisheye on the ground past the landing, him flying at it
      L.pos.set(1.3, 0.28, -9.4);
      L.look.copy(b).setY(b.y + 0.5);
      L.fov = 90;
    }
  }

  /** Nico stares at him a beat; then, from behind Theo (still texting), he pushes off the way he came. */
  private leaveCamera(u: number, hn: THREE.Vector3, ht: THREE.Vector3) {
    const L = this.lens;
    if (u < STARE) {
      this.setShot('stare', false);
      this.single(hn, ht, 0, 34);
      return;
    }
    this.setShot('leave', false);
    const { fwd, left, at } = this.frame();
    L.pos.copy(at).addScaledVector(fwd, -1.3).addScaledVector(left, -0.55).setY(at.y + 1.55);
    const b = this.follow('leave', u - STARE, new THREE.Vector3());
    L.look.copy(ht).setY(ht.y - 0.35).lerp(b.setY(0.9), 0.65);
    L.fov = 50;
  }

  /** a single from just off the other one's eyeline: head and shoulders, three-quarters on */
  private single(me: THREE.Vector3, other: THREE.Vector3, u: number, fov: number) {
    const L = this.lens;
    const toOther = other.clone().sub(me).setY(0).normalize();
    // the same side of the pair for both of them (the fountain side), so the eyelines match
    const side = new THREE.Vector3(-0.67, 0, 0.74).projectOnPlane(toOther).normalize();
    L.pos.copy(me).addScaledVector(toOther, 1.3).addScaledVector(side, 0.8).setY(me.y - 0.05);
    L.look.copy(me).setY(me.y - 0.2).addScaledVector(toOther, -0.06);
    L.fov = fov - 4 * smooth(u / 1.8);
  }

  /** Theo's notes in close-up (each a touch closer: he's getting worse), Nico in his. */
  private dialogCamera(i: number, u: number, hn: THREE.Vector3, ht: THREE.Vector3) {
    this.setShot('line' + i, false);
    const L = this.lens;
    const line = this.cues?.lines[i];
    // "...hit the big gap with something harder": cut to Nico taking that in
    if (i === 4 && this.dialogT() >= this.wordT(4, 6)) {
      this.setShot('line4b', false);
      this.single(hn, ht, 0, 36);
      return;
    }
    if (line?.who === 'a') {
      const loud = /[!?]/.test(line.text);
      // wide enough for his arms: he's losing it
      this.single(hn, ht, 0, loud ? 48 : 38);
      L.fov -= loud ? easeOut(u / 0.12) * 5 : 0;
      return;
    }
    this.single(ht, hn, u, 44 - 3 * Math.min(i, 4));
  }

  /* ---------------------------- overlay ---------------------------- */

  private updateOverlay(d: number, s: At) {
    // the camcorder's clock: a fresh recording every take
    const recT = s.shot === 'take' ? s.u : d + LEAD_IN;
    this.tc.textContent = `00:${String(Math.max(0, Math.floor(recT))).padStart(2, '0')}`;
    this.pov.classList.toggle('on', s.shot === 'hook' || s.shot === 'tail');
    // slates: TAKE n, popped at the start of each take
    const slate = s.shot === 'take' ? `TAKE ${s.n + 1}` : s.shot === 'final' && s.u < 0.6 ? `TAKE ${TAKES.length + 1}` : '';
    if (this.slate.textContent !== slate) this.slate.textContent = slate;
    this.slate.classList.toggle('on', !!slate && s.u < 0.7);
    const fin = s.shot === 'final';
    this.bars.classList.toggle('on', fin && s.u >= 0.6);
    this.tag.classList.toggle('on', fin && s.u >= REPLAY_AT);
    const callout = fin && s.u >= 0.75 && s.u < REPLAY_AT ? (s.u < 2.1 ? '360 LASER FLIP' : '360 LASER FLIP<small>+ FOUNTAIN GAP · 600</small>') : '';
    if (this.trick.innerHTML !== callout) {
      // the game's own score sounds, as each callout lands
      if (callout.includes('GAP')) this.host.audio.gap();
      else if (callout) this.host.audio.combo(2);
      this.trick.innerHTML = callout;
    }
    this.trick.classList.toggle('on', !!callout);
    this.root.classList.toggle('slow', fin && s.u >= 0.6 && s.u < 2.4);
    this.updateCaptions(d, s);
  }

  private updateCaptions(d: number, s: At) {
    const c = this.cues && s.shot !== 'tail' ? captionAt(this.cues, d) : null;
    let html = '';
    let key = '';
    if (c) {
      key = `${c.line}:${c.chunk[0].t0}`;
      html = c.chunk.map((w, k) => `<span class="${wordClass(w.w, MARKED)}${k < c.lit ? ' on' : ''}">${w.w.replace(/[<>&]/g, '')}</span>`).join(' ');
      // under the phone on the insert, clear of his messages
      this.cap.className = 'op-cap ' + this.cues!.lines[c.line].who + (s.shot === 'insert' ? ' low' : '');
    }
    if (key !== this.chunk) {
      this.chunk = key;
      this.cap.classList.remove('pop');
      void this.cap.offsetWidth;
      if (key) this.cap.classList.add('pop');
    }
    if (this.cap.innerHTML !== html) this.cap.innerHTML = html;
  }

  /** Keep the overlay over the picture. */
  layout(w: number, h: number) {
    const v = phoneView(w, h);
    Object.assign(this.root.style, { left: v.x + 'px', top: v.y + 'px', width: v.w + 'px', height: v.h + 'px' });
    return v;
  }
}
