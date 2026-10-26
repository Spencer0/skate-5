import * as THREE from 'three';
import './style.css';
import { Terrain } from './terrain';
import { buildMeshes, makeMaterials } from './park';
import { LEVELS, PARKS, LevelData, GapDef, GoalDef, inRect, V3, LETTERS } from './levels';
import { BoardModel, DECK } from './board';
import { Skater, SkaterEvent, TrickRecord, Quality, GRAB_LIFT } from './skater';
import { Input, trickAnywhere } from './input';
import { orbitHands } from './rider';
import { grabForDirection, GRABS } from './tricks';
import { Audio } from './audio';
import { Hud } from './hud';
import { Particles } from './fx';
import { shadowTexture, skyTexture } from './textures';
import { ambient } from './levels/decor';
import { Minimap } from './minimap';
import { Career, GoalTracker, applyStats, Medal } from './career';
import { UI, RunMode, GAP_NAMES, Standing, bestTwo } from './ui';
import { CutscenePlayer, previewScene } from './cutscene';
import { Opening, OPENING_ID } from './opening';
import { FilmThis, FILM_ID } from './filmthis';
import { Props } from './props';
import { HumanRider, setCompileHook } from './humanrider';
import { CAMERAS, loadOptions, saveOptions, npcSetting } from './settings';
import { NpcCrew, crewSize } from './npcs';
import { Tutorial, tutorialPlayed } from './tutorial';
import { Recorder, SFX, writeFrame } from './replay/rig';
import { FPS, MAX_CLIP_SECONDS, MODES } from './replay/clip';
import { listClips, putClip, roomLeft } from './replay/store';
import { Studio } from './replay/studio';
import { Graphics, startTier, TIERS } from './quality';
import { Perf } from './perf';

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app')!;
const options = loadOptions();
const launchTier = startTier(options.quality);
const renderer = new THREE.WebGLRenderer({ antialias: TIERS[launchTier].antialias, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#EFE7DA');
scene.fog = new THREE.Fog(0xefe7da, 45, 150);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.05, 400);

const hemi = new THREE.HemisphereLight(0xfff6ea, 0x8a7d6c, 1.35);
scene.add(hemi);

// sky dome: follows the camera, horizon colour matches the fog
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(360, 32, 16),
  new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }),
);
skyDome.renderOrder = -1;
skyDome.frustumCulled = false;
scene.add(skyDome);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
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
const quality = new Graphics(renderer, scene, sun, options.quality, launchTier);
const perf = new URLSearchParams(location.search).has('perf') ? new Perf(renderer, () => ({ ratio: quality.ratio, tier: quality.tier })) : null;
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

// the park locals (src/npcs.ts): never in captures driven by a virtual clock (tools/promo)
const NPC_CAPTURE = typeof (window as { __step?: unknown }).__step === 'function' || new URLSearchParams(location.search).has('capture');
const npcs = new NpcCrew(scene);

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
skater.autoRevert = options.autoRevert;
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
const storyHost = { scene, camera, audio, groundAt: (x: number, z: number) => terrain.height(x, z) };
const opening = new Opening(app, storyHost);
const filmThis = new FilmThis(app, storyHost);
/** the story scene playing (or last played): the opening, or chapter 2's "film this" */
let story: Opening | FilmThis = opening;

const fade = document.createElement('div');
fade.className = 'fade';
app.appendChild(fade);

const loading = document.createElement('div');
loading.className = 'loading';
loading.setAttribute('role', 'status');
loading.setAttribute('aria-label', 'Loading');
app.appendChild(loading);
/** Show the spinner if a wait outlasts a blink; returns the call that hides it. */
function spinner() {
  const t = setTimeout(() => loading.classList.add('on'), 150);
  return () => {
    clearTimeout(t);
    loading.classList.remove('on');
  };
}
let riderWait = 0;
/** Run `go` once the player's rider model is ready (at once if it already is), behind the spinner. */
function withRider(go: () => void) {
  if (rider.ready) return go();
  const id = ++riderWait;
  const done = spinner();
  rider.loaded.then(() => {
    if (id !== riderWait) return;
    done();
    go();
  });
}

// gap checklist names for every level
for (const L of PARKS) {
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
/** the 'special ready' how-to shows once per run */
let specialHinted = false;
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
}
input.onFirstInput = () => audio.start();

