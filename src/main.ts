import * as THREE from 'three';
import './style.css';
import { Terrain } from './terrain';
import { buildMeshes, makeMaterials } from './park';
import { LEVELS, LevelData, GapDef, inRect } from './levels';
import { Progress, GoalTracker } from './story';
import { Menu, PlayMode } from './menu';
import { letterTexture } from './textures';
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

const mats = makeMaterials();
let terrain = new Terrain();
let levelData: LevelData = LEVELS[0].build(terrain);
let levelGroup: THREE.Group | null = null;
let levelIndex = 0;
let playMode: PlayMode = 'free';

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

const spray = new Particles(240, 0.08, true, 9.8, 0.4);
const splash = new Particles(120, 0.14, true, 9.8, 1.2);
scene.add(spray.points, splash.points);

const skater = new Skater(terrain);

const overlay = document.createElement('canvas');
overlay.className = 'touch-layer';
app.appendChild(overlay);
const input = new Input(overlay);
const audio = new Audio();
const hud = new Hud(app);
let minimap: Minimap | null = null;
const progress = new Progress();
let tracker: GoalTracker | null = null;

/* ------------------------------------------------------------------ */
/* Start screen                                                        */
/* ------------------------------------------------------------------ */

const fade = document.createElement('div');
fade.className = 'fade';
app.appendChild(fade);

let started = false; // audio unlocked, first tap done
let playing = false; // menus closed, physics running
function begin() {
  if (started) return;
  started = true;
  audio.start();
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (matchMedia('(pointer: coarse)').matches) {
    try {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' } as FullscreenOptions);
      if (p && 'catch' in p) p.catch(() => {});
    } catch {
      /* not allowed: fine */
    }
  }
  if (tutorial.step < 0) tutorial.step = 0;
}
input.onFirstInput = () => {
  audio.start();
};

const menu = new Menu(app, progress, {
  onPlay(i, mode) {
    loadLevel(i, mode);
    resume();
  },
  onResume: resume,
  onRestart() {
    respawnAtStart();
    resume();
  },
  onQuit() {
    playing = false;
    menu.showTitle();
  },
  onToggleSound() {
    audio.start();
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
  onTricks() {
    hud.guide.classList.add('on');
  },
  onFirstTap: begin,
});

function resume() {
  menu.hide();
  playing = true;
  input.actions.length = 0;
}
function pause() {
  if (!playing) return;
  playing = false;
  menu.showPause(levelIndex, playMode, audio.muted);
}
hud.menuBtn.addEventListener('click', pause);
hud.goalsBtn.addEventListener('click', pause);

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

interface LetterPickup {
  idx: number;
  sprite: THREE.Sprite;
  base: THREE.Vector3;
}
let letters: LetterPickup[] = [];
let fountains: THREE.Vector3[] = [];
const LETTERS = 'CLAUDE';

function disposeGroup(g: THREE.Group) {
  const shared = new Set<THREE.Material>(Object.values(mats));
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (shared.has(x)) continue;
      // letter sprites own their textures
      const sm = x as THREE.SpriteMaterial;
      if (o instanceof THREE.Sprite) sm.map?.dispose();
      x.dispose();
    }
  });
}

function loadLevel(i: number, mode: PlayMode) {
  const L = LEVELS[i];
  levelIndex = i;
  playMode = mode;
  if (levelGroup) {
    scene.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  terrain = new Terrain();
  levelData = L.build(terrain);
  levelGroup = buildMeshes(terrain, levelData.vis, mats, { ground: L.ground });
  L.decorate(levelGroup, mats, terrain);
  scene.add(levelGroup);
  const sky = new THREE.Color(L.sky);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, L.fog[0], L.fog[1]);
  skater.terrain = terrain;
  respawnAtStart();
  minimap?.destroy();
  minimap = new Minimap(hud.root, terrain);
  fountains = terrain.elements.filter((e) => e.kind === 'fountain').map((e) => new THREE.Vector3(e.cx, 1.1, e.cz));

  letters = [];
  if (mode === 'story') {
    const have = progress.letters(L);
    levelData.letters.forEach((pos, idx) => {
      if (have.includes(idx)) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(LETTERS[idx]), depthWrite: false }));
      sprite.scale.set(0.9, 0.9, 0.9);
      sprite.position.copy(pos);
      levelGroup!.add(sprite);
      letters.push({ idx, sprite, base: pos.clone() });
    });
    tracker = new GoalTracker(L, progress, onGoal);
  } else tracker = null;
  updateGoalChip();
  combo.reset();
  liveGrind = null;
  cam.init = false;
}

