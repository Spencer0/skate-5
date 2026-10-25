#!/bin/sh
# Last step after repack*.py: WebP textures, then meshopt-compressed, quantized
# meshes (the game registers the meshopt decoder). Cuts the models ~3x.
# Usage: sh compress.sh brock coral voss custom_m custom_f extras_m extras_f
set -e
cd "$(dirname "$0")/../../public/riders"
GT="npx -y @gltf-transform/cli@4.1.1"
for n in "$@"; do
  $GT webp "$n.glb" "$n.tmp.glb" --quality 85
  $GT meshopt "$n.tmp.glb" "$n.glb" --level medium
  rm "$n.tmp.glb"
done