const ui = new UI(app, career, {
  startRun: (i, mode) => withRider(() => startRun(i, mode)),
  resume,
  restartRun() {
    if (!session) return;
    if (tut.active) startTutorial();
    else if (session.mode === 'free') {
      respawnAtStart();
      resume();
    } else startRun(session.level, session.mode);
  },
  endRun() {
    finishRun(false);
  },
  quit() {
    playing = false;
    stopRecording();
    const s = session;
    session = null;
    hud.setTimer(null);
    stopTutorial();
    if (s && s.mode !== 'free') ui.showLevel(s.level);
    else ui.showTitle();
  },
  playOpening,
  playFilmThis,
  playIntro(i, then) {
    withRider(() => {
      loadLevel(i);
      playScene(LEVELS[i].intro, () => {
        career.markSeen(LEVELS[i].intro.id);
        then();
      });
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
  startTutorial,
  tutorialPlayed,
  inTutorial: () => tut.active,
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
  getAutoRevert: () => options.autoRevert,
  setAutoRevert(v) {
    options.autoRevert = v;
    skater.autoRevert = v;
    saveOptions(options);
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
  getRecording: () => options.recording,
  setRecording(v) {
    options.recording = v;
    saveOptions(options);
    if (!v) stopRecording();
  },
  openStudio,
  getNpcs: () => npcSetting(options, quality.tier),
  setNpcs(v) {
    options.npcs = v;
    saveOptions(options);
  },
  getQuality: () => options.quality,
  setQuality(q) {
    options.quality = q;
    saveOptions(options);
    quality.set(q);
  },
  qualityStatus: () => ({ tier: quality.tier, antialiasPending: quality.antialiasPending }),
});

/* ------------------------------------------------------------------ */
/* Tutorial                                                            */
/* ------------------------------------------------------------------ */

const tut = new Tutorial(app, {
  stepDone() {
    audio.goal();
    buzz([15, 30, 15]);
  },
  finish(next) {
    if (next === 'again') {
      stopTutorial();
      return;
    }
    playing = false;
    session = null;
    stopTutorial();
    if (next === 'career') ui.showCareer();
    else ui.showTitle();
  },
  skip() {
    playing = false;
    session = null;
    stopTutorial();
    ui.showTitle();
  },
});

/** A no-clock ride in the first park with the coach on top. */
function startTutorial() {
  withRider(startTutorialNow);
}
function startTutorialNow() {
  startRun(0, 'free');
  tut.start();
  hud.root.classList.add('tutorial');
}
function stopTutorial() {
  tut.stop();
  hud.root.classList.remove('tutorial');
}

function resume() {
  ui.hide();
  playing = true;
  input.actions.length = 0;
  quality.resetWindow();
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
hud.recBtn.addEventListener('click', toggleRecording);
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'v' && !e.repeat && !(e.target instanceof HTMLInputElement)) toggleRecording();
});
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

/**
 * The story opening at Brazil Park, shot like a phone video. A new story goes
 * straight from it into the first run; `then` replaces that (replays).
 */
function playOpening(then?: () => void) {
  playStory(opening, 0, OPENING_ID, then);
}

/** Chapter 2's cold open at the Plaza ("Bro, can you film this?"), then its first run. */
function playFilmThis(then?: () => void) {
  playStory(filmThis, 1, FILM_ID, then);
}

function playStory(sc: Opening | FilmThis, level: number, id: string, then?: () => void) {
  story = sc;
  playing = false;
  stopRecording();
  ui.hide();
  hud.root.classList.add('cine');
  loadLevel(level);
  audio.start();
  fade.classList.add('on');
  const loaded = spinner();
  sc.load().then(() => {
    loaded();
    // straight from black into the first shot, no fade
    fade.style.transition = 'none';
    fade.classList.remove('on');
    void fade.offsetWidth;
    fade.style.transition = '';
    const fog = scene.fog as THREE.Fog;
    const near = fog.near;
    const far = fog.far;
    fog.near = near * 2;
    fog.far = far * 1.8;
    board.root.visible = blob.visible = rider.group.visible = false;
    sc.play(() => {
      fog.near = near;
      fog.far = far;
      board.root.visible = blob.visible = true;
      rider.setStyle(options.rider);
      hud.root.classList.remove('cine');
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      career.markSeen(id);
      cam.init = false;
      // the models are big and only needed again for a replay
      sc.dispose();
      if (then) then();
      else startRun(level, 'career');
    });
  });
}

/** A chapter's intro waits until after your first run there when a story scene came first (chapters 1 and 2). */
function introFirst(i: number, then: () => void) {
  const L = LEVELS[i];
  if (career.seen(L.intro.id)) return then();
  playScene(L.intro, () => {
    career.markSeen(L.intro.id);
    then();
  });
}

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

/**
 * Free a level's geometry and textures. Materials are kept: disposing the last
 * material on a shader program deletes the program, and the next visit to the
 * level would compile it again (a 150-400 ms stall on a phone). A material is
 * a few hundred bytes; the programs are what cost.
 */
function disposeGroup(g: THREE.Group) {
  const shared = new Set<THREE.Material>(Object.values(mats));
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (shared.has(x)) continue;
      (x as THREE.MeshStandardMaterial).map?.dispose();
    }
  });
}

