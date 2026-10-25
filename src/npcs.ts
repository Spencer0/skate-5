import * as THREE from 'three';
import { BoardModel } from './board';
import { HumanRider } from './humanrider';
import type { RiderId, RiderState } from './rider';
import type { Skater } from './skater';
import type { Terrain } from './terrain';
import type { LevelData } from './levels/common';
import { GRABS } from './tricks';
import { NpcBrain, Feature, Obstacle, WorldView, buildFeatures, seeded, STYLE_IDS } from './npcai';
import { CustomLook, Body, HAIR, HATS, TOPS, BOTTOMS, SHOES, SHAPES, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, forBody, Option } from './custom';
import { DECKS } from './career';
import { shadowTexture } from './textures';
import type { NpcSetting } from './settings';

/**
 * The park locals: 2-3 NPC skaters per park, each an NpcBrain (src/npcai.ts)
 * riding its own Skater, drawn with the game's own rider and board models.
 *
 * Cheap by construction: they spawn a second or so into a run, one at a time;
 * share the create-a-skater GLBs (one download per body, dressed per NPC); skip real shadows for a blob; are culled against the camera frustum
 * and a distance cap; pose their skeletons at a lower rate the further away
 * they are; and drop the board's truck hardware at distance. With the setting
 * off nothing is created and update() returns at once.
 */

export interface PlayerLook {
  rider: RiderId;
  look: CustomLook | null;
  deck: string;
}

export interface CrewContext {
  /** NPCs belong here at all (a run in progress, no cutscene / tutorial / capture) */
  active: boolean;
  /** the world is running (not paused) */
  running: boolean;
  count: number;
  player: Skater;
  camera: THREE.PerspectiveCamera;
  /** who the player is, so nobody wears the same thing (only read when someone spawns) */
  look(): PlayerLook;
  /** play a skate sound at `level` (0..1) */
  sound?(kind: 'pop' | 'land' | 'bail', level: number, impact: number): void;
}

/** How many locals a park gets for a setting. */
export function crewSize(setting: NpcSetting, levelId: string) {
  if (setting === 'off') return 0;
  if (setting === 'few') return 1;
  return levelId === 'pier' || levelId === 'arena' ? 2 : 3;
}

const FIXED = 1 / 240;
const VIS_DIST = 70;
const DETAIL_DIST = 10;
/** one seed per page load: the same locals all session, a new crew next time */
const SESSION = (Math.random() * 2 ** 31) | 0;

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();

class Npc {
  board = new BoardModel();
  rider: HumanRider;
  blob: THREE.Mesh;
  /** truck and wheel hardware, hidden at distance */
  detail: THREE.Object3D[] = [];
  act = { popAt: -1, catchAt: -1, landAt: -10, pushStart: -10, nollie: false };
  pump = { amt: 0, phase: 0 };
  fall = { on: false, t: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), side: 1 };
  lastDist = 0;
  poseAcc = 0;
  shown = false;
  dist = 0;
  st: RiderState;
  grab = { hand: 'front' as 'front' | 'back', x: 0, z: 0, pitch: 0, roll: 0, yaw: 0, amt: 0 };

  constructor(
    public brain: NpcBrain,
    look: { id: RiderId; custom: CustomLook | null; deck: string },
    geo: THREE.BufferGeometry,
    tex: THREE.Texture,
  ) {
    this.rider = new HumanRider(look.id, look.custom);
    this.rider.shadows = false;
    this.rider.setStyle('solid');
    this.board.setDeck(look.deck);
    this.board.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const g = m.geometry as THREE.BufferGeometry & { parameters?: { radiusTop?: number } };
      const tire = g.type === 'CylinderGeometry' && (g.parameters?.radiusTop ?? 0) > 0.02;
      if ((g.type === 'BoxGeometry' || g.type === 'CylinderGeometry') && !tire) this.detail.push(m);
    });
    this.blob = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.st = {
      crouch: 0,
      tuck: 0,
      lean: 0,
      push: -1,
      grind: null,
      air: false,
      time: 0,
      act: {
        popT: -1,
        flip: 0,
        shove: 0,
        wrap: 0,
        nollie: false,
        caught: true,
        catchT: -1,
        landT: 10,
        pushAt: -10,
        pushHold: false,
        ground: true,
        clock: 0,
        speed: 0,
        fakie: false,
        special: false,
        grab: undefined,
      },
    };
  }

  add(scene: THREE.Object3D) {
    scene.add(this.board.root, this.rider.group, this.blob);
  }

  dispose() {
    this.board.root.removeFromParent();
    this.rider.group.removeFromParent();
    this.blob.removeFromParent();
    this.rider.dispose();
    // the board builds its own geometry, materials and canvas textures
    const mats = new Set<THREE.Material>();
    this.board.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      mats.add(m.material as THREE.Material);
    });
    for (const m of mats) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    (this.blob.material as THREE.Material).dispose();
    this.brain.dispose();
  }
}

