# Claude Skate

A mobile-first skateboarding game with Skate-style flick-stick tricks, built with
Three.js. Top-down-ish chase camera, a big concrete park, and a board with a
Claude/Anthropic graphic on the bottom.

## Career mode

A Tony Hawk-style career across four chapters, told through letterboxed
cutscenes with a small cast: Mara (your crew leader), Dex (the rival), Kai
Moreno (Spark Skateboards team manager) and Officer Pete (plaza security).

- **Runs:** each session is a 2:00 run. Goals save the moment you land them.
  When the clock hits zero your current line gets to finish.
- **Goals (≈13 per spot):** High / Pro / Sick score, collect C-L-A-U-D-E in one run,
  find the secret tape, knock over 5 signs / cones / beach balls, named gaps
  (optionally with a specific trick), grind distances, big air, combos.
  Every goal has a hint and most have a **Show** camera preview.
- **Unlocks:** finish enough goals to open the next chapter. Each goal is a
  stat point (Speed, Ollie, Spin, Flip, Rail Balance). Goal totals unlock deck
  graphics (Haiku, Sonnet, Opus, Spark, Constitution, Classic Gold) and special tricks.
- **Specials:** landing tricks fills the special meter; when it glows you get
  a speed boost and the ★ button fires your equipped special (catch it like any flip).
- **Scoring:** combos multiply by trick count, gaps add bonuses, and repeating
  the same trick in a run scores less each time.

| Chapter | Spot | Highlights |
| --- | --- | --- |
| 1 | **Claude Park** | Jump Box gap, kickflip the 6-stair, spine transfer, vert air, bowl |
| 2 | **Fountain Plaza** | Gap over the fountain, rim lap, slide the 7-stair handrail, planter gap |
| 3 | **The Pier** | Pier Gap over rotten planks, 100 m on the 250 m pier rail, splash zones |
| 4 | **The Claude Classic** | Contest: 3 heats × 60 s vs CPU riders, best two count, medals, ending + credits |

**Free Skate** rides any unlocked spot with no clock.

## Skaters, camera and options

- **Three skaters**, picked when you start a career (switch any time under Skater):
  Brock Steele (the muscle: Ollie/Speed up, Spin/Flip down), Coral Reyes
  (beach local: Balance/Spin up), Dr. Elmer Voss (retired physicist: Flip +2,
  Balance up, Ollie/Speed down). The rider is procedurally animated with IK —
  feet stay on the bolts through pushes, pops, flips and grinds.
- **Ghost / Solid / Board only:** the rider defaults to a see-through ghost so
  the board is always readable.
- **Camera button** (top right) cycles Chase, Classic, Overhead and Filmer views;
  also in Options.

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
grinds, K catch, R reset.

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
- `src/park.ts` – ramp/rail building blocks, Claude Park's layout, and mesh building
- `src/skater.ts` – board physics: ground/air/grind/bail, pop, catch-to-land, grinds
- `src/tricks.ts` – flick gesture recognition, trick naming and scoring
- `src/input.ts` – floating touch sticks + keyboard
- `src/board.ts`, `src/textures.ts` – board model and procedural textures
- `src/audio.ts` – procedural WebAudio (no sound files)
- `src/levels/` – the four spots: layout, gaps, collectibles, goals and cutscene scripts
- `src/career.ts` – save data, stats, unlocks, goal tracking
- `src/ui.ts`, `src/cutscene.ts`, `src/cast.ts` – menus, cutscene player, characters
- `src/props.ts` – letters, tapes and knockable objects
- `src/rider.ts`, `src/settings.ts` – the three skaters (IK rig) and saved options
- `src/main.ts` – loop, level loading, camera, combo scoring, effects

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push
to `main`. One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**.
