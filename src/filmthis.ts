import * as THREE from 'three';
import { BoardModel } from './board';
import { F, STRIDE, clipDuration, sampleFrame } from './replay/clip';
import { lens, Lens } from './replay/rig';
import { sanitizeLook } from './custom';
import { Cues, captionAt, wordClass } from './captions';
import { Ghost, Intent, Person, StoryHost, easeOut, flapJaw, handheld, headOf, person, phoneView, poseGhost, posePerson, smooth, talkLevel, unpackGhosts, wheels } from './storykit';

/**
 * Chapter 2's cold open, "Bro, can you film this?", shot like a TikTok: Nico
 * rolls up to the Plaza fountain and asks Theo to film one kickflip. Theo
 * turns into the most demanding director in cinema history. Every take of the
 * kickflip is the very same recorded line (only the camera gets fancier),
 * then Nico finally sends a 360 laser flip over the fountain, in slow motion
 * with a replay, and the reveal: Theo's phone was pointed at the floor. It
 * ends on a hard cut back to the first frame, so the clip loops.
 *
 * Assets (public/story/, made by tools/story/ with --scene plaza / SCENE=plaza):
 * plaza-ghosts.bin (Nico's lines), plaza.mp3 and plaza.json (the dialogue,
 * with silent gaps for the takes).
 */

export const FILM_ID = 'story-film-this';

/** the first frame lands this far before the first line, Nico already rolling in */
const LEAD_IN = 0.35;
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
  hair: 'short03',
  hairColor: '#1c1510',
  hat: 'fedora01',
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
  /** where Theo puts the phone down for take 3 */
  phone: new THREE.Vector3(3.95, 0, 15.85),
  /** and where he stands to direct, in front of it */
  theo2: new THREE.Vector3(3.05, 0, 15.55),
};

/** roll-in clip time at dialogue time 0: he's sliding to a stop as the first line ends */
const ROLL_AT = 1.35;
/** the kickflip clip time each take starts from: always the same trick */
const TAKE_AT = 0.55;
/**
 * The last take, as (shot time, clip time) keys: the approach in real time, the
 * laser flip slowed right down over the fountain, a ramp back up to the landing,
 * then the replay from the landing side.
 */
const LIVE: [number, number][] = [
  [0, 1.9],
  [0.6, 2.5],
  [2.5, 3.1],
  [2.85, 3.95],
];
const REPLAY_AT = 2.85;
const REPLAY: [number, number][] = [
  [REPLAY_AT, 2.3],
  [3.8, 3.15],
  [4.4, 3.95],
];

/** the words the captions pop in colour */
const MARKED: Record<string, string> = { again: 'hi', naturally: 'hi', trick: 'hi', accidental: 'hi', filming: 'hi', frame: 'hi' };

const keyed = (keys: [number, number][], u: number) => {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [u1, c1] = keys[i];
    const [u0, c0] = keys[i - 1];
    if (u <= u1) return c0 + ((u - u0) / (u1 - u0)) * (c1 - c0);
  }
  return keys[keys.length - 1][1];
};

/** A phone: a black slab with the camera bump. Origin at the lens, which faces +Z (aim it with lookAt). */
function phoneModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.155, 0.009), new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.35, metalness: 0.4 }));
  body.position.set(0.02, -0.05, 0);
  const bump = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.004), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.3, metalness: 0.6 }));
  bump.position.set(0, 0, 0.006);
  g.add(body, bump);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

