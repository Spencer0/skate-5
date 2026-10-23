# Story opening assets

The career's opening scene (`src/opening.ts`) plays three files from
`public/story/`. All three are generated here.

| File | Made by | What it is |
| --- | --- | --- |
| `ghosts.bin` | `ghosts.mjs` | The background skaters: five scripted trick lines in Brazil Park, captured by the game's own replay recorder (pose, board, sounds). |
| `opening.mp3` | `voices.py` | The "Who's on the rail" dialogue, mixed. |
| `opening.json` | `voices.py` | When each line and word is spoken, for the captions, gestures and jaw. |

## Background skaters

Needs the dev server (`npx vite --port 5199`) and Playwright, same as `tools/promo`.
Static builds work too: set `URL`. Don't edit `src/` while it records, because a hot reload breaks the take.

```sh
node tools/story/ghosts.mjs public/story/ghosts.bin          # all lines
node tools/story/ghosts.mjs "" rail kicker                    # dry run, prints what happened
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
```

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
ffmpeg -framerate 30 -i out/frames/f%05d.jpg -itsoffset 3.3 -i public/story/opening.mp3 \
  -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest opening.mp4
```
