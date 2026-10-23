import * as THREE from 'three';
import type { Audio } from '../audio';
import type { BoardModel } from '../board';
import { HumanRider } from '../humanrider';
import type { RiderId } from '../rider';
import type { CustomLook } from '../custom';
import {
  CAM_MODES,
  Clip,
  Edit,
  F,
  FPS,
  MAX_LIBRARY_SECONDS,
  SPEEDS,
  STRIDE,
  Segment,
  Sfx,
  clipDuration,
  editLength,
  editSfx,
  fmtTime,
  locate,
  sampleFrame,
  segLength,
  trim,
} from './clip';
import { Lens, applyFrame, lens } from './rig';
import { deleteClip, listClips, loadEdit, roomLeft, saveEdit } from './store';
import { FORMATS, Format, canExport, exportMp4, renderSound } from './export';

/** What the studio borrows from the game while it's open. */
export interface StudioHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  board: BoardModel;
  blob: THREE.Mesh;
  audio: Audio;
  /** the player's own rider, hidden while the studio has the stage */
  rider(): HumanRider;
  loadLevel(i: number): void;
  groundAt(x: number, z: number): number;
  /** the player's deck, put back on the way out */
  deck(): string;
  /** sparks, dust and splashes for the frame being shown */
  fx(dt: number, at: THREE.Vector3, grind: number, events: string[]): void;
  /** ambient motion, particles, sky; then draw (into `view` only, in CSS pixels from the top left) */
  render(dt: number, view?: { x: number; y: number; w: number; h: number }): void;
  setRenderSize(w: number, h: number, ratio: number): void;
  restoreRenderSize(): void;
  exit(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

type Source = { kind: 'edit' } | { kind: 'clip'; id: string } | { kind: 'seg'; index: number };

/**
 * The skate-video editor: watch saved clips, drop them on the edit strip,
 * trim each cut, pick its lens and speed, then render the whole edit to MP4.
 */
export class Studio {
  active = false;
  exporting = false;
  private root: HTMLElement;
  private clips = new Map<string, Clip>();
  private order: Clip[] = [];
  private edit: Edit = { title: '', segments: [] };
  private src: Source = { kind: 'edit' };
  private t = 0;
  private playing = false;
  private riders = new Map<string, HumanRider>();
  private shown: HumanRider | null = null;
  private frame = new Float32Array(STRIDE);
  private view: Lens = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private camPos = new THREE.Vector3();
  private sfxCache: Sfx[] | null = null;
  private cancel = false;
  // UI parts rebuilt on change
  private playBtn!: HTMLButtonElement;
  private timeLabel!: HTMLElement;
  private scrub!: HTMLInputElement;
  private trimBar!: HTMLElement;
  private body!: HTMLElement;
  private dialog: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private host: StudioHost,
  ) {
    this.root = el('div', 'studio', parent);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /* -------------------------------------------------------------- */
  /* Open / close                                                    */
  /* -------------------------------------------------------------- */

  async open() {
    this.active = true;
    this.root.classList.add('on');
    this.root.replaceChildren();
    el('div', 'studio-loading', this.root, 'Loading clips…');
    this.host.rider().group.visible = false;
    try {
      this.order = await listClips();
      this.edit = (await loadEdit()) ?? { title: '', segments: [] };
    } catch (e) {
      console.warn('studio storage unavailable', e);
      this.order = [];
    }
    this.clips = new Map(this.order.map((c) => [c.id, c]));
    this.edit.segments = this.edit.segments.filter((s) => this.clips.has(s.clip));
    this.src = this.edit.segments.length ? { kind: 'edit' } : this.order.length ? { kind: 'clip', id: this.order[0].id } : { kind: 'edit' };
    this.t = 0;
    this.playing = false;
    this.sfxCache = null;
    this.build();
  }

  close() {
    this.active = false;
    this.playing = false;
    this.cancel = true;
    this.root.classList.remove('on');
    this.root.replaceChildren();
    this.dialog = null;
    if (this.shown) this.host.scene.remove(this.shown.group);
    this.shown = null;
    for (const r of this.riders.values()) r.dispose();
    this.riders.clear();
    const mine = this.host.rider();
    mine.group.visible = true;
    this.host.board.setDeck(this.host.deck());
    this.host.audio.update(0, 'none', 0, false);
    this.host.exit();
  }

  /* -------------------------------------------------------------- */
  /* Playback                                                        */
  /* -------------------------------------------------------------- */

  private length() {
    const s = this.src;
    if (s.kind === 'edit') return editLength(this.edit);
    const c = this.sourceClip();
    return c ? clipDuration(c) : 0;
  }

  private sourceClip(): Clip | null {
    const s = this.src;
    if (s.kind === 'clip') return this.clips.get(s.id) ?? null;
    if (s.kind === 'seg') return this.clips.get(this.edit.segments[s.index]?.clip) ?? null;
    return null;
  }

  /** What's on screen at the playhead: clip, clip time and the cut it belongs to. */
  private at(t: number): { clip: Clip; clipT: number; seg: Segment } | null {
    const s = this.src;
    if (s.kind === 'edit') {
      const l = locate(this.edit, t);
      if (!l) return null;
      const seg = this.edit.segments[l.index];
      const clip = this.clips.get(seg.clip);
      return clip ? { clip, clipT: l.clipT, seg } : null;
    }
    const clip = this.sourceClip();
    if (!clip) return null;
    const seg: Segment = s.kind === 'seg' ? this.edit.segments[s.index] : { clip: clip.id, in: 0, out: clipDuration(clip), speed: 1, cam: 'game' };
    return { clip, clipT: t, seg };
  }

  private riderFor(c: Clip) {
    const key = `${c.rider}:${JSON.stringify(c.look ?? null)}`;
    let r = this.riders.get(key);
    if (!r) {
      r = new HumanRider(c.rider as RiderId, (c.look as CustomLook | null) ?? null);
      r.setStyle('solid');
      this.riders.set(key, r);
    }
    if (this.shown !== r) {
      if (this.shown) this.host.scene.remove(this.shown.group);
      this.host.scene.add(r.group);
      this.shown = r;
    }
    return r;
  }

  /** Pose the whole scene for playhead t. */
  private show(t: number, dt: number, events: string[], snap: boolean) {
    const a = this.at(t);
    if (!a) return false;
    const { clip, clipT, seg } = a;
    this.host.loadLevel(clip.level);
    this.host.board.setDeck(clip.deck);
    const rider = this.riderFor(clip);
    sampleFrame(clip, clipT, this.frame);
    applyFrame({ board: this.host.board, rider, blob: this.host.blob, camera: this.host.camera }, this.frame);
    lens(clip, seg.cam, clipT, seg, this.host.groundAt, this.view);
    const cam = this.host.camera;
    // the game lens already carries its own smoothing; the others ease a touch
    if (snap || seg.cam !== 'filmer') this.camPos.copy(this.view.pos);
    else this.camPos.lerp(this.view.pos, Math.min(1, dt * 8));
    cam.position.copy(this.camPos);
    cam.lookAt(this.view.look);
    cam.fov = this.view.fov;
    cam.updateProjectionMatrix();
    const grind = this.frame[F.mode] === 2 ? this.frame[F.sound + 1] || 1 : 0;
    this.host.fx(dt, this.host.board.root.position, grind, events);
    return true;
  }

  private sounds(): Sfx[] {
    const s = this.src;
    if (s.kind === 'edit') return (this.sfxCache ??= editSfx(this.edit, this.clips));
    return this.sourceClip()?.sfx ?? [];
  }

  /** Main-loop tick while the studio is open. */
  update(dt: number) {
    if (this.exporting) return;
    const prev = this.t;
    const events: string[] = [];
    if (this.playing) {
      const s = this.src;
      const speed = s.kind === 'seg' ? this.edit.segments[s.index].speed : 1;
      const end = s.kind === 'seg' ? this.edit.segments[s.index].out : this.length();
      this.t = Math.min(end, this.t + dt * speed);
      for (const x of this.sounds()) {
        if (x.t > prev && x.t <= this.t) {
          events.push(x.n);
          (this.host.audio as unknown as Record<string, (...a: unknown[]) => void>)[x.n]?.(...x.a);
        }
      }
      if (this.t >= end) this.setPlaying(false);
      this.syncTransport();
    }
    const ok = this.show(this.t, dt, events, !this.playing);
    if (this.playing && ok) {
      const s = this.frame;
      this.host.audio.update(s[F.sound], s[F.sound + 1] === 2 ? 'slide' : s[F.sound + 1] === 1 ? 'grind' : 'none', s[F.sound + 2], s[F.sound + 3] > 0.5);
    } else this.host.audio.update(0, 'none', 0, false);
    if (!ok) {
      // nothing to show: slow orbit over the current spot
      const cam = this.host.camera;
      const a = performance.now() / 9000;
      cam.position.set(Math.cos(a) * 18, 9, Math.sin(a) * 18);
      cam.lookAt(0, 0, 0);
    }
    const view = this.monitor();
    this.host.camera.aspect = view.w / view.h;
    this.host.camera.updateProjectionMatrix();
    this.host.render(dt, view);
  }

  /** The preview is framed like the export, in the space the panel leaves free. */
  private monitor() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const panel = this.root.querySelector('.studio-panel')?.getBoundingClientRect();
    const top = this.root.querySelector('.studio-top')?.getBoundingClientRect();
    let x = 0;
    let y = top ? top.bottom + 6 : 0;
    let w = W;
    let h = H - y;
    if (panel) {
      // side panel (short landscape screens) or bottom sheet
      if (panel.left > W * 0.3) w = panel.left - 8;
      else h = panel.top - 6 - y;
    }
    if (w < 80 || h < 60) {
      x = 0;
      y = 0;
      w = W;
      h = H;
    }
    const aspect = this.format.w / this.format.h;
    const fw = Math.min(w, h * aspect);
    const fh = fw / aspect;
    return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
  }

  private setPlaying(on: boolean) {
    if (on) {
      const s = this.src;
      const start = s.kind === 'seg' ? this.edit.segments[s.index].in : 0;
      const end = s.kind === 'seg' ? this.edit.segments[s.index].out : this.length();
      if (this.t >= end - 1e-3 || (s.kind === 'seg' && this.t < start)) this.t = start;
    }
    this.playing = on && this.length() > 0;
    if (this.playBtn) {
      this.playBtn.textContent = this.playing ? '❚❚' : '▶';
      this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    }
  }

  /* -------------------------------------------------------------- */
  /* UI                                                              */
  /* -------------------------------------------------------------- */

  private changed() {
    this.sfxCache = null;
    saveEdit(this.edit).catch((e) => console.warn('could not save the edit', e));
  }

  private select(src: Source, t?: number) {
    this.src = src;
    this.setPlaying(false);
    if (t !== undefined) this.t = t;
    else if (src.kind === 'seg') this.t = this.edit.segments[src.index].in;
    else this.t = 0;
    this.buildBody();
    this.syncTransport();
  }

  private build() {
    this.root.replaceChildren();
    const top = el('div', 'studio-top', this.root);
    const back = el('button', 'menu-back', top, '‹') as HTMLButtonElement;
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', () => this.close());
    el('h2', 'studio-h', top, 'Studio');
    const exp = el('button', 'menu-btn primary studio-export', top, 'Export MP4') as HTMLButtonElement;
    exp.addEventListener('click', () => this.exportDialog());

    const panel = el('div', 'studio-panel', this.root);
    const tr = el('div', 'studio-transport', panel);
    this.playBtn = el('button', 'studio-play', tr, '▶') as HTMLButtonElement;
    this.playBtn.setAttribute('aria-label', 'Play');
    this.playBtn.addEventListener('click', () => this.setPlaying(!this.playing));
    const scrubWrap = el('div', 'studio-scrub', tr);
    this.trimBar = el('div', 'studio-trimbar', scrubWrap);
    this.scrub = el('input', '', scrubWrap) as HTMLInputElement;
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.step = String(1 / FPS);
    this.scrub.setAttribute('aria-label', 'Playhead');
    this.scrub.addEventListener('input', () => {
      this.setPlaying(false);
      this.t = Number(this.scrub.value);
      this.syncTransport();
    });
    this.timeLabel = el('div', 'studio-time', tr);
    this.body = el('div', 'studio-body', panel);
    this.buildBody();
    this.syncTransport();
  }

  private syncTransport() {
    if (!this.scrub) return;
    const len = this.length();
    this.scrub.max = String(len);
    this.scrub.value = String(this.t);
    this.scrub.disabled = len <= 0;
    const s = this.src;
    if (s.kind === 'seg') {
      const seg = this.edit.segments[s.index];
      const a = len > 0 ? (seg.in / len) * 100 : 0;
      const b = len > 0 ? (seg.out / len) * 100 : 100;
      this.trimBar.style.left = `${a}%`;
      this.trimBar.style.width = `${b - a}%`;
      this.trimBar.style.display = '';
    } else this.trimBar.style.display = 'none';
    this.timeLabel.textContent = `${fmtTime(this.t)} / ${fmtTime(len)}`;
    this.root.querySelectorAll<HTMLElement>('.strip-seg').forEach((n, i) => {
      const cur = s.kind === 'edit' ? locate(this.edit, this.t)?.index === i && this.playing : s.kind === 'seg' && s.index === i;
      n.classList.toggle('on', !!cur);
    });
  }

  private seg(parent: HTMLElement, items: { id: string; name: string }[], cur: string, set: (id: string) => void) {
    const row = el('div', 'seg', parent);
    for (const it of items) {
      const b = el('button', 'seg-btn' + (it.id === cur ? ' on' : ''), row, it.name);
      b.addEventListener('click', () => set(it.id));
    }
  }

  private buildBody() {
    const b = this.body;
    b.replaceChildren();
    const s = this.src;

    // the cut being trimmed
    if (s.kind === 'seg') {
      const seg = this.edit.segments[s.index];
      const clip = this.clips.get(seg.clip)!;
      const box = el('div', 'studio-trim', b);
      const head = el('div', 'studio-row', box);
      el('div', 'studio-label', head, `Cut ${s.index + 1} · ${clip.name}`);
      el('div', 'studio-dim', head, `${fmtTime(segLength(seg))} on screen`);
      const row = el('div', 'studio-row', box);
      const setIn = el('button', 'menu-btn small', row, '⟦ Set start') as HTMLButtonElement;
      setIn.addEventListener('click', () => {
        trim(seg, clip, 'in', this.t);
        this.changed();
        this.buildBody();
        this.syncTransport();
      });
      const setOut = el('button', 'menu-btn small', row, 'Set end ⟧') as HTMLButtonElement;
      setOut.addEventListener('click', () => {
        trim(seg, clip, 'out', this.t);
        this.changed();
        this.buildBody();
        this.syncTransport();
      });
      el('div', 'opt-label', box, 'Lens');
      this.seg(box, CAM_MODES, seg.cam, (id) => {
        seg.cam = id as Segment['cam'];
        this.changed();
        this.buildBody();
      });
      el('div', 'opt-label', box, 'Speed');
      this.seg(
        box,
        SPEEDS.map((v) => ({ id: String(v), name: v === 1 ? 'Normal' : `Slow-mo ${v === 0.5 ? '½' : '¼'}` })),
        String(seg.speed),
        (id) => {
          seg.speed = Number(id);
          this.changed();
          this.buildBody();
        },
      );
      const acts = el('div', 'studio-row', box);
      const move = (d: number) => {
        const j = s.index + d;
        if (j < 0 || j >= this.edit.segments.length) return;
        const list = this.edit.segments;
        [list[s.index], list[j]] = [list[j], list[s.index]];
        this.changed();
        this.select({ kind: 'seg', index: j }, this.t);
      };
      (el('button', 'menu-btn small', acts, '◀ Earlier') as HTMLButtonElement).addEventListener('click', () => move(-1));
      (el('button', 'menu-btn small', acts, 'Later ▶') as HTMLButtonElement).addEventListener('click', () => move(1));
      (el('button', 'menu-btn small', acts, 'Duplicate') as HTMLButtonElement).addEventListener('click', () => {
        this.edit.segments.splice(s.index + 1, 0, { ...seg });
        this.changed();
        this.select({ kind: 'seg', index: s.index + 1 });
      });
      (el('button', 'menu-btn small danger', acts, 'Remove') as HTMLButtonElement).addEventListener('click', () => {
        this.edit.segments.splice(s.index, 1);
        this.changed();
        this.select({ kind: 'edit' });
      });
    }

    // the edit strip
    const strip = el('div', 'studio-section', b);
    const sh = el('div', 'studio-row', strip);
    el('div', 'studio-label', sh, 'Your edit');
    el('div', 'studio-dim', sh, this.edit.segments.length ? `${this.edit.segments.length} cuts · ${fmtTime(editLength(this.edit))}` : '');
    if (this.edit.segments.length) {
      const all = el('button', 'menu-btn small' + (s.kind === 'edit' ? ' on' : ''), sh, '▶ Watch edit') as HTMLButtonElement;
      all.addEventListener('click', () => {
        this.select({ kind: 'edit' });
        this.setPlaying(true);
      });
    }
    const row = el('div', 'studio-strip', strip);
    if (!this.edit.segments.length) el('div', 'studio-empty', row, 'Add clips from below to start cutting your video.');
    const total = Math.max(0.001, editLength(this.edit));
    this.edit.segments.forEach((seg, i) => {
      const c = this.clips.get(seg.clip)!;
      const chip = el('button', 'strip-seg', row) as HTMLButtonElement;
      chip.style.flexGrow = String(Math.max(0.6, (segLength(seg) / total) * 10));
      el('b', '', chip, `${i + 1}`);
      el('span', '', chip, c.name);
      el('small', '', chip, `${fmtTime(segLength(seg))}${seg.speed < 1 ? ' · slow' : ''} · ${CAM_MODES.find((m) => m.id === seg.cam)?.name}`);
      chip.addEventListener('click', () => (s.kind === 'seg' && s.index === i ? this.select({ kind: 'edit' }) : this.select({ kind: 'seg', index: i })));
    });

    // the library
    const lib = el('div', 'studio-section', b);
    const lh = el('div', 'studio-row', lib);
    el('div', 'studio-label', lh, 'Clips');
    const used = MAX_LIBRARY_SECONDS - roomLeft(this.order);
    el('div', 'studio-dim', lh, `${fmtTime(used).replace(/\.\d$/, '')} of ${MAX_LIBRARY_SECONDS / 60}:00 used`);
    if (!this.order.length) {
      el('p', 'studio-empty', lib, 'No clips yet. Turn on Recording in Options, then tap ● REC (or press V) while you skate.');
    }
    const list = el('div', 'studio-clips', lib);
    for (const c of this.order) {
      const card = el('div', 'clip-card' + (s.kind === 'clip' && s.id === c.id ? ' on' : ''), list);
      const info = el('button', 'clip-info', card) as HTMLButtonElement;
      el('b', '', info, c.name);
      el('small', '', info, `${c.levelName} · ${fmtTime(clipDuration(c))}`);
      info.addEventListener('click', () => {
        this.select({ kind: 'clip', id: c.id });
        this.setPlaying(true);
      });
      const add = el('button', 'menu-btn small primary', card, '+ Add') as HTMLButtonElement;
      add.addEventListener('click', () => {
        // a clip watched and scrubbed adds from the playhead on
        const from = s.kind === 'clip' && s.id === c.id && this.t < clipDuration(c) - 0.5 ? this.t : 0;
        this.edit.segments.push({ clip: c.id, in: from, out: clipDuration(c), speed: 1, cam: 'filmer' });
        this.changed();
        this.select({ kind: 'seg', index: this.edit.segments.length - 1 });
      });
      const del = el('button', 'menu-btn small icon-only', card, '✕') as HTMLButtonElement;
      del.setAttribute('aria-label', `Delete ${c.name}`);
      del.addEventListener('click', () => this.confirmDelete(c));
    }
  }

  private confirmDelete(c: Clip) {
    const inEdit = this.edit.segments.filter((s) => s.clip === c.id).length;
    const d = this.modal();
    el('h3', 'studio-h', d, 'Delete clip?');
    el('p', 'menu-p', d, `“${c.name}” will be gone for good${inEdit ? `, along with its ${inEdit} cut${inEdit > 1 ? 's' : ''} in your edit` : ''}.`);
    const row = el('div', 'menu-btns row', d);
    (el('button', 'menu-btn', row, 'Keep it') as HTMLButtonElement).addEventListener('click', () => this.closeModal());
    (el('button', 'menu-btn primary', row, 'Delete') as HTMLButtonElement).addEventListener('click', async () => {
      this.closeModal();
      try {
        await deleteClip(c.id);
      } catch (e) {
        console.warn('delete failed', e);
        return;
      }
      this.clips.delete(c.id);
      this.order = this.order.filter((x) => x.id !== c.id);
      this.edit.segments = this.edit.segments.filter((s) => s.clip !== c.id);
      this.changed();
      this.select({ kind: 'edit' });
    });
  }

  private modal() {
    this.closeModal();
    const wrap = el('div', 'studio-modal', this.root);
    this.dialog = wrap;
    return el('div', 'menu-card', wrap);
  }

  private closeModal() {
    this.dialog?.remove();
    this.dialog = null;
  }

  /* -------------------------------------------------------------- */
  /* Export                                                          */
  /* -------------------------------------------------------------- */

  private format: Format = FORMATS[0];

  private exportDialog() {
    this.setPlaying(false);
    const d = this.modal();
    el('h3', 'studio-h', d, 'Export video');
    if (!this.edit.segments.length) {
      el('p', 'menu-p', d, 'Your edit is empty. Add a clip or two first.');
      (el('button', 'menu-btn primary', el('div', 'menu-btns', d), 'OK') as HTMLButtonElement).addEventListener('click', () => this.closeModal());
      return;
    }
    if (!canExport()) {
      el('p', 'menu-p', d, 'This browser can’t encode video. Try a recent Chrome, Edge or Safari.');
      (el('button', 'menu-btn primary', el('div', 'menu-btns', d), 'OK') as HTMLButtonElement).addEventListener('click', () => this.closeModal());
      return;
    }
    el('p', 'menu-p small', d, `${this.edit.segments.length} cuts · ${fmtTime(editLength(this.edit))} at ${FPS} fps, with sound.`);
    el('div', 'opt-label', d, 'Format');
    const fmts = el('div', '', d);
    const drawFmts = () => {
      fmts.replaceChildren();
      this.seg(fmts, [...FORMATS], this.format.id, (id) => {
        this.format = FORMATS.find((f) => f.id === id)!;
        drawFmts();
      });
    };
    drawFmts();
    el('div', 'opt-label', d, 'Title card (optional)');
    const title = el('input', 'studio-input', d) as HTMLInputElement;
    title.maxLength = 40;
    title.placeholder = 'e.g. Summer Part';
    title.value = this.edit.title;
    title.addEventListener('input', () => {
      this.edit.title = title.value;
      this.changed();
    });
    const row = el('div', 'menu-btns row', d);
    (el('button', 'menu-btn', row, 'Cancel') as HTMLButtonElement).addEventListener('click', () => this.closeModal());
    (el('button', 'menu-btn primary', row, 'Export MP4') as HTMLButtonElement).addEventListener('click', () => this.runExport());
  }

  private async runExport() {
    const d = this.modal();
    d.classList.add('studio-progress');
    el('h3', 'studio-h', d, 'Rendering your video');
    const bar = el('div', 'studio-bar', d);
    const fill = el('div', 'studio-bar-fill', bar);
    const label = el('p', 'menu-p small', d, 'Getting ready…');
    const row = el('div', 'menu-btns', d);
    const cancelBtn = el('button', 'menu-btn', row, 'Cancel') as HTMLButtonElement;
    this.cancel = false;
    cancelBtn.addEventListener('click', () => (this.cancel = true));

    const { w, h } = this.format;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d')!;
    const duration = editLength(this.edit);
    const titleText = this.edit.title.trim();
    this.exporting = true;
    this.src = { kind: 'edit' };
    this.host.audio.update(0, 'none', 0, false);
    this.host.setRenderSize(w, h, 1);
    let blob: Blob | null = null;
    let error: unknown = null;
    try {
      await this.ridersReady();
      const sfx = editSfx(this.edit, this.clips);
      let si = 0;
      blob = await exportMp4({
        format: this.format,
        duration,
        cancelled: () => this.cancel || !this.active,
        progress: (p, msg) => {
          fill.style.width = `${Math.round(p * 100)}%`;
          label.textContent = msg;
        },
        draw: (i) => {
          const t = i / FPS;
          const events: string[] = [];
          while (si < sfx.length && sfx[si].t <= t) events.push(sfx[si++].n);
          this.show(t, 1 / FPS, events, i === 0);
          this.host.render(1 / FPS);
          g.drawImage(this.host.renderer.domElement, 0, 0, w, h);
          if (titleText) drawTitle(g, w, h, titleText, t);
          return out;
        },
        sound: () =>
          renderSound(duration, sfx, (t) => {
            const a = this.at(t);
            if (!a) return [0, 0, 0, 0];
            sampleFrame(a.clip, a.clipT, this.frame);
            return [this.frame[F.sound], this.frame[F.sound + 1], this.frame[F.sound + 2], this.frame[F.sound + 3]];
          }),
      });
    } catch (e) {
      error = e;
      console.error('export failed', e);
    } finally {
      this.exporting = false;
      this.host.restoreRenderSize();
      this.t = 0;
    }
    if (!this.active) return;
    const done = this.modal();
    if (error) {
      el('h3', 'studio-h', done, 'Export failed');
      el('p', 'menu-p', done, error instanceof Error ? error.message : String(error));
      (el('button', 'menu-btn primary', el('div', 'menu-btns', done), 'OK') as HTMLButtonElement).addEventListener('click', () => this.closeModal());
      return;
    }
    if (!blob) return this.closeModal();
    const name = `${(titleText || 'skate-edit').replace(/[^\w-]+/g, '-').toLowerCase()}.mp4`;
    const url = URL.createObjectURL(blob);
    el('h3', 'studio-h', done, 'Your video is ready');
    el('p', 'menu-p small', done, `${name} · ${(blob.size / 1e6).toFixed(1)} MB`);
    const btns = el('div', 'menu-btns', done);
    const dl = el('a', 'menu-btn primary studio-dl', btns, 'Download MP4') as HTMLAnchorElement;
    dl.href = url;
    dl.download = name;
    const file = new File([blob], name, { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      (el('button', 'menu-btn', btns, 'Share…') as HTMLButtonElement).addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
    }
    (el('button', 'menu-btn', btns, 'Close') as HTMLButtonElement).addEventListener('click', () => {
      URL.revokeObjectURL(url);
      this.closeModal();
    });
    dl.click();
  }

  /** Rider models load in the background; an export waits for them so nobody renders as a capsule. */
  private async ridersReady() {
    for (const seg of this.edit.segments) {
      const c = this.clips.get(seg.clip);
      if (c) this.riderFor(c);
    }
    const until = performance.now() + 15000;
    while ([...this.riders.values()].some((r) => !r.ready) && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
  }
}

/** Lower-third title over the opening seconds. */
function drawTitle(g: CanvasRenderingContext2D, w: number, h: number, text: string, t: number) {
  const a = Math.max(0, Math.min(1, t / 0.4, (3.2 - t) / 0.6));
  if (a <= 0) return;
  const size = Math.round(Math.min(w, h) * 0.085);
  g.save();
  g.globalAlpha = a;
  g.font = `700 ${size}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const x = Math.round(w * 0.07);
  const y = Math.round(h * 0.84);
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = size * 0.35;
  g.fillStyle = '#faf9f5';
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.fillStyle = '#e04a3b';
  g.fillRect(x, y + size * 0.22, Math.min(w * 0.5, g.measureText(text).width), Math.max(3, size * 0.08));
  g.restore();
}
