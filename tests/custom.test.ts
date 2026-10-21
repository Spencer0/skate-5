import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTTOMS, HAIR, HATS, SHAPES, SHOES, TOPS, defaultLook, heightOf, partColors, sanitizeLook, shapeInfluences, HEIGHT_MAX, HEIGHT_MIN } from '../src/custom';

test('garbage from storage falls back to the default look', () => {
  for (const raw of [null, undefined, 5, 'x', [], {}]) assert.deepEqual(sanitizeLook(raw), defaultLook());
});

test('a valid look survives untouched, including bald and no hat', () => {
  const look = { ...defaultLook(), body: 'f' as const, hair: null, hat: HATS[0].id, top: TOPS[3].id, bottom: BOTTOMS[2].id, shoes: SHOES[1].id, height: 0.8, skin: '#8d5a3b' };
  assert.deepEqual(sanitizeLook(look), look);
});

test('unknown ids, bad colours and out-of-range heights are repaired', () => {
  const d = defaultLook();
  const out = sanitizeLook({ ...d, top: 'nope', bottom: 3, hair: 'mullet', hat: 'tophat', shoes: '', skin: 'red', topColor: '#12', height: 7, body: 'x' });
  assert.equal(out.top, d.top);
  assert.equal(out.bottom, d.bottom);
  assert.equal(out.hair, d.hair);
  assert.equal(out.hat, d.hat);
  assert.equal(out.shoes, d.shoes);
  assert.equal(out.skin, d.skin);
  assert.equal(out.topColor, d.topColor);
  assert.equal(out.height, 1);
  assert.equal(out.body, 'm');
  assert.equal(sanitizeLook({ height: -3 }).height, 0);
});

test('height maps onto the supported range', () => {
  assert.equal(heightOf({ ...defaultLook(), height: 0 }), HEIGHT_MIN);
  assert.ok(Math.abs(heightOf({ ...defaultLook(), height: 1 }) - HEIGHT_MAX) < 1e-9);
});

test('every option exists in the model catalogue and the default look wears real parts', () => {
  for (const list of [HAIR, HATS, TOPS, BOTTOMS, SHOES]) {
    assert.ok(list.length > 0);
    assert.equal(new Set(list.map((o) => o.id)).size, list.length, 'ids are unique');
  }
  const colors = partColors(defaultLook());
  for (const part of ['body', 'eyes', 'brows', 'lashes', 'top_tee', 'bottom_jeans', 'shoes_shoes06', 'hair_short02']) assert.ok(part in colors, part);
  assert.ok(!Object.keys(partColors({ ...defaultLook(), hair: null, hat: null })).some((k) => k.startsWith('hair_') || k.startsWith('hat_')));
});

test('body shape sliders are repaired and old saves get average shapes', () => {
  const d = defaultLook();
  assert.ok(SHAPES.length > 0);
  for (const def of SHAPES) assert.equal(d.shape[def.id], 0.5);
  const { shape: _omit, ...old } = d; // a save from before shapes existed
  assert.deepEqual(sanitizeLook(old).shape, d.shape);
  const out = sanitizeLook({ ...d, shape: { [SHAPES[0].id]: 9, [SHAPES[1].id]: 'x', bogus: 1 } });
  assert.equal(out.shape[SHAPES[0].id], 1);
  assert.equal(out.shape[SHAPES[1].id], 0.5);
  assert.ok(!('bogus' in out.shape));
});

test('shape sliders blend the lo / hi morph targets around the average', () => {
  const id = SHAPES[0].id;
  const at = (v: number) => shapeInfluences({ ...defaultLook(), shape: { ...defaultLook().shape, [id]: v } });
  assert.deepEqual([at(0.5)[id + '-lo'], at(0.5)[id + '-hi']], [0, 0]);
  assert.deepEqual([at(0)[id + '-lo'], at(0)[id + '-hi']], [1, 0]);
  assert.deepEqual([at(1)[id + '-lo'], at(1)[id + '-hi']], [0, 1]);
  assert.equal(at(0.75)[id + '-hi'], 0.5);
});