function respawnAtStart() {
  const sp = levelData.spawn;
  skater.spawn(sp.x, sp.z, sp.heading);
  combo.lose();
  fade.classList.remove('on');
  cam.init = false;
}

function updateGoalChip() {
  const L = LEVELS[levelIndex];
  hud.setGoals(progress.doneCount(L), playMode === 'story' ? L.goals.length : null);
}

function onGoal(g: { text: string }) {
  const L = LEVELS[levelIndex];
  hud.toast('Goal complete', g.text);
  audio.goal();
  buzz([20, 40, 20, 40, 60]);
  updateGoalChip();
  const done = progress.doneCount(L);
  const last = levelIndex === LEVELS.length - 1;
  if (!last && done === L.unlockAt) {
    setTimeout(() => {
      playing = false;
      menu.showComplete(levelIndex, resume);
    }, 2200);
  } else if (last && done === L.goals.length) {
    setTimeout(() => {
      playing = false;
      menu.showFinale(resume);
    }, 2200);
  } else if (done === L.goals.length) {
    setTimeout(() => hud.toast(L.name, 'Every goal complete!'), 1600);
  }
}

function collectLetters(dt: number, t: number) {
  if (!letters.length) return;
  const L = LEVELS[levelIndex];
  const bx = skater.pos.x;
  const by = skater.pos.y + 0.2;
  const bz = skater.pos.z;
  for (const l of letters) {
    l.sprite.position.y = l.base.y + Math.sin(t * 2.2 + l.idx) * 0.12;
    l.sprite.material.rotation = Math.sin(t * 1.4 + l.idx) * 0.15;
    if (skater.mode === 'bail') continue;
    const dx = bx - l.base.x;
    const dz = bz - l.base.z;
    if (dx * dx + dz * dz < 0.9 * 0.9 && Math.abs(by - l.base.y) < 0.6) {
      progress.collect(L, l.idx);
      l.sprite.removeFromParent();
      l.sprite.material.map?.dispose();
      l.sprite.material.dispose();
      const n = progress.letters(L).length;
      hud.toast(`Letter ${LETTERS[l.idx]}`, `${n}/6 · ${LETTERS.split('').map((c, i) => (progress.letters(L).includes(i) ? c : '·')).join(' ')}`, 'letter');
      audio.letter();
      buzz(12);
      tracker?.letters(n);
    }
  }
  letters = letters.filter((l) => l.sprite.parent);
  void dt;
}

