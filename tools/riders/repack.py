import os
MH = os.environ.get('MH_WORK', '/tmp/mh/')  # work dir: sysassets/, orig_*.png, out/
import json, struct, io, sys
from PIL import Image

def repack(src, dst):
    b = open(src, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin_off = 20 + jl + 8
    blob = b[bin_off:bin_off + struct.unpack('<I', b[20 + jl:24 + jl])[0]]
    views = j['bufferViews']
    new_data = {}
    for img in j['images']:
        v = views[img['bufferView']]
        raw = blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        name = img.get('name', '').lower()
        alpha = any(k in name for k in ('hair', 'brow', 'lash', 'ponytail', 'bob', 'short0', 'long', 'braid', 'afro'))
        im = Image.open(io.BytesIO(raw))
        out = io.BytesIO()
        if alpha:
            im.save(out, 'PNG', optimize=True)
        else:
            im.convert('RGB').save(out, 'JPEG', quality=80, optimize=True)
            img['mimeType'] = 'image/jpeg'
        new_data[img['bufferView']] = out.getvalue()
    # rebuild the binary chunk view by view
    parts, off = [], 0
    for i, v in enumerate(views):
        data = new_data.get(i, blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
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

for name in sys.argv[1:]:
    repack(MH + f'out/{name}.glb', os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../public/riders', f'{name}.glb'))
    print(name, 'ok')
