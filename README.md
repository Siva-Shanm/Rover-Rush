# Rover Rush: Spirit Level

A 2DHD pixel-art runner for the **NASA Space Apps Challenge 2026**. You drive NASA's Spirit rover (MER-A) across Gusev Crater while recovering memory fragments that tell the real story of the mission. Built with Phaser 3.60 (WebGL) and an HTML/CSS UI layer.

## Run it

The game loads images over HTTP, so serve the folder rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Add `?fx=0` to the URL to turn off the bloom, glow and vignette effects on low-end GPUs.

| Key | Action |
| --- | --- |
| `SPACE` / `↑` / `W` | Jump (costs a little energy) |
| `SHIFT` / `↓` / `S` | Trench-Scrape Slide (hitbox height ×0.5); fast-fall in the air |
| `E` or hold `SPACE` | Boost: +50% speed, drains energy |

## Project structure

```
index.html              entry point: Phaser CDN + modular scripts + DOM UI layer
css/style.css           VT323 font, HUD, terminals, quiz, codex (z-index 10 above the canvas)
js/main.js              Phaser config (WEBGL, 1280x720, pixelArt, roundPixels, arcade)
js/scenes/BootScene.js  preloads assets from AssetManifest, registers animations
js/scenes/GameScene.js  gameplay, physics, deterministic LEVEL_MAP, slow-mo, particles, FX
js/UIController.js      all DOM UI: HUD, tutorials, fragments, terminals, quiz, codex
js/ContentDatabase.js   every narrative string, verbatim from game_content_script_spirit_level.md
js/AssetManifest.js     AUTO-GENERATED frame sizes and URLs (do not edit)
assets/                 game-ready PNGs produced by tools/build_assets.py
tools/                  raster asset pipeline (Python)
```

## Asset pipeline

None of the game's entities are drawn procedurally. Each sprite is sampled from the raw art in the repo root by `tools/build_assets.py`:

| Output | Source | Method |
| --- | --- | --- |
| `sprites/rover.png` (10 frames: idle, run, jump, slide, damage) | `Rover_rush Spritesheet.jpeg` | Removes the checkerboard baked into the JPEG (fixed 60 px grid + flatness test so the silver mast survives), median-block downsample, shared 40-colour palette |
| `sprites/fragment.png` (6-frame spin) | `Hazards&checkpoint_animations.mp4` frames 1–16 | Cyan key against the red-dominant Mars backdrop |
| `sprites/dustdevil.png` (4-frame spin) | video frames 35–41 | Pan-compensated clean background plate + GrabCut |
| `sprites/silica.png`, `gate.png`, `sandtrap.png`, `ground.png` | video frames 67, 127, 88, 121 | GrabCut seeded by saturation / known regions |
| `sprites/battery.png` | `Solar battery.png` | Native alpha, downsampled |
| `ui/energy_full.png`, `energy_empty.png` | `Energy bar.jpeg` (WebP) | Checkerboard removed; "empty" is a darkened copy of the same pixels |
| `bg/sky.png`, `mountains.png`, `dunes.png` | `Mars.jpg` | Mountain silhouette key; mountains inpainted out of the sky layer |
| `ui/heart*.png`, `sprites/px4.png` | *(no source art)* | 4×4 pixel-block grid fallback |

To rebuild (needs `ffmpeg` on PATH; the output is deterministic):

```bash
pip install -r tools/requirements.txt
```

```bash
python3 tools/build_assets.py
```

## Level map (12,000 units, no RNG)

`LEVEL_MAP` in `GameScene.js` fixes the positions of everything. The beats from the PRD are tagged `[PRD]`:

- 2% crater tutorial
- 8% Fragment 1
- 12% slide tutorial
- 18% battery
- 25% Checkpoint 1
- 27% dust-devil tutorial
- 30% dust devil
- 41% Fragment 4
- 50% Checkpoint 2
- 52% sand tutorial
- 55% Troy sand trap
- 62% embedded silica (slide over it to get Fragment 7)
- 75% Checkpoint 3
- 82% Fragment 9
- 100% final gate, then the decryption quiz

Fixed filler placements teach each mechanic and hold the other six fragments, so all 10 lines of the content script appear. This filler is: more craters, overhangs, devils and batteries, and Fragments 2, 3, 5, 6, 8 and 10.

Tutorials run at 25% speed until the rover clears the hazard. Memory fragments run at 20% speed for 2 s of real time. Passing the quiz unlocks the Codex on the main menu (saved in `localStorage`).

## Asset licensing note

`Mars.jpg`, `Solar battery.png` and `Energy bar.jpeg` are stock-site preview images that carry faint watermarks (Adobe Stock / pngtree). Downsampling hides most of the watermark, but a trace is still visible in the sky. License or replace these files before a public release, then rerun the pipeline.