/** false while a freshly built level's shaders compile: the frame loop holds the last picture instead of stalling */
let levelReady = true;
let levelGen = 0;

/**
 * Compile an object's shaders with KHR_parallel_shader_compile where the
 * browser has it (Chrome, recent Safari) so the compiler runs on driver
 * threads instead of stalling the first frame the object is drawn.
 */
const parallelCompile = renderer.extensions.has('KHR_parallel_shader_compile');
function compileInBackground(o: THREE.Object3D): Promise<unknown> {
  if (parallelCompile) return renderer.compileAsync(o, camera, scene);
  // without the extension the compile blocks either way: do it now, quietly
  renderer.compile(o, camera, scene);
  return Promise.resolve();
}

function loadLevel(i: number) {
  if (i === levelIndex) return;
  const L = PARKS[i];
  levelIndex = i;
  if (levelGroup) {
    scene.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  terrain = new Terrain();
  levelData = L.build(terrain);
  levelGroup = buildMeshes(terrain, levelData.vis, mats, { ground: L.ground, groundColor: L.groundColor, rampMat: L.rampMat });
  L.decorate(levelGroup, mats, terrain);
  const hasTape = L.goals.some((g) => g.kind === 'tape');
  props = new Props(terrain, levelData.props, levelData.letters, hasTape ? levelData.tape : null);
  props.setPickupsVisible(false);
  levelGroup.add(props.group);
  const sky = new THREE.Color(L.sky);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, L.fog[0], L.fog[1]);
  const skyMat = skyDome.material as THREE.MeshBasicMaterial;
  skyMat.map?.dispose();
  skyMat.map = skyTexture(L.sky, L.zenith, i + 1);
  skyMat.needsUpdate = true;
  // a touch of sky blue in the fill light, so shade reads cool against warm sun
  hemi.color.set(0xfff6ea).lerp(new THREE.Color(L.zenith), 0.22);
  // fog and lights are set: the level's shaders can compile while the group stays out of the scene
  const group = levelGroup;
  const gen = ++levelGen;
  levelReady = false;
  compileInBackground(group).then(
    () => {
      if (gen !== levelGen) return;
      scene.add(group);
      levelReady = true;
      quality.resetWindow();
      last = performance.now();
    },
    () => {
      if (gen !== levelGen) return;
      scene.add(group);
      levelReady = true;
    },
  );
  skater.terrain = terrain;
  npcs.setLevel(terrain, levelData);
  respawnAtStart();
  minimap?.destroy();
  minimap = new Minimap(hud.root, terrain);
  fountains = terrain.elements.filter((e) => e.kind === 'fountain').map((e) => new THREE.Vector3(e.cx, 1.1, e.cz));
  combo.reset();
  liveGrind = null;
  cam.init = false;
}

/** Lift pads carry you back up to the top of the big drop-ins. */
function rideLifts() {
  if (skater.mode !== 'ground' || !levelData.lifts) return;
  for (const l of levelData.lifts) {
    if (!inRect(l.area, skater.pos.x, skater.pos.z)) continue;
    combo.bank();
    skater.spawn(l.to.x, l.to.z, l.to.heading);
    cam.init = false;
    hud.toast('Lift', l.name, 'letter');
    return;
  }
}

function respawnAtStart() {
  const sp = levelData.spawn;
  skater.spawn(sp.x, sp.z, sp.heading);
  combo.lose();
  fade.classList.remove('on');
  cam.init = false;
}