type Shot = 'hook' | 'line' | 'take1' | 'take2' | 'setup' | 'final' | 'floor' | 'tail';

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
    // the phone's camera screen: corner marks, REC and the clock
    this.rec = div('fm-rec', '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="fm-recl"><b></b>REC <span class="fm-tc">00:00</span></span><span class="fm-hd">4K · 60</span>');
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
    this.group.add(this.nico.rider.group, this.theo.rider.group, this.deck.root, this.phone);
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
    for (const p of [this.nico!, this.theo!]) {
      const at = p.rider.group.position;
      at.y = this.host.groundAt(at.x, at.z);
    }
    this.place(false);
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

  /** Theo where he films from (or, for take 3 on, in front of the phone he put down), both facing in. */
  private place(directing: boolean) {
    const N = this.nico!.rider.group;
    const T = this.theo!.rider.group;
    const at = directing ? SPOT.theo2 : SPOT.theo;
    T.position.set(at.x, this.host.groundAt(at.x, at.z), at.z);
    const yaw = (me: THREE.Object3D, to: THREE.Vector3) => Math.atan2(to.x - me.position.x, to.z - me.position.z);
    N.rotation.set(0, yaw(N, T.position), 0);
    // directing, he's half turned to the phone on the ground: talking to it as much as to Nico
    T.rotation.set(0, yaw(T, N.position) + (directing ? -0.5 : 0), 0);
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
    if (this.voiceStop && ctx) return ctx.currentTime - this.voiceAt;
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

  /** What's on screen at dialogue time d, and the time into that shot. */
  private shotAt(d: number): { shot: Shot; u: number; i: number } {
    if (this.t >= this.end - TAIL) return { shot: 'tail', u: this.t - (this.end - TAIL), i: -1 };
    for (const name of ['take1', 'take2', 'setup', 'final'] as const) {
      const c = this.cut(name);
      if (c && d >= c.t0 && d < c.t1) return { shot: name, u: d - c.t0, i: -1 };
    }
    const { i, u } = this.lineAt(d);
    const n = this.cues?.lines.length ?? 0;
    if (i <= 0) return { shot: 'hook', u: d + LEAD_IN, i: 0 };
    if (i === n - 1 && d >= (this.cut('final')?.t1 ?? Infinity)) return { shot: 'floor', u, i };
    return { shot: 'line', u, i };
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
    this.place(s.shot === 'final' || s.shot === 'floor' || (s.shot === 'line' && s.i >= 6));
    this.updateSkaters(s);
    this.updatePeople(dt, d, s);
    this.updateCamera(d, s);
    this.updateOverlay(d, s);
  }

  /* ---------------------------- skaters ---------------------------- */

  /** Which recorded line is on screen, and at what clip time. */
  private riding(s: { shot: Shot; u: number }): [string, number] | null {
    if (s.shot === 'hook') return ['rollin', ROLL_AT - LEAD_IN + s.u];
    // the loop: runs up to the first frame exactly
    if (s.shot === 'tail') return ['rollin', ROLL_AT - LEAD_IN - TAIL + s.u];
    if (s.shot === 'take1' || s.shot === 'take2') return ['kickflip', TAKE_AT + s.u];
    if (s.shot === 'final') return ['final', s.u < REPLAY_AT ? keyed(LIVE, s.u) : keyed(REPLAY, s.u)];
    return null;
  }

  private updateSkaters(s: { shot: Shot; u: number }) {
    const ride = this.riding(s);
    let on: Ghost | null = null;
    for (const g of this.ghosts) {
      const mine = ride?.[0] === g.clip.name;
      if (mine) {
        const dist = poseGhost(g, Math.min(ride![1], clipDuration(g.clip)), this.host, 9);
        wheels(g, this.host, Math.min(1, 7 / Math.max(1, dist)));
        on = g;
      }
      g.board.root.visible = g.rider.group.visible = g.blob.visible = mine;
    }
    if (!on) this.host.audio.update(0, 'none', 0, false);
    // standing Nico is off while he's riding; so is his board
    const standing = !ride;
    this.nico!.rider.group.visible = standing;
    this.deck.root.visible = standing;
  }

  /* ---------------------------- the two ---------------------------- */

  /** Where Theo holds the phone up to film: out in front of his face, at Nico. */
  private held() {
    const T = this.theo!.rider.group;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(T.quaternion);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(T.quaternion);
    return T.position.clone().addScaledVector(fwd, 0.42).addScaledVector(right, 0.08).setY(T.position.y + 1.38);
  }

  private intents(d: number, s: { shot: Shot; i: number }): { a: Intent; b: Intent } {
    const N = this.nico!;
    const T = this.theo!;
    const hn = headOf(N);
    const ht = headOf(T);
    const a: Intent = { look: ht };
    // Theo watches his phone screen, never Nico
    const ph = this.held();
    const b: Intent = { look: ph.clone().setY(ph.y - 0.1), holdR: ph };
    const cam = this.host.camera.position;
    const W = (n: number) => this.wordT(s.i, n);
    const phoneDown = SPOT.phone.clone().setY(this.host.groundAt(SPOT.phone.x, SPOT.phone.z));
    if (s.shot === 'setup' || s.shot === 'final' || s.shot === 'floor' || (s.shot === 'line' && s.i >= 6)) b.holdR = undefined;
    switch (s.shot === 'line' ? s.i : -1) {
      case 1:
        // "Nah, that wasn't it. Do it again."
        a.look = ht;
        break;
      case 2:
        // "What do you mean?"
        a.palms = 1;
        a.shrug = 0.5;
        a.lean = 0.06;
        break;
      case 3:
        // "You gotta catch it more naturally."
        b.look = hn;
        break;
      case 4:
        // "Catch what naturally? I did the trick."
        if (d < W(3)) {
          a.palms = 1;
          a.shrug = 1;
          a.lean = -0.05;
        } else {
          a.point = new THREE.Vector3(-1.5, 0.4, 13.6);
          a.lean = 0.08;
        }
        break;
      case 5:
        // "Yeah, but it didn't look accidental." Nico looks straight down the lens.
        a.look = cam;
        break;
      case 6:
        // "Okay, this time pretend you don't know I'm filming."
        b.look = hn;
        if (d < W(2)) b.palms = 0.8;
        else if (d < W(5)) b.point = hn;
        else b.point = phoneDown;
        a.look = ht;
        break;
      case 7:
        // "You're literally talking to me."
        a.point = ht.clone().setY(ht.y - 0.3);
        a.lean = 0.1;
        b.look = hn;
        break;
    }
    if (s.shot === 'floor') {
      a.look = ht;
      b.look = hn;
    }
    return { a, b };
  }

  private updatePeople(dt: number, d: number, s: { shot: Shot; i: number }) {
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
    posePerson(T, b, dt, this.t);
    // the phone: in his hand, at Nico; then down on the ground, tipped onto its face
    if (b.holdR) {
      this.phone.position.copy(T.hr);
      this.phone.lookAt(headOf(N));
    } else {
      const p = SPOT.phone;
      this.phone.position.set(p.x, this.host.groundAt(p.x, p.z) + 0.04, p.z);
      this.phone.lookAt(SPOT.nico.x, 0.03, SPOT.nico.z);
      this.phone.rotateX(0.95);
    }
  }

  /* ----------------------------- camera ----------------------------- */

  /** The phone on the ground, filming up. `look` it aims at. */
  private ground(look: THREE.Vector3, fov: number) {
    const L = this.lens;
    const p = SPOT.phone;
    L.pos.set(p.x, this.host.groundAt(p.x, p.z) + 0.08, p.z);
    L.look.copy(look);
    L.fov = fov;
  }

  /** a smoothed board position for the phone to follow (from the clip, so the loop lands on the same frame) */
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

  private updateCamera(d: number, s: { shot: Shot; u: number; i: number }) {
    const L = this.lens;
    const cam = this.host.camera;
    const ride = this.riding(s);
    const N = this.nico!;
    const T = this.theo!;
    const hn = headOf(N);
    const ht = headOf(T);
    let shake = 0.006;
    let roll = 0;
    // in the phone's own shots Theo is behind it: keep him and it out of the lens
    let pov = false;
    switch (s.shot) {
      case 'hook':
      case 'tail':
      case 'take1': {
        // Theo's phone, panning with him
        this.setShot(s.shot === 'take1' ? 'take1' : 'hook', s.shot === 'take1');
        pov = true;
        const b = this.follow(ride![0], ride![1], new THREE.Vector3());
        L.pos.copy(this.held());
        L.look.copy(b).setY(b.y + 0.75);
        L.fov = 62;
        shake = 0.008;
        break;
      }
      case 'take2': {
        // take 2: fisheye, low, chasing the board like a real filmer
        this.setShot('take2', true);
        const g = this.ghost('kickflip')!;
        lens(g.clip, 'filmer', ride![1], { in: 0, out: 1 }, this.host.groundAt, L);
        L.pos.y -= 0.22;
        L.fov = 94;
        shake = 0.012;
        break;
      }
      case 'setup': {
        // take 3: he lowers the phone right down to the ground, aimed up at Nico
        this.setShot('setup', true);
        pov = true;
        const k = easeOut(Math.max(0, s.u - 0.25) / 0.7);
        const hi = this.held();
        const p = SPOT.phone;
        const lo = new THREE.Vector3(p.x, this.host.groundAt(p.x, p.z) + 0.08, p.z);
        L.pos.copy(hi).lerp(lo, k);
        L.look.copy(hn).setY(hn.y - 0.25 - 0.3 * (1 - k));
        L.fov = 62 + 20 * k;
        roll = Math.sin(k * Math.PI) * 0.35 + 0.05 * k;
        shake = 0.01 * (1 - k);
        break;
      }
      case 'final':
        this.finalCamera(s.u);
        shake = s.u >= REPLAY_AT ? 0.012 : 0.004;
        break;
      case 'floor': {
        // what the phone actually got: the floor
        this.setShot('floor', false);
        pov = true;
        const p = SPOT.phone;
        const y = this.host.groundAt(p.x, p.z);
        const to = SPOT.nico.clone().sub(p).setY(0).normalize();
        L.pos.set(p.x, y + 0.2, p.z);
        L.look.set(p.x + to.x * 0.14, y, p.z + to.z * 0.14);
        L.fov = 70;
        shake = 0;
        roll = 0.08;
        break;
      }
      default:
        this.dialogCamera(d, s.i, s.u, hn, ht);
        shake = s.i >= 6 ? 0 : 0.006;
        roll = s.i >= 6 ? 0.05 : 0;
        pov = s.i >= 6;
    }
    // Theo is behind the held phone in its own shots; down on the ground it sees him
    const behind = pov && (s.shot === 'hook' || s.shot === 'tail' || s.shot === 'take1' || (s.shot === 'setup' && s.u < 0.6));
    T.rider.group.visible = !behind;
    this.phone.visible = !pov && s.shot !== 'take2';
    if (s.shot === 'final' || s.shot === 'take2') this.focus.copy(this.ghost(ride![0])?.board.root.position ?? SPOT.nico);
    else this.focus.copy(SPOT.nico).lerp(SPOT.theo, 0.5);
    this.rec.classList.toggle('on', pov || s.shot === 'take2');
    handheld(cam, L.pos, L.look, L.fov, this.t, shake, roll);
  }

  /** Take 4: a crane off the deck, bullet time over the fountain, then the replay from the landing. */
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
      this.setShot('bullet', false);
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

  /** Singles and a two-shot from the side, then (take 3) the phone's view up from the ground. */
  private dialogCamera(d: number, i: number, u: number, hn: THREE.Vector3, ht: THREE.Vector3) {
    const L = this.lens;
    const { line } = this.lineAt(d);
    // 'two' (both), 'a' (Nico), 'b' (Theo); from line 6 on it's the phone on the ground
    const plan = ['two', 'b', 'a', 'b', 'a', 'two', 'gb', 'ga', 'floor'];
    const frame = plan[i] ?? 'two';
    this.setShot('line' + i, false);
    const axis = ht.clone().sub(hn).setY(0).normalize();
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    if (frame === 'gb' || frame === 'ga') {
      // Theo looming over the lens; then a pan across to Nico past him
      if (frame === 'gb') this.ground(ht.clone().setY(ht.y - 0.45), 84);
      else this.ground(hn.clone().setY(hn.y - 0.35).lerp(ht, 0.18 * (1 - easeOut(u / 0.4))), 78);
      return;
    }
    if (frame === 'two') {
      // portrait is narrow: over Nico's shoulder at Theo, so when Nico turns to the lens it's right there
      const push = smooth(u / 2) * 0.25;
      L.pos.copy(hn).addScaledVector(axis, -1.5 + push).addScaledVector(side, 0.5).setY(hn.y + 0.02);
      L.look.copy(ht).setY(ht.y - 0.35).lerp(hn, 0.2);
      L.fov = 54;
      return;
    }
    // a single from just off the other one's eyeline: head and shoulders, three-quarters on
    const me = frame === 'a' ? hn : ht;
    const other = frame === 'a' ? ht : hn;
    const toOther = other.clone().sub(me).setY(0).normalize();
    L.pos.copy(me).addScaledVector(toOther, 1.3).addScaledVector(side, 0.8).setY(me.y - 0.05);
    L.look.copy(me).setY(me.y - 0.2).addScaledVector(toOther, -0.06);
    const loud = line && /[!?]/.test(line.text) && line.who === frame;
    // Theo's singles creep in, like the camera knows he's insufferable
    L.fov = frame === 'b' ? 38 - 6 * smooth(u / 1.8) : 38 - (loud ? easeOut(u / 0.12) * 5 : 0);
  }

  /* ---------------------------- overlay ---------------------------- */

  private updateOverlay(d: number, s: { shot: Shot; u: number; i: number }) {
    // the phone's clock: a fresh recording every take
    const startOf: Record<string, number> = { take1: 0, take2: 0, setup: 0, final: 0 };
    const recT = s.shot in startOf ? s.u : s.shot === 'floor' ? 11 + s.u : s.shot === 'line' && s.i >= 6 ? 2 + s.u : d + LEAD_IN;
    const sec = Math.max(0, Math.floor(recT));
    this.tc.textContent = `00:${String(sec).padStart(2, '0')}`;
    this.pov.classList.toggle('on', s.shot === 'hook' || s.shot === 'tail');
    // slates: TAKE n, popped at the start of each take
    const slate = s.shot === 'take1' ? 'TAKE 1' : s.shot === 'take2' ? 'TAKE 2' : s.shot === 'setup' ? 'TAKE 3' : s.shot === 'final' && s.u < 0.6 ? 'TAKE 4' : '';
    const showSlate = !!slate && s.u < 0.75;
    if (this.slate.textContent !== slate) this.slate.textContent = slate;
    this.slate.classList.toggle('on', showSlate);
    const fin = s.shot === 'final';
    this.bars.classList.toggle('on', fin && s.u >= 0.6);
    this.tag.classList.toggle('on', fin && s.u >= REPLAY_AT);
    const callout = fin && s.u >= 0.75 && s.u < REPLAY_AT ? (s.u < 2.2 ? '360 LASER FLIP' : '360 LASER FLIP<small>+ FOUNTAIN GAP · 600</small>') : '';
    if (this.trick.innerHTML !== callout) this.trick.innerHTML = callout;
    this.trick.classList.toggle('on', !!callout);
    this.root.classList.toggle('slow', fin && s.u >= 0.6 && s.u < 2.5);
    this.updateCaptions(d, s);
  }

  private updateCaptions(d: number, s: { shot: Shot }) {
    const c = this.cues && s.shot !== 'tail' ? captionAt(this.cues, d) : null;
    let html = '';
    let key = '';
    if (c) {
      key = `${c.line}:${c.chunk[0].t0}`;
      html = c.chunk.map((w, k) => `<span class="${wordClass(w.w, MARKED)}${k < c.lit ? ' on' : ''}">${w.w.replace(/[<>&]/g, '')}</span>`).join(' ');
      this.cap.className = 'op-cap ' + this.cues!.lines[c.line].who;
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
