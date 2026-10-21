# Claude Skate

A mobile-first skateboarding game with Skate-style flick-stick tricks, built with
Three.js. Top-down-ish chase camera, a big concrete park, and a board with a
Claude/Anthropic graphic on the bottom.

## Story Mode

Three chapters of Tony Hawk-style goals. Complete enough goals in a chapter to
unlock the next; progress saves on your device.

| Chapter | Spot | Highlights |
| --- | --- | --- |
| 1 | **Claude Park** | Jump Box gap, 6-stair, long flat rail, vert air, bowl |
| 2 | **Fountain Plaza** | Gap over the fountain, grind a lap of the fountain rim, 7-stair handrail, planter gap |
| 3 | **The Pier** | Pier Gap over rotten planks, a 250 m rail wrapping the whole pier, promenade stairs — fall in and it's a splash |

Every chapter also hides the letters **C-L-A-U-D-E** (orange dots on the
minimap) and has a combo-score goal. Gaps are scored THPS-style: take off in
one spot, land cleanly in another. **Free Skate** lets you ride any unlocked
spot with no goals.

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
- `src/levels/` – the three story spots, their gaps, letters and goals
- `src/story.ts`, `src/menu.ts` – goal tracking, saved progress, menus
- `src/main.ts` – loop, level loading, camera, combo scoring, effects

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push
to `main`. One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**.
