#!/usr/bin/env python3
"""Voice a story scene and time every word.

usage: voices.py <kokoro .onnx> <voices .bin> <out dir> [--scene opening|plaza|promo] [--engine kokoro|chatterbox] [--takes N] [--try A,B] [--pace X]

Scenes: 'opening' is the career opening ("Who's on the rail"), 'plaza' is
Chapter 2's "Bro, can you film this?".

Kokoro (Apache-2.0) gives each character a voice. With --engine chatterbox
(MIT) a short Kokoro read becomes each character's reference voice and
Chatterbox performs the lines with attitude. Every line is rendered --takes
times (more for one-word lines, which TTS fumbles most), Whisper listens to
each take unprompted, and the take it hears word-for-word closest to a quick
delivery wins. Takes are cached in <out>/work, so re-runs only render what
changed.

Writes <out>/<scene>.mp3 (the mixed dialogue) and <out>/<scene>.json (each
line's start/end and per-word times for the burned-in captions).
"""
import hashlib, json, os, subprocess, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from faster_whisper import WhisperModel

model, voices, out = sys.argv[1:4]


def opt(name, d):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else d


ENGINE = opt('--engine', 'kokoro')
TAKES = int(opt('--takes', '4'))
# every line sped up by this much on top of its own tempo (rapid-fire delivery)
PACE = float(opt('--pace', '1.12'))
work = os.path.join(out, 'work')
os.makedirs(work, exist_ok=True)
SR = 24000

SCENE = opt('--scene', 'opening')

# gap: seconds after the previous line ends (negative = talks over it)
# cut: (name, seconds) a stretch right after this line with no dialogue, where the
#      scene shows something else (a trick, a walk); the scene has its own sound there
# speed: Kokoro speed; exag: how hard Chatterbox pushes it; tempo: final time-stretch
# CAPS are only for the captions (TTS would spell them out)
SCENES = {
    'opening': dict(
        # 'a' = Tonho (deadpan, explains it), 'b' = Rafa (lost, getting louder)
        voices='am_michael,am_puck',
        ref={
            'a': "Nah man, listen. It's easy. I've told you like five times already. You just gotta pay attention for once.",
            'b': "Are you kidding me right now? I asked you one simple question! Just one! Why is this so hard for you?",
        },
        script=[
            dict(who='a', text="Who's on the rail, What's on the ramp, and Both's on the kicker.", speed=1.12, exag=0.4, tempo=1.12, gap=0.0),
            dict(who='b', text="Who's on the rail?", speed=1.12, exag=0.6, gap=0.1),
            dict(who='a', text="Yep.", speed=1.0, exag=0.35, gap=0.05, cut=('rail', 2.4)),
            dict(who='b', text="I'm asking you!", speed=1.18, exag=0.8, tempo=1.1, gap=-0.05),
            dict(who='a', text="Who.", speed=1.0, exag=0.35, gap=0.06),
            dict(who='b', text="The guy on the rail!", speed=1.22, exag=0.85, tempo=1.08, gap=-0.04),
            dict(who='a', text="Who's on the rail.", speed=1.1, exag=0.4, gap=0.05),
            dict(who='b', text="What?", speed=1.0, exag=0.75, gap=0.12),
            dict(who='a', text="Ramp.", speed=1.0, exag=0.35, gap=0.04, cut=('ramp', 2.6)),
            dict(who='b', text="Okay. Then who's on the kicker?", speed=1.22, exag=0.9, tempo=1.1, gap=0.08),
            dict(who='a', text="Both.", speed=1.0, exag=0.35, gap=0.06),
            dict(who='b', text="Both of WHO?!", speed=1.2, exag=1.1, gap=-0.04, cut=('kicker', 2.4)),
        ],
    ),
    'plaza': dict(
        cut_gap=0.06,
        # 'a' = Nico (the skater, hyped, then fed up), 'b' = Theo (the filmer, completely flat)
        voices='am_fenrir,am_onyx',
        ref={
            'a': "Yo, this is gonna be crazy, watch. I've been landing this all week, I swear. You ready? Okay, okay, here we go!",
            'b': "Hm. Okay. I mean, it's fine. It's just not really what I was going for. Let's go again. From the top.",
        },
        script=[
            dict(who='a', text="Yo, film this real quick.", speed=1.15, exag=0.6, gap=0.0, cut=('take1', 1.6)),
            dict(who='b', text="Do it more naturally.", speed=1.0, exag=0.25, gap=0.05, cut=('take2', 1.6)),
            dict(who='b', text="That was too natural. Do it more clean.", speed=1.05, exag=0.3, tempo=1.06, gap=0.05, cut=('take3', 1.6)),
            dict(who='b', text="Eh, a little too clean. Add a little life to it.", speed=1.05, exag=0.3, tempo=1.08, gap=0.05, cut=('take4', 1.6)),
            dict(who='b', text="Okay, now you're just too creative. Hit the big gap with something harder.", speed=1.08, exag=0.35, tempo=1.1, gap=0.05, cut=('final', 4.0)),
            dict(who='a', text="Dude, that was so sick! Tell me you got it!", speed=1.18, exag=1.0, tempo=1.06, gap=0.1),
            dict(who='b', text="Oh, sorry dude. I was texting my girl.", speed=1.0, exag=0.25, gap=0.2, cut=('leave', 3.5)),
        ],
    ),
    # the TikTok cut's intro (tools/promo/tiktok.py): the dev, over gameplay
    'promo': dict(
        voices='am_michael,am_michael',
        ref={
            'a': "So I've been making this game for about a year now, and honestly, it's finally starting to feel really good.",
            'b': "So I've been making this game for about a year now, and honestly, it's finally starting to feel really good.",
        },
        script=[
            dict(who='a', text="I made a skate game for your mobile.", speed=1.05, exag=0.5, gap=0.0),
            dict(who='a', text="Here's a cutscene I'm working on.", speed=1.05, exag=0.5, gap=0.25),
        ],
    ),
}
SC = SCENES[SCENE]
# the beat between a line and the cutaway after it
CUT_GAP = SC.get('cut_gap', 0.12)
VOICE = dict(zip('ab', opt('--try', SC['voices']).split(',')))
REF_TEXT = SC['ref']
SCRIPT = SC['script']

