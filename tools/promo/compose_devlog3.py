#!/usr/bin/env python3
"""Cut Dev Log #3 (the special tricks) for TikTok: 1080x1920, voiced, captioned.

usage: compose_devlog3.py <devlog3.mjs frames dir> <voice dir> <out.mp4> [--intro]

- The frames dir holds devlog3.mjs's shots: frames, marks.json (events and each
  frame's game-clock time) and audio.wav (the game's own sound on that clock).
- The voice dir is `tools/story/voices.py --scene devlog3` output (devlog3.mp3/.json).

Each beat is some footage plus one voice line. A beat lasts as long as the
longer of the two: short footage plays on past its end mark when the shot has
frames left, then holds. Captions come up a few words at a time with the
voice; the game's sound runs under it, slowed with the slowed frames.
"""
import json, os, re, subprocess, sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

shots_dir, voice_dir, out = sys.argv[1:4]
# --intro renders only the intro (the hook and the bail), to open other videos with
ONLY_INTRO = '--intro' in sys.argv
FPS, W, H = 30, 1080, 1920
SR = 48000
FONT = '/usr/share/fonts/opentype/inter/Inter-Black.otf'
ORANGE, WHITE, INK, GOLD = (255, 138, 61), (255, 255, 255), (15, 12, 10), (255, 205, 90)

cues = json.load(open(os.path.join(voice_dir, 'devlog3.json')))
LINES = cues['lines']
vo_all, vo_sr = sf.read(os.path.join(voice_dir, 'devlog3.mp3'), dtype='float32')
if vo_all.ndim > 1:
    vo_all = vo_all.mean(axis=1)

_shots = {}


def shot(name):
    if name not in _shots:
        d = os.path.join(shots_dir, name)
        m = json.load(open(os.path.join(d, 'marks.json')))
        wav = os.path.join(d, 'audio.wav')
        # a shot nobody touched never started the game's sound: silence
        a = sf.read(wav, dtype='float32')[0].mean(axis=1) if os.path.exists(wav) else np.zeros(SR, dtype=np.float32)
        _shots[name] = dict(dir=d, n=m['frames'], marks=m['marks'], times=m['times'], audio=a)
    return _shots[name]


def mark(name, k, off):
    s = shot(name)
    return max(1, min(s['n'], s['marks'][k] + off))


# (shot, from mark, offset, to mark, offset[, speed]): frames are 1-based like the files
# The intro (the first two beats) is speed-ramped: the tricks play at full speed, the
# rolling and the slam's aftermath are fast-forwarded, and the laser flip out keeps
# some of its slow motion (recorded at 1/3 speed, played back at 1/2).
INTRO = [
    dict(clips=[('hook', 'flick', -4, 'grind', 4), ('hook', 'grind', 4, 'out', -2, 1.6),
                ('hook', 'out', -2, 'land', 4, 1.45), ('hook', 'land', 4, 'land', 12)], vo=0, at=0.05),
    dict(clips=[('miss', 'flick', -2, 'pop', 0, 1.5), ('miss', 'pop', 0, 'pop', 24, 2.0),
                ('miss', 'pop', 24, 'bail', 4), ('miss', 'bail', 4, 'bail', 24)], vo=1, at=0.1),
]
BEATS = INTRO + [
    dict(card='title', vo=2, at=0.25),
    dict(clips=[('meter', 'kpop', -14, 'star', -1)], vo=3),
    dict(clips=[('meter', 'star', -1, 'land', 24)], vo=4),
    dict(clips=[('bullet', 'star', -10, 'land', 24)], vo=5, label='BULLET TRAIN'),
    # the special that got cut (the old double impossible footage), and what replaced it
    dict(clips=[('aurora', 'star', -10, 'land', 24), ('aurora', 'star', 2, 'land', 2, 0.5)], vo=6),
    # long lines: the trick again from the other angle and slowed, not the roll-away
    dict(clips=[('world', 'star', -10, 'land', 10), ('world', 'star', 2, 'land', 2, 0.33)], vo=7, label='AROUND THE WORLD'),
    dict(clips=[('world2', 'star', -4, 'land', 4, 0.3)], vo=8, label='AROUND THE WORLD'),
    dict(clips=[('world2', 'star', -10, 'land', 6), ('world', 'star', 2, 'land', 2, 0.5), ('world2', 'star', 2, 'land', 10, 0.5)], vo=9),
    dict(clips=[('world', 'star', -10, 'land', 10), ('world2', 'star', 2, 'land', 10, 0.4)], vo=10),
    dict(clips=[('southern', 'star', -10, 'land', 24)], vo=11, label='SOUTHERN CROSS'),
    dict(clips=[('drop', 'star', -10, 'bail', 60)], vo=12),
    dict(clips=[('laser', 'flick', -24, 'land', 25)], vo=13),
    dict(clips=[('mega', 'pop', -26, 'land', 20)], vo=14),
    dict(clips=[('menu', None, 1, None, 20)], vo=15, hold=True),
    dict(card='end', vo=16, at=0.3),
]