function startRun(i: number, mode: RunMode) {
  quality.resetWindow();
  stopRecording();
  stopTutorial();
  loadLevel(i);
  const L = PARKS[i];
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
  specialHinted = false;
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
  stopRecording();
  hud.setTimer(null);
  combo.bank();
  const L = PARKS[s.level];
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
      retry: () => introFirst(s.level, () => startRun(s.level, 'career')),
      level: () => introFirst(s.level, () => ui.showLevel(s.level)),
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
  const L = PARKS[levelIndex];
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
  if (skater.flick({ flip: sp.flip, shove: sp.shove, wrap: sp.wrap, orbit: sp.orbit, nollie: false, speed: 1.5, label: sp.name, special: sp.name })) {
    audio.special();
    hud.popup(sp.name, 'special!', 'perfect');
    buzz([10, 20, 10]);
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
    case 'grab':
      audio.grab();
      buzz(8);
      hud.popup(ev.name, 'hold it…', 'clean');
      break;
    case 'revert':
      audio.revert();
      hud.popup('Revert', undefined, 'clean');
      combo.add({ name: 'Revert', points: 100, kind: 'trick' });
      break;
    case 'push':
      act.pushStart = now();
      audio.push();
      tut.push();
      break;
    case 'pop':
      act.popAt = now();
      act.catchAt = -1;
      act.nollie = ev.nollie;
      audio.pop();
      buzz(8);
      dustBurst(5, 0.8);
      combo.groundT = 0;
      break;
    case 'catch':
      act.catchAt = now();
      audio.catchClick(ev.quality === 'perfect');
      buzz(ev.quality === 'perfect' ? [6, 30, 6] : 6);
      hud.popup(ev.name, ev.quality === 'perfect' ? 'perfect catch' : ev.quality === 'sketchy' ? 'late catch' : undefined, ev.quality);
      if (ev.quality === 'perfect') hitStop = 0.045;
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
      if (recorder.active) recorder.tricks.push(...ev.tricks.map((r) => r.name));
      const gaps = gapsCleared();
      const L = PARKS[levelIndex];
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
      tut.land(ev.tricks.map((r) => r.name));
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
      // the full rider goes limp (the scripted tip-over still runs while its model is loading)
      rider.startRagdoll(skater.vel, fall.side, terrain);
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
      tut.bail(ev.reason);
      break;
    }
    case 'grindStart':
      audio.grindStart(ev.slide);
      buzz(10);
      for (const r of ev.tricks) combo.add(r);
      liveGrind = ev.name;
      break;
    case 'grindChange':
      liveGrind = ev.name;
      break;
    case 'grindEnd':
      combo.add(ev.record);
      if (recorder.active) recorder.tricks.push(ev.record.name);
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
      rider.stopRagdoll();
      fade.classList.remove('on');
      break;
  }
}

/** Timeline of the last pop / catch / landing / push, for the rider's choreography. */
const act = { popAt: -1, catchAt: -1, landAt: -10, pushStart: -10, nollie: false };
/** Crouch pulse while pumping: `amt` eases in and out, `phase` drives the in-and-out. */
const pump = { amt: 0, phase: 0 };
const now = () => skater.time;
const PUSH_CYCLE = 0.66;
const riderQ = new THREE.Quaternion();
const yawQ = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);

/** Pose the skater from the board's state (feet stay planted via IK). */
function updateRider(dt: number, t: number, boardPos: THREE.Vector3) {
  if (!rider.group.visible) return;
  // any way out of the bail (respawn, restart, level change) stands the rider back up
  if (rider.ragdolling && skater.mode !== 'bail') rider.stopRagdoll();
  if (rider.ragdolling) {
    rider.update(dt, { crouch: 0, tuck: 0, lean: 0, push: -1, grind: null, air: false, time: t });
    return;
  }
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
  pump.amt += ((skater.pumping ? 1 : 0) - pump.amt) * Math.min(1, dt * 6);
  if (pump.amt > 0.02) pump.phase += dt * Math.PI * 2 * 2.2;
  else pump.phase = 0;
  crouch += pump.amt * 0.4 * (0.5 - 0.5 * Math.cos(pump.phase));
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
      pushAt: act.pushStart,
      pushHold: playing && input.pushHold,
      ground: skater.mode === 'ground',
      clock: now(),
      speed: skater.speed,
      fakie: skater.mode === 'ground' && skater.fwdSpeed < -0.4,
      special: !!tr.spec?.special,
      orbit: orbitHands(skater),
      grab: skater.grabAmt > 0.01 ? { ...GRABS[skater.grabIdx], amt: skater.grabAmt } : undefined,
    },
  });
}

