import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Graphics, TIERS } from '../src/quality';

(globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 3 };
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem() {} };

function rig(setting: 'auto' | 'high' = 'auto') {
  const renderer = {
    ratio: 0,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap as THREE.ShadowMapType },
    setPixelRatio(r: number) {
      this.ratio = r;
    },
  };
  const sun = new THREE.DirectionalLight();
  const g = new Graphics(renderer as unknown as THREE.WebGLRenderer, new THREE.Scene(), sun, setting, 'high');
  return { g, renderer, sun };
}

/** run `secs` of frames at a steady fps */
function run(g: Graphics, fps: number, secs: number) {
  for (let i = 0; i < fps * secs; i++) g.update(1 / fps);
}

test('applies the launch tier', () => {
  const { g, renderer, sun } = rig();
  assert.equal(renderer.ratio, TIERS.high.maxRatio);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(renderer.shadowMap.type, THREE.PCFSoftShadowMap);
  assert.equal(sun.shadow.mapSize.x, 2048);
  assert.equal(g.tier, 'high');
});

test('smooth frame rate changes nothing', () => {
  const { g, renderer } = rig();
  run(g, 60, 20);
  assert.equal(g.tier, 'high');
  assert.equal(renderer.ratio, 2);
});

test('a GPU-bound device steps down resolution, then tier, until smooth', () => {
  const { g, renderer, sun } = rig();
  // fps scales with pixels drawn; shadows cost extra
  for (let i = 0; i < 40; i++) {
    const cost = renderer.ratio * renderer.ratio * (g.spec.shadows ? 1.6 : 1);
    run(g, Math.min(60, 50 / cost), 2);
  }
  assert.equal(g.tier, 'low');
  assert.equal(sun.castShadow, false);
  assert.equal(renderer.shadowMap.enabled, false);
});

test('a 30 Hz cap (no gain from stepping down) puts quality back and stops', () => {
  const { g, renderer } = rig();
  run(g, 30, 30);
  assert.equal(g.tier, 'high');
  assert.equal(renderer.ratio, 2);
});

test('a manual tier never adapts', () => {
  const { g, renderer } = rig('high');
  run(g, 20, 30);
  assert.equal(g.tier, 'high');
  assert.equal(renderer.ratio, 2);
});