export class NpcCrew {
  private npcs: Npc[] = [];
  private features: Feature[] | null = null;
  private terrain: Terrain | null = null;
  private data: LevelData | null = null;
  private wait = 0;
  private acc = 0;
  private frame = 0;
  private others: Obstacle[] = [];
  private playerObs: Obstacle = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
  private camera: THREE.PerspectiveCamera | null = null;
  private world: WorldView;
  private blobGeo: THREE.BufferGeometry | null = null;
  private blobTex: THREE.Texture | null = null;
  private seq = 0;

  constructor(private scene: THREE.Scene) {
    this.world = {
      others: this.others,
      player: null,
      visible: (x, y, z) => this.canSee(x, y, z),
    };
  }

  get size() {
    return this.npcs.length;
  }

  /** The bots, for tests and the debug hook. */
  get brains() {
    return this.npcs.map((n) => n.brain);
  }

  /** A new park: drop everyone (they come back once the run is going). */
  setLevel(terrain: Terrain, data: LevelData) {
    this.clear();
    this.terrain = terrain;
    this.data = data;
    this.features = null;
  }

  /** Remove and dispose every NPC. */
  clear() {
    if (!this.npcs.length) return;
    for (const n of this.npcs) n.dispose();
    this.npcs.length = 0;
    this.others.length = 0;
    this.wait = 0;
  }

  private canSee(x: number, y: number, z: number) {
    const cam = this.camera;
    if (!cam) return false;
    _c.set(x, y, z);
    if (_c.distanceTo(cam.position) > VIS_DIST + 20) return false;
    return _frustum.containsPoint(_c);
  }

