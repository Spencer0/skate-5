import * as THREE from 'three';
import './style.css';
import { Terrain } from './terrain';
import { buildMeshes, makeMaterials } from './park';
import { LEVELS, LevelData, GapDef, GoalDef, inRect, V3 } from './levels';
import { BoardModel, DECK } from './board';
import { Skater, SkaterEvent, TrickRecord, Quality } from './skater';
import { Input } from './input';
import { Audio } from './audio';
import { Hud } from './hud';
import { Particles } from './fx';
import { shadowTexture } from './textures';
import { Minimap } from './minimap';
import { Career, GoalTracker, applyStats, Medal } from './career';
import { UI, RunMode, GAP_NAMES, Standing, bestTwo } from './ui';
import { CutscenePlayer, previewScene } from './cutscene';
import { Props } from './props';
import { HumanRider } from './humanrider';
import { CAMERAS, loadOptions, saveOptions } from './settings';

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
scene.background = new THREE.Color('#EFE7DA');
scene.fog = new THREE.Fog(0xefe7da, 45, 150);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.05, 400);

scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7d6c, 1.35));
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
let levelIndex = -1;
let props: Props | null = null;

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
const spray = new Particles(240, 0.08, true, 9.8, 0.4);
const splash = new Particles(120, 0.14, true, 9.8, 1.2);
const glow = new Particles(160, 0.12, true, -0.5, 2);
scene.add(sparks.points, dust.points, spray.points, splash.points, glow.points);

const skater = new Skater(terrain);

const overlay = document.createElement('canvas');
overlay.className = 'touch-layer';
app.appendChild(overlay);
const input = new Input(overlay);
const audio = new Audio();
const hud = new Hud(app);
let minimap: Minimap | null = null;
const career = new Career();
applyStats(career.effectiveStats());
board.setDeck(career.data.deck);
const options = loadOptions();
let rider = new HumanRider(career.data.rider ?? 'brock', career.customLook());
rider.setStyle(options.rider);
scene.add(rider.group);
function swapRider() {
  scene.remove(rider.group);
  rider.dispose();
  rider = new HumanRider(career.data.rider ?? 'brock', career.customLook());
  rider.setStyle(options.rider);
  scene.add(rider.group);
}
// rider fall when bailing
const fall = { on: false, t: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), side: 1 };
let tracker: GoalTracker | null = null;
const cut = new CutscenePlayer(app, camera);

const fade = document.createElement('div');
fade.className = 'fade';
app.appendChild(fade);

// gap checklist names for every level
for (const L of LEVELS) {
  const d = L.build(new Terrain());
  GAP_NAMES[L.id] = d.gaps.map((g) => [g.id, g.name, g.points]);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

interface Session {
  mode: RunMode;
  level: number;
  time: number;
  timeUp: boolean;
  bestCombo: number;
  goals: GoalDef[];
  startTotal: number;
  unlockedBefore: boolean;
  heat: number;
  heats: number[];
  cpu: Standing[];
}

let session: Session | null = null;
let started = false; // audio unlocked, first tap done
let playing = false; // physics + input live
let special = 0;
const runCounts = new Map<string, number>();

const CPU = [
  { name: 'Dex Tran', avg: 9000 },
  { name: 'Rin Takeda', avg: 14000 },
  { name: 'Sol Arquette', avg: 19500 },
];

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
input.onFirstInput = () => audio.start();

const ui = new UI(app, career, {
  startRun,
  resume,
  restartRun() {
    if (!session) return;
    if (session.mode === 'free') {
      respawnAtStart();
      resume();
    } else startRun(session.level, session.mode);
  },
  endRun() {
    finishRun(false);
  },
  quit() {
    playing = false;
    const s = session;
    session = null;
    hud.setTimer(null);
    if (s && s.mode !== 'free') ui.showLevel(s.level);
    else ui.showTitle();
  },
  playIntro(i, then) {
    loadLevel(i);
    playScene(LEVELS[i].intro, () => {
      career.markSeen(LEVELS[i].intro.id);
      then();
    });
  },
  previewGoal(i, g, back) {
    loadLevel(i);
    const v = goalView(g);
    if (!v) return back();
    // show collectibles in the preview even though they're hidden between runs
    props?.setPickupsVisible(true);
    playScene(previewScene('preview', v.cam, v.look, g.text, g.hint ?? ''), () => {
      props?.setPickupsVisible(false);
      back();
    });
  },
  toggleSound() {
    audio.start();
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
  isMuted: () => audio.muted,
  showTricks() {
    hud.guide.classList.add('on');
  },
  firstTap: begin,
  deckChanged(id) {
    board.setDeck(id);
  },
  riderChanged() {
    swapRider();
    applyStats(career.effectiveStats());
  },
  getCamera: () => options.camera,
  setCamera(i) {
    options.camera = i;
    saveOptions(options);
    cam.init = false;
  },
  getRiderStyle: () => options.rider,
  setRiderStyle(st) {
    options.rider = st;
    saveOptions(options);
    rider.setStyle(st);
  },
  statsChanged() {
    applyStats(career.effectiveStats());
  },
});

function resume() {
  ui.hide();
  playing = true;
  input.actions.length = 0;
}
function pause() {
  if (!playing || !session) return;
  playing = false;
  ui.showPause(session.level, session.mode);
}
hud.menuBtn.addEventListener('click', pause);
hud.camBtn.addEventListener('click', () => {
  options.camera = (options.camera + 1) % CAMERAS.length;
  saveOptions(options);
  hud.toast('Camera', CAMERAS[options.camera].name, 'letter');
});
hud.goalsBtn.addEventListener('click', pause);
hud.starBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  fireSpecial();
});

