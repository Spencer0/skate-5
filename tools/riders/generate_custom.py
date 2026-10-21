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
# PACK=extras builds the themed add-on parts (OPT['extras']) as extras_<m|f>.glb: just their
# meshes on the same skeleton, loaded on demand by the game
PACK = os.environ.get('PACK', 'base')
SRC = OPT if PACK == 'base' else OPT['extras']
HAIR, HATS, TOPS, BOTTOMS, SHOES = (SRC.get(k, []) for k in ('hair', 'hats', 'tops', 'bottoms', 'shoes'))
FILE = 'custom' if PACK == 'base' else 'extras'
srcname = lambda it: it.get('src', it['id'])
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


def push_out(o):
    """Nudge a whole garment out along its normals (see CLOTH_OFFSET)."""
    b = bmesh.new()
    b.from_mesh(o.data)
    b.normal_update()
    for v in b.verts:
        v.co += v.normal * CLOTH_OFFSET
    b.to_mesh(o.data)
    b.free()


def make_hat(kind, body, arm):
    """A hat MakeHuman doesn't ship, revolved around the head and skinned to the head bone.
    Sized from this body's own skull, so it sits right on both bodies."""
    import math
    hz = (arm.matrix_world @ arm.data.bones['head'].head_local).z
    head = [p for p in (body.matrix_world @ v.co for v in body.data.vertices) if p.z > hz]
    xs, ys, zs = [p.x for p in head], [p.y for p in head], [p.z for p in head]
    cx, cy, top = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2 - 0.012, max(zs)  # a touch forward of the skull's middle
    rx, ry = (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2
    N = 48
    prof = []  # (radius relative to the crown, height above the hat's base, ring kind)
    if kind == 'party':
        base, H = top - 0.05, 0.24
        sx, sy = 0.62 * rx, 0.62 * ry
        prof = [(1 - i / 10, H * i / 10) for i in range(11)]
        def place(r, z, a):
            t = z / H
            return cx + r * math.cos(a) * sx, cy + r * math.sin(a) * sy + 0.04 * t * t, base + z
    else:  # cowboy
        base, H = top - 0.085, 0.135
        sx, sy = 1.12 * rx, 1.12 * ry
        prof += [(2.25 - i / 8 * 1.25, 0.0) for i in range(9)]  # brim, outside in
        prof += [(1.0 - 0.2 * i / 8, H * i / 8) for i in range(1, 9)]  # crown wall, tapering up
        prof += [(0.8 * (1 - i / 5), H) for i in range(1, 6)]  # top, to the centre
        def place(r, z, a):
            x, y = r * math.cos(a), r * math.sin(a)
            if z == 0.0 and r > 1.0:  # brim: curled up at the sides, dipping front and back
                t = r - 1.0
                z += 0.07 * t * t * math.cos(a) ** 2 - 0.012 * t * t * math.sin(a) ** 2
            # the crease along the top, front to back
            z -= 0.045 * math.exp(-(x / 0.3) ** 2) * (z / H) ** 2 if z > 0 else 0
            return cx + x * sx, cy + y * sy, base + z
    verts = [place(r, z, 2 * math.pi * k / N) for (r, z) in prof for k in range(N)]
    faces = []
    for i in range(len(prof) - 1):
        for k in range(N):
            a, b = i * N + k, i * N + (k + 1) % N
            faces.append((a, b, b + N, a + N))
    inv = body.matrix_world.inverted()
    mesh = bpy.data.meshes.new('hat_' + kind)
    mesh.from_pydata([tuple(inv @ __import__('mathutils').Vector(v)) for v in verts], [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh)
    bm.free()
    for f in mesh.polygons:
        f.use_smooth = True
    o = bpy.data.objects.new('hat_' + kind, mesh)
    bpy.context.scene.collection.objects.link(o)
    o.parent = arm
    o.matrix_parent_inverse = body.matrix_parent_inverse.copy()
    o.matrix_basis = body.matrix_basis.copy()
    o.modifiers.new('Armature', 'ARMATURE').object = arm
    o.vertex_groups.new(name='head').add(list(range(len(mesh.vertices))), 1.0, 'REPLACE')
    mat = bpy.data.materials.new('hat')
    mat.use_nodes = True
    mat.use_backface_culling = False
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    mesh.materials.append(mat)
    return o


TargetService = dyn('mpfb.services.targetservice', 'TargetService')


def variants():
    """(shape key name, macro overrides, detail targets) for every slider end."""
    out = []
    for sh in OPT['shape']:
        for end, val in (('lo', 0.0), ('hi', 1.0)):
            macro = {sh['macro']: val} if 'macro' in sh else {}
            out.append((f"{sh['id']}-{end}", macro, sh.get('details', {}).get(end, [])))
    return out


def build(gid, spec, macro=None, details=(), export=True, morphs=None):
    """Build one body with every option fitted. With export=False (a shape variant) return
    {part: vertex coordinates} instead of writing the GLB."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    basemesh = HumanService.create_human(macro_detail_dict={**spec['macro'], **(macro or {})})
    for t in details:
        TargetService.load_target(basemesh, TargetService.target_full_path(t), weight=1.0)
    HumanService.set_character_skin(AssetService.find_asset_absolute_path(spec['skin'], asset_subdir='skins'), basemesh, skin_type='GAMEENGINE')
    HumanService.add_builtin_rig(basemesh, 'game_engine')
    if PACK == 'base':
        asset('eyes', 'low-poly', 'Eyes', basemesh)
        asset('eyebrows', 'eyebrow001', 'Eyebrows', basemesh)
        asset('eyelashes', 'eyelashes01', 'Eyelashes', basemesh)
    for h in HAIR:
        asset('hair', h['id'], 'Hair', basemesh)
    for h in HATS + SHOES + [o for o in TOPS + BOTTOMS if o.get('single')]:
        if 'proc' not in h:
            asset('clothes', srcname(h), 'Clothes', basemesh)
    srcs = sorted({o['src'] for o in TOPS + BOTTOMS if not o.get('single')})
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
    if PACK == 'base':
        rename(meshes.pop('low-poly'), 'eyes')
        rename(meshes.pop('eyebrow001'), 'brows')
        rename(meshes.pop('eyelashes01'), 'lashes')
    for h in HAIR:
        rename(meshes.pop(h['id']), 'hair_' + h['id'])
    arm = body.parent
    for h in HATS:
        rename(make_hat(h['proc'], body, arm) if 'proc' in h else meshes.pop(srcname(h)), 'hat_' + h['id'])
    for s in SHOES:
        rename(meshes.pop(srcname(s)), 'shoes_' + s['id'])
    parts = {s: split_suit(meshes[s], zmin, height) for s in srcs}
    for kind, items in (('top', TOPS), ('bottom', BOTTOMS)):
        for it in items:
            if it.get('single'):
                o = meshes.pop(it['src'])
                push_out(o)
                rename(o, f"{kind}_{it['id']}")
                continue
            o = parts[it['src']].get(kind)
            if o is None:
                raise SystemExit(f"{it['src']} has no {kind}")
            # a source used twice (e.g. top + bottom of one suit) needs separate objects
            rename(o, f"{kind}_{it['id']}")
    # drop the whole suits and any split part nobody asked for
    wanted = {f"top_{i['id']}" for i in TOPS} | {f"bottom_{i['id']}" for i in BOTTOMS}
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
    if not export:
        import numpy as np
        out = {}
        for o in bpy.data.objects:
            if o.type == 'MESH' and (o.name == 'body' or o.name.startswith(('top_', 'bottom_'))):
                a = np.empty(len(o.data.vertices) * 3, dtype=np.float32)
                o.data.vertices.foreach_get('co', a)
                out[o.name] = a
        return out
    for key, coords in (morphs or {}).items():
        for name, a in coords.items():
            o = bpy.data.objects[name]
            if o.data.shape_keys is None:
                o.shape_key_add(name='Basis')
            if len(o.data.vertices) * 3 != len(a):
                raise SystemExit(f'{name}: vertex count differs in {key}')
            k = o.shape_key_add(name=key)
            k.data.foreach_set('co', a)
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
            print('  mesh', o.name, len(o.data.loop_triangles))
    print(gid, 'tris', tris)
    bpy.ops.object.select_all(action='SELECT')
    if PACK != 'base':
        # the body only existed to fit the garments; the game already has it
        for o in list(bpy.data.objects):
            if o.type == 'MESH' and not o.name.startswith(('top_', 'bottom_', 'shoes_', 'hat_')):
                bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='SELECT')
    path = OUT + f'{FILE}_{gid}.glb'
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_image_format='AUTO',
                              export_jpeg_quality=80, export_morph=True, export_morph_normal=False, export_animations=False, export_skins=True,
                              export_apply=False, export_yup=True)
    print('wrote', path, os.path.getsize(path))


only = os.environ.get('ONLY')
for gid, spec in BODIES.items():
    if only and gid != only:
        continue
    morphs = {}
    for key, macro, details in ([] if os.environ.get('QUICK') else variants()):
        morphs[key] = build(gid, spec, macro, details, export=False)
        print('variant', gid, key, flush=True)
    build(gid, spec, morphs=morphs)
