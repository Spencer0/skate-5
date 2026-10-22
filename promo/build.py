#!/usr/bin/env python3
"""Turn the frames from record.mjs into a 1080x1920 TikTok mp4 with captions.

Usage: python3 promo/build.py <framesDir> <out.mp4>

Caption timing follows the step timestamps record.mjs writes to stamps.json, so
re-recording never needs the captions retimed by hand.
"""
import json
import subprocess
import sys

frames, out = sys.argv[1], sys.argv[2]
meta = json.load(open(f"{frames}/stamps.json"))
fps, n = meta["fps"], meta["frames"]
stamps = dict(meta["stamp"])  # step title -> seconds
end = n / fps
FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
if not __import__("os").path.exists(FONT):
    FONT = "/usr/share/fonts/opentype/inter/Inter-Regular.otf"

# (text, start, end): shown in the band under the game's own step card
caps = [
    ("Learn to skate in 30 seconds", 0.2, stamps.get("Roll forward", 3) + 1.0),
    ("1. Tap to push", stamps.get("Roll forward", 3) + 1.0, stamps.get("Steer", 5)),
    ("2. Drag to steer", stamps.get("Steer", 5), stamps.get("Ollie", 7)),
    ("3. Pull down, flick up", stamps.get("Ollie", 7), stamps.get("Kickflip", 9)),
    ("4. Flick up-left: kickflip", stamps.get("Kickflip", 9), end - 3.2),
]
cta_start = end - 3.2

filters = ["scale=1080:1920:flags=lanczos"]
for text, a, b in caps:
    if b - a < 0.3:
        continue
    filters.append(
        f"drawtext=fontfile={FONT}:text='{text}':fontsize=64:fontcolor=white:"
        f"borderw=5:bordercolor=black@0.85:x=(w-text_w)/2:y=470:"
        f"enable='between(t,{a:.2f},{b:.2f})'"
    )
# end card: dark panel so it reads over any scene
filters.append(f"drawbox=x=0:y=700:w=1080:h=420:color=black@0.78:t=fill:enable='gte(t,{cta_start:.2f})'")
for text, size, y in [("Play free in your browser", 76, 800), ("Link in bio", 64, 920)]:
    filters.append(
        f"drawtext=fontfile={FONT}:text='{text}':fontsize={size}:fontcolor=white:"
        f"x=(w-text_w)/2:y={y}:enable='gte(t,{cta_start:.2f})'"
    )

subprocess.run(
    ["ffmpeg", "-y", "-framerate", str(fps), "-i", f"{frames}/f%05d.jpg", "-vf", ",".join(filters),
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium", "-r", str(fps),
     "-movflags", "+faststart", out],
    check=True,
)
