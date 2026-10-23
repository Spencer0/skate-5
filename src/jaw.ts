import * as THREE from 'three';

/**
 * A talking jaw for the MakeHuman body, which has no jaw bone or face morphs.
 * The body's head vertices below the mouth line swing down around a hinge
 * near the ears (in the vertex shader, before skinning), and a dark mouth
 * cavity sits inside the head so the open mouth doesn't show through it.
 */
export interface Jaw {
  /** 0 closed .. 1 wide open */
  set(open: number): void;
  dispose(): void;
}

export function rigJaw(root: THREE.Object3D): Jaw | null {
  let body: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === 'body') body = o as THREE.SkinnedMesh;
  });
  if (!body) return null;
  const mesh = body as THREE.SkinnedMesh;
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const head = mesh.skeleton.bones.findIndex((b) => b.name === 'head');
  if (head < 0 || !si || !sw) return null;

  // the head's own vertices (mostly weighted to the head bone), in bind space
  let minY = Infinity;
  let maxY = -Infinity;
  const hv: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === head) w += sw.getComponent(i, k);
    if (w < 0.6) continue;
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    hv.push(v);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  if (hv.length < 50) return null;
  // the face looks down +Z: the nose is the most forward point near the middle
  const mid = hv.filter((v) => Math.abs(v.x) < (maxY - minY) * 0.08);
  const nose = mid.reduce((a, b) => (b.z > a.z ? b : a));
  const u = maxY - minY; // head height, the unit for everything below
  // chin: lowest forward point of the face
  const face = mid.filter((v) => v.z > nose.z - u * 0.18 && v.y < nose.y);
  const chin = face.reduce((a, b) => (b.y < a.y ? b : a), nose);
  const lip = nose.y - (nose.y - chin.y) * 0.42;
  const hinge = new THREE.Vector3(0, lip + u * 0.06, nose.z - u * 0.42);

  const uniforms = {
    uJaw: { value: 0 },
    uLip: { value: lip },
    uHinge: { value: hinge },
    uFront: { value: nose.z - u * 0.3 },
    uU: { value: u },
  };
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uJaw;
uniform float uLip;
uniform vec3 uHinge;
uniform float uFront;
uniform float uU;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  // lower face only: below the lip line, in front of the ears, above the neck
  float below = smoothstep(uLip + uU * 0.004, uLip - uU * 0.01, transformed.y);
  float front = smoothstep(uFront - uU * 0.12, uFront, transformed.z);
  float neck = smoothstep(uLip - uU * 0.36, uLip - uU * 0.24, transformed.y);
  float side = 1.0 - smoothstep(uU * 0.2, uU * 0.3, abs(transformed.x));
  float w = below * front * neck * side;
  float a = uJaw * 0.27 * w;
  vec3 r = transformed - uHinge;
  float c = cos(a), s = sin(a);
  transformed = uHinge + vec3(r.x, r.y * c - r.z * s, r.y * s + r.z * c);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'jaw';
  mat.needsUpdate = true;

  // the dark inside of the mouth, riding the head bone
  const bone = mesh.skeleton.bones[head];
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x1a0c0a }));
  const at = new THREE.Vector3(0, lip - u * 0.025, nose.z - u * 0.21);
  // bind space -> head bone space
  const toBone = mesh.skeleton.boneInverses[head].clone().multiply(mesh.bindMatrix);
  cavity.position.copy(at.applyMatrix4(toBone));
  const sc = new THREE.Vector3().setFromMatrixScale(toBone);
  cavity.scale.set(u * 0.075 * sc.x, u * 0.04 * sc.y, u * 0.07 * sc.z);
  bone.add(cavity);

  return {
    set(open: number) {
      uniforms.uJaw.value = Math.max(0, Math.min(1, open));
    },
    dispose() {
      cavity.removeFromParent();
      cavity.geometry.dispose();
      (cavity.material as THREE.Material).dispose();
    },
  };
}