function handleProps(dt: number, t: number) {
  if (!props) return;
  const collect = !!session && session.mode === 'career' && playing;
  const hits = props.update(dt, t, skater.pos, skater.vel, playing && skater.mode !== 'bail', collect);
  const L = PARKS[levelIndex];
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
      hud.toast(`Letter ${LETTERS[h.idx]}`, `${got.size}/${LETTERS.length} · ${LETTERS.split('').map((c, i) => (got.has(i) ? c : '·')).join(' ')}`, 'letter');
      audio.letter();
      buzz(12);
      tracker?.letters(got.size);
    } else if (h.kind === 'tape') {
      hud.toast('Secret tape!', 'You found the Atlas team tape', 'goal');
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
/* Recording + studio                                                  */
/* ------------------------------------------------------------------ */

/** what audio.update() was given this frame: roll speed, grind kind, grind speed, powerslide */
const bed = [0, 0, 0, 0];
const recorder = new Recorder(MAX_CLIP_SECONDS * FPS);
// every skate sound also lands in the clip being recorded, to be replayed in the edit
for (const n of SFX) {
  const fns = audio as unknown as Record<string, (...a: unknown[]) => void>;
  const orig = fns[n].bind(audio);
  fns[n] = (...a: unknown[]) => {
    recorder.sound(n, a as (number | string | boolean)[]);
    orig(...a);
  };
}

function toggleRecording() {
  if (!options.recording || !session) return;
  if (recorder.active) stopRecording();
  else if (playing) {
    recorder.start();
    audio.blip();
  }
}

function stopRecording() {
  if (!recorder.active) return;
  const frames = recorder.frames;
  const data = recorder.stop();
  if (frames < FPS) return; // under a second: a mis-tap
  const tricks = [...new Set(recorder.tricks)];
  const name = tricks.length ? tricks.slice(0, 3).join(' · ') + (tricks.length > 3 ? ' …' : '') : 'Cruising';
  const L = PARKS[levelIndex];
  const clip = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    created: Date.now(),
    level: levelIndex,
    levelName: L.name,
    rider: career.data.rider ?? 'brock',
    look: career.customLook(),
    deck: career.data.deck,
    frames,
    data,
    sfx: recorder.sfx,
  };
  listClips()
    .then((all) => {
      if (roomLeft(all) < frames / FPS) {
        hud.toast('Studio is full', 'Delete some clips in the Studio to record more', 'letter');
        return;
      }
      return putClip(clip).then(() => hud.toast('Clip saved', `${name} · open the Studio to edit`, 'letter'));
    })
    .catch((e) => {
      console.warn('clip not saved', e);
      hud.toast('Clip not saved', 'This browser blocked storage', 'letter');
    });
}

const studioFxPos = new THREE.Vector3();
const studio = new Studio(app, {
  scene,
  camera,
  renderer,
  board,
  blob,
  audio,
  rider: () => rider,
  loadLevel,
  groundAt: (x, z) => terrain.height(x, z),
  deck: () => career.data.deck,
  fx(dt, at, grind, events) {
    studioFxPos.copy(at);
    if (grind) {
      sparkAcc += dt * 60 * (grind === 2 ? 0.3 : 1);
      while (sparkAcc > 1) {
        sparkAcc -= 1;
        tmpV.set((Math.random() - 0.5) * 1.2, 0.6, (Math.random() - 0.5) * 1.2);
        sparks.emit(studioFxPos, tmpV, 2.2, SPARK, 0.35);
      }
    }
    for (const e of events) {
      const n = e === 'pop' ? 5 : e === 'land' ? 10 : 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        tmpV.set(Math.cos(a), 0.2, Math.sin(a));
        dust.emit(studioFxPos, tmpV, 0.6, DUST, 0.5);
      }
      if (e === 'splash') {
        for (let i = 0; i < 60; i++) {
          tmpV.set((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3);
          splash.emit(studioFxPos, tmpV, 0.6, WATER, 1.0);
        }
      }
    }
  },
  render(dt, view) {
    worldTick(dt);
    if (!view) {
      renderer.render(scene, camera);
      return;
    }
    // letterboxed monitor: dark surround, the shot in its export aspect
    const H = window.innerHeight;
    renderer.setScissorTest(false);
    renderer.setClearColor(0x141413, 1);
    renderer.clear();
    renderer.setViewport(view.x, H - view.y - view.h, view.w, view.h);
    renderer.setScissor(view.x, H - view.y - view.h, view.w, view.h);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, H);
  },
  setRenderSize(w, h, ratio) {
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  },
  restoreRenderSize() {
    renderer.setPixelRatio(quality.ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  },
  exit() {
    hud.root.style.display = '';
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    cam.init = false;
    ui.showTitle();
  },
});

