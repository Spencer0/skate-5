#!/usr/bin/env python3
"""Cut the recorded shots into the TikTok promo: AI voice + burned-in captions.

usage: compose.py <frames dir from record.mjs> <voice model .onnx> <out.mp4>
"""
import json, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from piper import PiperVoice, SynthesisConfig

frames_dir, model, out = sys.argv[1:4]
work = os.path.join(os.path.dirname(os.path.abspath(out)), 'work')
os.makedirs(work, exist_ok=True)
FPS, W, H = 30, 1080, 1920
FONT = '/usr/share/fonts/opentype/inter/Inter-Black.otf'
ORANGE, WHITE = (255, 138, 61), (255, 255, 255)

# each shot: which frames to keep, when the voice starts (s into the shot), what is said
def marks(n):
    return json.load(open(os.path.join(frames_dir, n, 'marks.json')))

M = {n: marks(n) for n in ('grind', 'laser', 'mega', 'bail')}
SHOTS = [
    dict(name='grind', a=4, b=128, voice=0.15,
         text='I build a skate game... can you do a sick line?',
         chunks=[('I build', []), ('a skate game...', [1, 2]), ('can you do', []), ('a sick line?', [1])]),
    dict(name='laser', a=14, b=118, voice=0.15,
         text='Use thumbs to flick tricks.',
         chunks=[('Use thumbs', [1]), ('to flick tricks', [1, 2])]),
    dict(name='mega', a=8, b=132,
         voice=(M['mega']['marks']['grab'] - 8) / FPS - 0.95,
         text='Tap the board to grab.',
         chunks=[('Tap the board', [2]), ('to grab', [1])]),
    dict(name='bail', a=18, b=M['bail']['marks']['bail'] + 58,
         voice=(M['bail']['marks']['bail'] - 18) / FPS - 1.05,
         text="Don't forget to land it.",
         chunks=[("Don't forget", []), ('to land it', [1])]),
]

voice = PiperVoice.load(model)
cfg = SynthesisConfig(length_scale=0.9)

def speak(text, path):
    with wave.open(path, 'wb') as w:
        voice.synthesize_wav(text, w, syn_config=cfg)

def speech_span(path):
    with wave.open(path) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float)
    idx = np.where(np.abs(x) > 600)[0]
    return sr, idx[0] / sr, idx[-1] / sr, len(x) / sr

def font(px):
    return ImageFont.truetype(FONT, px)

def caption_png(words, hi, path, scale=1.0):
    size = int(104 * scale)
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
        d.text((x + 0, y + size * 0.07), w, font=f, fill=(0, 0, 0, 150), stroke_width=int(size * 0.12), stroke_fill=(0, 0, 0, 150))
        d.text((x, y), w, font=f, fill=col, stroke_width=int(size * 0.11), stroke_fill=(15, 12, 10, 255))
        x += widths[i] + gap
    img.save(path)

def endcard_png(path):
    img = Image.new('RGBA', (W, 560), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for txt, px, col, y in (('SKATE NATIONS', 112, ORANGE, 60), ('free in your browser · link in bio', 50, WHITE, 250)):
        f = font(px)
        x = (W - f.getlength(txt)) / 2
        d.text((x, y), txt, font=f, fill=col, stroke_width=int(px * 0.1), stroke_fill=(15, 12, 10, 255))
    img.save(path)

# --- timeline -----------------------------------------------------------
t = 0.0
inputs, vf, audio = [], [], []
overlays = []  # (png, start, end, y)
clip_t0 = []
for k, s in enumerate(SHOTS):
    n = s['b'] - s['a']
    s['t0'], s['n'] = t, n
    wav = os.path.join(work, f'line{k}.wav')
    speak(s['text'], wav)
    sr, v0, v1, dur = speech_span(wav)
    s['wav'] = wav
    start = max(0.0, s['voice'])
    s['v0'] = v0  # leading silence in the wav, trimmed by the delay
    # spread the chunks over the spoken span by letter count
    wts = [len(c[0].replace(' ', '')) + 2 for c in s['chunks']]
    cur = t + start
    span = v1 - v0
    for (txt, hi), w in zip(s['chunks'], wts):
        d = span * w / sum(wts)
        overlays.append((txt.split(' '), hi, cur, cur + d + (0.12 if (txt, hi) == s['chunks'][-1] else 0)))
        cur += d
    t += n / FPS
total = t
print('total', total, 's')

# video: concat of the shot frame sequences
cmd = ['ffmpeg', '-y', '-v', 'error']
for s in SHOTS:
    cmd += ['-framerate', str(FPS), '-start_number', str(s['a'] + 1), '-i', os.path.join(frames_dir, s['name'], 'f%05d.jpg')]
trims = ''.join(f'[{i}:v]trim=end_frame={s["n"]},setpts=PTS-STARTPTS,scale={W}:{H},fps={FPS},format=yuv420p[v{i}];' for i, s in enumerate(SHOTS))
chain = ''.join(f'[v{i}]' for i in range(len(SHOTS))) + f'concat=n={len(SHOTS)}:v=1:a=0[base];'

# captions with a quick pop-in (bigger for 2 frames, then settle)
pngs = []
for i, (words, hi, a, b) in enumerate(overlays):
    for j, sc in enumerate((1.14, 1.06, 1.0)):
        p = os.path.join(work, f'cap{i}_{j}.png')
        caption_png(words, hi, p, sc)
        pngs.append((p, a + (0 if j == 0 else 2 * j / FPS), (a + 2 * (j + 1) / FPS) if j < 2 else b))
end_png = os.path.join(work, 'end.png')
endcard_png(end_png)
end_a = total - 2.3
pngs.append((end_png, end_a, total, 'end'))

n0 = len(SHOTS)
cur = 'base'
for i, item in enumerate(pngs):
    cmd += ['-i', item[0]]
    nxt = f'o{i}'
    y = 1010 if len(item) == 3 else 560
    chain += f"[{cur}][{n0 + i}:v]overlay=0:{y}:enable='between(t,{item[1]:.3f},{item[2]:.3f})'[{nxt}];"
    cur = nxt

# audio
base = n0 + len(pngs)
for s in SHOTS:
    cmd += ['-i', s['wav']]
achain = ''
for i, s in enumerate(SHOTS):
    ms = int(max(0.0, s['t0'] + max(0.0, s['voice']) - s['v0']) * 1000)
    achain += f'[{base + i}:a]adelay={ms}|{ms},volume=1.0[a{i}];'
achain += ''.join(f'[a{i}]' for i in range(len(SHOTS))) + f'amix=inputs={len(SHOTS)}:normalize=0,apad=whole_dur={total:.3f},loudnorm=I=-14:TP=-1.5[aout]'

fc = trims + chain + achain
cmd += ['-filter_complex', fc, '-map', f'[{cur}]', '-map', '[aout]', '-t', f'{total:.3f}',
        '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS),
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
subprocess.run(cmd, check=True)
print('wrote', out)
