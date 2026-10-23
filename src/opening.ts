import * as THREE from 'three';
import { BoardModel } from './board';
import { HumanRider, StandState } from './humanrider';
import type { RiderId } from './rider';
import { Clip, F, STRIDE, Sfx, sampleFrame, clipDuration } from './replay/clip';
import { applyFrame, lens, Lens } from './replay/rig';
import { shadowTexture } from './textures';
import { sanitizeLook } from './custom';
import type { Audio } from './audio';
import { Cues, captionAt, wordClass } from './captions';
import { Jaw, rigJaw } from './jaw';

/**
 * The story-mode opening, in engine and shot for a phone: three seconds of a
 * busy Brazil Park (real recorded trick lines replayed on extra skaters), a
 * hard cut to two locals arguing over a bagged bottle ("Who's on the rail"),
 * voiced and captioned word by word, then the player drops in.
 *
 * Assets (public/story/, made by tools/story/): ghosts.bin (the background
 * skaters), opening.mp3 (the dialogue) and opening.json (when every line and
 * word is spoken).
 */

export const OPENING_ID = 'story-opening';

/** seconds of park montage before the cut */
const MONTAGE = 3;
/** the dialogue starts this long after the cut */
const LEAD_IN = 0.3;
/** hold after the last line before the player drops in */
const TAIL = 1.1;
/** phone framing on wide screens */
const PORTRAIT = 9 / 16;

interface Ghost {
  clip: Clip;
  board: BoardModel;
  rider: HumanRider;
  blob: THREE.Mesh;
  /** clip time at opening time 0 */
  offset: number;
  frame: Float32Array;
  sfxAt: number;
}

/** Where the background skaters' lines start, so each trick lands inside its montage shot. */
const OFFSETS: Record<string, number> = { flat: 1.6, kicker: 1.43, rail: 2.5, stairs: -0.05, ramp: 0 };

/** The two locals. A explains, B loses it. */
const LOOK_A = sanitizeLook({
  body: 'm',
  height: 0.62,
  shape: { weight: 0.68, muscle: 0.45, shoulders: 0.55 },
  skin: '#8d5a3b',
  hair: 'short01',
  hairColor: '#17120f',
  hat: null,
  top: 'baggy',
  topColor: '#1f1f1f',
  bottom: 'jeans',
  bottomColor: '#2c3e64',
  shoes: 'shoes02',
  shoesColor: '#f4f1ea',
});
const LOOK_B = sanitizeLook({
  body: 'm',
  height: 0.4,
  shape: { weight: 0.38, muscle: 0.5 },
  skin: '#d49c72',
  hair: 'afro01',
  hairColor: '#2a1c12',
  hat: null,
  top: 'flannel',
  topColor: '#c8402d',
  bottom: 'jeans',
  bottomColor: '#c9b793',
  shoes: 'shoes06',
  shoesColor: '#1f1f1f',
});

/** Where the argument happens: just off the spawn, looking north over the park. */
const SPOT = { a: new THREE.Vector3(6.55, 0, 47.1), b: new THREE.Vector3(5.45, 0, 47.25) };
const KICKER = new THREE.Vector3(-34, 0.9, 30);

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** A brown paper bag twisted round the neck of a big bottle. Origin at the neck, body down -Y. */
function paperBagBottle() {
  const g = new THREE.Group();
  // the bag: a lathe that crumples in toward the neck, with a wobbly rim
  const prof: THREE.Vector2[] = [];
  const pts = [
    [0.0, -0.3],
    [0.052, -0.298],
    [0.056, -0.27],
    [0.054, -0.18],
    [0.057, -0.12],
    [0.05, -0.08],
    [0.034, -0.055],
    [0.028, -0.04],
    [0.036, -0.025],
  ];
  for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
  const bag = new THREE.LatheGeometry(prof, 14);
  const pos = bag.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    // creases: radial wobble that grows toward the twisted top
    const k = 1 + 0.08 * Math.sin(a * 5 + y * 40) + 0.05 * Math.sin(a * 9 - y * 23);
    pos.setXYZ(i, x * k, y, z * k);
  }
  bag.computeVertexNormals();
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#a77b4f';
  c.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 260; i++) {
    c.fillStyle = `rgba(${Math.random() < 0.5 ? '60,38,20' : '214,180,135'},${0.05 + Math.random() * 0.1})`;
    c.fillRect(Math.random() * 64, Math.random() * 128, 1 + Math.random() * 10, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const bagMesh = new THREE.Mesh(bag, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }));
  // the glass neck and cap poking out
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.07, 10).translate(0, 0.0, 0), new THREE.MeshStandardMaterial({ color: 0x3b2a12, roughness: 0.15, metalness: 0.1 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 10).translate(0, 0.04, 0), new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.4, metalness: 0.7 }));
  g.add(bagMesh, neck, cap);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

