import os
MH = os.environ.get('MH_WORK', '/tmp/mh/')  # work dir: out/
"""Neutralises the custom-character textures so the game can tint them.

Skin, clothes, shoes and hair become greyscale (logos and trims painted out of
the tees), so a material colour multiplied onto the map reads as that colour
with the original cloth / skin / strand detail still on top. Then JPEG (PNG
where there is alpha) and write public/riders/custom_<m|f>.glb.
"""
import json, struct, io, sys
import numpy as np
from PIL import Image, ImageFilter


def lum(a):
    return a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def kind_of(name):
    n = name.lower()
    if 'eye' in n and 'brow' not in n and 'lash' not in n:
        return 'keep'
    if 'lash' in n:
        return 'keep'
    if 'brow' in n or any(k in n for k in ('hair', 'afro', 'bob', 'braid', 'long', 'ponytail', 'short')):
        return 'hair'
    if 'skin' in n:
        return 'skin'
    return 'cloth'


# atlases whose tee carries a logo / orange trim, and how much of the atlas height the tee occupies
TEE_REGION = {'male_casualsuit02': 0.45, 'male_casualsuit04': 0.45, 'male_casualsuit06': 0.43,
              'female_casualsuit01': 0.45, 'female_casualsuit02': 0.42, 'female_sportsuit01': 0.42}


def strip_logo(rgb, lum_, frac):
    H, W = lum_.shape
    y1 = int(H * frac)
    reg = rgb[:y1]
    l = lum_[:y1]
    blue = reg[..., 2].mean() > reg[..., 0].mean()
    m = (reg[..., 0] > reg[..., 2] + 40) & (reg[..., 0] > reg[..., 1] + 10)  # orange
    if blue:
        med = np.median(l[~m])
        sat = reg.max(-1) - reg.min(-1)
        m |= (l > med + 0.14) & (sat < 0.2)  # the pale ring round the logo
    mi = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
    m = np.array(mi) > 0
    base = np.median(l[~m])
    shifted = np.roll(l, (37, 53), axis=(0, 1))
    ms = np.roll(m, (37, 53), axis=(0, 1))
    fill = np.where(ms, base, shifted)
    out = lum_.copy()
    out[:y1] = np.where(m, fill, l)
    return out


def neutral(name, raw):
    im = Image.open(io.BytesIO(raw))
    k = kind_of(name)
    if k == 'keep':
        return im, 'png' if im.mode == 'RGBA' else 'jpg'
    a = np.asarray(im.convert('RGBA'), dtype=np.float32) / 255
    rgb, alpha = a[..., :3], a[..., 3]
    L = lum(rgb)
    base = name.lower().replace('_diffuse', '')
    if base in TEE_REGION:
        L = strip_logo(rgb, L, TEE_REGION[base])
    if k == 'hair':
        solid = alpha > 0.5
        gain = 0.95 / max(0.05, float(np.percentile(L[solid], 75)))
    elif k == 'skin':
        gain = 1.0 / max(0.05, float(np.median(L)))
    else:
        # the flat atlas background must not set the exposure: use the cloth itself
        bg = rgb[0, 0]
        cloth = np.abs(rgb - bg).max(-1) > 0.06
        gain = 0.92 / max(0.05, float(np.median(L[cloth])) if cloth.sum() > 100 else float(np.median(L)))
    g = np.clip(L * gain, 0, 1) ** (1 / 1.0)
    out = np.stack([g, g, g] + ([alpha] if k == 'hair' else []), -1)
    mode = 'RGBA' if k == 'hair' else 'RGB'
    return Image.fromarray((out * 255).astype(np.uint8), mode), 'png' if k == 'hair' else 'jpg'


def repack(src, dst):
    b = open(src, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    blob = b[20 + jl + 8:20 + jl + 8 + struct.unpack('<I', b[20 + jl:24 + jl])[0]]
    views = j['bufferViews']
    new = {}
    for img in j['images']:
        v = views[img['bufferView']]
        raw = blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        im, fmt = neutral(img.get('name', ''), raw)
        out = io.BytesIO()
        if fmt == 'png':
            im.save(out, 'PNG', optimize=True)
            img['mimeType'] = 'image/png'
        else:
            im.convert('RGB').save(out, 'JPEG', quality=82, optimize=True)
            img['mimeType'] = 'image/jpeg'
        new[img['bufferView']] = out.getvalue()
    parts, off = [], 0
    for i, v in enumerate(views):
        data = new.get(i, blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
        pad = (-off) % 4
        parts.append(b'\0' * pad)
        off += pad
        v['byteOffset'] = off
        v['byteLength'] = len(data)
        parts.append(data)
        off += len(data)
    binary = b''.join(parts)
    binary += b'\0' * ((-len(binary)) % 4)
    j['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)


# args: m f (the base models) and/or extras_m extras_f (the themed add-on parts)
for gid in sys.argv[1:]:
    name = gid if '_' in gid else f'custom_{gid}'
    repack(MH + f'out/{name}.glb', os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../public/riders', f'{name}.glb'))
    print(name, 'ok')
