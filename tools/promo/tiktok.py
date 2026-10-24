#!/usr/bin/env python3
"""Cut the TikTok post: a voiced gameplay intro, the Plaza cutscene, an end card.

usage: tiktok.py <record.mjs frames dir> <promo voice dir> <cutscene.mp4> <out.mp4>

- The frames dir holds the `grind` and `flick` shots from record.mjs (the
  flick one slowed, the trick pad on screen).
- The voice dir is tools/story/voices.py --scene promo output (promo.mp3/.json).
- The cutscene is the preview.mjs AUDIO=1 render of the Plaza cold open; its
  last TAIL seconds (the loop back to the first frame) are cut, since the end
  card follows instead.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

frames_dir, voice_dir, cutscene, out = sys.argv[1:5]
work = os.path.join(os.path.dirname(os.path.abspath(out)), 'tiktok-work')
os.makedirs(work, exist_ok=True)
FPS, W, H = 30, 1080, 1920
FONT = '/usr/share/fonts/opentype/inter/Inter-Black.otf'
ORANGE, WHITE, INK = (255, 138, 61), (255, 255, 255), (15, 12, 10)
# the cold open's loop tail (src/filmthis.ts TAIL)
TAIL = 0.6
END = 2.6

def marks(n):
    return json.load(open(os.path.join(frames_dir, n, 'marks.json')))['marks']

G, K = marks('grind'), marks('flick')
# (shot, first frame, last frame): the kickflip into the boardslide down the rail; the slowed flick to the landing
SHOTS = [('grind', G['flick'] - 4, G['grind'] + 40), ('flick', K['flick'] - 4, K['land'] - 4)]
cues = json.load(open(os.path.join(voice_dir, 'promo.json')))
# each line: which shot it plays over, and the caption chunks (word count, highlighted word indices)
LINES = [(0, [(2, []), (3, [2]), (3, [2])]), (1, [(3, [2]), (3, [])])]

def font(px):
    return ImageFont.truetype(FONT, px)

def caption_png(words, hi, path, scale=1.0):
    size = int(100 * scale)
    f = font(size)
    gap = int(size * 0.28)
    widths = [f.getlength(w) for w in words]
    total = sum(widths) + gap * (len(words) - 1)
    img = Image.new('RGBA', (W, 360), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = (W - total) / 2
    y = 360 / 2 - size * 0.62
    for i, w in enumerate(words):
        col = ORANGE if i in hi else WHITE
        d.text((x, y + size * 0.07), w, font=f, fill=(0, 0, 0, 150), stroke_width=int(size * 0.12), stroke_fill=(0, 0, 0, 150))
        d.text((x, y), w, font=f, fill=col, stroke_width=int(size * 0.11), stroke_fill=INK + (255,))
        x += widths[i] + gap
    img.save(path)

def endcard_png(bg, path):
    # the cutscene's last frame, blurred and dimmed, under the call to action
    img = Image.open(bg).convert('RGB').resize((W, H)).filter(ImageFilter.GaussianBlur(28))
    img = Image.blend(img, Image.new('RGB', (W, H), (12, 10, 9)), 0.55)
    d = ImageDraw.Draw(img)
    for txt, px, col, y in (('SKATE NATION', 128, ORANGE, 700), ('Play for Free', 92, WHITE, 900), ('Link in comments', 58, WHITE, 1060)):
        f = font(px)
        x = (W - f.getlength(txt)) / 2
        d.text((x, y), txt, font=f, fill=col, stroke_width=int(px * 0.09), stroke_fill=INK)
    img.save(path)

# --- timeline -----------------------------------------------------------
t = 0.0
shot_t0 = []
for name, a, b in SHOTS:
    shot_t0.append(t)
    t += (b - a) / FPS
intro = t
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', cutscene], capture_output=True, text=True).stdout)
body = dur - TAIL
total = intro + body + END
print(f'intro {intro:.2f}s + cutscene {body:.2f}s + end {END}s = {total:.2f}s')

# the voice: each line moved to start just after its shot does
voice_at = []
overlays = []
for k, (shot, chunks) in enumerate(LINES):
    L = cues['lines'][k]
    at = shot_t0[shot] + 0.12
    voice_at.append((L['t0'], L['t1'], at))
    words = L['words']
    i = 0
    for n, hi in chunks:
        ws = words[i:i + n]
        a = at + (ws[0]['t0'] - L['t0'])
        b = at + (ws[-1]['t1'] - L['t0']) + (0.15 if i + n >= len(words) else 0)
        overlays.append(([w['w'] for w in ws], hi, a, b))
        i += n
# chunks run back to back: each holds until the next pops
for j in range(len(overlays) - 1):
    if overlays[j + 1][2] - overlays[j][3] < 0.25:
        overlays[j] = overlays[j][:3] + (overlays[j + 1][2],)

pngs = []
for i, (words, hi, a, b) in enumerate(overlays):
    for j, sc in enumerate((1.14, 1.06, 1.0)):
        p = os.path.join(work, f'cap{i}_{j}.png')
        caption_png(words, hi, p, sc)
        pngs.append((p, a + (0 if j == 0 else 2 * j / FPS), (a + 2 * (j + 1) / FPS) if j < 2 else b))
last = os.path.join(work, 'last.jpg')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-sseof', f'-{TAIL + 0.1}', '-i', cutscene, '-frames:v', '1', last], check=True)
end_png = os.path.join(work, 'end.png')
endcard_png(last, end_png)

# --- video ----------------------------------------------------------------
cmd = ['ffmpeg', '-y', '-v', 'error']
for name, a, b in SHOTS:
    cmd += ['-framerate', str(FPS), '-start_number', str(a + 1), '-i', os.path.join(frames_dir, name, 'f%05d.jpg')]
cmd += ['-i', cutscene]
cmd += ['-loop', '1', '-framerate', str(FPS), '-t', str(END), '-i', end_png]
cmd += ['-i', os.path.join(voice_dir, 'promo.mp3')]
n0 = len(SHOTS)
vf = ''
for i, (name, a, b) in enumerate(SHOTS):
    vf += f'[{i}:v]trim=end_frame={b - a},setpts=PTS-STARTPTS,scale={W}:{H},fps={FPS},format=yuv420p,setsar=1[v{i}];'
vf += f'[{n0}:v]trim=end={body},setpts=PTS-STARTPTS,scale={W}:{H},fps={FPS},format=yuv420p,setsar=1[vc];'
vf += f'[{n0 + 1}:v]scale={W}:{H},fps={FPS},format=yuv420p,setsar=1[ve];'
vf += ''.join(f'[v{i}]' for i in range(n0)) + f'[vc][ve]concat=n={n0 + 2}:v=1:a=0[base];'
base = len(SHOTS) + 3
for i, (p, a, b) in enumerate(pngs):
    cmd += ['-i', p]
prev = 'base'
for i, (p, a, b) in enumerate(pngs):
    tag = f'o{i}'
    vf += f'[{prev}][{base + i}:v]overlay=0:{int(H * 0.66)}:enable=\'between(t,{a:.3f},{b:.3f})\'[{tag}];'
    prev = tag
# audio: the intro lines, the cutscene's own track, silence under the end card
v = n0 + 2
for k, (l0, l1, at) in enumerate(voice_at):
    vf += f'[{v}:a]atrim={l0}:{l1 + 0.05},asetpts=PTS-STARTPTS,adelay={int(at * 1000)}|{int(at * 1000)},apad=whole_dur={total}[va{k}];'
vf += f'[{n0}:a]atrim=end={body},asetpts=PTS-STARTPTS,afade=t=out:st={body - 0.25}:d=0.25,adelay={int(intro * 1000)}|{int(intro * 1000)},apad=whole_dur={total}[ca];'
vf += ''.join(f'[va{k}]' for k in range(len(voice_at))) + f'[ca]amix=inputs={len(voice_at) + 1}:normalize=0,loudnorm=I=-14:TP=-1:LRA=9[aout]'
cmd += ['-filter_complex', vf, '-map', f'[{prev}]', '-map', '[aout]', '-t', str(total), '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out]
subprocess.run(cmd, check=True)
print('wrote', out)
