import * as THREE from 'three';
import { Terrain } from './terrain';
import type { PropDef, PropKind } from './levels';
import { letterTexture } from './textures';

/**
 * Things you skate through: letters and the secret tape (collected) and
 * signs / cones / beach balls (knocked flying). Everything resets per run.
 */

interface Knock {
  kind: PropKind;
  obj: THREE.Object3D;
  base: THREE.Vector3;
  hit: boolean;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  t: number;
}

interface Pickup {
  idx: number; // letter index, or -1 for the tape
  obj: THREE.Object3D;
  base: THREE.Vector3;
}

const LETTERS = 'CLAUDE';

function signMesh() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x9a968e, metalness: 0.7, roughness: 0.4 }));
  post.position.y = 0.8;
  g.add(post);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.beginPath();
  x.arc(64, 64, 62, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#c0392b';
  x.lineWidth = 14;
  x.beginPath();
  x.arc(64, 64, 52, 0, Math.PI * 2);
  x.stroke();
  x.beginPath();
  x.moveTo(28, 28);
  x.lineTo(100, 100);
  x.stroke();
  // a tiny skateboard under the slash
  x.fillStyle = '#141413';
  x.fillRect(36, 60, 56, 9);
  x.beginPath();
  x.arc(46, 76, 6, 0, Math.PI * 2);
  x.arc(82, 76, 6, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
  plate.position.y = 1.45;
  g.add(plate);
  return g;
}

function coneMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xe0612f }));
  base.position.y = 0.02;
  g.add(base);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 16), new THREE.MeshStandardMaterial({ color: 0xff7a35, roughness: 0.6 }));
  cone.position.y = 0.33;
  g.add(cone);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.115, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xf8f8f2 }));
  band.position.y = 0.38;
  g.add(band);
  return g;
}

function ballMesh() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d')!;
  const cols = ['#d97757', '#faf9f5', '#6a9bcc', '#faf9f5', '#e8c547', '#faf9f5'];
  cols.forEach((col, i) => {
    x.fillStyle = col;
    x.fillRect((i * 256) / cols.length, 0, 256 / cols.length + 1, 128);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  m.position.y = 0.32;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

function tapeMesh() {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const x = c.getContext('2d')!;
  x.fillStyle = '#141413';
  x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#faf9f5';
  x.fillRect(20, 18, 216, 64);
  x.fillStyle = '#d97757';
  x.font = 'bold 30px Georgia, serif';
  x.textAlign = 'center';
  x.fillText('SECRET', 128, 52);
  x.font = 'bold 16px sans-serif';
  x.fillStyle = '#141413';
  x.fillText('SPARK TEAM — DO NOT ERASE', 128, 74);
  x.fillStyle = '#2b2a27';
  x.beginPath();
  x.arc(84, 118, 22, 0, Math.PI * 2);
  x.arc(172, 118, 22, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#9a968e';
  x.beginPath();
  x.arc(84, 118, 8, 0, Math.PI * 2);
  x.arc(172, 118, 8, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.5 });
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: 0x332211, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.31, 0.08), [mat, mat, mat, mat, face, face]);
  g.add(body);
  // glow halo so it reads from a distance
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(' '), color: 0xffe0b0, transparent: true, opacity: 0.55, depthWrite: false }));
  halo.scale.set(1.3, 1.3, 1.3);
  g.add(halo);
  return g;
}

export class Props {
  group = new THREE.Group();
  private knocks: Knock[] = [];
  private pickups: Pickup[] = [];
  objectsHit = 0;
  lettersGot = new Set<number>();
  tapeGot = false;