function playScene(sc: Parameters<CutscenePlayer['play']>[0], then: () => void) {
  playing = false;
  ui.hide();
  hud.root.classList.add('cine');
  // cutscenes show the whole spot: push the fog back
  const fog = scene.fog as THREE.Fog;
  const near = fog.near;
  const far = fog.far;
  fog.near = near * 2;
  fog.far = far * 1.8;
  cut.play(sc, () => {
    fog.near = near;
    fog.far = far;
    hud.root.classList.remove('cine');
    cam.init = false;
    then();
  });
}
cut.onLine = () => audio.blip();

/** Camera for a goal's "show me" preview. */
function goalView(g: GoalDef): { cam: V3; look: V3 } | null {
  if (g.view) return g.view;
  const around = (x: number, y: number, z: number, d = 6): { cam: V3; look: V3 } => ({ cam: [x + d * 0.7, y + d * 0.55, z + d * 0.7], look: [x, y, z] });
  if (g.kind === 'gap') {
    const gp = levelData.gaps.find((x) => x.id === g.gap);
    if (!gp) return null;
    const fx = (gp.from.x0 + gp.from.x1) / 2;
    const fz = (gp.from.z0 + gp.from.z1) / 2;
    const tx = (gp.to.x0 + gp.to.x1) / 2;
    const tz = (gp.to.z0 + gp.to.z1) / 2;
    const mx = (fx + tx) / 2;
    const mz = (fz + tz) / 2;
    const h = terrain.height(mx, mz);
    // look across the gap from the side
    const dx = tx - fx;
    const dz = tz - fz;
    const l = Math.hypot(dx, dz) || 1;
    const sx = -dz / l;
    const sz = dx / l;
    const d = Math.max(7, l * 1.1);
    return { cam: [mx + sx * d, h + 4, mz + sz * d], look: [mx, h + 0.5, mz] };
  }
  if (g.kind === 'letters' && levelData.letters[0]) {
    const p = levelData.letters[0];
    return around(p.x, p.y, p.z);
  }
  if (g.kind === 'objects' && levelData.props[0]) {
    const p = levelData.props[0].pos;
    return around(p.x, terrain.height(p.x, p.z) + 0.6, p.z, 5);
  }
  if (g.kind === 'tape') {
    const p = levelData.tape;
    return around(p.x, p.y, p.z, 7);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

let fountains: THREE.Vector3[] = [];

function disposeGroup(g: THREE.Group) {
  const shared = new Set<THREE.Material>(Object.values(mats));
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (shared.has(x)) continue;
      if (o instanceof THREE.Sprite) (x as THREE.SpriteMaterial).map?.dispose();
      x.dispose();
    }
  });
}