/** Gaps cleared by the air that just landed. */
function gapsCleared(): GapDef[] {
  const from = skater.takeoff;
  const to = skater.pos;
  const seen = new Set<string>();
  const out: GapDef[] = [];
  for (const g of levelData.gaps) {
    if (seen.has(g.id)) continue;
    if (inRect(g.from, from.x, from.z) && inRect(g.to, to.x, to.z)) {
      seen.add(g.id);
      out.push(g);
    }
  }
  return out;
}

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
    tracker?.comboBanked(v);
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
const WATER = new THREE.Color(0.75, 0.9, 1.0);

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
      const gaps = gapsCleared();
      for (const g of gaps) combo.add({ name: g.name, points: g.points, kind: 'trick' });
      if (ev.tricks.length || gaps.length) {
        const label = ev.quality === 'perfect' ? 'Perfect landing' : ev.quality === 'sketchy' ? 'Sketchy' : 'Clean';
        const last = ev.tricks.length ? ev.tricks[ev.tricks.length - 1].name : '';
        const main = gaps.length ? gaps.map((g) => g.name + '!').join(' ') : last;
        hud.popup(main, gaps.length && last ? `${last} · ${label}` : label, ev.quality);
        if (gaps.length) audio.gap();
      }
      tracker?.landed(ev.tricks, gaps, skater.maxAirY - skater.takeoff.y);
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
        water: 'into the water',
      };
      hud.popup(ev.reason === 'water' ? 'Splash!' : 'Bail', why[ev.reason] ?? '', 'bail');
      if (ev.reason === 'water') {
        audio.splash();
        for (let i = 0; i < 60; i++) {
          tmpV.set((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3);
          splash.emit(skater.pos, tmpV, 0.6, WATER, 1.0);
        }
      }
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
  yaw: -Math.PI / 2,
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
  if (!playing && menu.open) targetYaw = cam.yaw;
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
let sprayAcc = 0;

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
  if (playing && !document.hidden) adaptResolution(dt);

  const push = input.poll();
  input.enabled = playing;
  for (const a of input.actions) {
    if (!playing) continue;
    if (a.type === 'catch') skater.catchBoard();
    else if (a.type === 'flick') {
      if (skater.flick(a.spec)) {
        const sp = a.spec;
        audio.flipWhoosh(Math.abs(sp.flip) + Math.abs(sp.shove) * 0.5 + Math.abs(sp.wrap));
      }
    } else if (a.type === 'respawn') {
      respawnAtStart();
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
    steer: playing ? input.steer : 0,
    push: playing && push,
    pushHold: playing && input.pushHold,
    brake: playing && input.brake,
    grindMod: input.grindMod,
    crouch: input.crouch,
  };
  acc += debug.paused || !playing ? 0 : dt;
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
  // fountain spray
  for (const f of fountains) {
    sprayAcc += dt * 45;
    while (sprayAcc > 1) {
      sprayAcc -= 1;
      tmpV.set((Math.random() - 0.5) * 0.9, 3.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.9);
      spray.emit(f, tmpV, 0.2, WATER, 0.75);
    }
  }
  const wmap = mats.water.map;
  if (wmap) {
    wmap.offset.x += dt * 0.012;
    wmap.offset.y += dt * 0.007;
  }
  if (skater.grind) tracker?.grinding(skater.grind.rail.tag, skater.grind.dist, skater.grind.name);
  if (playing) collectLetters(dt, now / 1000);
  else for (const l of letters) l.sprite.position.y = l.base.y + Math.sin((now / 1000) * 2.2 + l.idx) * 0.12;

  sparks.update(dt);
  dust.update(dt);
  spray.update(dt);
  splash.update(dt);

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
  const uncaught = skater.mode === 'air' && skater.trick.active && !skater.trick.caught;
  hud.setHint(playing ? (uncaught && !tutorial.done ? 'TAP to catch it!' : tutorialHint()) : null);
  minimap?.draw(
    skater.mode === 'bail' ? skater.bpos.x : skater.pos.x,
    skater.mode === 'bail' ? skater.bpos.z : skater.pos.z,
    cam.yaw,
    letters.map((l) => ({ x: l.base.x, z: l.base.z })),
  );
  hud.root.classList.toggle('dim', !playing);

  // attract mode: slowly orbit the board behind the menus
  if (!playing && menu.open) cam.yaw += dt * 0.12;
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

loadLevel(0, 'free');
requestAnimationFrame(frame);

// debug/test hook
(window as unknown as { __skate: unknown }).__skate = {
  skater,
  get terrain() {
    return terrain;
  },
  input,
  combo,
  camera,
  begin,
  debug,
  loadLevel,
  resume,
  progress,
  menu,
};
