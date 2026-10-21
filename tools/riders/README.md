# Rider models

The three skaters in `public/riders/*.glb` are MakeHuman characters built with
[MPFB](https://github.com/makehumancommunity/mpfb2) inside headless Blender.
MakeHuman's base mesh, rig and the `makehuman_system_assets` pack are **CC0**.

Pipeline (Python 3.13, run from this folder):

```sh
export MH_WORK=/tmp/mh/          # scratch dir
python -m venv $MH_WORK/venv && $MH_WORK/venv/bin/pip install bpy==5.2.2 pillow
git clone --depth 1 https://github.com/makehumancommunity/mpfb2 /tmp/mpfb2
export MPFB_SRC=/tmp/mpfb2/src/mpfb
curl -L -o $MH_WORK/sys.zip https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
unzip -q $MH_WORK/sys.zip -d $MH_WORK/sysassets
# keep pristine copies of the textures recolor.py edits
cp $MH_WORK/sysassets/clothes/male_casualsuit06/male_casualsuit06_diffuse.png $MH_WORK/orig_m6.png
cp $MH_WORK/sysassets/clothes/male_elegantsuit01/male_elegantsuit01_diffuse.png $MH_WORK/orig_el.png
cp $MH_WORK/sysassets/clothes/female_casualsuit02/female_casualsuit02_diffuse.png $MH_WORK/orig_f2.png

$MH_WORK/venv/bin/python setup.py       # install MPFB into bpy, link the assets
$MH_WORK/venv/bin/python recolor.py     # clay tee, teal tee, lab-coat white + Claude sparks
$MH_WORK/venv/bin/python generate.py    # build brock / coral / voss, export GLB
$MH_WORK/venv/bin/python repack.py brock coral voss   # JPEG textures -> public/riders/
```

`generate.py` holds each character's body sliders (gender, age, muscle,
weight, height…), skin, hair and clothes. The game drives the `game_engine`
rig with its own IK (`src/humanrider.ts`).
