# Story scene assets

The career's phone-video scenes play files from `public/story/`, all
generated here. There are two: the opening (`src/opening.ts`, Brazil Park) and
Chapter 2's cold open, "Bro, can you film this?" (`src/filmthis.ts`, the Plaza).
Their shared parts are in `src/storykit.ts`.

| File | Made by | What it is |
| --- | --- | --- |
| `ghosts.bin` | `ghosts.mjs` | The opening's background skaters: five scripted trick lines in Brazil Park, captured by the game's own replay recorder (pose, board, sounds). |
| `opening.mp3` | `voices.py` | The "Who's on the rail" dialogue, mixed. |
| `opening.json` | `voices.py` | When each line and word is spoken, for the captions, gestures and jaw. |
| `plaza-ghosts.bin` | `SCENE=plaza ghosts.mjs` | Nico's three lines at the Plaza: the roll-in, the kickflip that every take reuses, and the fountain laser flip. |
| `plaza.mp3`, `plaza.json` | `voices.py --scene plaza` | The "film this" dialogue and its timings. |

## Background skaters

Needs the dev server (`npx vite --port 5199`) and Playwright, same as `tools/promo`.
Static builds work too: set `URL`. Don't edit `src/` while it records, because a hot reload breaks the take.

```sh
node tools/story/ghosts.mjs public/story/ghosts.bin          # all lines
node tools/story/ghosts.mjs "" rail kicker                    # dry run, prints what happened
SCENE=plaza node tools/story/ghosts.mjs public/story/plaza-ghosts.bin
```

Each line prints its mode changes and events (`land Kickflip`, `bail` ...), so a
retune (the `E('KP', 30.4)` style env overrides) can be checked without rendering.

## Voices

Python 3.12 venv with `kokoro-onnx`, `faster-whisper`, `soundfile`, and for the
default expressive pass `chatterbox-tts` (CPU torch is fine, just slow, about an hour)
plus `setuptools<81`. Model files: `kokoro-v1.0.onnx` and `voices-v1.0.bin`
from the kokoro-onnx releases. ffmpeg with rubberband is also needed.

```sh
python voices.py kokoro-v1.0.onnx voices-v1.0.bin out --engine chatterbox --takes 4
cp out/opening.mp3 out/opening.json public/story/
python voices.py kokoro-v1.0.onnx voices-v1.0.bin plaza --scene plaza --engine chatterbox --takes 4
cp plaza/plaza.mp3 plaza/plaza.json public/story/
```

With Python 3.12, Chatterbox wants `numpy<2` and `torch==2.6.0`. Its
`spacy-pkuseg` dependency doesn't build there and is only used for Chinese, so
install `chatterbox-tts` with `--no-deps` plus the rest of its requirements.
`kokoro-onnx==0.4.9` goes in the same way: it works on numpy 1.26 even though it
asks for numpy 2. Older kokoro-onnx releases can't read `voices-v1.0.bin`.

Kokoro (Apache-2.0) gives each character a voice, and a short read of each
becomes the reference voice that Chatterbox (MIT) performs with. Every line
gets several takes, and twice as many for one-word lines. Whisper listens to
each take without a prompt, and the take it hears word-for-word, at the
quickest natural pace, wins. Takes are cached in `out/work`, so editing one
line of `SCRIPT` re-renders only that line. `--engine kokoro` is a fast,
flatter fallback.

## Preview

```sh
node tools/story/preview.mjs out/frames 2          # 1080x1920 frames at exact 30 fps
STORY=plaza node tools/story/preview.mjs out/plaza 2   # the Chapter 2 cold open (audio: plaza.mp3)
ffmpeg -framerate 30 -i out/frames/f%05d.jpg -itsoffset 3.3 -i public/story/opening.mp3 \
  -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest opening.mp4
```

`AUDIO=1` renders the game's own sound along with the frames: the voice, wheels,
pops and whooshes, mixed the way the game mixes them. It runs offline on the
same virtual clock, and `<out dir>/audio.wav` lines up with the frames from
frame 0:

```sh
STORY=plaza AUDIO=1 CLEAN=1 node tools/story/preview.mjs out/plaza 2
ffmpeg -framerate 30 -i out/plaza/f%05d.jpg -i out/plaza/audio.wav -map 0:v -map 1:a \
  -c:v libx264 -pix_fmt yuv420p -af loudnorm=I=-14:TP=-1 -c:a aac -shortest film-this.mp4
```