tts = Kokoro(model, voices)
wm = WhisperModel('small.en', device='cpu', compute_type='int8')


def norm(t):
    return ''.join(c for c in t.lower().replace('-', ' ') if c.isalnum() or c in " '").split()


def hear(x):
    x16 = np.interp(np.arange(0, len(x), SR / 16000), np.arange(len(x)), x).astype(np.float32)
    # no prompt: what Whisper hears unprompted doubles as an intelligibility check
    segs, _ = wm.transcribe(x16, word_timestamps=True, beam_size=5, language='en')
    return [w for s in segs for w in s.words]


def trim(x, thr=0.012, pad=0.02):
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx):
        return x
    return x[max(0, idx[0] - int(pad * SR)):min(len(x), idx[-1] + int(pad * SR))]


def stretch(x, tempo):
    """Pitch-preserving speed-up (Rubber Band through ffmpeg)."""
    if abs(tempo - 1) < 1e-3:
        return x
    a, b = os.path.join(work, 'st_in.wav'), os.path.join(work, 'st_out.wav')
    sf.write(a, x, SR)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', a, '-af', f'rubberband=tempo={tempo}:transients=crisp', b], check=True)
    y, _ = sf.read(b, dtype='float32')
    return y


cb = None
refs = {}
if ENGINE == 'chatterbox':
    import torch
    from chatterbox.tts import ChatterboxTTS
    cb = ChatterboxTTS.from_pretrained(device='cpu')
    for who, text in REF_TEXT.items():
        a, _ = tts.create(text, voice=VOICE[who], speed=1.05, lang='en-us')
        refs[who] = os.path.join(work, f'ref_{who}_{VOICE[who]}.wav')
        sf.write(refs[who], np.asarray(a, dtype=np.float32), SR)