function loadLevel(i: number) {
  if (i === levelIndex) return;
  const L = LEVELS[i];
  levelIndex = i;
  if (levelGroup) {
    scene.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  terrain = new Terrain();
  levelData = L.build(terrain);
  levelGroup = buildMeshes(terrain, levelData.vis, mats, { ground: L.ground });
  L.decorate(levelGroup, mats, terrain);
  const hasTape = L.goals.some((g) => g.kind === 'tape');
  props = new Props(terrain, levelData.props, levelData.letters, hasTape ? levelData.tape : null);
  props.setPickupsVisible(false);
  levelGroup.add(props.group);
  scene.add(levelGroup);
  const sky = new THREE.Color(L.sky);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, L.fog[0], L.fog[1]);
  skater.terrain = terrain;
  respawnAtStart();
  minimap?.destroy();
  minimap = new Minimap(hud.root, terrain);
  fountains = terrain.elements.filter((e) => e.kind === 'fountain').map((e) => new THREE.Vector3(e.cx, 1.1, e.cz));
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

function startRun(i: number, mode: RunMode) {
  loadLevel(i);
  const L = LEVELS[i];
  const prev = session;
  const heat = mode === 'comp' && prev?.mode === 'comp' && prev.level === i && prev.heats.length < 3 ? prev.heats.length + 1 : 1;
  session = {
    mode,
    level: i,
    time: mode === 'free' ? Infinity : L.runTime,
    timeUp: false,
    bestCombo: 0,
    goals: [],
    startTotal: career.totalDone(),
    unlockedBefore: i + 1 < LEVELS.length && career.isUnlocked(i + 1),
    heat,
    heats: heat > 1 && prev ? prev.heats : [],
    cpu: heat > 1 && prev ? prev.cpu : CPU.map((c) => ({ name: c.name, heats: [] })),
  };
  respawnAtStart();
  combo.total = 0;
  runCounts.clear();
  special = 0;
  props?.reset();
  props?.setPickupsVisible(mode === 'career');
  tracker = mode === 'free' ? null : new GoalTracker(L, career, onGoal);
  updateGoalChip();
  resume();
  if (mode === 'comp') hud.bigText(`HEAT ${heat}`);
  else if (mode === 'career') hud.bigText('GO!');
  audio.horn(false);
}

function finishRun(timeUp: boolean) {
  const s = session;
  if (!s) return;
  playing = false;
  hud.setTimer(null);
  combo.bank();
  const L = LEVELS[s.level];
  const score = combo.total;
  if (s.mode === 'comp') {
    s.heats.push(score);
    // CPU heat scores: steady, with some variance
    s.cpu.forEach((c, k) => {
      const seed = Math.sin((s.heats.length + 1) * 12.9898 + k * 78.233) * 43758.5453;
      const r = seed - Math.floor(seed);
      c.heats.push(Math.round((CPU[k].avg * (0.85 + r * 0.3)) / 10) * 10);
    });
    const standings: Standing[] = [{ name: 'You', heats: s.heats, you: true }, ...s.cpu];
    const final = s.heats.length >= 3;
    let medal: Medal | null = null;
    if (final) {
      const order = [...standings].sort((a, b) => bestTwo(b.heats) - bestTwo(a.heats));
      const place = order.findIndex((x) => x.you);
      medal = place === 0 ? 'gold' : place === 1 ? 'silver' : place === 2 ? 'bronze' : null;
      if (medal) {
        career.awardMedal(medal);
        tracker?.medal(medal);
        audio.goal();
      }
    }
    ui.showStandings(
      final ? 'Final results' : `Heat ${s.heats.length} results`,
      standings,
      s.heats.length,
      final,
      () => {
        if (!final) return startRun(s.level, 'comp');
        session = null;
        if (medal) {
          const first = !career.seen(L.outro.id);
          playScene(L.outro, () => {
            career.markSeen(L.outro.id);
            if (first || medal === 'gold') ui.showCredits(() => ui.showCareer());
            else ui.showCareer();
          });
        } else ui.showLevel(s.level);
      },
      medal,
    );
    return;
  }
  if (s.mode === 'free') {
    ui.showTitle();
    session = null;
    return;
  }
  const newBest = career.recordScore(L, score);
  const unlockedNow = s.level + 1 < LEVELS.length && career.isUnlocked(s.level + 1);
  const chapterUnlocked = unlockedNow && !s.unlockedBefore;
  ui.showRunEnd(
    {
      levelIndex: s.level,
      score,
      bestCombo: s.bestCombo,
      goals: s.goals,
      unlocks: [...career.unlocksBetween(s.startTotal), ...(chapterUnlocked ? [`Chapter: ${LEVELS[s.level + 1].name}`] : [])],
      newBest,
      chapterUnlocked,
      timeUp,
    },
    {
      retry: () => startRun(s.level, 'career'),
      level: () => ui.showLevel(s.level),
      nextChapter: chapterUnlocked
        ? () =>
            playScene(L.outro, () => {
              career.markSeen(L.outro.id);
              const n = s.level + 1;
              loadLevel(n);
              playScene(LEVELS[n].intro, () => {
                career.markSeen(LEVELS[n].intro.id);
                ui.showLevel(n);
              });
            })
        : null,
    },
  );
}

function updateGoalChip() {
  const L = LEVELS[levelIndex];
  hud.setGoals(career.doneCount(L), session && session.mode !== 'free' ? L.goals.length : null);
}

function onGoal(g: GoalDef) {
  session?.goals.push(g);
  hud.toast('Goal complete · +1 stat point', g.text);
  audio.goal();
  buzz([20, 40, 20, 40, 60]);
  updateGoalChip();
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

function fireSpecial() {
  const sp = career.equippedSpecial();
  if (!playing || !sp || special < 1) return;
  if (skater.flick({ flip: sp.flip, shove: sp.shove, wrap: sp.wrap, nollie: false, speed: 1.5, label: sp.name, special: sp.name })) {
    audio.special();
    hud.popup(sp.name, 'special!', 'perfect');
    buzz([10, 20, 10]);
  }
}

/* ------------------------------------------------------------------ */
/* Tutorial hints                                                      */
/* ------------------------------------------------------------------ */

const tutorial = {
  step: -1,
  pushes: 0,
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
      return 'Nice! Ollie onto a rail to grind. Menu ↗ shows your goals';
  }
  return null;
}
function tutorialAdvance(ev: 'push' | 'pop' | 'catch' | 'grind') {
  if (tutorial.done) return;
  if (tutorial.step === 0 && ev === 'push' && ++tutorial.pushes >= 2) tutorial.step = 1;
  else if (tutorial.step === 1 && ev === 'pop') tutorial.step = 2;
  else if (tutorial.step === 2 && ev === 'catch') tutorial.step = 3;
  else if (tutorial.step === 3 && ev === 'grind') {
    tutorial.done = true;
    try {
      localStorage.setItem('skate5.tut', '1');
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Combo + score                                                       */
/* ------------------------------------------------------------------ */

const QUALITY_MULT: Record<Quality, number> = { perfect: 1.5, clean: 1, sketchy: 0.6 };
const REPEAT = [1, 0.75, 0.5, 0.25, 0.1];

class Combo {
  names: string[] = [];
  points = 0;
  count = 0;
  total = 0;
  groundT = 0;
  active = false;

  add(r: TrickRecord) {
    this.active = true;
    this.groundT = 0;
    // THPS rule: the same trick scores less every time you repeat it in a run
    const n = runCounts.get(r.name) ?? 0;
    runCounts.set(r.name, n + 1);
    const q = r.quality ? QUALITY_MULT[r.quality] : 1;
    const pts = Math.round(r.points * q * REPEAT[Math.min(n, REPEAT.length - 1)]);
    this.points += pts;
    this.count += 1;
    this.names.push(r.name);
    if (session) special = Math.min(1, special + pts / 2200);
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
    if (session) session.bestCombo = Math.max(session.bestCombo, v);
    tracker?.comboBanked(v, this.count);
    tracker?.runScore(this.total);
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
const GLOW = new THREE.Color(1.0, 0.75, 0.35);

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
      act.pushStart = now();
      audio.push();
      tutorialAdvance('push');
      break;
    case 'pop':
      act.popAt = now();
      act.catchAt = -1;
      act.nollie = ev.nollie;
      audio.pop();
      buzz(8);
      tutorialAdvance('pop');
      dustBurst(5, 0.8);
      combo.groundT = 0;
      break;
    case 'catch':
      act.catchAt = now();
      audio.catchClick(ev.quality === 'perfect');
      buzz(ev.quality === 'perfect' ? [6, 30, 6] : 6);
      hud.popup(ev.name, ev.quality === 'perfect' ? 'perfect catch' : ev.quality === 'sketchy' ? 'late catch' : undefined, ev.quality);
      if (ev.quality === 'perfect') hitStop = 0.045;
      tutorialAdvance('catch');
      break;
    case 'land': {
      act.landAt = now();
      act.popAt = -1;
      audio.land(ev.impact, ev.quality);
      buzz(ev.quality === 'sketchy' ? [20, 30, 20] : 14);
      shake.t = 0.18;
      shake.amp = Math.min(0.06, 0.012 + ev.impact * 0.004);
      dustBurst(8 + Math.round(ev.impact * 2), 1.2);
      for (const r of ev.tricks) combo.add(r);
      const gaps = gapsCleared();
      const L = LEVELS[levelIndex];
      for (const g of gaps) {
        combo.add({ name: g.name, points: g.points, kind: 'trick' });
        if (session && session.mode !== 'free' && career.foundGap(L, g.id)) hud.toast('New gap found', g.name, 'letter');
      }
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
      act.landAt = now();
      act.popAt = -1;
      audio.touchdown(ev.impact);
      break;
    case 'bail': {
      fall.on = true;
      fall.t = 0;
      fall.pos.copy(rider.group.position);
      fall.q.copy(rider.group.quaternion);
      fall.vel.copy(skater.vel).multiplyScalar(0.6);
      fall.side = Math.random() < 0.5 ? 1 : -1;
      audio.bail();
      buzz([40, 50, 40]);
      shake.t = 0.35;
      shake.amp = 0.08;
      slowMo = 0.5;
      special = 0;
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
      fall.on = false;
      fade.classList.remove('on');
      break;
  }
}

/** Timeline of the last pop / catch / landing / push, for the rider's choreography. */
const act = { popAt: -1, catchAt: -1, landAt: -10, pushStart: -10, nollie: false };
const now = () => skater.time;
const PUSH_CYCLE = 0.52;
const riderQ = new THREE.Quaternion();
const yawQ = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);

/** Pose the skater from the board's state (feet stay planted via IK). */
function updateRider(dt: number, t: number, boardPos: THREE.Vector3) {
  if (!rider.group.visible) return;
  if (fall.on && skater.mode === 'bail') {
    // tip over and slide to a stop next to the board
    fall.t += dt;
    fall.vel.multiplyScalar(Math.exp(-dt * 2.5));
    fall.pos.addScaledVector(fall.vel, dt);
    fall.pos.y = terrain.height(fall.pos.x, fall.pos.z);
    const w = terrain.waterAt(fall.pos.x, fall.pos.z);
    if (w !== null && fall.pos.y < w) fall.pos.y = w - 0.6;
    rider.group.position.copy(fall.pos);
    yawQ.setFromAxisAngle(AX_X, fall.side * Math.min(1.45, fall.t * 5));
    rider.group.quaternion.copy(fall.q).multiply(yawQ);
    rider.update(dt, { crouch: 0.7, tuck: 0, lean: 0, push: -1, grind: null, air: false, time: t });
    return;
  }
  skater.baseQuat(riderQ);
  yawQ.setFromAxisAngle(AX_Y, skater.slideYaw * 0.6 + skater.yawOffset);
  riderQ.multiply(yawQ);
  rider.group.position.copy(boardPos);
  rider.group.quaternion.copy(riderQ);
  const tr = skater.trick;
  const air = skater.mode === 'air';
  const grinding = skater.mode === 'grind' && skater.grind;
  let tuck = 0;
  if (tr.active && !tr.caught) tuck = 1;
  else if (tr.active) tuck = Math.min(1, skater.residual() * 2.5);
  if (air) tuck = Math.max(tuck, skater.popped ? 0.3 : 0.1);
  let crouch = 0.04 + Math.min(1, skater.speed / 8) * 0.1;
  if (input.crouch && skater.mode === 'ground') crouch += 0.6;
  crouch += Math.max(0, -skater.squash * 8);
  if (grinding) crouch += 0.3;
  if (skater.braking) crouch += 0.25;
  rider.update(dt, {
    crouch: Math.min(1, crouch),
    tuck,
    lean: skater.mode === 'ground' ? skater.steerS * Math.min(1, skater.speed / 4) * 0.28 : 0,
    push: skater.mode === 'ground' && now() - act.pushStart < PUSH_CYCLE ? (now() - act.pushStart) / PUSH_CYCLE : -1,
    grind: grinding ? skater.grind!.balance : null,
    air,
    time: t,
    act: {
      popT: air && act.popAt >= 0 ? now() - act.popAt : -1,
      flip: Math.sign(tr.flipRate),
      shove: Math.sign(tr.shoveRate),
      wrap: Math.sign(tr.wrapRate),
      nollie: act.nollie,
      caught: !tr.active || tr.caught,
      catchT: act.catchAt >= 0 && air ? now() - act.catchAt : -1,
      landT: now() - act.landAt,
      pushT: skater.mode === 'ground' && now() - act.pushStart < PUSH_CYCLE ? now() - act.pushStart : -1,
      speed: skater.speed,
      special: !!tr.spec?.special,
    },
  });
}

function handleProps(dt: number, t: number) {
  if (!props) return;
  const collect = !!session && session.mode === 'career' && playing;
  const hits = props.update(dt, t, skater.pos, skater.vel, playing && skater.mode !== 'bail', collect);
  const L = LEVELS[levelIndex];
  for (const h of hits) {
    if (h.kind === 'object') {
      audio.knock(h.noun === 'ball');
      buzz(10);
      if (collect) {
        hud.popup(`${h.idx}/5`, L.objectNoun, 'clean');
        combo.add({ name: L.objectNoun, points: 150, kind: 'trick' });
        tracker?.objects(props.objectsHit);
      }
    } else if (h.kind === 'letter') {
      const got = props.lettersGot;
      hud.toast(`Letter ${'CLAUDE'[h.idx]}`, `${got.size}/6 · ${'CLAUDE'.split('').map((c, i) => (got.has(i) ? c : '·')).join(' ')}`, 'letter');
      audio.letter();
      buzz(12);
      tracker?.letters(got.size);
    } else if (h.kind === 'tape') {
      hud.toast('Secret tape!', 'You found the Spark team tape', 'goal');
      audio.letter();
      tracker?.tape();
    }
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
  if (!playing) targetYaw = cam.yaw;
  const vertical = s.mode === 'air' && vh < 2.5 && Math.abs(s.vel.y) > 2;
  let d = targetYaw - cam.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const rate = vertical ? 0.4 : s.mode === 'grind' ? 3 : 2.4;
  cam.yaw += d * Math.min(1, dt * rate);

  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 1;
  const sp = Math.min(12, s.speed);
  const menuPull = !playing && ui.open ? 1.8 : 1;
  // the four views: chase (top-down-ish), classic (behind, sees ahead), overhead, filmer (low + wide)
  const view = playing ? CAMERAS[options.camera].id : 'chase';
  const V = {
    chase: { dist: portrait ? 2.3 : 1.8, hr: portrait ? 1.3 : 1.12, abs: 0, ahead: 1, lookY: 0.15, fov: portrait ? 62 : 52, minH: 1.2, side: 0 },
    classic: { dist: portrait ? 4.3 : 3.5, hr: 0, abs: 1.9, ahead: 2.6, lookY: 0.7, fov: portrait ? 72 : 62, minH: 0.8, side: 0 },
    overhead: { dist: 0.7, hr: 0, abs: portrait ? 9 : 7, ahead: 0.6, lookY: 0, fov: portrait ? 60 : 50, minH: 3, side: 0 },
    filmer: { dist: portrait ? 2.6 : 2.2, hr: 0, abs: 0.35, ahead: 0.6, lookY: 0.5, fov: portrait ? 80 : 70, minH: 0.25, side: 2.2 },
  }[view];
  const baseDist = V.dist * menuPull;
  const targetDist = baseDist + sp * (view === 'overhead' ? 0 : 0.1);
  cam.dist += (targetDist - cam.dist) * Math.min(1, dt * 2);
  if (!cam.init) cam.dist = targetDist;
  const height = V.abs ? V.abs * (view === 'overhead' ? 1 : menuPull) + (view === 'overhead' ? sp * 0.2 : 0) : cam.dist * V.hr;

  const groundH = terrain.height(focus.x, focus.z);
  const fy = s.mode === 'air' ? groundH + (focus.y - groundH) * 0.65 : focus.y;
  if (!cam.init) {
    cam.y = fy;
    cam.yaw = targetYaw;
  }
  cam.y += (fy - cam.y) * Math.min(1, dt * (s.mode === 'air' ? 3 : 8));

  const fx = Math.cos(cam.yaw);
  const fz = Math.sin(cam.yaw);
  const ahead = Math.min(1.3, 0.4 + sp * 0.09) * V.ahead;
  const lookT = tmpV2.set(focus.x + fx * ahead, cam.y + V.lookY, focus.z + fz * ahead);
  // filmer runs alongside on the right, slightly behind
  const posT = new THREE.Vector3(focus.x - fx * cam.dist - fz * V.side, cam.y + height, focus.z - fz * cam.dist + fx * V.side);
  const camGround = terrain.height(posT.x, posT.z);
  if (posT.y < camGround + V.minH) posT.y = camGround + V.minH;
  if (!cam.init) {
    cam.pos.copy(posT);
    cam.look.copy(lookT);
    cam.init = true;
  }
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
  const fovT = V.fov + sp * 0.6;
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
let sprayAcc = 0;
const joint = { x: Infinity, z: Infinity };

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

function runClock(dt: number) {
  const s = session;
  if (!s || s.mode === 'free') {
    hud.setTimer(null);
    return;
  }
  if (!playing) return;
  if (!s.timeUp) {
    const before = s.time;
    s.time -= dt;
    if (Math.ceil(s.time) !== Math.ceil(before) && s.time <= 5 && s.time > 0) audio.tick();
    if (s.time <= 0) {
      s.time = 0;
      s.timeUp = true;
      hud.bigText('TIME!');
      audio.horn(true);
    }
  }
  hud.setTimer(s.time);
  // THPS rule: the clock runs out but your current line gets to finish
  if (s.timeUp && skater.mode !== 'air' && skater.mode !== 'grind' && !combo.active) finishRun(true);
}

function updateTracker() {
  const s = session;
  if (!s || s.mode === 'free' || !tracker) {
    hud.setTracker([], null);
    return;
  }
  const L = LEVELS[s.level];
  const rows: { label: string; value: string }[] = [];
  if (s.mode === 'comp') {
    rows.push({ label: `Heat ${s.heat}/3`, value: (combo.total + (combo.active ? combo.points * combo.mult : 0)).toLocaleString('en-US') });
  } else {
    const run = {
      score: combo.total,
      letters: props?.lettersGot.size ?? 0,
      objects: props?.objectsHit ?? 0,
      grind: skater.grind ? { tag: skater.grind.rail.tag, dist: skater.grind.dist } : null,
    };
    const open = L.goals.filter((g) => !career.isDone(L, g.id));
    const nextScore = open.find((g) => g.kind === 'score');
    if (nextScore) rows.push({ label: nextScore.text.split(':')[0], value: tracker.progressText(nextScore, run) });
    const obj = open.find((g) => g.kind === 'objects');
    if (obj && run.objects > 0) rows.push({ label: L.objectNoun, value: tracker.progressText(obj, run) });
    const grind = open.find((g) => g.kind === 'grind' && run.grind?.tag === g.tag);
    if (grind) rows.push({ label: 'Grind', value: tracker.progressText(grind, run) });
  }
  const showLetters = s.mode === 'career' && L.goals.some((g) => g.kind === 'letters' && !career.isDone(L, g.id));
  hud.setTracker(rows, showLetters ? [0, 1, 2, 3, 4, 5].map((i) => props?.lettersGot.has(i) ?? false) : null);
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
    } else if (a.type === 'respawn') respawnAtStart();
  }
  input.actions.length = 0;

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

  if (skater.mode === 'ground' && combo.active) {
    combo.groundT += dt;
    if (combo.groundT > 0.75) combo.bank();
  }

  // special meter
  const hasSpecial = !!session && !!career.equippedSpecial();
  if (playing && !combo.active) special = Math.max(0, special - dt * 0.02);
  skater.boost = special >= 1 ? 0.8 : 0;
  const ready = hasSpecial && special >= 1 && playing && skater.mode !== 'bail' && !(skater.trick.active && !skater.trick.caught);
  hud.setSpecial(session ? special : null, ready);
  if (special >= 1 && playing && Math.random() < 0.5) {
    tmpV.set((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4);
    glow.emit(board.root.position, tmpV, 0.3, GLOW, 0.5);
  }

  runClock(dt);

  // board visuals
  skater.visualQuat(q);
  skater.visualPos(p);
  board.root.position.copy(p);
  board.root.quaternion.copy(q);
  const crouch = input.crouch && skater.mode === 'ground' ? -0.012 : 0;
  board.pivot.position.y = DECK.deckY + crouch;
  const dist = skater.distance - lastDist;
  lastDist = skater.distance;
  const fsgn = skater.fwdSpeed < 0 ? -1 : 1;
  board.animate(dist * fsgn, skater.mode === 'ground' ? skater.steerS : 0);
  updateRider(dt, now / 1000, p);

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
  blob.rotateZ(-Math.atan2(skater.fwd.z, skater.fwd.x));
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
  if (skater.mode === 'ground' && skater.braking && skater.speed > 2 && Math.random() < 0.6) {
    tmpV.copy(skater.vel).multiplyScalar(0.2);
    dust.emit(skater.pos, tmpV, 0.8, DUST, 0.4);
  }
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
  if (skater.grind && playing) tracker?.grinding(skater.grind.rail.tag, skater.grind.dist, skater.grind.name);
  handleProps(dt, now / 1000);

  sparks.update(dt);
  dust.update(dt);
  spray.update(dt);
  splash.update(dt);
  glow.update(dt);

  // expansion joints click under the wheels on the plaza concrete
  if (skater.mode === 'ground' && Math.abs(skater.pos.y) < 0.001 && skater.groundN.y > 0.999) {
    const jx = Math.floor(skater.pos.x / 4);
    const jz = Math.floor(skater.pos.z / 4);
    if ((jx !== joint.x || jz !== joint.z) && joint.x !== Infinity) audio.joint(skater.speed);
    joint.x = jx;
    joint.z = jz;
  } else joint.x = joint.z = Infinity;

  const grindKind = skater.mode === 'grind' && skater.grind ? (skater.grind.family === 'slide' ? 'slide' : 'grind') : 'none';
  audio.update(playing && skater.mode === 'ground' ? skater.speed : 0, playing ? grindKind : 'none', skater.grind ? Math.abs(skater.grind.spd) : 0, skater.braking && skater.speed > 1.5);

  // HUD
  hud.setScore(combo.total, session ? session.bestCombo : 0);
  hud.showCombo(combo.names, combo.points + (skater.grind ? skater.grind.points : 0), combo.mult + (liveGrind ? 1 : 0), liveGrind);
  hud.balance(skater.mode === 'grind' && skater.grind ? skater.grind.balance : null);
  hud.setSpeed(skater.speed * 3.6);
  const uncaught = skater.mode === 'air' && skater.trick.active && !skater.trick.caught;
  hud.setHint(playing ? (uncaught && !tutorial.done ? 'TAP to catch it!' : tutorialHint()) : null);
  updateTracker();
  minimap?.draw(bx, bz, cam.yaw, props?.letterDots ?? []);
  hud.root.classList.toggle('dim', !playing);

  if (cut.active) cut.update(dt);
  else if (!debug.freeCam) {
    if (!playing && ui.open) cam.yaw += dt * 0.12;
    updateCamera(dt);
  }
  sun.position.copy(cut.active ? camera.position : skater.pos).add(SUN_OFFSET);
  sun.target.position.copy(cut.active ? camera.position : skater.pos);
  input.draw();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

loadLevel(0);
ui.showTitle();
requestAnimationFrame(frame);

// debug/test hook
(window as unknown as { __skate: unknown }).__skate = {
  get rider() {
    return rider;
  },
  skater,
  get terrain() {
    return terrain;
  },
  get session() {
    return session;
  },
  get special() {
    return special;
  },
  set special(v: number) {
    special = v;
  },
  input,
  combo,
  camera,
  career,
  ui,
  cut,
  begin,
  debug,
  startRun,
  finishRun,
  loadLevel,
};