interface Person {
  rider: HumanRider;
  st: StandState;
  /** eased hand targets */
  hl: THREE.Vector3;
  hr: THREE.Vector3;
  jaw: Jaw | null;
}

function person(look: ReturnType<typeof sanitizeLook>, at: THREE.Vector3): Person {
  const rider = new HumanRider('custom', look);
  rider.setStyle('solid');
  rider.group.position.copy(at);
  return {
    rider,
    st: { time: 0, look: new THREE.Vector3(), talk: 0, handL: new THREE.Vector3(), reachL: 0, handR: new THREE.Vector3(), reachR: 0, lean: 0, shrug: 0 },
    hl: new THREE.Vector3(),
    hr: new THREE.Vector3(),
    jaw: null,
  };
}

/** What a person is doing right now: the targets their hands, head and body ease toward. */
interface Intent {
  look: THREE.Vector3;
  /** a world point to point at (with whichever hand is on that side) */
  point?: THREE.Vector3 | null;
  /** both palms up and out */
  palms?: number;
  /** hands to the head */
  head?: number;
  /** both arms flung up */
  fling?: number;
  /** a hand over the face */
  face?: number;
  /** the bottle to the lips */
  sip?: number;
  lean?: number;
  shrug?: number;
}

export interface OpeningHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  audio: Audio;
  groundAt(x: number, z: number): number;
}

export class Opening {
  private root: HTMLElement;
  private cap: HTMLElement;
  private hook: HTMLElement;
  private flash: HTMLElement;
  private group = new THREE.Group();
  private ghosts: Ghost[] = [];
  private a: Person | null = null;
  private b: Person | null = null;
  private bottle = paperBagBottle();
  private cues: Cues | null = null;
  private voice: AudioBuffer | null = null;
  private voiceAt = 0;
  private voiceStop: (() => void) | null = null;
  private loading: Promise<void> | null = null;
  private t = 0;
  private shot = -1;
  private chunk = '';
  private onDone: (() => void) | null = null;
  private lens: Lens = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  /** where the shadows should centre */
  focus = new THREE.Vector3();
  active = false;