  update(dt: number, ctx: CrewContext) {
    if (!ctx.active || ctx.count <= 0 || !this.terrain || !this.data) {
      if (this.npcs.length) this.clear();
      this.wait = 0;
      return;
    }
    const cam = ctx.camera;
    this.camera = cam;
    cam.updateMatrixWorld();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    const player = ctx.player;
    this.playerObs.pos.copy(player.mode === 'bail' ? player.bpos : player.pos);
    this.playerObs.vel.copy(player.vel);
    this.world.player = this.playerObs.pos;

    while (this.npcs.length > ctx.count) {
      this.npcs.pop()!.dispose();
      this.rebuildOthers();
    }
    if (ctx.running) {
      // join the session one at a time, after the run is under way
      this.wait += dt;
      if (this.npcs.length < ctx.count && this.wait > 1.2 + this.npcs.length * 0.7) this.spawn(ctx);
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= FIXED) {
        this.acc -= FIXED;
        for (const n of this.npcs) n.brain.step(FIXED, this.world);
      }
    }
    this.frame++;
    for (const n of this.npcs) this.present(n, dt, ctx);
  }

  private rebuildOthers() {
    this.others.length = 0;
    this.others.push(this.playerObs);
    for (const n of this.npcs) this.others.push({ pos: n.brain.sk.pos, vel: n.brain.sk.vel });
  }

  private spawn(ctx: CrewContext) {
    const t = this.terrain!;
    const data = this.data!;
    if (!this.features) this.features = buildFeatures(t, data);
    const i = this.npcs.length;
    const r = seeded(SESSION + i * 7919);
    // a mixed crew: a street skater, a vert skater, a tech skater (which one comes first changes per session)
    const style = STYLE_IDS[(i + SESSION) % STYLE_IDS.length];
    const brain = new NpcBrain(t, this.features, this.seq++, seeded(SESSION ^ (this.seq * 104729 + 17)), data.spawn, style);
    const npc = new Npc(brain, pickLook(r, ctx.look()), this.blobGeometry(), this.blobTexture());
    // start somewhere off camera, away from the player
    brain.place(data.spawn.x, data.spawn.z, data.spawn.heading);
    this.npcs.push(npc);
    this.rebuildOthers();
    brain.respawnNow(this.world);
    npc.lastDist = brain.sk.distance;
    npc.add(this.scene);
  }

  private blobGeometry() {
    return (this.blobGeo ??= new THREE.PlaneGeometry(1, 1));
  }

  private blobTexture() {
    return (this.blobTex ??= shadowTexture());
  }

  /** Events, culling, board + rider + shadow. */
  private present(n: Npc, dt: number, ctx: CrewContext) {
    const sk = n.brain.sk;
    const now = sk.time;
    const bail = sk.mode === 'bail';
    const focus = bail ? sk.bpos : sk.pos;
    n.dist = focus.distanceTo(ctx.camera.position);
    for (const ev of sk.events) {
      switch (ev.type) {
        case 'pop':
          n.act.popAt = now;
          n.act.catchAt = -1;
          n.act.nollie = ev.nollie;
          this.sfx(ctx, n, 'pop', 0);
          break;
        case 'catch':
          n.act.catchAt = now;
          break;
        case 'land':
          n.act.landAt = now;
          n.act.popAt = -1;
          this.sfx(ctx, n, 'land', ev.impact);
          break;
        case 'touchdown':
          n.act.landAt = now;
          n.act.popAt = -1;
          break;
        case 'push':
          n.act.pushStart = now;
          break;
        case 'bail':
          n.fall.on = true;
          n.fall.t = 0;
          n.fall.pos.copy(n.rider.group.position);
          n.fall.q.copy(n.rider.group.quaternion);
          n.fall.vel.copy(sk.vel).multiplyScalar(0.6);
          n.fall.side = Math.random() < 0.5 ? 1 : -1;
          if (n.dist < VIS_DIST) n.rider.startRagdoll(sk.vel, n.fall.side, this.terrain!);
          this.sfx(ctx, n, 'bail', ev.impact);
          break;
        case 'respawn':
          n.fall.on = false;
          n.rider.stopRagdoll();
          break;
      }
    }
    sk.events.length = 0;

    _sphere.center.set(focus.x, focus.y + 0.8, focus.z);
    _sphere.radius = 1.4;
    // nobody shows up as the capsule stand-in: an NPC appears once its model is in
    const vis = n.rider.ready && n.dist < VIS_DIST && _frustum.intersectsSphere(_sphere);
    n.board.root.visible = vis;
    n.rider.group.visible = vis;
    n.blob.visible = vis;
    const dist = sk.distance - n.lastDist;
    n.lastDist = sk.distance;
    if (!vis) {
      n.shown = false;
      n.poseAcc += dt;
      if (n.rider.ragdolling && !bail) n.rider.stopRagdoll();
      return;
    }

    // board
    sk.visualQuat(_q);
    sk.visualPos(_p);
    n.board.root.position.copy(_p);
    n.board.root.quaternion.copy(_q);
    const fsgn = sk.fwdSpeed < 0 ? -1 : 1;
    n.board.animate(dist * fsgn, sk.mode === 'ground' ? sk.steerS : 0);
    const detail = n.dist < DETAIL_DIST;
    if (n.detail.length && n.detail[0].visible !== detail) for (const o of n.detail) o.visible = detail;

    // contact shadow
    const t = this.terrain!;
    const gh = t.height(focus.x, focus.z);
    const hgt = Math.max(0, focus.y - gh);
    n.blob.position.set(focus.x, gh + 0.01, focus.z);
    t.normal(focus.x, focus.z, _n);
    n.blob.quaternion.setFromUnitVectors(AX_Z, _n);
    const sc = 0.95 + hgt * 0.25;
    n.blob.scale.set(sc, sc * 0.55 + 0.25, 1);
    n.blob.rotateZ(-Math.atan2(sk.fwd.z, sk.fwd.x));
    (n.blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - hgt * 0.35) * 0.85;

    // rider: full rate up close, every 2nd / 3rd frame further out
    n.poseAcc += dt;
    const every = n.dist < 15 ? 1 : n.dist < 32 ? 2 : 3;
    if (n.shown && (this.frame + n.brain.id) % every !== 0) return;
    n.shown = true;
    const pdt = Math.min(0.1, n.poseAcc);
    n.poseAcc = 0;
    this.pose(n, pdt, _p);
  }

  private sfx(ctx: CrewContext, n: Npc, kind: 'pop' | 'land' | 'bail', impact: number) {
    if (!ctx.sound || n.dist > 32) return;
    ctx.sound(kind, Math.min(1, 4 / Math.max(1, n.dist)) * 0.55, impact);
  }

  /** The same choreography as the player's rider (main.ts updateRider), without the touch input. */
  private pose(n: Npc, dt: number, boardPos: THREE.Vector3) {
    const sk = n.brain.sk;
    const rider = n.rider;
    const st = n.st;
    const a = st.act!;
    const now = sk.time;
    st.time = now;
    if (rider.ragdolling && sk.mode !== 'bail') rider.stopRagdoll();
    if (rider.ragdolling) {
      st.crouch = 0;
      st.tuck = 0;
      st.lean = 0;
      st.push = -1;
      st.grind = null;
      st.air = false;
      rider.update(dt, st);
      return;
    }
    if (n.fall.on && sk.mode === 'bail') {
      // model not in yet: tip the stand-in over
      const f = n.fall;
      f.t += dt;
      f.vel.multiplyScalar(Math.exp(-dt * 2.5));
      f.pos.addScaledVector(f.vel, dt);
      f.pos.y = this.terrain!.height(f.pos.x, f.pos.z);
      rider.group.position.copy(f.pos);
      _q2.setFromAxisAngle(AX_X, f.side * Math.min(1.45, f.t * 5));
      rider.group.quaternion.copy(f.q).multiply(_q2);
      st.crouch = 0.7;
      st.tuck = 0;
      st.push = -1;
      st.grind = null;
      st.air = false;
      rider.update(dt, st);
      return;
    }
    sk.baseQuat(_q);
    _q2.setFromAxisAngle(AX_Y, sk.slideYaw * 0.6 + sk.yawOffset);
    _q.multiply(_q2);
    rider.group.position.copy(boardPos);
    rider.group.quaternion.copy(_q);
    const tr = sk.trick;
    const air = sk.mode === 'air';
    const grinding = sk.mode === 'grind' && !!sk.grind;
    let tuck = 0;
    if (tr.active && !tr.caught) tuck = 1;
    else if (tr.active) tuck = Math.min(1, sk.residual() * 2.5);
    if (air) tuck = Math.max(tuck, sk.popped ? 0.3 : 0.1);
    let crouch = 0.04 + Math.min(1, sk.speed / 8) * 0.1;
    crouch += Math.max(0, -sk.squash * 8);
    if (grinding) crouch += 0.3;
    if (sk.braking) crouch += 0.25;
    const p = n.pump;
    p.amt += ((sk.pumping ? 1 : 0) - p.amt) * Math.min(1, dt * 6);
    if (p.amt > 0.02) p.phase += dt * Math.PI * 2 * 2.2;
    else p.phase = 0;
    crouch += p.amt * 0.4 * (0.5 - 0.5 * Math.cos(p.phase));
    st.crouch = Math.min(1, crouch);
    st.tuck = tuck;
    st.lean = sk.mode === 'ground' ? sk.steerS * Math.min(1, sk.speed / 4) * 0.28 : 0;
    st.push = sk.mode === 'ground' && now - n.act.pushStart < 0.66 ? (now - n.act.pushStart) / 0.66 : -1;
    st.grind = grinding ? sk.grind!.balance : null;
    st.air = air;
    a.popT = air && n.act.popAt >= 0 ? now - n.act.popAt : -1;
    a.flip = Math.sign(tr.flipRate);
    a.shove = Math.sign(tr.shoveRate);
    a.wrap = Math.sign(tr.wrapRate);
    a.nollie = n.act.nollie;
    a.caught = !tr.active || tr.caught;
    a.catchT = n.act.catchAt >= 0 && air ? now - n.act.catchAt : -1;
    a.landT = now - n.act.landAt;
    a.pushAt = n.act.pushStart;
    a.pushHold = n.brain.inp.pushHold;
    a.ground = sk.mode === 'ground';
    a.clock = now;
    a.speed = sk.speed;
    a.fakie = sk.mode === 'ground' && sk.fwdSpeed < -0.4;
    a.special = !!tr.spec?.special && tr.active;
    if (sk.grabAmt > 0.01) {
      const g = GRABS[sk.grabIdx];
      const o = n.grab;
      o.hand = g.hand;
      o.x = g.x;
      o.z = g.z;
      o.pitch = g.pitch;
      o.roll = g.roll;
      o.yaw = g.yaw;
      o.amt = sk.grabAmt;
      a.grab = o;
    } else a.grab = undefined;
    rider.update(dt, st);
  }
}

