import * as THREE from 'three';
import './style.css';
import { Terrain } from './terrain';
import { buildLayout, buildMeshes, makeMaterials, SPAWN } from './park';
import { BoardModel, DECK } from './board';
import { Skater, SkaterEvent, TrickRecord, Quality } from './skater';
import { Input } from './input';
import { Audio } from './audio';
import { Hud } from './hud';
import { Particles } from './fx';
import { shadowTexture } from './textures';
import { Minimap } from './minimap';

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color('#EFE7DA');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 45, 150);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.05, 400);

const hemi = new THREE.HemisphereLight(0xfff6ea, 0x8a7d6c, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 14;
sun.shadow.camera.left = -SH;
sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH;
sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);
const SUN_OFFSET = new THREE.Vector3(-14, 30, 10);

const terrain = new Terrain();
const vis = buildLayout(terrain);
scene.add(buildMeshes(terrain, vis, makeMaterials()));

const board = new BoardModel();
scene.add(board.root);

// contact shadow: reads height at a glance from the top-down camera
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
);
scene.add(blob);

const sparks = new Particles(260, 0.05, true, 9, 1.5);
const dust = new Particles(160, 0.22, true, -0.4, 3);
scene.add(sparks.points, dust.points);

const skater = new Skater(terrain);
skater.spawn(SPAWN.x, SPAWN.z, SPAWN.heading);

const overlay = document.createElement('canvas');
overlay.className = 'touch-layer';
app.appendChild(overlay);
const input = new Input(overlay);
const audio = new Audio();
const hud = new Hud(app);
const minimap = new Minimap(hud.root, terrain);

/* ------------------------------------------------------------------ */
/* Start screen                                                        */
/* ------------------------------------------------------------------ */

const fade = document.createElement('div');
fade.className = 'fade';
app.appendChild(fade);

const start = document.getElementById('start')!;
let started = false;
function begin() {
  if (started) return;
  started = true;
  audio.start();
  start.classList.add('gone');
  setTimeout(() => start.remove(), 600);
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (matchMedia('(pointer: coarse)').matches) {
    try {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' } as FullscreenOptions);
      if (p && 'catch' in p) p.catch(() => {});
    } catch {
      /* not allowed: fine */
    }
  }
  tutorial.step = 0;
}
start.addEventListener('click', begin);
start.addEventListener('touchend', (e) => {
  e.preventDefault();
  begin();
});
input.onFirstInput = () => {
  audio.start();
};

