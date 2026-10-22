# Rider models

The three skaters in `public/riders/*.glb` are MakeHuman characters built with
[MPFB](https://github.com/makehumancommunity/mpfb2) inside headless Blender.
MakeHuman's base mesh, rig and the `makehuman_system_assets` pack are **CC0**.

Pipeline (Python 3.13, run from this folder):

```sh
export MH_WORK=/tmp/mh/          # scratch dir
python -m venv $MH_WORK/venv && $MH_WORK/venv/bin/pip install bpy==5.2.2 pillow
git clone https://github.com/makehumancommunity/mpfb2 /tmp/mpfb2 && git -C /tmp/mpfb2 checkout b1a2dc98776da9d1eea751b159d42cf61778fe2e
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

## Create-a-skater models

`public/riders/custom_m.glb` and `custom_f.glb` are modular: one body per
gender with every hair, hat, top, bottom and shoe option fitted to it and
sharing one skeleton. The game hides the parts a player didn't pick and tints
the rest (`src/humanrider.ts`, `src/custom.ts`, `src/creator.ts`).

The option list is `src/data/skater-options.json`. It is the single source of
truth: `generate_custom.py` builds whatever it lists and the game's menus read
the same file. Tops and bottoms name a MakeHuman suit (`src`); suits are split
into their loose shirt / trousers parts, so any top goes with any bottom.

```sh
# same setup as above (pin MPFB so rebuilds are reproducible)
git clone https://github.com/makehumancommunity/mpfb2 /tmp/mpfb2 && git -C /tmp/mpfb2 checkout b1a2dc98776da9d1eea751b159d42cf61778fe2e
$MH_WORK/venv/bin/python setup.py
$MH_WORK/venv/bin/python generate_custom.py     # ONLY=m or ONLY=f for one body
$MH_WORK/venv/bin/python repack_custom.py m f   # greyscale textures, logos painted out -> public/riders/
```

`repack_custom.py` turns skin, cloth, shoe and hair textures greyscale so a
material colour multiplied on top reads as that colour, and paints the logos
and orange trim out of the tees. To add an option: add the asset to the JSON,
re-run the two scripts, commit the JSON and both GLBs. No `.blend` files are
needed: the scripts rebuild everything from the CC0 asset pack.

**Body shape** (weight, muscle, shoulders, chest, waist, hips) is baked as glTF
morph targets on the body, tops and bottoms. `generate_custom.py` rebuilds the
whole character once per slider end (`weight-lo`, `weight-hi`, …) using
MakeHuman macro values or detail targets, so every garment is re-fitted to the
changed body; the vertex order is identical across builds, so the differences
become morph targets. The game blends them with sliders (`reshape` in
`src/humanrider.ts`). The sliders are listed under `shape` in the JSON. The
skeleton is not morphed, so height is a plain uniform scale and shapes stay
within what the bones can follow. A full run takes about 6 minutes per body.

Nodes are named `body`, `eyes`, `brows`, `lashes`, `hair_*`, `hat_*`,
`top_*`, `bottom_*` and `shoes_*`; each has its own material named the same.

### Themed add-on parts (beach, party, cowboy)

Themed items live under `extras` in `src/data/skater-options.json` and are
built separately into `public/riders/extras_m.glb` / `extras_f.glb`: just their
meshes (with the same body-shape morph targets) on the same skeleton. The game
only downloads the extras model when a look wears one of them, and grafts the
meshes onto the base model's bones by bone name (`src/humanrider.ts`).

```sh
# the community packs are CC BY: download the ones you need and unzip into $MH_WORK/sysassets
#   https://static.makehumancommunity.org/assets/assetpacks.html  (hats03, shoes03, pants03, underwear02, shirts02, shoes02)
PACK=extras $MH_WORK/venv/bin/python generate_custom.py     # ONLY=m / QUICK=1 (skip body-shape morphs) for fast iteration
$MH_WORK/venv/bin/python repack_custom.py extras_m extras_f
```

An item with `"single": true` is a stand-alone garment (not a suit to split);
`"proc"` builds a hat MakeHuman doesn't have (party, cowboy) from the body's own
head measurements and skins it to the head bone; `"color"` is the colour it
starts in. `"author"` feeds the credits (all CC BY).
