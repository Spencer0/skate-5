import * as THREE from 'three';

/**
 * Graphics quality tiers. "Auto" picks a starting tier from what the device
 * tells us, then a governor watches the frame rate in play and steps down
 * (resolution first, then tier) until the game holds a smooth rate. The tier
 * it settles on is remembered so the next launch starts there.
 */

export type Tier = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | Tier;

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high'];

export interface TierSpec {
  /** cap on renderer pixel ratio */
  maxRatio: number;
  /** the governor never lowers resolution below this */
  minRatio: number;
  shadows: boolean;
  shadowSize: number;
  softShadows: boolean;
  /** MSAA is fixed when the WebGL context is created: applies on next launch */
  antialias: boolean;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { maxRatio: 2, minRatio: 1.25, shadows: true, shadowSize: 2048, softShadows: true, antialias: true },
  medium: { maxRatio: 1.5, minRatio: 1, shadows: true, shadowSize: 1024, softShadows: false, antialias: true },
  low: { maxRatio: 1, minRatio: 0.75, shadows: false, shadowSize: 512, softShadows: false, antialias: false },
};

export const QUALITY_NAMES: Record<QualitySetting, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };

const LEARNED_KEY = 'skate5.autoTier';

function lower(a: Tier, b: Tier): Tier {
  return TIER_ORDER.indexOf(a) < TIER_ORDER.indexOf(b) ? a : b;
}

/** Best guess from the GPU string, memory, cores and form factor. */
export function detectTier(): Tier {
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* ignore */
  }
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = matchMedia('(pointer: coarse)').matches || /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if (mem <= 2 || (mobile && cores <= 4)) return 'low';
  // old mobile GPUs that struggle with shadow maps at phone resolutions
  if (/adreno \(tm\) [1-5]\d\d|mali-[4t]|powervr|sgx/.test(gpu)) return 'low';
  if (mobile) return 'medium';
  if (/intel/.test(gpu) && !/iris|arc/.test(gpu)) return 'medium';
  return 'high';
}

function loadLearned(): Tier | null {
  try {
    const v = localStorage.getItem(LEARNED_KEY);
    return v && (TIER_ORDER as string[]).includes(v) ? (v as Tier) : null;
  } catch {
    return null;
  }
}

function saveLearned(t: Tier) {
  try {
    localStorage.setItem(LEARNED_KEY, t);
  } catch {
    /* ignore */
  }
}

/** The tier a setting resolves to at launch. */
export function startTier(setting: QualitySetting): Tier {
  if (setting !== 'auto') return setting;
  const learned = loadLearned();
  const detected = detectTier();
  return learned ? lower(learned, detected) : detected;
}

const WINDOW = 2; // seconds per fps sample
const LOW_FPS = 48;
const RATIO_STEP = 0.25;

export class Graphics {
  tier: Tier;
  ratio: number;
  /** set when the first step down didn't raise the frame rate (a 30 Hz cap, low power mode): stop adapting */
  private frozen = false;
  /** whether the first step has been checked for a refresh cap */
  private probed = false;
  private t = 0;
  private frames = 0;
  private undo: { tier: Tier; ratio: number; fps: number } | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    public setting: QualitySetting,
    /** the tier the context was created for (decides antialias) */
    readonly launchTier: Tier,
  ) {
    this.tier = launchTier;
    this.ratio = this.maxRatio();
    this.apply();
  }

  get spec() {
    return TIERS[this.tier];
  }

  /** true when the current tier wants a different antialias than the context has */
  get antialiasPending() {
    return TIERS[this.tier].antialias !== TIERS[this.launchTier].antialias;
  }

  private maxRatio() {
    return Math.min(window.devicePixelRatio || 1, this.spec.maxRatio);
  }

  set(setting: QualitySetting) {
    this.setting = setting;
    this.frozen = false;
    this.probed = false;
    this.undo = null;
    this.t = this.frames = 0;
    this.tier = setting === 'auto' ? startTier('auto') : setting;
    this.ratio = this.maxRatio();
    this.apply();
  }

  private apply() {
    const s = this.spec;
    this.renderer.setPixelRatio(this.ratio);
    const type = s.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const changed = this.renderer.shadowMap.enabled !== s.shadows || this.renderer.shadowMap.type !== type;
    this.renderer.shadowMap.enabled = s.shadows;
    this.renderer.shadowMap.type = type;
    this.sun.castShadow = s.shadows;
    if (this.sun.shadow.mapSize.x !== s.shadowSize) {
      this.sun.shadow.mapSize.set(s.shadowSize, s.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // shadow on/off and filter type are compiled into every lit material
    if (changed) this.recompile();
  }

  private recompile() {
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
  }

  /** Feed real frame times while playing. Only Auto adapts. */
  update(dt: number) {
    if (this.setting !== 'auto' || this.frozen) return;
    this.t += dt;
    this.frames++;
    if (this.t < WINDOW) return;
    const fps = this.frames / this.t;
    this.t = this.frames = 0;
    if (this.undo) {
      // the first step should buy real frames; if not, the limit is elsewhere
      // (a refresh cap), so put quality back and leave it alone
      const prev = this.undo;
      this.undo = null;
      this.probed = true;
      if (fps < LOW_FPS && fps < prev.fps * 1.06) {
        this.tier = prev.tier;
        this.ratio = prev.ratio;
        this.frozen = true;
        this.apply();
        saveLearned(this.tier);
        return;
      }
    }
    if (fps >= LOW_FPS) return;
    const prev = { tier: this.tier, ratio: this.ratio, fps };
    if (this.ratio - RATIO_STEP >= this.spec.minRatio - 1e-6) {
      this.ratio -= RATIO_STEP;
    } else {
      const i = TIER_ORDER.indexOf(this.tier);
      if (i === 0) {
        this.frozen = true;
        return;
      }
      this.tier = TIER_ORDER[i - 1];
      this.ratio = Math.min(this.ratio, this.maxRatio());
    }
    if (!this.probed) this.undo = prev;
    this.apply();
    saveLearned(this.tier);
  }

  /** Restart the sample window (after a load hitch, unpause, etc). */
  resetWindow() {
    this.t = this.frames = 0;
  }
}
