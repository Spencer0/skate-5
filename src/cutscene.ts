import * as THREE from 'three';
import type { Cutscene, Shot, V3 } from './levels';
import { CAST, portrait } from './cast';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * Plays scripted camera shots with letterboxing, a title card and
 * typewriter dialogue. Tap to advance a line; Skip ends the scene.
 */
export class CutscenePlayer {
  private root: HTMLElement;
  private title: HTMLElement;
  private titleMain: HTMLElement;
  private titleSub: HTMLElement;
  private box: HTMLElement;
  private face: HTMLImageElement;
  private who: HTMLElement;
  private role: HTMLElement;
  private text: HTMLElement;
  private more: HTMLElement;

  private scene: Cutscene | null = null;
  private shot = 0;
  private t = 0;
  private line = 0;
  private typed = 0;
  private lineDone = false;
  private onDone: (() => void) | null = null;
  private look = new THREE.Vector3();
  onLine: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.root = el('div', 'cut', parent);
    el('div', 'cut-bar top', this.root);
    el('div', 'cut-bar bottom', this.root);
    this.title = el('div', 'cut-title', this.root);
    this.titleMain = el('div', 'cut-title-main', this.title);
    this.titleSub = el('div', 'cut-title-sub', this.title);
    this.box = el('div', 'cut-box', this.root);
    this.face = el('img', 'cut-face', this.box) as HTMLImageElement;
    const col = el('div', 'cut-col', this.box);
    const head = el('div', 'cut-head', col);
    this.who = el('span', 'cut-who', head);
    this.role = el('span', 'cut-role', head);
    this.text = el('div', 'cut-text', col);
    this.more = el('div', 'cut-more', this.box, '▸');
    const skip = el('button', 'cut-skip', this.root, 'Skip ›') as HTMLButtonElement;
    skip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.finish();
    });
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.advance();
    });
  }

  get active() {
    return this.scene !== null;
  }

  play(scene: Cutscene, onDone: () => void) {
    this.scene = scene;
    this.onDone = onDone;
    this.root.classList.add('on');
    this.startShot(0);
  }

  private get cur(): Shot {
    return this.scene!.shots[this.shot];
  }

  private startShot(i: number) {
    this.shot = i;
    this.t = 0;
    this.line = 0;
    const s = this.cur;
    if (s.title) {
      this.titleMain.textContent = s.title;
      this.titleSub.textContent = s.subtitle ?? '';
      this.title.classList.remove('show');
      void this.title.offsetWidth; // restart the animation
      this.title.classList.add('show');
    }
    this.showLine();
  }

  private showLine() {
    const lines = this.cur.lines ?? [];
    if (this.line >= lines.length) {
      this.box.classList.remove('on');
      this.lineDone = true;
      return;
    }
    const l = lines[this.line];
    const c = CAST[l.who];
    this.face.src = portrait(l.who);
    this.who.textContent = c.name;
    this.who.style.color = c.color === '#F0EEE6' ? '#141413' : c.color;
    this.role.textContent = c.role;
    this.text.textContent = '';
    this.typed = 0;
    this.lineDone = false;
    this.box.classList.add('on');
    this.box.classList.remove('pop');
    void this.box.offsetWidth;
    this.box.classList.add('pop');
    this.onLine?.();
  }

  private advance() {
    if (!this.scene) return;
    const lines = this.cur.lines ?? [];
    if (this.line < lines.length && !this.lineDone) {
      // finish typing first
      this.typed = lines[this.line].text.length;
      this.text.textContent = lines[this.line].text;
      this.lineDone = true;
      return;
    }
    if (this.line < lines.length) {
      this.line++;
      this.showLine();
      return;
    }
    this.nextShot();
  }

  private nextShot() {
    if (!this.scene) return;
    if (this.shot + 1 < this.scene.shots.length) this.startShot(this.shot + 1);
    else this.finish();
  }

  finish() {
    if (!this.scene) return;
    this.scene = null;
    this.root.classList.remove('on');
    this.box.classList.remove('on');
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  update(dt: number) {
    if (!this.scene) return;
    const s = this.cur;
    this.t += dt;
    // type the current line
    const lines = s.lines ?? [];
    if (this.line < lines.length && !this.lineDone) {
      const full = lines[this.line].text;
      this.typed = Math.min(full.length, this.typed + dt * 52);
      this.text.textContent = full.slice(0, Math.floor(this.typed));
      if (this.typed >= full.length) this.lineDone = true;
    }
    this.more.style.opacity = this.lineDone && this.line < lines.length ? '1' : '0';
    // camera: ease along the move; hold at the end while dialogue continues
    const k = smooth(Math.min(1, this.t / s.dur));
    const p = v3(s.cam).lerp(v3(s.cam2 ?? s.cam), k);
    this.look.copy(v3(s.look)).lerp(v3(s.look2 ?? s.look), k);
    // gentle drift so holds don't feel frozen
    p.y += Math.sin(this.t * 0.6) * 0.08;
    this.camera.position.copy(p);
    this.camera.lookAt(this.look);
    const portraitMode = window.innerWidth < window.innerHeight;
    this.camera.fov = portraitMode ? 66 : 50;
    this.camera.updateProjectionMatrix();
    // a shot with no dialogue left moves on by itself
    if (this.line >= lines.length && this.t >= s.dur) this.nextShot();
  }
}

/** A single-shot "show me" preview for a goal. */
export function previewScene(id: string, cam: V3, look: V3, title: string, hint: string): Cutscene {
  const c = v3(cam);
  const l = v3(look);
  const away = c.clone().sub(l).multiplyScalar(1.25).add(l);
  return {
    id,
    shots: [{ cam: [away.x, away.y + 1, away.z], cam2: cam, look, dur: 3.2, title, subtitle: hint }],
  };
}