  constructor(
    parent: HTMLElement,
    private host: OpeningHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'op';
    parent.appendChild(this.root);
    this.hook = document.createElement('div');
    this.hook.className = 'op-hook';
    this.hook.textContent = 'POV: first session at Brazil Park';
    this.cap = document.createElement('div');
    this.cap.className = 'op-cap';
    this.flash = document.createElement('div');
    this.flash.className = 'op-flash';
    const skip = document.createElement('button');
    skip.className = 'op-skip';
    skip.textContent = 'Skip ›';
    skip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.finish();
    });
    this.root.append(this.hook, this.cap, this.flash, skip);
  }

  /** Fetch the clips, voice and models; resolves when everything is in (or gave up). */
  load(): Promise<void> {
    return (this.loading ??= this.fetchAll());
  }

  private async fetchAll() {
    const base = import.meta.env.BASE_URL + 'story/';
    const [bin, cues, mp3] = await Promise.all([
      fetch(base + 'ghosts.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
      fetch(base + 'opening.json').then((r) => (r.ok ? (r.json() as Promise<Cues>) : null)),
      fetch(base + 'opening.mp3').then((r) => (r.ok ? r.arrayBuffer() : null)),
    ]).catch(() => [null, null, null] as const);
    this.cues = cues;
    if (mp3) this.voice = await this.host.audio.decode(mp3);
    if (bin) this.ghosts = this.unpack(bin);
    this.a = person(LOOK_A, SPOT.a);
    this.b = person(LOOK_B, SPOT.b);
    for (const p of [this.a, this.b]) this.group.add(p.rider.group);
    this.group.add(this.bottle);
    // models stream in; give them a few seconds before rolling anyway
    const riders = [...this.ghosts.map((g) => g.rider), this.a.rider, this.b.rider];
    const t0 = performance.now();
    while (riders.some((r) => !r.ready) && performance.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 100));
  }

  private unpack(buf: ArrayBuffer): Ghost[] {
    const n = new DataView(buf).getUint32(0, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as { name: string; rider: RiderId; frames: number; sfx?: Sfx[] }[];
    let off = 4 + n + ((4 - ((4 + n) % 4)) % 4);
    const decks = ['brazil', 'atlas', 'compass', 'japan', 'airmail', 'mosaic'];
    return head.map((h, i) => {
      const data = new Float32Array(buf, off, h.frames * STRIDE);
      off += h.frames * STRIDE * 4;
      const clip = { id: h.name, name: h.name, created: 0, level: 0, levelName: '', rider: h.rider, look: null, deck: decks[i % decks.length], frames: h.frames, data, sfx: h.sfx ?? [] } as Clip;
      const board = new BoardModel();
      board.setDeck(clip.deck);
      const rider = new HumanRider(h.rider);
      rider.setStyle('solid');
      const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      );
      this.group.add(board.root, rider.group, blob);
      return { clip, board, rider, blob, offset: OFFSETS[h.name] ?? 0, frame: new Float32Array(STRIDE), sfxAt: -1 };
    });
  }

  get ready() {
    return !!this.cues && !!this.a?.rider.ready && !!this.b?.rider.ready;
  }

  play(onDone: () => void) {
    this.onDone = onDone;
    this.active = true;
    this.t = 0;
    this.shot = -1;
    this.chunk = '';
    this.voiceAt = 0;
    this.host.scene.add(this.group);
    // the bystanders stand on whatever the ground is there
    for (const [p, at] of [[this.a!, SPOT.a], [this.b!, SPOT.b]] as const) p.rider.group.position.set(at.x, this.host.groundAt(at.x, at.z), at.z);
    this.face();
    for (const g of this.ghosts) g.sfxAt = this.clipT(g, 0);
    this.root.classList.add('on');
    this.hook.classList.add('show');
    this.cap.textContent = '';
  }

  /** The two turn toward each other, opened up a little to the camera. */
  private face() {
    const A = this.a!.rider.group;
    const B = this.b!.rider.group;
    const cam = new THREE.Vector3((SPOT.a.x + SPOT.b.x) / 2, 0, SPOT.a.z + 4);
    for (const [me, other] of [
      [A, B],
      [B, A],
    ]) {
      const d = other.position.clone().sub(me.position).setY(0).normalize();
      const c = cam.clone().sub(me.position).setY(0).normalize();
      const f = d.addScaledVector(c, 1).normalize();
      me.rotation.set(0, Math.atan2(f.x, f.z), 0);
    }
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.voiceStop?.();
    this.voiceStop = null;
    this.host.scene.remove(this.group);
    this.root.classList.remove('on');
    this.hook.classList.remove('show');
    this.host.audio.update(0, 'none', 0, false);
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  /** Free the clips, boards and models (the opening only ever plays once in a while). */
  dispose() {
    for (const g of this.ghosts) {
      g.rider.dispose();
      g.board.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const p of [this.a, this.b]) {
      p?.jaw?.dispose();
      p?.rider.dispose();
    }
    this.ghosts = [];
    this.a = this.b = null;
    this.group.clear();
    this.loading = null;
  }

  private get end() {
    return MONTAGE + LEAD_IN + (this.cues?.duration ?? 0) + TAIL;
  }

  private clipT(g: Ghost, t: number) {
    const len = clipDuration(g.clip) + 0.6;
    const x = t + g.offset;
    return x < 0 ? x : x % len;
  }

  /** Dialogue time: the voice's own clock when it's playing, so captions never drift. */
  private dialogT() {
    const ctx = this.host.audio.ctx;
    if (this.voiceStop && ctx) return ctx.currentTime - this.voiceAt;
    return this.t - MONTAGE - LEAD_IN;
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    if (t >= this.end) return this.finish();
    this.updateGhosts(t);
    if (t >= MONTAGE + LEAD_IN && !this.voiceStop && this.voice && this.host.audio.ctx && !this.host.audio.muted) {
      const v = this.host.audio.play(this.voice, 1.15);
      this.voiceAt = v.at;
      this.voiceStop = v.stop;
    }
    const d = this.dialogT();
    this.updatePeople(dt, t, d);
    this.updateCamera(t, d);
    this.updateCaptions(d);
  }

  /* ---------------------------- skaters ---------------------------- */

  private updateGhosts(t: number) {
    const cam = this.host.camera.position;
    let near: Ghost | null = null;
    let nearD = Infinity;
    for (const g of this.ghosts) {
      const ct = this.clipT(g, t);
      sampleFrame(g.clip, Math.max(0, ct), g.frame);
      applyFrame({ board: g.board, rider: g.rider, blob: g.blob, camera: this.host.camera }, g.frame);
      // hold off-screen until the line starts
      const on = ct >= 0;
      g.board.root.visible = g.rider.group.visible = g.blob.visible = on;
      const dist = g.board.root.position.distanceTo(cam);
      if (on && dist < nearD) {
        near = g;
        nearD = dist;
      }
      // the line's own sounds, quieter with distance
      if (ct < g.sfxAt) g.sfxAt = ct - 1e-3; // looped
      const level = Math.min(1, 7 / Math.max(1, dist)) * 0.9;
      for (const s of g.clip.sfx) {
        if (s.t > g.sfxAt && s.t <= ct) {
          const fn = (this.host.audio as unknown as Record<string, (...a: unknown[]) => void>)[s.n];
          if (fn) this.host.audio.distant(level, () => fn.apply(this.host.audio, s.a));
        }
      }
      g.sfxAt = ct;
    }
    // wheels: the closest skater's roll and grind
    if (near) {
      const f = near.frame;
      const k = Math.min(1, 6 / Math.max(1, nearD));
      this.host.audio.update(f[F.sound] * k, f[F.sound + 1] === 2 ? 'slide' : f[F.sound + 1] === 1 ? 'grind' : 'none', f[F.sound + 2] * k, false);
    }
  }

  private ghost(name: string) {
    return this.ghosts.find((g) => g.clip.name === name) ?? null;
  }

  /* ---------------------------- the two ---------------------------- */

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

  private targetOf(name: 'rail' | 'ramp' | 'kicker') {
    if (name === 'kicker') return KICKER;
    const g = this.ghost(name);
    return g ? g.board.root.position.clone().setY(g.board.root.position.y + 0.6) : KICKER;
  }

  private headOf(p: Person) {
    return p.rider.joint('head', new THREE.Vector3());
  }

  /** Who does what, line by line. */
  private intents(d: number): { a: Intent; b: Intent } {
    const A = this.a!;
    const B = this.b!;
    const ha = this.headOf(A);
    const hb = this.headOf(B);
    const a: Intent = { look: hb };
    const b: Intent = { look: ha };
    const camP = this.host.camera.position;
    if (d < -LEAD_IN + 0.01) {
      // caught mid-argument: they're already glaring at each other
      return { a, b };
    }
    const { i, u } = this.lineAt(d);
    const W = (n: number) => this.wordT(i, n);
    switch (i) {
      case -1:
        a.sip = 1; // a swig before he explains it again
        break;
      case 0: {
        // "Who's on the rail, What's on the ramp, and Both's on the kicker."
        const at = d < W(4) ? 'rail' : d < W(9) ? 'ramp' : 'kicker';
        a.point = this.targetOf(at);
        a.look = d < W(1) ? hb : a.point;
        a.lean = 0.04;
        break;
      }
      case 1:
        // "Who's on the rail?"
        b.palms = 1;
        b.lean = 0.08;
        break;
      case 2:
        // "Yep."
        a.look = hb;
        break;
      case 3:
        // "I'm asking you!"
        b.point = ha.clone().setY(ha.y - 0.35);
        b.lean = 0.12;
        break;
      case 4:
        // "Who."
        a.palms = 0.5;
        a.shrug = 0.4;
        break;
      case 5:
        // "The guy on the rail!"
        b.point = this.targetOf('rail');
        b.look = u < 0.35 ? b.point : ha;
        b.lean = 0.1;
        break;
      case 6:
        // "Who's on the rail."
        a.point = this.targetOf('rail');
        a.look = u < 0.5 ? hb : a.point;
        break;
      case 7:
        // "What?"
        b.palms = 1;
        b.shrug = 1;
        b.lean = -0.06;
        break;
      case 8:
        // "Ramp."
        a.point = this.targetOf('ramp');
        a.look = a.point;
        break;
      case 9:
        // "Okay. Then who's on the kicker?"
        if (d < W(1)) {
          b.head = 1;
          b.look = camP;
        } else {
          b.point = this.targetOf('kicker');
          b.look = d < W(3) ? b.point : ha;
        }
        break;
      case 10:
        // "Both."
        a.look = hb;
        break;
      case 11:
        // "Both of WHO?!"
        b.fling = 1;
        b.shrug = 1;
        b.lean = -0.14;
        break;
      default: {
        // "Rail." ... and a calm swig while the other one gives up
        a.look = u < 0.6 ? hb : camP;
        a.sip = u > 0.5 ? 1 : 0;
        b.face = u > 0.35 ? 1 : 0;
        b.lean = 0.12;
        b.look = new THREE.Vector3(hb.x, hb.y - 1, hb.z).addScaledVector(new THREE.Vector3(0, 0, 1), 1);
      }
    }
    return { a, b };
  }

  private updatePeople(dt: number, t: number, d: number) {
    if (!this.a || !this.b) return;
    const { a, b } = this.intents(d);
    for (const [p, it, who] of [
      [this.a, a, 'a'],
      [this.b, b, 'b'],
    ] as const) {
      const st = p.st;
      st.time = t + (who === 'a' ? 0 : 1.7);
      st.talk = this.talkLevel(who, d);
      // the jaw flaps with the syllables inside each word
      if (!p.jaw && p.rider.ready) p.jaw = rigJaw(p.rider.group);
      p.jaw?.set(st.talk * (0.45 + 0.55 * Math.abs(Math.sin(d * 17 + (who === 'a' ? 0 : 1)))) + (it.sip ? 0.25 : 0));
      const k = 1 - Math.exp(-dt * 11);
      st.look.lerp(it.look, st.look.lengthSq() ? k : 1);
      st.lean += ((it.lean ?? 0) - st.lean) * k;
      st.shrug += ((it.shrug ?? 0) - st.shrug) * k;
      const g = p.rider.group;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      const left = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
      const head = this.headOf(p);
      const chest = head.clone().setY(head.y - 0.42);
      // decide each hand's target
      let wl: THREE.Vector3 | null = null;
      let wr: THREE.Vector3 | null = null;
      // point up over anything in the way, higher the farther it is: "way over there"
      const reach = (from: THREE.Vector3, to: THREE.Vector3, len = 0.75) => {
        const dir = to.clone().sub(from);
        const lift = 0.25 + Math.min(0.45, dir.length() / 80);
        return from.clone().add(dir.normalize().add(new THREE.Vector3(0, lift, 0)).normalize().multiplyScalar(len));
      };
      if (it.point) {
        const toT = it.point.clone().sub(chest);
        const side = toT.dot(left) >= 0 ? 'l' : 'r';
        const sh = chest.clone().addScaledVector(left, side === 'l' ? 0.18 : -0.18).setY(chest.y + 0.1);
        const target = reach(sh, it.point);
        if (side === 'l') wl = target;
        else wr = target;
      }
      if (it.palms) {
        const lo = chest.clone().setY(chest.y - 0.2).addScaledVector(fwd, 0.3);
        wl ??= lo.clone().addScaledVector(left, 0.32 * it.palms);
        wr ??= lo.clone().addScaledVector(left, -0.32 * it.palms);
      }
      if (it.head) {
        wl = head.clone().addScaledVector(left, 0.12).setY(head.y + 0.08);
        wr = head.clone().addScaledVector(left, -0.12).setY(head.y + 0.08);
      }
      if (it.fling) {
        wl = head.clone().addScaledVector(left, 0.55).setY(head.y + 0.35).addScaledVector(fwd, 0.15);
        wr = head.clone().addScaledVector(left, -0.55).setY(head.y + 0.35).addScaledVector(fwd, 0.15);
      }
      if (it.face) wl = head.clone().addScaledVector(fwd, 0.12).setY(head.y + 0.02);
      if (it.sip && who === 'a') wr = head.clone().addScaledVector(fwd, 0.16).setY(head.y - 0.06);
      // ease: quick to throw a hand out, slower to let it drop
      const ease = (cur: THREE.Vector3, want: THREE.Vector3 | null, r: number, curReach: number) => {
        if (want) cur.lerp(want, curReach < 0.05 ? 1 : 1 - Math.exp(-dt * 16));
        return curReach + ((want ? 1 : 0) - curReach) * (1 - Math.exp(-dt * (want ? r : 6)));
      };
      st.reachL = ease(p.hl, wl, 12, st.reachL);
      st.reachR = ease(p.hr, wr, 12, st.reachR);
      st.handL!.copy(p.hl);
      st.handR!.copy(p.hr);
      p.rider.stand(st);
    }
    this.placeBottle();
    this.focus.copy(SPOT.a).lerp(SPOT.b, 0.5);
  }

  /** The bottle rides in A's right hand: neck at the fist, bag along the forearm. */
  private placeBottle() {
    const r = this.a!.rider;
    const hand = r.joint('hand_r', new THREE.Vector3());
    const elbow = r.joint('lowerarm_r', new THREE.Vector3());
    const along = hand.clone().sub(elbow).normalize();
    this.bottle.position.copy(hand).addScaledVector(along, 0.05);
    // the bag hangs past the fist, the neck back toward the wrist
    this.bottle.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), along);
    // a hand at the mouth tips the bottle up
    const head = r.joint('head', new THREE.Vector3());
    if (hand.distanceTo(head) < 0.3) {
      const up = new THREE.Vector3(0, 1, 0);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(r.group.quaternion);
      const dir = up.multiplyScalar(0.8).addScaledVector(fwd, 0.6).normalize();
      this.bottle.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      this.bottle.position.copy(head).addScaledVector(fwd, 0.1).setY(head.y - 0.06);
    }
    this.bottle.visible = r.ready;
  }

  /** 0..1 mouth-and-head energy for a speaker: a pulse on every word they say. */
  private talkLevel(who: 'a' | 'b', d: number) {
    let v = 0;
    for (const L of this.cues?.lines ?? []) {
      if (L.who !== who || d < L.t0 - 0.1 || d > L.t1 + 0.1) continue;
      for (const w of L.words) {
        if (d < w.t0 - 0.05 || d > w.t1 + 0.05) continue;
        const k = (d - w.t0) / Math.max(0.08, w.t1 - w.t0);
        v = Math.max(v, Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * (/[!?]|[A-Z]{2,}/.test(w.w) ? 1 : 0.7));
      }
    }
    return v;
  }

  /* ----------------------------- camera ----------------------------- */

  private setShot(n: number) {
    if (n === this.shot) return;
    const first = this.shot === -1;
    this.shot = n;
    if (first) return;
    // hard cut: a white blink and a whoosh on the big one
    if (n === 4) {
      this.flash.classList.remove('go');
      void this.flash.offsetWidth;
      this.flash.classList.add('go');
      this.host.audio.whoosh();
      this.hook.classList.remove('show');
    }
  }

  private updateCamera(t: number, d: number) {
    const L = this.lens;
    const cam = this.host.camera;
    const g = (n: string) => this.ghost(n);
    if (t < MONTAGE) {
      // 0: drone push over the park, 1: low tripod on the jump box, 2: fisheye on the rail, 3: the 6-stair
      const n = t < 0.8 ? 0 : t < 1.5 ? 1 : t < 2.2 ? 2 : 3;
      this.setShot(n);
      if (n === 0) {
        const k = easeOut(t / 0.8);
        L.pos.set(-12, 11, 68).lerp(new THREE.Vector3(-3, 5.5, 52), k);
        L.look.set(-2, 0, 24).lerp(new THREE.Vector3(3, 0.8, 28), k);
        L.fov = 62 - 8 * k;
      } else if (n === 1 && g('kicker')) {
        const b = g('kicker')!.board.root.position;
        L.pos.set(-30.6, 0.42, 27.4);
        L.look.lerp(b.clone().setY(b.y + 0.55), t - 0.8 < 1 / 30 ? 1 : 0.35);
        L.fov = 74 - 10 * smooth((t - 0.8) / 0.7);
      } else if (n === 2 && g('rail')) {
        const gh = g('rail')!;
        lens(gh.clip, 'filmer', Math.max(0, this.clipT(gh, t)), { in: 0, out: 1 }, this.host.groundAt, L);
        L.fov = 86;
      } else if (n === 3 && g('stairs')) {
        const b = g('stairs')!.board.root.position;
        const k = smooth((t - 2.2) / 0.8);
        L.pos.set(46, 0.7, -31.5).lerp(new THREE.Vector3(45.2, 0.55, -30.6), k);
        L.look.lerp(b.clone().setY(b.y + 0.6), t - 2.2 < 1 / 30 ? 1 : 0.4);
        L.fov = 62 - 6 * k;
      }
      this.focus.copy(L.look);
    } else {
      this.dialogCamera(d);
    }
    // handheld: a phone in somebody's hand
    const shake = t < MONTAGE ? 0.012 : 0.006;
    const n1 = Math.sin(t * 7.3) * 0.6 + Math.sin(t * 13.1) * 0.4;
    const n2 = Math.sin(t * 5.9 + 1.3) * 0.6 + Math.sin(t * 11.7 + 0.4) * 0.4;
    cam.position.copy(L.pos);
    cam.position.x += n1 * shake * 4;
    cam.position.y += n2 * shake * 3;
    cam.lookAt(L.look.x + n2 * shake, L.look.y + n1 * shake, L.look.z);
    cam.fov = L.fov;
    cam.updateProjectionMatrix();
  }

  /** Cut to whoever is talking; punch in on the loud ones. */
  private dialogCamera(d: number) {
    const L = this.lens;
    const A = this.a!;
    const B = this.b!;
    const ha = this.headOf(A);
    const hb = this.headOf(B);
    const mid = ha.clone().lerp(hb, 0.5);
    const { i, line, u } = this.lineAt(d);
    // which framing: 'two' (both, waist up), 'a' or 'b' (one face)
    const plan = ['two', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'a', 'two', 'a', 'b', 'two'];
    const frame = i < 0 ? 'two' : (plan[i] ?? 'two');
    // a new shot per line; shot 4 is the cut in from the montage
    this.setShot(5 + i);
    const front = new THREE.Vector3(0, 0, 1);
    if (frame === 'two') {
      const push = smooth(Math.max(0, d + LEAD_IN) / 4) * 0.5;
      const end = i >= 12 ? smooth(u / 1.2) * 0.35 : 0;
      L.pos.copy(mid).addScaledVector(front, 3.4 - push + end).setY(mid.y - 0.12);
      L.look.copy(mid).setY(mid.y - 0.42);
      L.fov = 48;
    } else {
      // a single from just off the other one's eyeline: the speaker's face, three-quarters on
      const me = frame === 'a' ? ha : hb;
      const other = frame === 'a' ? hb : ha;
      const toOther = other.clone().sub(me).setY(0).normalize();
      L.pos.copy(me).addScaledVector(toOther, 0.85).addScaledVector(front, 0.62).setY(me.y - 0.04);
      L.look.copy(me).setY(me.y - 0.12).addScaledVector(toOther, -0.06);
      // loud lines punch in fast
      const loud = line && /[!?]/.test(line.text) && line.who === frame;
      const punch = loud ? easeOut(u / 0.12) : 0;
      L.fov = 40 - punch * (i === 11 ? 12 : 6);
    }
  }

  /* ---------------------------- captions ---------------------------- */

  private updateCaptions(d: number) {
    const c = this.cues ? captionAt(this.cues, d) : null;
    let html = '';
    let key = '';
    if (c) {
      key = `${c.line}:${c.chunk[0].t0}`;
      html = c.chunk.map((w, k) => `<span class="${wordClass(w.w)}${k < c.lit ? ' on' : ''}">${w.w.replace(/[<>&]/g, '')}</span>`).join(' ');
      this.cap.className = 'op-cap ' + this.cues!.lines[c.line].who;
    }
    if (key !== this.chunk) {
      this.chunk = key;
      // each new chunk pops in
      this.cap.classList.remove('pop');
      void this.cap.offsetWidth;
      if (key) this.cap.classList.add('pop');
    }
    if (this.cap.innerHTML !== html) this.cap.innerHTML = html;
  }

  /* ----------------------------- framing ----------------------------- */

  /** The phone-shaped rectangle the opening renders into (CSS pixels, top-left origin). */
  static view(w: number, h: number) {
    if (w / h <= PORTRAIT + 0.01) return { x: 0, y: 0, w, h };
    const vw = Math.round(h * PORTRAIT);
    return { x: Math.round((w - vw) / 2), y: 0, w: vw, h };
  }

  /** Keep the overlay over the picture. */
  layout(w: number, h: number) {
    const v = Opening.view(w, h);
    Object.assign(this.root.style, { left: v.x + 'px', top: v.y + 'px', width: v.w + 'px', height: v.h + 'px' });
    return v;
  }
}