def render(L, take):
    spoken = L['text'].replace('WHO', 'who')
    key = hashlib.sha1(json.dumps([ENGINE, VOICE[L['who']], spoken, L['speed'], L['exag'], take]).encode()).hexdigest()[:16]
    cache = os.path.join(work, f'take_{key}.wav')
    if os.path.exists(cache):
        return sf.read(cache, dtype='float32')[0]
    if ENGINE == 'kokoro':
        audio, _ = tts.create(spoken, voice=VOICE[L['who']], speed=L['speed'], lang='en-us')
        x = np.asarray(audio, dtype=np.float32)
    else:
        torch.manual_seed(1000 + take)
        w = cb.generate(spoken, audio_prompt_path=refs[L['who']], exaggeration=L['exag'], cfg_weight=0.3, temperature=0.8)
        x = w.squeeze(0).numpy().astype(np.float32)
        if cb.sr != SR:
            x = np.interp(np.arange(0, len(x), cb.sr / SR), np.arange(len(x)), x).astype(np.float32)
    sf.write(cache, x, SR)
    return x


lines = []
for i, L in enumerate(SCRIPT):
    want = norm(L['text'])
    n = 1 if ENGINE == 'kokoro' else TAKES * (2 if len(want) <= 2 else 1)
    # a quick, natural pace for this many words
    target = (0.14 + 0.25 * len(want)) / PACE
    best = None
    for k in range(n):
        x = trim(render(L, k))
        x = stretch(x, L.get('tempo', 1.0) * PACE)
        x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
        heard = hear(x)
        got = norm(' '.join(w.word for w in heard))
        miss = sum(1 for a, b in zip(want, got) if a != b) + abs(len(want) - len(got))
        dur = len(x) / SR
        score = miss * 10 + abs(dur - target) * 2
        print(f'  line {i} take {k}: {dur:.2f}s miss {miss} heard "{" ".join(got)}"', flush=True)
        if best is None or score < best[0]:
            best = (score, x, heard, miss)
    _, x, heard, miss = best
    p = os.path.join(work, f'line{i:02d}.wav')
    sf.write(p, x, SR)
    lines.append(dict(L, wav=p, dur=len(x) / SR, heard=heard, miss=miss))

# lay the lines end to end on one clock
t = 0.0
cuts = []
for L in lines:
    L['t0'] = max(0.0, t + L['gap'])
    L['t1'] = L['t0'] + L['dur']
    t = L['t1']
    if 'cut' in L:
        name, length = L['cut']
        cuts.append(dict(name=name, t0=round(t + CUT_GAP, 3), t1=round(t + CUT_GAP + length, 3)))
        t += CUT_GAP + length
total = t
mix = np.zeros(int(total * SR) + 1, dtype=np.float32)
for L in lines:
    x, _ = sf.read(L['wav'], dtype='float32')
    a = int(L['t0'] * SR)
    mix[a:a + len(x)] += x
mix /= max(1.0, np.max(np.abs(mix)) / 0.95)
raw = os.path.join(work, 'mix.wav')
sf.write(raw, mix, SR)

# word times from the chosen take's hearing, matched to the script words in order
for L in lines:
    words = L['text'].split()
    heard = L['heard']
    if len(heard) == len(words):
        spans = [(w.start, w.end) for w in heard]
    else:
        # fall back to spreading the words by length
        n = [len(w) + 2 for w in words]
        c = np.cumsum([0] + n) / sum(n) * L['dur']
        spans = list(zip(c[:-1], c[1:]))
    L['words'] = [dict(w=w, t0=round(L['t0'] + a, 3), t1=round(L['t0'] + b, 3)) for w, (a, b) in zip(words, spans)]

# a phone-mic feel: cut the rumble, tame the peaks, even out the levels
mp3 = os.path.join(out, SCENE + '.mp3')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af',
                'highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-16:TP=-1.5:LRA=7',
                '-ar', '44100', '-ac', '1', '-b:a', '96k', mp3], check=True)

cues = dict(duration=round(total, 3), engine=ENGINE, voices=VOICE, cuts=cuts,
            lines=[dict(who=L['who'], text=L['text'], t0=round(L['t0'], 3), t1=round(L['t1'], 3), words=L['words']) for L in lines])
json.dump(cues, open(os.path.join(out, SCENE + '.json'), 'w'), indent=1)
for L in lines:
    print('ok ' if L['miss'] == 0 else '?? ', f"{L['t0']:5.2f}-{L['t1']:5.2f}", L['who'], L['text'], '| heard:', ' '.join(w.word.strip() for w in L['heard']))
print('total', round(total, 2), 's')
