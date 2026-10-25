import * as THREE from 'three';

/**
 * Debug performance overlay, on with `?perf` in the URL. Frame time (average
 * and 95th percentile) split by section, renderer counters (draw calls,
 * triangles, programs) and GPU time when the timer-query extension exists.
 * `__skate.perf.snapshot()` returns the same numbers as JSON for a headless
 * run to read.
 */

export type Section = 'input' | 'physics' | 'npcs' | 'rider' | 'hud' | 'render' | 'other';
const SECTIONS: Section[] = ['input', 'physics', 'npcs', 'rider', 'hud', 'render', 'other'];

export interface Snapshot {
  frames: number;
  /** ms per frame */
  avg: number;
  p95: number;
  max: number;
  fps: number;
  /** ms per frame spent in each section */
  sections: Record<Section, number>;
  /** ms per frame on the GPU (null without EXT_disjoint_timer_query_webgl2) */
  gpu: number | null;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  ratio: number;
  tier: string;
  width: number;
  height: number;
}

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class Perf {
  readonly root = document.createElement('pre');
  private sect: Record<Section, number> = { input: 0, physics: 0, npcs: 0, rider: 0, hud: 0, render: 0, other: 0 };
  private frameTimes: number[] = [];
  private frameStart = 0;
  private markAt = 0;
  private windowStart = performance.now();
  private last: Snapshot | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private ext: TimerExt | null = null;
  private queries: WebGLQuery[] = [];
  private gpuNs: number[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    private status: () => { ratio: number; tier: string },
  ) {
    this.root.style.cssText =
      'position:fixed;left:8px;top:34%;z-index:9999;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.65);pointer-events:none;white-space:pre';
    document.body.appendChild(this.root);
    renderer.info.autoReset = false;
    const gl = renderer.getContext();
    if (gl instanceof WebGL2RenderingContext) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
      if (ext) {
        this.gl = gl;
        this.ext = ext;
      }
    }
  }

  /** Start of a frame. */
  begin() {
    this.frameStart = this.markAt = performance.now();
    this.renderer.info.reset();
  }

  /** Charge the time since the last mark to `s`. */
  mark(s: Section) {
    const now = performance.now();
    this.sect[s] += now - this.markAt;
    this.markAt = now;
  }

  /** Wrap the GPU work of the frame. */
  gpuBegin() {
    const gl = this.gl;
    if (!gl || !this.ext) return;
    this.pollQueries();
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.queries.push(q);
  }

  gpuEnd() {
    if (this.gl && this.ext && this.queries.length) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
  }

  private pollQueries() {
    const gl = this.gl!;
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT);
      if (!disjoint) this.gpuNs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) as number);
      gl.deleteQuery(q);
      this.queries.shift();
    }
  }

  /** End of a frame: account the remainder, refresh the overlay twice a second. */
  end() {
    this.mark('other');
    const now = performance.now();
    this.frameTimes.push(now - this.frameStart);
    if (now - this.windowStart < 500) return;
    const info = this.renderer.info;
    const n = this.frameTimes.length;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const sections = {} as Record<Section, number>;
    for (const s of SECTIONS) {
      sections[s] = this.sect[s] / n;
      this.sect[s] = 0;
    }
    const st = this.status();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.last = {
      frames: n,
      avg: sorted.reduce((a, b) => a + b, 0) / n,
      p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
      max: sorted[n - 1],
      fps: (n * 1000) / (now - this.windowStart),
      sections,
      gpu: this.gpuNs.length ? this.gpuNs.reduce((a, b) => a + b, 0) / this.gpuNs.length / 1e6 : null,
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      ratio: st.ratio,
      tier: st.tier,
      width: size.x,
      height: size.y,
    };
    this.frameTimes.length = 0;
    this.gpuNs.length = 0;
    this.windowStart = now;
    this.draw(this.last);
  }

  private draw(s: Snapshot) {
    const f = (x: number) => x.toFixed(2).padStart(6);
    const lines = [
      `${s.fps.toFixed(0).padStart(3)} fps  avg ${f(s.avg)}  p95 ${f(s.p95)}  max ${f(s.max)} ms`,
      `gpu ${s.gpu === null ? '   n/a' : f(s.gpu)} ms   ${s.width}x${s.height} @${s.ratio.toFixed(2)} ${s.tier}`,
      `calls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k  progs ${s.programs}  geo ${s.geometries}  tex ${s.textures}`,
      ...SECTIONS.map((k) => `  ${k.padEnd(8)}${f(s.sections[k])}`),
    ];
    this.root.textContent = lines.join('\n');
  }

  /** The last half-second window. */
  snapshot(): Snapshot | null {
    return this.last;
  }
}