# caption text for spoken words that read better as figures
SHOW = {'three-sixty': '360', 'ten-eighty': '1080', 'three.': '#3.'}
HOT = re.compile(r"^(flip|bullet|train|around|world|crazier|unrealistic|polish|impossible|southern|cross|special|meter|star|catch|slam|button|honest|thumbs|free|mobile|harder|skate|four|clean|easy|career|dev|log|#3)$", re.I)


def font(px):
    return ImageFont.truetype(FONT, px)


def text_img(words, size, hot=None):
    """One caption line: white words with a dark outline, hot words in orange."""
    f = font(size)
    gap = int(size * 0.28)
    widths = [f.getlength(w) for w in words]
    total = sum(widths) + gap * (len(words) - 1)
    pad = int(size * 0.4)
    img = Image.new('RGBA', (int(total) + pad * 2, int(size * 1.6)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x, y = pad, int(size * 0.2)
    for i, w in enumerate(words):
        col = ORANGE if (hot or (lambda s: HOT.match(re.sub(r'[^\w#]', '', s))))(w) else WHITE
        d.text((x, y + size * 0.07), w, font=f, fill=(0, 0, 0, 140), stroke_width=int(size * 0.12), stroke_fill=(0, 0, 0, 140))
        d.text((x, y), w, font=f, fill=col, stroke_width=int(size * 0.11), stroke_fill=INK + (255,))
        x += widths[i] + gap
    return img


def chunks(words):
    """Split a line's words into caption chunks: up to 3 words, breaking after punctuation."""
    out, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) == 3 or w['w'][-1] in '.,?!' or (len(cur) == 2 and len(w['w']) > 9):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def shown(w):
    return SHOW.get(w.lower(), w)


# --- timeline ---------------------------------------------------------------
def clip_frames(c):
    """The frame numbers a clip plays (speed < 1 repeats frames)."""
    name, ka, oa, kb, ob = c[:5]
    speed = c[5] if len(c) > 5 else 1.0
    s = shot(name)
    a = mark(name, ka, oa) if ka else oa
    b = mark(name, kb, ob) if kb else min(s['n'], ob)
    # speed > 1 skips frames (a fast-forward), < 1 repeats them
    n = int(round((b - a + 1) / speed))
    return [(name, a + i * speed) for i in range(n)]


if ONLY_INTRO:
    BEATS = INTRO
timeline = []  # per video frame: ('shot', name, fractional frame) | ('card', kind, beat index)
voice = []  # (line index, start s)
caps = []  # (words, t0, t1)
labels = []  # (text, t0, t1)
beat_at = {}  # voice line -> (t0, t1) of its beat
for bi, B in enumerate(BEATS):
    t0 = len(timeline) / FPS
    L = LINES[B['vo']]
    vdur = L['t1'] - L['t0']
    at = B.get('at', 0.15)
    need = int(np.ceil((at + vdur + 0.35) * FPS))
    if 'card' in B:
        frames = [('card', B['card'], i) for i in range(max(need, int(1.6 * FPS)))]
    else:
        frames = []
        for c in B['clips']:
            frames += [('shot', n, f) for n, f in clip_frames(c)]
        # too short for its line: run on past the end mark, then hold the last frame
        last = B['clips'][-1]
        s = shot(last[0])
        f = frames[-1][2]
        while len(frames) < need:
            f = min(s['n'], f + 1) if not B.get('hold') else f
            frames.append(('shot', last[0], f))
    timeline += frames
    beat_at[B['vo']] = (t0, len(timeline) / FPS)
    va = t0 + at
    voice.append((B['vo'], va))
    if B.get('label'):
        labels.append((B['label'], t0 + 0.05, t0 + len(frames) / FPS - 0.1))
    if B['vo'] == 2:
        continue  # the title card spells it out
    words = L['words']
    for ch in chunks(words):
        caps.append(([shown(w['w']) for w in ch], va + ch[0]['t0'] - L['t0'], va + ch[-1]['t1'] - L['t0']))
# each caption holds until the next one comes up (or 0.4 s after its last word)
for i in range(len(caps)):
    nxt = caps[i + 1][1] if i + 1 < len(caps) else 1e9
    caps[i] = (caps[i][0], caps[i][1], min(nxt, caps[i][2] + 0.4))
total = len(timeline) / FPS
print(f'{len(timeline)} frames, {total:.2f}s')

# --- cards -------------------------------------------------------------------
def frame_path(name, f):
    return os.path.join(shot(name)['dir'], f'f{int(round(f)):05d}.jpg')


def blurred(name, f):
    img = Image.open(frame_path(name, f)).convert('RGB').resize((W, H)).filter(ImageFilter.GaussianBlur(30))
    return Image.blend(img, Image.new('RGB', (W, H), (12, 10, 9)), 0.5)


def center(img, layer, y):
    img.alpha_composite(layer, (int((W - layer.width) / 2), int(y)))


TITLE_BG = blurred('meter', mark('meter', 'star', 4)).convert('RGBA')
END_BG = blurred('hook', mark('hook', 'land', 10)).convert('RGBA')


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def card(kind, i):
    t = i / FPS
    img = (TITLE_BG if kind == 'title' else END_BG).copy()
    if kind == 'title':
        for txt, px, col, y, d in (('DEV LOG', 150, WHITE, 640, 0.0), ('#3', 300, ORANGE, 800, 0.12), ('★ SPECIAL TRICKS ★', 84, GOLD, 1170, 0.5)):
            k = ease((t - d) / 0.25)
            if k <= 0:
                continue
            layer = text_img([txt], int(px * (1.25 - 0.25 * k)), hot=lambda w: False)
            layer = recolor(layer, col)
            center(img, layer, y - (layer.height - px * 1.6) / 2)
    else:
        for txt, px, col, y, d in (('SKATE NATIONS', 112, ORANGE, 610, 0.0), ('Free to play on mobile', 70, WHITE, 800, 0.25), ('Link in bio & comments', 70, GOLD, 900, 0.5)):
            k = ease((t - d) / 0.25)
            if k <= 0:
                continue
            layer = recolor(text_img([txt], int(px * (1.2 - 0.2 * k)), hot=lambda w: False), col)
            center(img, layer, y - (layer.height - px * 1.6) / 2)
    return img


def recolor(layer, col):
    """Swap the white fill of a text_img for `col`, keeping the outline."""
    a = np.asarray(layer).copy()
    white = (a[..., 0] > 200) & (a[..., 1] > 200) & (a[..., 2] > 200)
    a[white, 0], a[white, 1], a[white, 2] = col
    return Image.fromarray(a)


# --- frames ------------------------------------------------------------------
cap_cache = {}


def caption_layer(words, scale):
    key = (tuple(words), round(scale, 2))
    if key not in cap_cache:
        cap_cache[key] = text_img(words, int(96 * scale))
        if cap_cache[key].width > W - 40:
            r = (W - 40) / cap_cache[key].width
            cap_cache[key] = cap_cache[key].resize((int(cap_cache[key].width * r), int(cap_cache[key].height * r)), Image.LANCZOS)
    return cap_cache[key]


label_cache = {}
work = os.path.join(os.path.dirname(os.path.abspath(out)), 'devlog3-work')
os.makedirs(work, exist_ok=True)
silent = os.path.join(work, 'video.mp4')
enc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', silent], stdin=subprocess.PIPE)
img_cache = {}
for vi, (kind, a, b) in enumerate(timeline):
    t = vi / FPS
    if kind == 'card':
        img = card(a, b)
    else:
        p = frame_path(a, b)
        if p not in img_cache:
            img_cache.clear()
            img_cache[p] = Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS).convert('RGBA')
        img = img_cache[p].copy()
    for txt, l0, l1 in labels:
        if l0 <= t < l1:
            if txt not in label_cache:
                label_cache[txt] = recolor(text_img([txt], 64, hot=lambda w: False), GOLD)
            center(img, label_cache[txt], 300)
    # "your special meter fills up": ring the meter at the top of the HUD
    m0, m1 = beat_at.get(3, (-1, -1))
    if m0 <= t < m1:
        d = ImageDraw.Draw(img)
        k = 0.5 + 0.5 * np.sin((t - m0) * 7)
        d.rounded_rectangle((424, 2, 656, 56), radius=28, outline=ORANGE + (int(160 + 95 * k),), width=7)
        if 'meter' not in label_cache:
            label_cache['meter'] = recolor(text_img(['SPECIAL', 'METER'], 46, hot=lambda w: False), GOLD)
        center(img, label_cache['meter'], 62)
    for words, c0, c1 in caps:
        if c0 <= t < c1:
            # pop in: a touch big, settling over three frames
            k = (t - c0) * FPS
            sc = 1.14 if k < 1 else 1.06 if k < 2 else 1.0
            layer = caption_layer(words, sc)
            center(img, layer, H * 0.64 - layer.height / 2)
    enc.stdin.write(img.convert('RGB').tobytes())
    if vi % 150 == 0:
        print(f'  frame {vi}/{len(timeline)}', flush=True)