  constructor(
    private terrain: Terrain,
    defs: PropDef[],
    letters: THREE.Vector3[],
    tape: THREE.Vector3 | null,
  ) {
    for (const d of defs) {
      const obj = d.kind === 'sign' ? signMesh() : d.kind === 'cone' ? coneMesh() : ballMesh();
      const base = d.pos.clone();
      base.y = terrain.height(base.x, base.z);
      obj.position.copy(base);
      obj.rotation.y = Math.random() * Math.PI * 2;
      obj.traverse((o) => (o.castShadow = true));
      this.group.add(obj);
      this.knocks.push({ kind: d.kind, obj, base, hit: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0 });
    }
    letters.forEach((pos, idx) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(LETTERS[idx]), depthWrite: false }));
      s.scale.set(0.9, 0.9, 0.9);
      s.position.copy(pos);
      this.group.add(s);
      this.pickups.push({ idx, obj: s, base: pos.clone() });
    });
    if (tape) {
      const m = tapeMesh();
      m.position.copy(tape);
      this.group.add(m);
      this.pickups.push({ idx: -1, obj: m, base: tape.clone() });
    }
  }

  /** Put everything back for a fresh run. */
  reset() {
    this.objectsHit = 0;
    this.lettersGot.clear();
    this.tapeGot = false;
    for (const k of this.knocks) {
      k.hit = false;
      k.obj.visible = true;
      k.obj.position.copy(k.base);
      k.obj.rotation.set(0, Math.random() * Math.PI * 2, 0);
      k.obj.scale.setScalar(1);
    }
    for (const p of this.pickups) p.obj.visible = true;
  }

  setPickupsVisible(v: boolean) {
    for (const p of this.pickups) p.obj.visible = v && !(p.idx >= 0 ? this.lettersGot.has(p.idx) : this.tapeGot);
  }

  get letterDots() {
    return this.pickups.filter((p) => p.idx >= 0 && p.obj.visible).map((p) => ({ x: p.base.x, z: p.base.z }));
  }

  /**
   * Animate and test contact with the board. Returns what was touched this frame.
   */
  update(dt: number, t: number, board: THREE.Vector3, vel: THREE.Vector3, active: boolean, collect: boolean) {
    const hits: { kind: 'object' | 'letter' | 'tape'; idx: number; noun: PropKind | null }[] = [];
    for (const p of this.pickups) {
      if (!p.obj.visible) continue;
      p.obj.position.y = p.base.y + Math.sin(t * 2.2 + p.idx) * 0.12;
      if (p.idx < 0) p.obj.rotation.y += dt * 1.6;
      else (p.obj as THREE.Sprite).material.rotation = Math.sin(t * 1.4 + p.idx) * 0.15;
      if (!active || !collect) continue;
      const dx = board.x - p.base.x;
      const dz = board.z - p.base.z;
      if (dx * dx + dz * dz < 0.81 && Math.abs(board.y + 0.2 - p.base.y) < 0.6) {
        p.obj.visible = false;
        if (p.idx < 0) {
          this.tapeGot = true;
          hits.push({ kind: 'tape', idx: -1, noun: null });
        } else {
          this.lettersGot.add(p.idx);
          hits.push({ kind: 'letter', idx: p.idx, noun: null });
        }
      }
    }
    for (const k of this.knocks) {
      if (k.hit) {
        // tumble away and fade
        k.t += dt;
        k.vel.y -= 9.8 * dt;
        k.obj.position.addScaledVector(k.vel, dt);
        const floor = this.terrain.height(k.obj.position.x, k.obj.position.z);
        if (k.obj.position.y < floor) {
          k.obj.position.y = floor;
          k.vel.y = Math.abs(k.vel.y) * (k.kind === 'ball' ? 0.7 : 0.3);
          k.vel.x *= 0.8;
          k.vel.z *= 0.8;
        }
        k.obj.rotation.x += k.spin.x * dt;
        k.obj.rotation.z += k.spin.z * dt;
        if (k.t > 1.6) k.obj.scale.setScalar(Math.max(0.001, 1 - (k.t - 1.6) * 2));
        if (k.t > 2.2) k.obj.visible = false;
        continue;
      }
      if (!active) continue;
      const dx = board.x - k.base.x;
      const dz = board.z - k.base.z;
      const top = k.kind === 'sign' ? 1.7 : 0.7;
      if (dx * dx + dz * dz < 0.7 * 0.7 && board.y > k.base.y - 0.3 && board.y < k.base.y + top) {
        k.hit = true;
        k.t = 0;
        k.vel.set(vel.x * 0.9 + (Math.random() - 0.5) * 2, 3 + Math.random() * 2 + (k.kind === 'ball' ? 3 : 0), vel.z * 0.9 + (Math.random() - 0.5) * 2);
        k.spin.set((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14);
        if (collect) this.objectsHit++;
        hits.push({ kind: 'object', idx: this.objectsHit, noun: k.kind });
      }
    }
    return hits;
  }
}
