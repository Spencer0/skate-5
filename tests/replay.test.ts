import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clip, Edit, F, FPS, MAX_LIBRARY_SECONDS, STRIDE, editLength, editSfx, locate, sampleFrame, segLength, trim } from '../src/replay/clip';
import * as THREE from 'three';
import { Recorder, lens } from '../src/replay/rig';
import { roomLeft } from '../src/replay/store';

function clip(frames: number, fill: (f: Float32Array, i: number) => void, id = 'a'): Clip {
  const data = new Float32Array(frames * STRIDE);
  for (let i = 0; i < frames; i++) {
    const f = data.subarray(i * STRIDE, (i + 1) * STRIDE);
    // identity quaternions everywhere by default
    for (let n = 0; n < STRIDE; n++) f[n] = 0;
    for (const q of [F.boardQuat, F.riderQuat, F.blobQuat, F.camQuat]) f[q + 3] = 1;
    for (let b = 0; b < 20; b++) f[F.boneQuats + b * 4 + 3] = 1;
    fill(f, i);
  }
  return { id, name: id, created: 0, level: 0, levelName: '', rider: 'brock', look: null, deck: 'atlas', frames, data, sfx: [] };
}

test('sampleFrame blends positions between recorded frames', () => {
  const c = clip(3, (f, i) => (f[F.boardPos] = i * 3));
  const out = new Float32Array(STRIDE);
  sampleFrame(c, 0.5 / FPS, out);
  assert.equal(out[F.boardPos], 1.5);
  sampleFrame(c, 99, out);
  assert.equal(out[F.boardPos], 6, 'clamps past the end');
  sampleFrame(c, -1, out);
  assert.equal(out[F.boardPos], 0, 'clamps before the start');
});

test('sampleFrame takes the short way between flipped quaternions and snaps stepped values', () => {
  // the same rotation stored with opposite signs must not blend through zero
  const c = clip(2, (f, i) => {
    f[F.boardQuat + 3] = i === 0 ? 1 : -1;
    f[F.mode] = i === 0 ? 1 : 3;
  });
  const out = new Float32Array(STRIDE);
  sampleFrame(c, 0.5 / FPS, out);
  assert.ok(Math.abs(Math.abs(out[F.boardQuat + 3]) - 1) < 1e-6);
  assert.equal(out[F.mode], 3, 'mode snaps to the nearer frame');
});

test('locate maps edit time onto clips, honouring trims and slow-mo', () => {
  const e: Edit = {
    title: '',
    segments: [
      { clip: 'a', in: 1, out: 3, speed: 1, cam: 'game' },
      { clip: 'b', in: 0, out: 1, speed: 0.5, cam: 'filmer' },
    ],
  };
  assert.equal(segLength(e.segments[1]), 2);
  assert.equal(editLength(e), 4);
  assert.deepEqual(locate(e, 0.5), { index: 0, start: 0, clipT: 1.5 });
  assert.deepEqual(locate(e, 3), { index: 1, start: 2, clipT: 0.5 });
  assert.deepEqual(locate(e, 10), { index: 1, start: 2, clipT: 1 }, 'past the end holds the last frame');
  assert.equal(locate({ title: '', segments: [] }, 0), null);
});

test('editSfx keeps only sounds inside each cut, on the edit clock', () => {
  const a = clip(91, () => {}, 'a');
  a.sfx = [
    { t: 0.5, n: 'pop', a: [] },
    { t: 1.5, n: 'land', a: [2, 'clean'] },
  ];
  const e: Edit = {
    title: '',
    segments: [
      { clip: 'a', in: 1, out: 2, speed: 1, cam: 'game' },
      { clip: 'a', in: 1, out: 2, speed: 0.5, cam: 'game' },
    ],
  };
  const s = editSfx(e, new Map([['a', a]]));
  assert.deepEqual(
    s.map((x) => [x.n, x.t]),
    [
      ['land', 0.5],
      ['land', 2],
    ],
  );
});

test('trim keeps the cut inside the clip and at least a few frames long', () => {
  const c = { frames: 61 }; // 2 s
  const s = { clip: 'a', in: 0, out: 2, speed: 1, cam: 'game' as const };
  trim(s, c, 'in', 5);
  assert.ok(s.in < s.out);
  trim(s, c, 'out', 9);
  assert.equal(s.out, 2);
  trim(s, c, 'in', -3);
  assert.equal(s.in, 0);
});

test('the library refuses footage past its budget', () => {
  assert.equal(roomLeft([]), MAX_LIBRARY_SECONDS);
  assert.equal(roomLeft([{ frames: MAX_LIBRARY_SECONDS * FPS }]), 0);
});

test('Recorder samples at a fixed rate whatever the render rate, and stops when full', () => {
  const r = new Recorder(10);
  r.start();
  let writes = 0;
  const w = (out: Float32Array, o: number) => {
    out[o] = writes++;
  };
  // 0.2 s of 144 Hz frames → first frame plus 6 more at 30 fps
  for (let i = 0; i < 29; i++) r.capture(1 / 144, w);
  assert.equal(r.frames, 7);
  for (let i = 0; i < 20; i++) if (!r.capture(1 / 30, w)) break;
  assert.equal(r.frames, 10);
  const data = r.stop();
  assert.equal(data.length, 10 * STRIDE);
  assert.equal(data[9 * STRIDE], 9);
});

test('every lens keeps the board in front of the camera', () => {
  // rolling along +x at 4 m/s, 2 m off the ground
  const c = clip(61, (f, i) => {
    f[F.boardPos] = 10 + (i / FPS) * 4;
    f[F.boardPos + 1] = 2;
    f[F.boardPos + 2] = -5;
    f[F.camPos] = f[F.boardPos] - 3;
    f[F.camPos + 1] = 4;
    f[F.camPos + 2] = -5;
    f[F.camFov] = 60;
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(f[F.camPos], 4, -5);
    cam.lookAt(f[F.boardPos], 2, -5);
    cam.quaternion.toArray(f, F.camQuat);
  });
  const seg = { in: 0, out: 2 };
  for (const mode of ['game', 'filmer', 'tripod'] as const) {
    const L = lens(c, mode, 1, seg, () => 0, { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0 });
    const board = new THREE.Vector3(14, 2, -5);
    const toBoard = board.clone().sub(L.pos).normalize();
    const facing = L.look.clone().sub(L.pos).normalize();
    assert.ok(toBoard.dot(facing) > 0.8, `${mode} looks at the board`);
    assert.ok(L.pos.distanceTo(board) < 12, `${mode} stays close`);
    assert.ok(L.fov > 20 && L.fov < 100);
  }
});