enc.stdin.close()
enc.wait()

# --- audio -------------------------------------------------------------------
n = int(total * SR) + 1
game = np.zeros(n, dtype=np.float32)
tv = np.arange(n) / SR
# per video frame, the game-clock time it shows; held frames go quiet
gt = np.full(len(timeline) + 1, np.nan)
src = [None] * (len(timeline) + 1)
for vi, (kind, a, b) in enumerate(timeline):
    if kind == 'shot':
        s = shot(a)
        times = s['times']
        lo, hi = int(np.floor(b)), int(np.ceil(b))
        ta, tb = times[lo], times[hi] if hi < len(times) and times[hi] is not None else times[lo]
        gt[vi] = ta + (tb - ta) * (b - lo)
        src[vi] = a
        if vi > 0 and src[vi - 1] == a and gt[vi] == gt[vi - 1]:
            gt[vi] = np.nan  # a hold
for vi in range(len(timeline)):
    if src[vi] is None or np.isnan(gt[vi]):
        continue
    nxt = gt[vi + 1] if vi + 1 < len(timeline) and src[vi + 1] == src[vi] and not np.isnan(gt[vi + 1]) else gt[vi] + 1 / FPS
    i0, i1 = int(vi / FPS * SR), min(n, int((vi + 1) / FPS * SR))
    tg = np.linspace(gt[vi], nxt, i1 - i0, endpoint=False)
    au = shot(src[vi])['audio']
    game[i0:i1] = np.interp(tg * SR, np.arange(len(au)), au)
