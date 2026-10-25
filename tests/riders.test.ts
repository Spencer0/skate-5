import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../public/riders/', import.meta.url);

/** the JSON chunk of a .glb */
function gltfJson(file: URL) {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as { extensionsUsed?: string[]; images?: { mimeType?: string }[] };
}

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.glb'))) {
  test(`${f} ships compressed (tools/riders/compress.sh)`, () => {
    const j = gltfJson(new URL(f, DIR));
    assert.ok(j.extensionsUsed?.includes('EXT_meshopt_compression'), 'meshes not meshopt-compressed');
    for (const img of j.images ?? []) assert.equal(img.mimeType, 'image/webp');
  });
}
