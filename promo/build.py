#!/usr/bin/env python3
"""Turn the frames from record.mjs into a 1080x1920 TikTok mp4 with captions.

Usage: python3 promo/build.py <framesDir> <out.mp4>

Caption timing follows the step timestamps record.mjs writes to stamps.json, so
re-recording never needs the captions retimed by hand. The last frame is held
under the end card.
"""
import json
import os
import subprocess
import sys

frames, out = sys.argv[1], sys.argv[2]
meta = json.load(open(f"{frames}/stamps.json"))
fps, n = meta["fps"], meta["frames"]
stamps = dict(meta["stamp"])  # step title -> seconds
rec_end = n / fps  # footage length
HOLD = 3.2  # last frame held under the end card
total = rec_end + HOLD

FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
if not os.path.exists(FONT):
    FONT = "/usr/share/fonts/opentype/inter/Inter-Regular.otf"

t_push = stamps.get("Roll forward", 2.5)
t_steer = stamps.get("Steer", 4.3)
t_ollie = stamps.get("Ollie", 6.2)
t_kick = stamps.get("Kickflip", 8.6)

# (text, start, end): shown in the band under the game's own step card
caps = [
    ("Learn to skate in 10 seconds", 0.2, t_push),
    ("1. Tap to push", t_push, t_steer),
    ("2. Drag to steer", t_steer, t_ollie),
    ("3. Pull down, flick up: ollie", t_ollie, t_kick),
    ("4. Flick up-left: kickflip", t_kick, rec_end),
]

filters = [
    "scale=1080:1920:flags=lanczos",
    f"tpad=stop_mode=clone:stop_duration={HOLD}",
]
for text, a, b in caps:
    if b - a < 0.3:
        continue
    filters.append(
        f"drawtext=fontfile={FONT}:text='{text}':fontsize=64:fontcolor=white:"
        f"borderw=5:bordercolor=black@0.85:x=(w-text_w)/2:y=470:"
        f"enable='between(t,{a:.2f},{b:.2f})'"
    )
# end card: dark panel so it reads over any scene
filters.append(f"drawbox=x=0:y=700:w=1080:h=420:color=black@0.78:t=fill:enable='gte(t,{rec_end:.2f})'")
for text, size, y in [("Play free in your browser", 76, 800), ("Link in bio", 64, 920)]:
    filters.append(
        f"drawtext=fontfile={FONT}:text='{text}':fontsize={size}:fontcolor=white:"
        f"x=(w-text_w)/2:y={y}:enable='gte(t,{rec_end:.2f})'"
    )

subprocess.run(
    ["ffmpeg", "-y", "-framerate", str(fps), "-i", f"{frames}/f%05d.jpg", "-vf", ",".join(filters),
     "-t", f"{total:.2f}", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium",
     "-r", str(fps), "-movflags", "+faststart", out],
    check=True,
)
