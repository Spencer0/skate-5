import * as THREE from 'three';
import * as T from './textures';

/**
 * Skateboard model. Local axes: +X = nose, +Y = up, +Z = right side.
 *
 * Hierarchy:
 *   root   – placed at the wheel contact point, oriented to the base frame
 *   pivot  – at deck centre height; trick rotations happen here
 *   deck / trucks / wheels
 */
export const DECK = {
  length: 0.81,
  width: 0.205,
  thick: 0.012,
  wheelR: 0.027,
  truckX: 0.19,
  deckY: 0.082, // deck mid-plane above contact
};

export class BoardModel {
  root = new THREE.Group();
  pivot = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Mesh[] = [];
  hangers: THREE.Group[] = [];
  private wheelSpin = 0;
  private graphic!: THREE.MeshStandardMaterial;
  deck = 'atlas';

  /** Swap the bottom graphic for an unlocked deck. */
  setDeck(id: string) {
    if (id === this.deck) return;
    this.deck = id;
    this.graphic.map?.dispose();
    this.graphic.map = T.deckTexture(id);
    this.graphic.needsUpdate = true;
  }

  constructor() {
    this.root.add(this.pivot);
    this.pivot.position.y = DECK.deckY;
    this.pivot.add(this.body);
    this.body.position.y = -DECK.deckY;
    this.buildDeck();
    this.buildTrucks();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
      }
    });
  }

  private buildDeck() {
    const { length: L, width: W, thick: TH } = DECK;
    const NX = 64;
    const NY = 10;
    const a = L / 2 - W * 0.55;
    const Rx = W * 0.55;
    const halfW = (x: number) => {
      const ax = Math.abs(x);
      if (ax <= a) return W / 2;
      const t = Math.min(1, (ax - a) / Rx);
      return (W / 2) * Math.sqrt(Math.max(0, 1 - t * t)) * 0.999 + 0.0005;
    };
    const kickStart = 0.25;
    const lift = (x: number, y: number) => {
      const ax = Math.abs(x);
      let z = 0;
      if (ax > kickStart) {
        const k = x > 0 ? 3.4 : 3.0; // nose a touch steeper
        z = (ax - kickStart) ** 2 * k;
      }
      const ny = y / (W / 2);
      z += 0.005 * ny * ny; // concave
      return z;
    };

    const topPos: number[] = [];
    const botPos: number[] = [];
    const topUv: number[] = [];
    const botUv: number[] = [];
    const idxTop: number[] = [];
    const idxBot: number[] = [];
    for (let i = 0; i <= NX; i++) {
      // cluster samples toward the ends for smooth tips
      const s = i / NX;
      const x = -L / 2 + L * (0.5 - 0.5 * Math.cos(Math.PI * s));
      const hw = halfW(x);
      for (let j = 0; j <= NY; j++) {
        const t = j / NY;
        const y = -hw + 2 * hw * t;
        const z = lift(x, y);
        topPos.push(x, z + TH / 2, y);
        botPos.push(x, z - TH / 2, y);
        topUv.push(x / L + 0.5, 1 - (y / W + 0.5));
        // the bottom is seen from below, so mirror across the width
        botUv.push(x / L + 0.5, y / W + 0.5);
      }
    }
    const row = NY + 1;
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const p = i * row + j;
        const q = p + row;
        idxTop.push(p, p + 1, q, q, p + 1, q + 1);
        idxBot.push(p, q, p + 1, q, q + 1, p + 1);
      }
    }
    const mk = (pos: number[], uv: number[], idx: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const top = mk(topPos, topUv, idxTop);
    const bot = mk(botPos, botUv, idxBot);
    // ensure orientation: top normals up, bottom down
    fixFacing(top, 1);
    fixFacing(bot, -1);

    // side wall around the outline
    const sidePos: number[] = [];
    const sideUv: number[] = [];
    const sideIdx: number[] = [];
    const outline: number[] = [];
    for (let i = 0; i <= NX; i++) outline.push(i * row + 0);
    for (let i = NX; i >= 0; i--) outline.push(i * row + NY);
    let k = 0;
    for (let n = 0; n < outline.length; n++) {
      const vi = outline[n];
      sidePos.push(topPos[vi * 3], topPos[vi * 3 + 1], topPos[vi * 3 + 2]);
      sidePos.push(botPos[vi * 3], botPos[vi * 3 + 1], botPos[vi * 3 + 2]);
      sideUv.push(n / outline.length, 1, n / outline.length, 0);
      if (n > 0) {
        const b = k - 2;
        sideIdx.push(b, b + 1, k, k, b + 1, k + 1);
      }
      k += 2;
    }
    const side = mk(sidePos, sideUv, sideIdx);

    const grip = new THREE.MeshStandardMaterial({ map: T.boardTopTexture(), roughness: 0.95 });
    const graphic = new THREE.MeshStandardMaterial({ map: T.deckTexture('atlas'), roughness: 0.42, metalness: 0.0 });
    this.graphic = graphic;
    const wood = new THREE.MeshStandardMaterial({ map: T.woodTexture(), roughness: 0.7, side: THREE.DoubleSide });
    const deck = new THREE.Group();
    deck.add(new THREE.Mesh(top, grip));
    deck.add(new THREE.Mesh(bot, graphic));
    deck.add(new THREE.Mesh(side, wood));
    deck.position.y = DECK.deckY;
    this.body.add(deck);
  }

  private buildTrucks() {
    const metal = new THREE.MeshStandardMaterial({ color: 0xd6d3cc, roughness: 0.28, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6, metalness: 0.4 });
    const bushing = new THREE.MeshStandardMaterial({ color: 0xe04a3b, roughness: 0.6 });
    const urethane = new THREE.MeshStandardMaterial({ color: 0xfaf9f5, roughness: 0.55 });
    const core = new THREE.MeshStandardMaterial({ color: 0xe04a3b, roughness: 0.5 });
    const deckBottom = DECK.deckY - DECK.thick / 2;
    const axleY = DECK.wheelR;
    for (const sx of [-1, 1]) {
      const x = sx * DECK.truckX;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.008, 0.06), dark);
      base.position.set(x, deckBottom - 0.004, 0);
      this.body.add(base);
      const bush = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 10), bushing);
      bush.position.set(x - sx * 0.012, deckBottom - 0.016, 0);
      this.body.add(bush);
      const hanger = new THREE.Group();
      hanger.position.set(x, axleY, 0);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.15), metal);
      h.position.y = 0.012;
      hanger.add(h);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.02, deckBottom - axleY - 0.02, 0.03), metal);
      neck.position.y = (deckBottom - axleY) / 2;
      hanger.add(neck);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.21, 6), metal);
      axle.rotation.x = Math.PI / 2;
      hanger.add(axle);
      for (const sz of [-1, 1]) {
        const w = new THREE.Group();
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(DECK.wheelR, DECK.wheelR, 0.032, 18), urethane);
        tire.rotation.x = Math.PI / 2;
        w.add(tire);
        const c = new THREE.Mesh(new THREE.CylinderGeometry(DECK.wheelR * 0.55, DECK.wheelR * 0.55, 0.034, 12), core);
        c.rotation.x = Math.PI / 2;
        w.add(c);
        // a spoke mark so you can see the wheels spin
        const mark = new THREE.Mesh(new THREE.BoxGeometry(0.006, DECK.wheelR * 1.5, 0.036), dark);
        w.add(mark);
        w.position.z = sz * 0.088;
        hanger.add(w);
        this.wheels.push(w as unknown as THREE.Mesh);
      }
      this.hangers.push(hanger);
      this.body.add(hanger);
    }
  }

  /** Spin wheels by distance travelled; steer the hangers. */
  animate(dist: number, steer: number) {
    this.wheelSpin -= dist / DECK.wheelR;
    for (const w of this.wheels) w.rotation.z = this.wheelSpin;
    this.hangers[0].rotation.y = steer * 0.12; // tail truck
    this.hangers[1].rotation.y = -steer * 0.12; // nose truck
  }
}

function fixFacing(g: THREE.BufferGeometry, sign: number) {
  const n = g.getAttribute('normal');
  let s = 0;
  for (let i = 0; i < n.count; i++) s += n.getY(i);
  if (s * sign < 0) {
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
}
