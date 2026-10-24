# Skate Nations

A mobile-first skateboarding game with Skate-style flick-stick tricks, built with
Three.js. Top-down-ish chase camera, a big concrete park, and a board with your
country's flag on the bottom.

## Career mode

A Tony Hawk-style career across four chapters, told through letterboxed
cutscenes with a small cast: Mara (your crew leader), Dex (the rival), Kai
Moreno (Atlas Skateboards team manager) and Officer Pete (plaza security).

- **Opening:** a new story starts with an in-engine phone-video opening at
  Brazil Park: two locals doing a rapid "Who's on the rail, What's on the
  ramp, Both's on the kicker" bit, voiced and captioned word by word, while
  the park skates behind them (real recorded trick lines). Between exchanges
  it cuts away to the skater just named landing a trick, then you drop
  straight into your first run (Mara's intro follows it). 9:16 on wide
  screens, skippable, replayable from Brazil Park's menu. Assets come from
  `tools/story/`.
- **Chapter 2 cold open:** "Bro, can you film this?" at the Plaza. Nico asks
  Theo to film one kickflip. He lands it four times through Theo's camcorder,
  each take a real, slightly different kickflip (a little twist, a 180, a
  double), and each one gets a worse
  note: too natural, too clean, too creative, now hit the big gap. Nico sends
  a 360 laser flip over the fountain, shown in slow motion with a replay, and
  asks "tell me you got it!" Theo was texting his girl. Nico storms off,
  flicks an angry kickflip, slams, and the clip loops to its first frame. It plays before your first Plaza run
  (the Plaza intro follows it), and you can replay it from the Plaza menu.
- **Runs:** each session is a 2:00 run. Goals save the moment you land them.
  When the clock hits zero your current line gets to finish.
- **Goals (≈13 per spot):** High / Pro / Sick score, collect N-A-T-I-O-N in one run,
  find the secret tape, knock over 5 signs / cones / beach balls, named gaps
  (optionally with a specific trick), grind distances, big air, combos.
  Every goal has a hint and most have a **Show** camera preview.
- **Unlocks:** finish enough goals to open the next chapter. Each goal is a
  stat point (Speed, Ollie, Spin, Flip, Rail Balance). Goal totals unlock pro deck
  graphics (Compass, Airmail, Passport, Jet Stream, All Nations, Nations Cup Gold)
  and special tricks (Samba Flip, Bullet Train, Aurora Impossible, Southern Cross).
- **Flag decks:** 37 country flags (`src/flags.ts`) are open from the start. Each
  spot flies its country's flag.
- **Specials:** landing tricks fills the special meter; when it glows you get
  a speed boost and the ★ button fires your equipped special (catch it like any flip).
- **Scoring:** combos multiply by trick count, gaps add bonuses, and repeating
  the same trick in a run scores less each time.

| Chapter | Spot | Highlights |
| --- | --- | --- |
| 1 | **Brazil Park** | Jump Box gap, kickflip the 6-stair, spine transfer, vert air, bowl |
| 2 | **Plaza de España** | Gap over the fountain, rim lap, slide the 7-stair handrail, planter gap |
| 3 | **Australia Pier** | Pier Gap over rotten planks, 100 m on the 250 m pier rail, splash zones |
| 4 | **The Nations Cup** (Japan Arena) | Contest: 3 heats × 60 s vs CPU riders, best two count, medals, ending + credits |

**Free Skate** rides any spot with no clock, and every spot is open from the
start. It also has a free-skate-only spot, **The Mega Park**: a 24 m mega ramp
(roll-in tower, 17 m gap over a knuckle table, 8 m quarter pipe with a drop
off the back), a superpipe with its own 11 m drop-in, a giant bowl, a 4 m
spine, a 16-stair with handrail and hubbas, rails down the mega roll-in and a
100 m flat rail. Ride onto a yellow LIFT pad to go back up to the top.

**Pumping:** hold push (left thumb up, or W) while dropping down a transition
to gain speed — that's how you keep the superpipe and bowls going.

## Skaters, camera and options

- **Three skaters**, picked when you start a career (switch any time under Skater):
  Brock Steele (the muscle: Ollie/Speed up, Spin/Flip down), Coral Reyes
  (beach local: Balance/Spin up), Dr. Elmer Voss (retired physicist: Flip +2,
  Balance up, Ollie/Speed down). They are MakeHuman characters (CC0) generated in Blender, animated with IK —
  feet stay on the bolts through pushes, pops, flips and grinds.
- **Create a skater:** the fourth card in the Rider menu opens a creator with a
  live 3D preview: masculine or feminine build, height, skin tone, hair style
  and colour, hat, top, bottoms (jeans, shorts, leggings, skirt…), shoes, and a
  free colour picker for each. Your skater has no stat bonuses or penalties and
  is saved with your career.
- **Ghost / Solid / Board only:** the rider defaults to a see-through ghost so
  the board is always readable.
- **Camera button** (top right) cycles Chase, Classic, Overhead and Filmer views;
  also in Options.

## Studio: record clips, cut a skate video

- **Record:** turn on **Options → Recording**, then tap **● REC** in the top
  bar (or press **V**) while you skate, and tap again to stop. A clip is up to
  60 s; the Studio keeps up to 10 minutes of footage (about 9 MB) in the
  browser's IndexedDB. Clips are named after the tricks you landed.
- **Clips are data, not video:** each 30 fps frame stores the board, the
  rider's skeleton, the contact shadow, the camera and the rolling/grinding
  sound levels, plus every skate sound with its time. Playback interpolates
  between frames, so slow-mo stays smooth and the lens can change after the
  fact.
- **Edit:** **Studio** on the title screen. Watch a clip, **+ Add** it to the
  edit strip, then tap a cut to trim it (Set start / Set end at the playhead),
  pick a lens (**Game** = what you saw, **Filmer** = low fisheye follow,
  **Tripod** = fixed and panning) and a speed (normal, ½, ¼), and reorder.
- **Export:** renders the edit frame by frame (not in real time, so no dropped
  frames) with WebCodecs, re-synthesizes the sound offline and muxes an MP4
  (H.264 + AAC where the browser has them, otherwise VP9 / Opus) with
  `mp4-muxer`. Landscape 720p, portrait 720p or 1080p, with an optional title
  card. Needs a browser with WebCodecs (recent Chrome, Edge, Safari or Firefox).

## Controls

**Touch (two floating thumb sticks)**

| Thumb | Action |
| --- | --- |
| Left – tap | Push |
| Left – drag sideways | Carve. In the air, push it hard to spin (FS/BS 180s, 360s). On a rail, keep your balance. |
| Left – hold up | Keep pushing; carry over a lip onto a deck or out of a bowl |
| Left – hold down | Powerslide / brake |
| Right – pull down, then flick | Pop a trick (see below) |
| Tap anywhere in the air | **Catch the board.** It keeps flipping until you do — land uncaught and you bail. Wait longer for doubles. |
| Right – hold up / down on a rail | Nose / tail grind variants |
| In the air: tap/click next to your skater and hold | **Grab.** Where you tap around the board picks it: Nosegrab, Tailgrab, Indy (toe), Melon (heel), Mute, Japan, Method, Stalefish. Hold longer for more points; let go before you land or it's sketchy. |

**Trick stick** (pull down to load the tail; pull *up* first for nollies)

| Gesture after loading | Trick |
| --- | --- |
| Flick straight up | Ollie |
| Flick up-left / up-right | Kickflip / Heelflip |
| Roll ¼ left / right | Pop Shove-it / FS Pop Shove-it |
| Roll to up-left / up-right | Varial Kickflip / Varial Heelflip |
| Roll ½ to the top (left / right) | 360 Shove-it / FS 360 Shove-it |
| Roll right past the top / left past the top | Hardflip / Inward Heelflip |
| Roll ¾ (left / right) | 360 Flip / Laser Flip |
| Full circle | Impossible |

Names compose from what actually happened: catch late for Double/Triple
flips, add body spins for FS/BS 180s and Bigspins, pop from the nose for
Nollie, roll backwards for Fakie.

**Grinds**: ollie onto a rail or ledge edge. The board angle picks the family
(straight → 50-50 / 5-0 / Nosegrind, ~35° → Feeble / Smith / Crooked,
sideways → Boardslide / Lipslide / Noseslide / Tailslide). Flick to pop out
(you can flip out of a grind too).

**Keyboard** (desktop): A/D steer, W push, S brake, Space ollie/catch, J
kickflip, L heelflip, U/O shove-its, 1–9 combo flips, Shift = nollie, N/M nose/tail
grinds, G/H/T/Y grabs (hold), K catch, R reset.

## Development

```sh
npm install
npm run dev      # local server (also reachable from your phone on the LAN)
npm test         # gesture-recognition + physics regression tests (Node)
npm run build    # production build into dist/
```

Code map:

- `src/terrain.ts` – analytic heightfield: every surface is a height function that
  both the physics and the meshes sample
- `src/park.ts` – ramp/rail building blocks, Brazil Park's layout, and mesh building
- `src/skater.ts` – board physics: ground/air/grind/bail, pop, catch-to-land, grinds
- `src/tricks.ts` – flick gesture recognition, trick naming and scoring
- `src/input.ts` – floating touch sticks + keyboard
- `src/board.ts`, `src/textures.ts`, `src/flags.ts` – board model, procedural textures and country flags
- `src/audio.ts` – procedural WebAudio (no sound files)
- `src/levels/` – the four spots: layout, gaps, collectibles, goals and cutscene scripts
- `src/career.ts` – save data, stats, unlocks, goal tracking
- `src/ui.ts`, `src/cutscene.ts`, `src/cast.ts` – menus, cutscene player, characters
- `src/props.ts` – letters, tapes and knockable objects
- `src/rider.ts`, `src/humanrider.ts`, `src/settings.ts` – skater IK, the MakeHuman riders and saved options
- `src/custom.ts`, `src/creator.ts`, `src/data/skater-options.json` – the create-a-skater look, its menu and the shared option list
- `tools/riders/` – Blender + MPFB pipeline that generates `public/riders/*.glb`
- `src/main.ts` – loop, level loading, camera, combo scoring, effects

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push
to `main`. One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**.