function openStudio() {
  npcs.clear();
  playing = false;
  stopRecording();
  ui.hide();
  hud.root.style.display = 'none';
  input.actions.length = 0;
  studio.open();
}

/** Things that move whether or not anyone is skating: particles, water, palms, flags, sky. */
function worldTick(dt: number) {
  sparks.update(dt);
  dust.update(dt);
  spray.update(dt);
  splash.update(dt);
  glow.update(dt);
  for (const f of fountains) {
    sprayAcc += dt * 45;
    while (sprayAcc > 1) {
      sprayAcc -= 1;
      tmpV.set((Math.random() - 0.5) * 0.9, 3.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.9);
      spray.emit(f, tmpV, 0.2, WATER, 0.75);
    }
  }
  // shadows centre on the board: a tripod can stand well outside the shadow box
  sun.position.copy(board.root.position).add(SUN_OFFSET);
  sun.target.position.copy(board.root.position);
  ambient.value += dt;
  mats.water.map?.offset.set(ambient.value * 0.012, ambient.value * 0.02);
  for (const f of (levelGroup?.userData.ticks ?? []) as ((dt: number, t: number) => void)[]) f(dt, ambient.value);
  skyDome.position.copy(camera.position);
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
  const L = PARKS[s.level];
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
  perf?.begin();
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (studio.active) {
    input.enabled = false;
    studio.update(dt);
    return;
  }
  if (!levelReady) {
    input.poll();
    input.actions.length = 0;
    return;
  }
  const realDt = dt;
  if (playing && !document.hidden) quality.update(dt);

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
    else if (a.type === 'special') fireSpecial();
    else if (a.type === 'grab') pendingGrab = a.idx;
    else if (a.type === 'release') {
      pendingGrab = null;
      skater.releaseGrab();
    }
  }
  input.actions.length = 0;
  // a grab pressed while the board is still settling from a catch starts as soon as it can
  if (pendingGrab !== null) {
    if (skater.mode !== 'air') pendingGrab = null;
    else if (skater.startGrab(pendingGrab)) pendingGrab = null;
  }

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
  perf?.mark('input');
  acc += debug.paused || !playing ? 0 : dt;
  let first = true;
  while (acc >= FIXED) {
    skater.step(FIXED, { ...sin, push: first && sin.push });
    first = false;
    acc -= FIXED;
  }
  for (const ev of skater.events) handle(ev);
  skater.events.length = 0;
  perf?.mark('physics');
  npcs.update(dt, npcCtx);
  perf?.mark('npcs');

  if (skater.mode === 'bail' && skater.bailT > 1.45) fade.classList.add('on');
  if (playing) rideLifts();

  if (skater.mode === 'ground' && combo.active) {
    combo.groundT += dt;
    if (combo.groundT > 0.75) combo.bank();
  }

  // special meter
  const hasSpecial = !!session && !!career.equippedSpecial();
  // a part-filled meter drains between combos; a full one stays lit until you bail
  if (playing && !combo.active && special < 1) special = Math.max(0, special - dt * 0.02);
  skater.boost = special >= 1 ? 0.8 : 0;
  const ready = hasSpecial && special >= 1 && playing && skater.mode !== 'bail' && !(skater.trick.active && !skater.trick.caught);
  hud.setSpecial(session ? special : null, ready);
  if (session && playing && special >= 1 && !specialHinted) {
    specialHinted = true;
    const sp = career.equippedSpecial();
    if (sp) hud.toast(`${sp.name} ready`, trickAnywhere() ? 'Press E (or click ★), then catch it' : 'Tap ★ in the air, then tap to catch', 'letter');
  }
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
  // Around the World carries the board off the feet; the rider stays put
  skater.orbitBoard(board.root.position, board.root.quaternion);
  const crouch = input.crouch && skater.mode === 'ground' ? -0.012 : 0;
  board.pivot.position.y = DECK.deckY + crouch;
  const dist = skater.distance - lastDist;
  lastDist = skater.distance;
  const fsgn = skater.fwdSpeed < 0 ? -1 : 1;
  board.animate(dist * fsgn, skater.mode === 'ground' ? skater.steerS : 0);
  updateRider(dt, now / 1000, p);
  perf?.mark('rider');

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
  bed[0] = playing && skater.mode === 'ground' ? skater.speed : 0;
  bed[1] = !playing || grindKind === 'none' ? 0 : grindKind === 'grind' ? 1 : 2;
  bed[2] = skater.grind ? Math.abs(skater.grind.spd) : 0;
  bed[3] = skater.braking && skater.speed > 1.5 ? 1 : 0;
  // a story scene runs the wheel sounds itself (its own skaters)
  if (!story.active) audio.update(bed[0], playing ? grindKind : 'none', bed[2], bed[3] > 0);

  // HUD
  perf?.mark('other');
  hud.setScore(combo.total, session ? session.bestCombo : 0);
  hud.showCombo(combo.names, combo.points + (skater.grind ? skater.grind.points : 0), combo.mult + (liveGrind ? 1 : 0), liveGrind);
  hud.balance(skater.mode === 'grind' && skater.grind ? skater.grind.balance : null);
  hud.setSpeed(skater.speed * 3.6);
  const uncaught = skater.mode === 'air' && skater.trick.active && !skater.trick.caught;
  hud.setHint(playing && uncaught && !tutorialPlayed() && !tut.active ? 'TAP to catch it!' : null);
  tut.update(dt, { playing, steer: input.steer, uncaught });
  updateTracker();
  minimap?.draw(bx, bz, cam.yaw, props?.letterDots ?? []);
  hud.root.classList.toggle('dim', !playing);

  if (story.active) story.update(realDt);
  else if (cut.active) cut.update(dt);
  else if (!debug.freeCam) {
    if (!playing && ui.open) cam.yaw += dt * 0.12;
    updateCamera(dt);
  }
  const lit = story.active ? story.focus : cut.active ? camera.position : skater.pos;
  sun.position.copy(lit).add(SUN_OFFSET);
  sun.target.position.copy(lit);
  input.grabZone = playing && skater.mode === 'air' && !cut.active ? grabZone() : null;
  input.draw();
  // ambient life: swaying palms, waving flags, birds, boats
  ambient.value += dt;
  mats.water.map?.offset.set(ambient.value * 0.012, ambient.value * 0.02);
  for (const f of (levelGroup?.userData.ticks ?? []) as ((dt: number, t: number) => void)[]) f(dt, ambient.value);
  skyDome.position.copy(camera.position);
  perf?.mark('hud');
  perf?.gpuBegin();
  if (story.active) renderPortrait();
  else renderer.render(scene, camera);
  perf?.gpuEnd();
  perf?.mark('render');
  if (recorder.active && playing && !cut.active) {
    const mode = Math.max(0, MODES.indexOf(skater.mode as (typeof MODES)[number]));
    if (!recorder.capture(realDt, (out, o) => writeFrame({ board, rider, blob, camera }, out, o, bed, mode))) {
      hud.toast('Clip full', `${MAX_CLIP_SECONDS} s max per clip`, 'letter');
      stopRecording();
    }
  }
  hud.setRec(options.recording && playing && session ? (recorder.active ? recorder.time : -1) : null);
  perf?.end();
}

