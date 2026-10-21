import os
MH = os.environ.get('MH_WORK', '/tmp/mh/')  # work dir: sysassets/, out/
"""Builds the modular character-creator models: public/riders/custom_{m,f}.glb.

One body per gender with every hair / hat / top / bottom / shoe option fitted
to it, all sharing a single skeleton. The game shows or hides parts by node
name (hair_*, top_*, bottom_*, shoes_*, hat_*) and tints their materials, so
the option list lives in src/data/skater-options.json, read by both sides.
"""
import bpy, bmesh, json, sys, importlib

bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')

def dyn(pkg, key):
    for m in list(sys.modules):
        if m.endswith(pkg):
            return getattr(importlib.import_module(m), key)
    raise ValueError(pkg)

HumanService = dyn('mpfb.services.humanservice', 'HumanService')
AssetService = dyn('mpfb.services.assetservice', 'AssetService')
ExportService = dyn('mpfb.services.exportservice', 'ExportService')
ObjectService = dyn('mpfb.services.objectservice', 'ObjectService')

HERE = os.path.dirname(os.path.abspath(__file__))
OPT = json.load(open(os.path.join(HERE, '../../src/data/skater-options.json')))
OUT = sys.argv[-1] if sys.argv[-1].endswith('/') else MH + 'out/'
os.makedirs(OUT, exist_ok=True)

BODIES = {
    'm': dict(macro=dict(gender=1.0, age=0.5, muscle=0.5, weight=0.5, proportions=0.5, height=0.5, cupsize=0.5, firmness=0.5,
                         race=dict(african=0.33, caucasian=0.34, asian=0.33)), skin='young_caucasian_male.mhmat'),
    'f': dict(macro=dict(gender=0.0, age=0.5, muscle=0.5, weight=0.5, proportions=0.5, height=0.5, cupsize=0.5, firmness=0.5,
                         race=dict(african=0.33, caucasian=0.34, asian=0.33)), skin='young_caucasian_female.mhmat'),
}
# the full body stays under every garment (any top goes with any bottom), so garments are
# pushed out a little to keep the skin from z-fighting through tight cloth
CLOTH_OFFSET = 0.004
# fraction of body height: a loose part centred below this is trousers / skirt, above is a top
WAIST = 0.56


def asset(sub, name, kind, basemesh):
    p = AssetService.find_asset_absolute_path(name + '.mhclo', asset_subdir=sub)
    if p is None:
        raise SystemExit('MISSING ' + name)
    HumanService.add_mhclo_asset(p, basemesh, asset_type=kind, subdiv_levels=0, material_type='GAMEENGINE')