hud.soundBtn.addEventListener('click', () => {
  audio.start();
  audio.setMuted(!audio.muted);
  hud.soundBtn.textContent = audio.muted ? 'Sound off' : 'Sound on';
});
hud.guideBtn.addEventListener('click', () => hud.guide.classList.add('on'));
hud.resetBtn.addEventListener('click', () => {
  skater.spawn(SPAWN.x, SPAWN.z, SPAWN.heading);
  combo.lose();
});
for (const b of [hud.soundBtn, hud.guideBtn, hud.resetBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());

/* ------------------------------------------------------------------ */
/* Tutorial hints                                                      */
/* ------------------------------------------------------------------ */

const tutorial = {
  step: -1,
  t: 0,
  pushes: 0,
  pops: 0,
  catches: 0,
  done: (() => {
    try {
      return localStorage.getItem('skate5.tut') === '1';
    } catch {
      return false;
    }
  })(),
};
function tutorialHint(): string | null {
  if (tutorial.done || tutorial.step < 0) return null;
  switch (tutorial.step) {
    case 0:
      return 'Left thumb: tap to push · drag to steer';
    case 1:
      return 'Right thumb: pull down, then flick up to ollie';
    case 2:
      return 'Flick up-left for a kickflip — then TAP to catch before you land';
    case 3:
      return 'Nice! Ollie onto a rail to grind. Tricks menu ↗ has every flick';
  }
  return null;
}
function tutorialAdvance(ev: 'push' | 'pop' | 'catch' | 'grind') {
  if (tutorial.done) return;
  if (tutorial.step === 0 && ev === 'push' && ++tutorial.pushes >= 2) tutorial.step = 1;
  else if (tutorial.step === 1 && ev === 'pop') tutorial.step = 2;
  else if (tutorial.step === 2 && ev === 'catch') {
    tutorial.step = 3;
    tutorial.t = 0;
  } else if (tutorial.step === 3 && ev === 'grind') finishTutorial();
}
function finishTutorial() {
  tutorial.done = true;
  try {
    localStorage.setItem('skate5.tut', '1');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Combo + score                                                       */
/* ------------------------------------------------------------------ */

const QUALITY_MULT: Record<Quality, number> = { perfect: 1.5, clean: 1, sketchy: 0.6 };

class Combo {
  names: string[] = [];
  points = 0;
  count = 0;
  total = 0;
  best = 0;
  groundT = 0;
  active = false;

  constructor() {
    try {
      this.best = Number(localStorage.getItem('skate5.best') || 0);
    } catch {
      /* ignore */
    }
  }

  add(r: TrickRecord) {
    this.active = true;
    this.groundT = 0;
    const q = r.quality ? QUALITY_MULT[r.quality] : 1;
    this.points += Math.round(r.points * q);
    this.count += 1;
    this.names.push(r.name);
  }

  get mult() {
    return Math.max(1, this.count);
  }

  bank() {
    if (!this.active) return;
    const v = this.points * this.mult;
    this.total += v;
    if (this.count > 1 || v > 0) {
      hud.comboResult(`+${v.toLocaleString()}`, true);
      if (this.count > 2) audio.combo(this.count);
    }
    if (v > this.best) {
      this.best = v;
      try {
        localStorage.setItem('skate5.best', String(v));
      } catch {
        /* ignore */
      }
    }
    this.reset();
  }

  lose() {
    if (this.active && this.points > 0) hud.comboResult('combo lost', false);
    this.reset();
  }

  reset() {
    this.names = [];
    this.points = 0;
    this.count = 0;
    this.active = false;
    this.groundT = 0;
  }
}
const combo = new Combo();
let liveGrind: string | null = null;

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const shake = { t: 0, amp: 0 };
let hitStop = 0;
let slowMo = 0;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const DUST = new THREE.Color(0.32, 0.29, 0.26);
const SPARK = new THREE.Color(1.0, 0.62, 0.3);

function buzz(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* ignore */
  }
}

function dustBurst(n: number, strength: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    tmpV.set(Math.cos(a) * strength, 0.2, Math.sin(a) * strength);
    dust.emit(skater.pos, tmpV, 0.6, DUST, 0.5);
  }
}

function handle(ev: SkaterEvent) {
  switch (ev.type) {
    case 'push':
      audio.push();
      tutorialAdvance('push');
      break;
    case 'pop':
      audio.pop();
      buzz(8);
      tutorialAdvance('pop');
      dustBurst(5, 0.8);
      combo.groundT = 0;
      break;
    case 'catch':
      audio.catchClick(ev.quality === 'perfect');
      buzz(ev.quality === 'perfect' ? [6, 30, 6] : 6);
      hud.popup(ev.name, ev.quality === 'perfect' ? 'perfect catch' : ev.quality === 'sketchy' ? 'late catch' : undefined, ev.quality);
      if (ev.quality === 'perfect') hitStop = 0.045;
      tutorialAdvance('catch');
      break;
    case 'land': {
      audio.land(ev.impact, ev.quality);
      buzz(ev.quality === 'sketchy' ? [20, 30, 20] : 14);
      shake.t = 0.18;
      shake.amp = Math.min(0.06, 0.012 + ev.impact * 0.004);
      dustBurst(8 + Math.round(ev.impact * 2), 1.2);
      for (const r of ev.tricks) combo.add(r);
      if (ev.tricks.length) {
        const label = ev.quality === 'perfect' ? 'Perfect landing' : ev.quality === 'sketchy' ? 'Sketchy' : 'Clean';
        const last = ev.tricks[ev.tricks.length - 1];
        hud.popup(last.name, label, ev.quality);
      }
      break;
    }
    case 'touchdown':
      audio.touchdown(ev.impact);
      break;
    case 'bail': {
      audio.bail();
      buzz([40, 50, 40]);
      shake.t = 0.35;
      shake.amp = 0.08;
      slowMo = 0.5;
      const why: Record<string, string> = {
        uncaught: 'tap to catch the board!',
        sloppy: 'caught it too late',
        sideways: 'land straight',
        impact: 'too big',
        wall: 'ouch',
        balance: 'lost your balance',
      };
      hud.popup('Bail', why[ev.reason] ?? '', 'bail');
      combo.lose();
      liveGrind = null;
      break;
    }
    case 'grindStart':
      audio.grindStart(ev.slide);
      buzz(10);
      for (const r of ev.tricks) combo.add(r);
      liveGrind = ev.name;
      tutorialAdvance('grind');
      break;
    case 'grindChange':
      liveGrind = ev.name;
      break;
    case 'grindEnd':
      combo.add(ev.record);
      liveGrind = null;
      break;
    case 'wall':
      audio.wall(ev.impact);
      shake.t = 0.12;
      shake.amp = 0.02;
      break;
    case 'spinTick':
      audio.spinTick();
      break;
    case 'fallOff':
      hud.popup('Slipped off', undefined, 'sketchy');
      break;
    case 'respawn':
      fade.classList.remove('on');
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

const cam = {
  yaw: SPAWN.heading,
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
  y: 0,
  dist: 3.6,
  init: false,
};

function updateCamera(dt: number) {
  const s = skater;
  const focus = s.mode === 'bail' ? tmpV.copy(s.bpos) : tmpV.copy(s.pos);
  // follow direction of travel; fall back to board heading when slow
  const vh = Math.hypot(s.vel.x, s.vel.z);
  let targetYaw = cam.yaw;
  if (s.mode === 'grind' && s.grind) {
    const d = s.grind.rail.dir;
    targetYaw = Math.atan2(d.z * Math.sign(s.grind.spd || 1), d.x * Math.sign(s.grind.spd || 1));
  } else if (vh > 1.2 && s.mode !== 'bail') {
    targetYaw = Math.atan2(s.vel.z, s.vel.x);
  } else if (s.mode === 'ground' && vh < 0.6) {
    const fh = Math.hypot(s.fwd.x, s.fwd.z);
    if (fh > 0.3) targetYaw = Math.atan2(s.fwd.z, s.fwd.x);
  }
  // in the air off a vert wall, don't whip around
  const vertical = s.mode === 'air' && vh < 2.5 && Math.abs(s.vel.y) > 2;
  let d = targetYaw - cam.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const rate = vertical ? 0.4 : s.mode === 'grind' ? 3 : 2.4;
  cam.yaw += d * Math.min(1, dt * rate);

  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 1;
  const sp = Math.min(12, s.speed);
  const baseDist = portrait ? 2.3 : 1.8;
  const targetDist = baseDist + sp * 0.1;
  cam.dist += (targetDist - cam.dist) * Math.min(1, dt * 2);
  if (!cam.init) cam.dist = targetDist;
  const height = cam.dist * (portrait ? 1.3 : 1.12);

  // vertical follow lags so airs feel big, but stays tight on the ground
  const groundH = terrain.height(focus.x, focus.z);
  const fy = s.mode === 'air' ? groundH + (focus.y - groundH) * 0.65 : focus.y;
  if (!cam.init) {
    cam.y = fy;
    cam.yaw = targetYaw;
  }
  cam.y += (fy - cam.y) * Math.min(1, dt * (s.mode === 'air' ? 3 : 8));

  const fx = Math.cos(cam.yaw);
  const fz = Math.sin(cam.yaw);
  const ahead = Math.min(1.3, 0.4 + sp * 0.09);
  const lookT = tmpV2.set(focus.x + fx * ahead, cam.y + 0.15, focus.z + fz * ahead);
  const posT = new THREE.Vector3(focus.x - fx * cam.dist, cam.y + height, focus.z - fz * cam.dist);
  if (!cam.init) {
    cam.pos.copy(posT);
    cam.look.copy(lookT);
    cam.init = true;
  }
  // keep the camera above whatever terrain it's over (bowls, ramps)
  const camGround = terrain.height(posT.x, posT.z);
  if (posT.y < camGround + 1.2) posT.y = camGround + 1.2;
  cam.pos.lerp(posT, Math.min(1, dt * 10));
  cam.look.lerp(lookT, Math.min(1, dt * 12));
  camera.position.copy(cam.pos);
  if (shake.t > 0) {
    shake.t -= dt;
    const a = shake.amp * (shake.t / 0.3);
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
  }
  camera.lookAt(cam.look);
  const fovT = (portrait ? 62 : 52) + sp * 0.6;
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 2);
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

const FIXED = 1 / 240;
const debug = { paused: false, freeCam: false };
let acc = 0;
let last = performance.now();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
let lastDist = 0;
let sparkAcc = 0;
const joint = { x: Infinity, z: Infinity };

// adaptive resolution: drop pixel ratio if the device can't hold ~50fps
const perf = { t: 0, frames: 0, ratio: Math.min(window.devicePixelRatio || 1, 2) };
function adaptResolution(dt: number) {
  perf.t += dt;
  perf.frames++;
  if (perf.t < 2) return;
  const fps = perf.frames / perf.t;
  perf.t = 0;
  perf.frames = 0;
  if (fps < 48 && perf.ratio > 1) {
    perf.ratio = Math.max(1, perf.ratio - 0.25);
    renderer.setPixelRatio(perf.ratio);
  }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (started && !document.hidden) adaptResolution(dt);

  const push = input.poll();
  for (const a of input.actions) {
    if (!started) continue;
    if (a.type === 'catch') skater.catchBoard();
    else if (a.type === 'flick') {
      if (skater.flick(a.spec)) {
        const sp = a.spec;
        audio.flipWhoosh(Math.abs(sp.flip) + Math.abs(sp.shove) * 0.5 + Math.abs(sp.wrap));
      }
    } else if (a.type === 'respawn') {
      skater.spawn(SPAWN.x, SPAWN.z, SPAWN.heading);
      combo.lose();
    }
  }
  input.actions.length = 0;

  // juice: brief hit-stop on perfect catches, slow-mo on bails
  if (hitStop > 0) {
    hitStop -= dt;
    dt *= 0.15;
  }
  if (slowMo > 0) {
    slowMo -= dt;
    dt *= 0.45;
  }

  const sin = {
    steer: started ? input.steer : 0,
    push: started && push,
    pushHold: started && input.pushHold,
    brake: started && input.brake,
    grindMod: input.grindMod,
    crouch: input.crouch,
  };
  acc += debug.paused ? 0 : dt;
  let first = true;
  while (acc >= FIXED) {
    skater.step(FIXED, { ...sin, push: first && sin.push });
    first = false;
    acc -= FIXED;
  }
  for (const ev of skater.events) handle(ev);
  skater.events.length = 0;

  if (skater.mode === 'bail' && skater.bailT > 1.45) fade.classList.add('on');

  // combo banks after a beat on the ground
  if (skater.mode === 'ground' && combo.active) {
    combo.groundT += dt;
    if (combo.groundT > 0.75) combo.bank();
  }

  // board visuals
  skater.visualQuat(q);
  skater.visualPos(p);
  board.root.position.copy(p);
  board.root.quaternion.copy(q);
  // crouch: board sinks a touch while the tail is loaded
  const crouch = input.crouch && skater.mode === 'ground' ? -0.012 : 0;
  board.pivot.position.y = DECK.deckY + crouch;
  const dist = skater.distance - lastDist;
  lastDist = skater.distance;
  const fsgn = skater.fwdSpeed < 0 ? -1 : 1;
  board.animate(dist * fsgn, skater.mode === 'ground' ? skater.steerS : 0);

  // contact shadow
  const bx = skater.mode === 'bail' ? skater.bpos.x : skater.pos.x;
  const bz = skater.mode === 'bail' ? skater.bpos.z : skater.pos.z;
  const gh = terrain.height(bx, bz);
  const n = terrain.normal(bx, bz, tmpV);
  const by = skater.mode === 'bail' ? skater.bpos.y : skater.pos.y;
  const hgt = Math.max(0, by - gh);
  blob.position.set(bx, gh + 0.01, bz);
  blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const sc = 0.95 + hgt * 0.25;
  blob.scale.set(sc, sc * 0.55 + 0.25, 1);
  const yaw = Math.atan2(skater.fwd.z, skater.fwd.x);
  blob.rotateZ(-yaw);
  (blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - hgt * 0.35);

  // sparks while grinding
  if (skater.mode === 'grind' && skater.grind) {
    const g = skater.grind;
    sparkAcc += dt * Math.min(140, 30 + Math.abs(g.spd) * 14) * (g.family === 'slide' ? 0.3 : 1);
    while (sparkAcc > 1) {
      sparkAcc -= 1;
      tmpV.copy(skater.vel).multiplyScalar(-0.25);
      tmpV.y += 0.6;
      sparks.emit(skater.pos, tmpV, 2.2, SPARK, 0.35);
    }
  }
  // powerslide dust
  if (skater.mode === 'ground' && skater.braking && skater.speed > 2 && Math.random() < 0.6) {
    tmpV.copy(skater.vel).multiplyScalar(0.2);
    dust.emit(skater.pos, tmpV, 0.8, DUST, 0.4);
  }
  sparks.update(dt);
  dust.update(dt);

  // expansion joints click under the wheels on the plaza concrete
  if (skater.mode === 'ground' && Math.abs(skater.pos.y) < 0.001 && skater.groundN.y > 0.999) {
    const jx = Math.floor(skater.pos.x / 4);
    const jz = Math.floor(skater.pos.z / 4);
    if ((jx !== joint.x || jz !== joint.z) && joint.x !== Infinity) audio.joint(skater.speed);
    joint.x = jx;
    joint.z = jz;
  } else joint.x = joint.z = Infinity;

  // audio
  const grindKind = skater.mode === 'grind' && skater.grind ? (skater.grind.family === 'slide' ? 'slide' : 'grind') : 'none';
  audio.update(skater.mode === 'ground' ? skater.speed : 0, grindKind, skater.grind ? Math.abs(skater.grind.spd) : 0, skater.braking && skater.speed > 1.5);

  // HUD
  hud.setScore(combo.total, combo.best);
  hud.showCombo(combo.names, combo.points + (skater.grind ? skater.grind.points : 0), combo.mult + (liveGrind ? 1 : 0), liveGrind);
  hud.balance(skater.mode === 'grind' && skater.grind ? skater.grind.balance : null);
  hud.setSpeed(skater.speed * 3.6);
  hud.setHint(started ? tutorialHint() : null);
  minimap.draw(skater.mode === 'bail' ? skater.bpos.x : skater.pos.x, skater.mode === 'bail' ? skater.bpos.z : skater.pos.z, cam.yaw);

  if (!debug.freeCam) updateCamera(dt);
  sun.position.copy(skater.pos).add(SUN_OFFSET);
  sun.target.position.copy(skater.pos);
  input.draw();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

requestAnimationFrame(frame);

// debug/test hook
(window as unknown as { __skate: unknown }).__skate = { skater, terrain, input, combo, camera, begin, debug };