/** The story scenes are phone videos: on a wide screen they play in a 9:16 window. */
function renderPortrait() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const v = story.layout(W, H);
  if (camera.aspect !== v.w / v.h) {
    camera.aspect = v.w / v.h;
    camera.updateProjectionMatrix();
  }
  if (v.w === W) {
    renderer.render(scene, camera);
    return;
  }
  renderer.setScissorTest(false);
  renderer.setClearColor(0x0b0b0a, 1);
  renderer.clear();
  renderer.setViewport(v.x, H - v.y - v.h, v.w, v.h);
  renderer.setScissor(v.x, H - v.y - v.h, v.w, v.h);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
}

/** What the park locals need each frame (one object, reused). */
const npcCtx = {
  get active() {
    return !!session && session.mode !== 'comp' && !tut.active && !cut.active && !story.active && !NPC_CAPTURE;
  },
  get running() {
    return playing && !debug.paused;
  },
  get count() {
    return crewSize(npcSetting(options, quality.tier), PARKS[levelIndex]?.id ?? '');
  },
  player: skater,
  camera,
  look: () => ({ rider: career.data.rider ?? 'brock', look: career.customLook(), deck: career.data.deck }),
  sound(kind: 'pop' | 'land' | 'bail', level: number, impact: number) {
    // skate sounds also land in a clip being recorded: keep the locals out of it
    if (recorder.active) return;
    audio.distant(level, () => (kind === 'pop' ? audio.pop() : kind === 'land' ? audio.land(impact, 'clean') : audio.bail()));
  },
};