def split_suit(obj, zmin, height):
    """Loose parts of a suit -> {'top': obj, 'bottom': obj} (either may be absent)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            c = stack.pop()
            comp.append(c.index)
            for e in c.link_edges:
                w = e.other_vert(c)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        islands.append(comp)
    kinds = {'top': set(), 'bottom': set()}
    for comp in islands:
        zs = [(obj.matrix_world @ bm.verts[i].co).z for i in comp]
        c = ((min(zs) + max(zs)) / 2 - zmin) / height
        if len(comp) < 4:
            continue
        kinds['bottom' if c < WAIST else 'top'].update(comp)
    bm.free()
    out = {}
    for kind, keep in kinds.items():
        if not keep:
            continue
        o = obj.copy()
        o.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(o)
        b = bmesh.new()
        b.from_mesh(o.data)
        b.verts.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[v for v in b.verts if v.index not in keep], context='VERTS')
        b.normal_update()
        for v in b.verts:
            v.co += v.normal * CLOTH_OFFSET
        b.to_mesh(o.data)
        b.free()
        out[kind] = o
    return out


def build(gid, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    basemesh = HumanService.create_human(macro_detail_dict=spec['macro'])
    HumanService.set_character_skin(AssetService.find_asset_absolute_path(spec['skin'], asset_subdir='skins'), basemesh, skin_type='GAMEENGINE')
    HumanService.add_builtin_rig(basemesh, 'game_engine')
    asset('eyes', 'low-poly', 'Eyes', basemesh)
    asset('eyebrows', 'eyebrow001', 'Eyebrows', basemesh)
    asset('eyelashes', 'eyelashes01', 'Eyelashes', basemesh)
    for h in OPT['hair']:
        asset('hair', h['id'], 'Hair', basemesh)
    for h in OPT['hats']:
        asset('clothes', h['id'], 'Clothes', basemesh)
    for s in OPT['shoes']:
        asset('clothes', s['id'], 'Clothes', basemesh)
    srcs = sorted({o['src'] for o in OPT['tops'] + OPT['bottoms']})
    for s in srcs:
        asset('clothes', s, 'Clothes', basemesh)

    root = ExportService.create_character_copy(basemesh, name_suffix='_export')
    eb = ObjectService.find_object_of_type_amongst_nearest_relatives(root, 'Basemesh')
    # keep the full body: the player may wear any top with any bottom
    ExportService.bake_modifiers_remove_helpers(eb, bake_masks=False, bake_subdiv=True, remove_helpers=True, also_proxy=True)
    keep = {root} | set(ObjectService.get_list_of_children(root))
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for m in [m for m in o.modifiers if m.type == 'MASK']:
                o.modifiers.remove(m)
            if o.data.shape_keys:
                bpy.context.view_layer.objects.active = o
                o.select_set(True)
                bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
                o.select_set(False)

    meshes = {o.name.replace('_export', '').replace('Human.', ''): o for o in bpy.data.objects if o.type == 'MESH'}
    body = meshes.pop('Human', None) or meshes.pop('body')
    body.name = 'body'
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    zmin, height = min(zs), max(zs) - min(zs)

    def rename(o, name):
        o.name = name
        o.data.name = name
        # every part gets its own material so the game can tint it independently
        for slot in o.material_slots:
            slot.material = slot.material.copy()
            slot.material.name = name

    rename(body, 'body')
    rename(meshes.pop('low-poly'), 'eyes')
    rename(meshes.pop('eyebrow001'), 'brows')
    rename(meshes.pop('eyelashes01'), 'lashes')
    for h in OPT['hair']:
        rename(meshes.pop(h['id']), 'hair_' + h['id'])
    for h in OPT['hats']:
        rename(meshes.pop(h['id']), 'hat_' + h['id'])
    for s in OPT['shoes']:
        rename(meshes.pop(s['id']), 'shoes_' + s['id'])
    parts = {s: split_suit(meshes[s], zmin, height) for s in srcs}
    for kind, items in (('top', OPT['tops']), ('bottom', OPT['bottoms'])):
        for it in items:
            o = parts[it['src']].get(kind)
            if o is None:
                raise SystemExit(f"{it['src']} has no {kind}")
            # a source used twice (e.g. top + bottom of one suit) needs separate objects
            rename(o, f"{kind}_{it['id']}")
    # drop the whole suits and any split part nobody asked for
    wanted = {f"top_{i['id']}" for i in OPT['tops']} | {f"bottom_{i['id']}" for i in OPT['bottoms']}
    for s in srcs:
        bpy.data.objects.remove(meshes[s], do_unlink=True)
    for p in parts.values():
        for o in p.values():
            if o.name not in wanted and not o.name.startswith(('top_', 'bottom_')):
                bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name not in wanted and not o.name.startswith(('hair_', 'hat_', 'shoes_')) and o.name not in ('body', 'eyes', 'brows', 'lashes'):
            bpy.data.objects.remove(o, do_unlink=True)

    for mat in bpy.data.materials:
        if mat.use_nodes:
            for n in list(mat.node_tree.nodes):
                if n.type == 'NORMAL_MAP':
                    mat.node_tree.nodes.remove(n)
    for img in bpy.data.images:
        n = img.name.lower()
        small = any(k in n for k in ('eye', 'brow', 'lash'))
        tgt = 256 if small or 'shoe' in n else 1024 if 'skin' in n else 512
        if img.size[0] > tgt:
            img.scale(tgt, tgt)
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
            print('  mesh', o.name, len(o.data.loop_triangles))
    print(gid, 'tris', tris)
    bpy.ops.object.select_all(action='SELECT')
    path = OUT + f'custom_{gid}.glb'
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_image_format='AUTO',
                              export_jpeg_quality=80, export_morph=False, export_animations=False, export_skins=True,
                              export_apply=False, export_yup=True)
    print('wrote', path, os.path.getsize(path))


only = os.environ.get('ONLY')
for gid, spec in BODIES.items():
    if only and gid != only:
        continue
    build(gid, spec)
