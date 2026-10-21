import * as THREE from 'three';
import { BoardModel } from './board';
import { CustomLook, heightOf } from './custom';
import { HumanRider } from './humanrider';
import type { RiderId } from './rider';

/**
 * A little turntable: the game's HumanRider standing on a board in its own
 * canvas. Used by the create-a-skater screen and the skater picker. Models
 * swap in only once loaded, so edits don't flash.
 */
export class RiderStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
  private board = new BoardModel();
  private rider: HumanRider | null = null;
  private pending: HumanRider | null = null;
  private height = 1.8;
  private yaw = -0.5;
  private dragging = false;
  private raf = 0;
  private last = 0;
  private t = 0;
  private ro: ResizeObserver;

  constructor(readonly el: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'creator-canvas';
    el.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7d6c, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    this.scene.add(this.board.root);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshBasicMaterial({ color: 0x141413, transparent: true, opacity: 0.08 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.002;
    this.scene.add(disc);

    // drag to turn the skater around
    let lx = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      lx = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - lx) * 0.012;
      lx = e.clientX;
    });
    const up = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.frame(performance.now());
  }

  /** Show a rider; it replaces the current one the moment its model is ready. */
  show(id: RiderId, look: CustomLook | null = null) {
    this.pending?.dispose();
    this.pending = new HumanRider(id, look);
    this.height = look ? heightOf(look) : 1.8;
    this.scene.add(this.pending.group);
    this.pending.group.visible = false;
  }

  /** Camera framing follows the look's height without a rebuild. */
  setHeight(h: number) {
    this.height = h;
  }

  reshape(look: CustomLook) {
    this.rider?.reshape(look);
    this.pending?.reshape(look);
  }

  recolor(look: CustomLook) {
    this.rider?.recolor(look);
    this.pending?.recolor(look);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.rider?.dispose();
    this.pending?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.t += dt;
    if (this.pending?.ready) {
      if (this.rider) {
        this.scene.remove(this.rider.group);
        this.rider.dispose();
      }
      this.rider = this.pending;
      this.pending = null;
      this.rider.setStyle('solid');
      this.rider.group.visible = true;
    }
    if (!this.dragging) this.yaw += dt * 0.35;
    const h = this.height;
    // fit the whole skater (and the board under their feet) in the frame, tall or narrow
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = this.camera.aspect || 1;
    const dist = Math.max((h + 0.45) / 2 / half, 0.9 / aspect / half);
    this.camera.position.set(Math.sin(this.yaw) * dist, h * 0.5 + 0.2, Math.cos(this.yaw) * dist);
    this.camera.lookAt(0, h * 0.5 + 0.04, 0);
    this.rider?.update(dt, { crouch: 0.1, tuck: 0, lean: 0, push: -1, grind: null, air: false, time: this.t });
    this.renderer.render(this.scene, this.camera);
  };
}
