import os
MH = os.environ.get('MH_WORK', '/tmp/mh/')  # work dir: sysassets/, orig_*.png, out/
from PIL import Image, ImageDraw, ImageFilter
import math
base=MH + 'sysassets/clothes/'

def globe(img, cx, cy, R, col):
    """The Atlas Skateboards globe: ring, two meridian ellipses, the axis and three parallels."""
    d = ImageDraw.Draw(img)
    w = max(2, int(R * 0.12))
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=col, width=w)
    w2 = max(2, int(R * 0.08))
    for k in (0.38, 0.75):
        d.ellipse([cx - R * k, cy - R, cx + R * k, cy + R], outline=col, width=w2)
    d.line([(cx, cy - R), (cx, cy + R)], fill=col, width=w2)
    for t in (-0.5, 0, 0.5):
        y = cy + t * R
        hw = math.sqrt(R * R - (t * R) ** 2)
        d.line([(cx - hw, y), (cx + hw, y)], fill=col, width=w2)

def tint_region(img, box, color, keep=lambda p: False, lo=0.55, hi=1.08):
    """Recolor pixels in box to `color`, keeping only their shading (wipes logos)."""
    px = img.load()
    x0,y0,x1,y1 = box
    # luminance normalised against the region's median-ish brightness
    for y in range(y0,y1):
        for x in range(x0,x1):
            r,g,b = px[x,y][:3]
            if keep((r,g,b)): continue
            l = (0.3*r+0.59*g+0.11*b)/255
            s = max(lo, min(hi, 0.35 + l*0.75))
            px[x,y] = (int(min(255,color[0]*s)), int(min(255,color[1]*s)), int(min(255,color[2]*s)))

bg = lambda p: abs(p[0]-p[1])<6 and abs(p[1]-p[2])<6 and 200<p[0]<225  # flat grey atlas background

# Brock: white tee -> clay, Atlas globe on the chest
im = Image.open(MH + 'orig_m6.png').convert('RGB')
W,H = im.size
tint_region(im, (0,0,W,int(H*0.43)), (222,122,90), lo=0.9, hi=1.05)
globe(im, int(W*0.255), int(H*0.13), int(W*0.0425), (250,246,236))
im.save(base+'male_casualsuit06/male_casualsuit06_diffuse.png')

# Coral: blue tee -> teal, keep the shorts denim
im = Image.open(MH + 'orig_f2.png').convert('RGB')
W,H = im.size
tint_region(im, (0,0,W,int(H*0.397)), (70,180,170), lo=0.75, hi=1.15)
tint_region(im, (int(W*0.725),int(H*0.57),W,int(H*0.88)), (70,180,170), lo=0.4, hi=1.3)  # sleeves
globe(im, int(W*0.79), int(H*0.2), int(W*0.0425), (250,246,236))
im.save(base+'female_casualsuit02/female_casualsuit02_diffuse.png')

# Voss: dark suit jacket -> lab coat white (top 46%, leave the shirt/tie strip alone)
im = Image.open(MH + 'orig_el.png').convert('RGB')
W,H = im.size
shirt = (int(W*0.33), 0, int(W*0.52), int(H*0.3))
px = im.load()
for y in range(0, int(H*0.47)):
    for x in range(W):
        if shirt[0] <= x < shirt[2] and y < shirt[3]:
            r,g,b = px[x,y]
            if (r+g+b)/3 > 120 or b > r + 12: continue  # shirt + tie
        if x > W*0.68 and y > H*0.42: continue
        r,g,b = px[x,y]
        l = (r+g+b)/3/255
        if l < 0.35:
            s = 0.78 + l*0.6
            px[x,y] = (int(240*s), int(238*s), int(232*s))
# second sleeve sits under the shoe patch, bottom right
for y in range(int(H*0.715), H):
    for x in range(int(W*0.715), W):
        r,g,b = px[x,y]
        l = (r+g+b)/3/255
        if l < 0.35:
            s = 0.78 + l*0.6
            px[x,y] = (int(240*s), int(238*s), int(232*s))
im.save(base+'male_elegantsuit01/male_elegantsuit01_diffuse.png')
print('ok')