/* ------------------------------------------------------------------ */
/* Looks                                                               */
/* ------------------------------------------------------------------ */

const pick = <T>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length) % list.length];
/** a themed part (beach, party, cowboy) now and then: it pulls the small extras model */
const THEMED = 0.12;

/** A random create-a-skater outfit: any body, shape, colours and parts. */
export function randomLook(r: () => number, body: Body): CustomLook {
  const part = (list: Option[]) => {
    const all = forBody(list, body);
    const plain = all.filter((o) => !o.theme);
    const themed = all.filter((o) => o.theme);
    const o = themed.length && r() < THEMED ? pick(r, themed) : pick(r, plain);
    return o;
  };
  const colorOf = (o: Option | null) => o?.color ?? pick(r, CLOTH_COLORS);
  const hat = r() < 0.3 ? part(HATS) : null;
  const top = part(TOPS);
  const bottom = part(BOTTOMS);
  const shoes = part(SHOES);
  return {
    body,
    height: r(),
    shape: Object.fromEntries(SHAPES.map((d) => [d.id, 0.1 + r() * 0.8])),
    skin: pick(r, SKIN_TONES),
    hair: r() < 0.08 ? null : pick(r, forBody(HAIR, body)).id,
    hairColor: pick(r, HAIR_COLORS),
    hat: hat?.id ?? null,
    hatColor: colorOf(hat),
    top: top.id,
    topColor: colorOf(top),
    bottom: bottom.id,
    bottomColor: colorOf(bottom),
    shoes: shoes.id,
    shoesColor: colorOf(shoes),
  };
}

/** NPC i's look, stable for the session: a fresh random skater, never dressed like the player. */
export function pickLook(r: () => number, player: PlayerLook): { id: RiderId; custom: CustomLook | null; deck: string } {
  const decks = DECKS.filter((d) => d.id !== player.deck && d.id !== 'gold');
  const deck = pick(r, decks).id;
  const body: Body = r() < 0.5 ? 'm' : 'f';
  let look = randomLook(r, body);
  if (player.look && look.top === player.look.top && look.topColor === player.look.topColor) look = randomLook(r, body);
  return { id: 'custom', custom: look, deck };
}
