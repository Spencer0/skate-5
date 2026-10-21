import os
MH = os.environ.get('MH_WORK', '/tmp/mh/')  # work dir: sysassets/, orig_*.png, out/
import bpy, os, sys, importlib

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

OUT = sys.argv[-1] if sys.argv[-1].endswith('/') else MH + 'out/'
os.makedirs(OUT, exist_ok=True)

CHARS = {
    'brock': dict(
        macro=dict(gender=1.0, age=0.5, muscle=0.95, weight=0.72, proportions=0.8, height=0.7, cupsize=0.5, firmness=0.5,
                   race=dict(african=0.55, caucasian=0.35, asian=0.1)),
        skin='young_african_male.mhmat',
        assets=[('hair', 'short02.mhclo', 'Hair'), ('clothes', 'male_casualsuit06.mhclo', 'Clothes'), ('clothes', 'shoes06.mhclo', 'Clothes')],
        brows='eyebrow001.mhclo'),
    'coral': dict(
        macro=dict(gender=0.0, age=0.45, muscle=0.62, weight=0.42, proportions=0.75, height=0.45, cupsize=0.45, firmness=0.6,
                   race=dict(african=0.2, caucasian=0.45, asian=0.35)),
        skin='young_asian_female.mhmat',
        assets=[('hair', 'ponytail01.mhclo', 'Hair'), ('clothes', 'female_casualsuit02.mhclo', 'Clothes'), ('clothes', 'shoes05.mhclo', 'Clothes')],
        brows='eyebrow010.mhclo'),
    'voss': dict(
        macro=dict(gender=1.0, age=0.95, muscle=0.3, weight=0.45, proportions=0.4, height=0.42, cupsize=0.5, firmness=0.3,
                   race=dict(african=0.05, caucasian=0.9, asian=0.05)),
        skin='old_caucasian_male.mhmat',
        assets=[('hair', 'bob02.mhclo', 'Hair'), ('clothes', 'male_elegantsuit01.mhclo', 'Clothes'), ('clothes', 'shoes01.mhclo', 'Clothes')],
        brows='eyebrow003.mhclo'),
}

only = os.environ.get('ONLY')
for cid, c in CHARS.items():
    if only and cid != only:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    basemesh = HumanService.create_human(macro_detail_dict=c['macro'])
    HumanService.set_character_skin(AssetService.find_asset_absolute_path(c['skin'], asset_subdir='skins'), basemesh, skin_type='GAMEENGINE')
    HumanService.add_builtin_rig(basemesh, 'game_engine')
    extra = [('eyes', 'low-poly.mhclo', 'Eyes'), ('eyebrows', c['brows'], 'Eyebrows'), ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes')]
    for sub, f, t in extra + c['assets']:
        p = AssetService.find_asset_absolute_path(f, asset_subdir=sub)
        if p is None:
            print('MISSING', f)
            continue
        HumanService.add_mhclo_asset(p, basemesh, asset_type=t, subdiv_levels=0, material_type='GAMEENGINE')
    root = ExportService.create_character_copy(basemesh, name_suffix='_export')
    eb = ObjectService.find_object_of_type_amongst_nearest_relatives(root, 'Basemesh')
    ExportService.bake_modifiers_remove_helpers(eb, bake_masks=True, bake_subdiv=True, remove_helpers=True, also_proxy=True)
    # drop the original character
    keep = {root} | set(ObjectService.get_list_of_children(root))
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    # bake body shape keys into the mesh (the game doesn't morph)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.data.shape_keys:
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
            o.select_set(False)
    # small textures for the web; drop normal maps
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in list(mat.node_tree.nodes):
            if n.type == 'NORMAL_MAP':
                mat.node_tree.nodes.remove(n)
    for img in bpy.data.images:
        n = img.name.lower()
        small = any(k in n for k in ('eye', 'brow', 'lash', 'shoe'))
        tgt = 256 if small else 1024 if ('diffuse' in n and ('suit' in n or 'skin' in n or 'male' in n or 'female' in n)) else 512
        if img.size[0] > tgt:
            img.scale(tgt, tgt)
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
            print('  mesh', o.name, len(o.data.loop_triangles))
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    print(cid, 'tris', tris, 'bones', len(arm.data.bones))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT + cid + '.glb', export_format='GLB', use_selection=True,
                              export_image_format='AUTO', export_jpeg_quality=80, export_morph=False, export_animations=False,
                              export_skins=True, export_apply=False, export_yup=True)
    print('wrote', OUT + cid + '.glb', os.path.getsize(OUT + cid + '.glb'))