# soften the joins between clips
edges = [vi for vi in range(1, len(timeline)) if src[vi] != src[vi - 1] or (src[vi] and abs((gt[vi] if not np.isnan(gt[vi]) else 0) - (gt[vi - 1] if not np.isnan(gt[vi - 1]) else 0)) > 0.2)]
for vi in edges:
    c = int(vi / FPS * SR)
    r = int(0.03 * SR)
    lo, hi = max(0, c - r), min(n, c + r)
    game[lo:hi] *= np.abs(np.linspace(-1, 1, hi - lo))

vo = np.zeros(n, dtype=np.float32)
if vo_sr != SR:
    vo_all = np.interp(np.arange(0, len(vo_all), vo_sr / SR), np.arange(len(vo_all)), vo_all).astype(np.float32)
for li, at in voice:
    L = LINES[li]
    seg = vo_all[int(L['t0'] * SR):int((L['t1'] + 0.08) * SR)]
    i0 = int(at * SR)
    m = min(len(seg), n - i0)
    vo[i0:i0 + m] += seg[:m]
# the game ducks under the voice
env = np.convolve((np.abs(vo) > 0.02).astype(np.float32), np.ones(int(0.25 * SR)) / int(0.25 * SR), mode='same')
duck = 1.0 - 0.7 * np.clip(env * 4, 0, 1)
mix = vo * 1.0 + game * duck
wav = os.path.join(work, 'mix.wav')
sf.write(wav, np.stack([mix, mix], axis=1), SR)
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', silent, '-i', wav, '-af', 'loudnorm=I=-14:TP=-1:LRA=9', '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out], check=True)
print('wrote', out, f'{total:.2f}s')