let pendingGrab: number | null = null;
const gzA = new THREE.Vector3();
const gzB = new THREE.Vector3();
const gzRay = new THREE.Raycaster();
const gzPlane = new THREE.Plane();
const gzNdc = new THREE.Vector2();

/** Screen circle around the airborne skater; a press inside it grabs. */
function grabZone(): import('./input').GrabZone | null {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const base = skater.pos;
  // centre on the rider's hips, size by how tall they look on screen
  const toScreen = (v: THREE.Vector3) => new THREE.Vector2((v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H);
  gzA.copy(base).addScaledVector(skater.up, 0.75).project(camera);
  if (gzA.z > 1) return null;
  const mid = toScreen(gzA);
  const feet = toScreen(gzB.copy(base).project(camera));
  const head = toScreen(gzB.copy(base).addScaledVector(skater.up, 1.7).project(camera));
  const r = Math.max(70, Math.min(Math.min(W, H) * 0.32, feet.distanceTo(head) * 0.75));
  const x = mid.x;
  const y = mid.y;
  const fwd = skater.fwd.clone();
  const toe = new THREE.Vector3().crossVectors(fwd, skater.up).normalize();
  return {
    x,
    y,
    r,
    pick: (px, py) => {
      // where on the board's plane did the press land?
      gzNdc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
      gzRay.setFromCamera(gzNdc, camera);
      gzPlane.setFromNormalAndCoplanarPoint(skater.up, base);
      const hit = new THREE.Vector3();
      let along: number;
      let across: number;
      if (gzRay.ray.intersectPlane(gzPlane, hit)) {
        hit.sub(base);
        along = hit.dot(fwd);
        across = hit.dot(toe);
      } else {
        // looking edge-on: fall back to screen directions
        const ps = base.clone().add(fwd).project(camera);
        const ts = base.clone().add(toe).project(camera);
        const bs = base.clone().project(camera);
        const d = new THREE.Vector2(gzNdc.x - bs.x, gzNdc.y - bs.y);
        along = d.dot(new THREE.Vector2(ps.x - bs.x, ps.y - bs.y));
        across = d.dot(new THREE.Vector2(ts.x - bs.x, ts.y - bs.y));
      }
      return grabForDirection(along, across);
    },
    spot: (idx) => {
      const gd = GRABS[idx];
      const lift = skater.up.clone().multiplyScalar(0.12 + GRAB_LIFT * 0.5);
      const p = base.clone().add(lift).addScaledVector(fwd, gd.x).addScaledVector(toe, gd.z * 1.2).project(camera);
      return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
    },
  };
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// riders that live in this scene compile their shaders before they show; the creator's preview (its own renderer) doesn't
setCompileHook((model, owner) => {
  for (let p: THREE.Object3D | null = owner; p; p = p.parent) if (p === scene) return compileInBackground(model);
  return Promise.resolve();
});
loadLevel(0);
ui.showTitle();
// everything in the opening scene (board, sky, particles) compiles before the first frame
(parallelCompile ? renderer.compileAsync(scene, camera) : (renderer.compile(scene, camera), Promise.resolve())).finally(() => {
  last = performance.now();
  requestAnimationFrame(frame);
});

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
  tut,
  recorder,
  audio,
  npcs,
  opening,
  playOpening,
  filmThis,
  playFilmThis,
  quality,
  perf,
  renderer,
  scene,
  mats,
  skyDome,
  sun,
  THREE,
};
