import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/terrain';
import { buildLayout } from '../src/park';
import { Ragdoll } from '../src/ragdoll';

const terrain = new Terrain();
buildLayout(terrain);

// a standing body facing +Z, in RAG order
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const body = (x: number, z: number) =>
  [
    V(0.1, 0.95, 0), V(-0.1, 0.95, 0), V(0, 1.35, 0), V(0, 1.6, 0), V(0.2, 1.45, 0), V(-0.2, 1.45, 0),
    V(0.25, 1.2, -0.03), V(-0.25, 1.2, -0.03), V(0.27, 0.95, 0.05), V(-0.27, 0.95, 0.05),
    V(0.1, 0.5, 0.05), V(-0.1, 0.5, 0.05), V(0.1, 0.08, 0), V(-0.1, 0.08, 0),
  ].map((p) => p.add(V(x, 0, z)));

function fall(x: number, z: number, vel: THREE.Vector3, sec: number) {
  const pos = body(x, z);
  const rag = new Ragdoll(11);
  // feet catch, the upper body carries on
  rag.start(pos, pos.map((_, i) => vel.clone().multiplyScalar(i >= 10 ? 0.3 : 1)));
  const rest = (rag as any).links.map(([a, b, l]: number[]) => [a, b, l]);
  let maxY = 0;
  for (let i = 0; i < sec * 60; i++) {
    rag.step(1 / 60, terrain);
    for (const p of rag.p) maxY = Math.max(maxY, p.y);
  }
  return { rag, rest, maxY };
}

test('ragdoll falls over on flat ground, stays in one piece and settles', () => {
  const { rag, rest, maxY } = fall(0, 40, V(0, 0, -6), 3);
  for (const p of rag.p) {
    assert.ok(Number.isFinite(p.x + p.y + p.z));
    assert.ok(p.y > terrain.height(p.x, p.z) - 0.01, 'nothing sinks into the ground');
  }
  for (const [a, b, l] of rest) assert.ok(Math.abs(rag.p[a].distanceTo(rag.p[b]) - l) < 0.03, `link ${a}-${b} stretched`);
  const hipY = (rag.p[0].y + rag.p[1].y) / 2;
  assert.ok(hipY < 0.4, `lying down (hip at ${hipY.toFixed(2)})`);
  assert.ok(maxY < 1.8, 'no bounce up');
});

test('ragdoll hitting a box side stops against it instead of launching', () => {
  // the 0.9m box at (-2, 58) has its near face at z = 55
  const { rag, maxY } = fall(-2, 54.2, V(0, 0, 6), 2.5);
  assert.ok(maxY < 2.2, `launched to ${maxY.toFixed(2)}m`);
  const hipZ = (rag.p[0].z + rag.p[1].z) / 2;
  assert.ok(hipZ < 56.5, `went through the box (hip z ${hipZ.toFixed(2)})`);
});
