# Rover Rush

A 2DHD pixel-art runner across three NASA Mars missions, built for the **NASA Space Apps Challenge 2026**. Play as **Sojourner** (Ares Vallis, 1997), **Spirit** (Gusev Crater, 2004) and **Opportunity** (Meridiani Planum, 2004). Each rover has its own signature ability, course, memory fragments, checkpoint logs, decryption quiz and Codex archive. Built with Phaser 3.60 (WebGL) plus an HTML/CSS UI layer.

## Run it

The game loads images and level data over HTTP, so serve the folder rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> and pick a rover card. Add `?fx=0` to the URL to turn off bloom, glow and vignette on low-end GPUs.

## Controls

| Key | All rovers |
| --- | --- |
| `SPACE` / `↑` / `W` | Jump (grounded only) |
| `SHIFT` / `↓` / `S` | The rover's signature ability, which spends energy from the battery bar |

| Rover | `SHIFT` ability | Energy |
| --- | --- | --- |
| Sojourner | **Airbag Bounce**: one high bounce per landing, on the ground or in mid-air. Its normal hop is short. | 15% per bounce; magnetic dust drains 15% |
| Spirit | **Trench-Scrape Slide**: hold to slide under obstacles; the hitbox halves at the feet. Also `E` / hold `SPACE` to boost. | 15% per slide; boost drains while held; batteries refill |
| Opportunity | **Solar Wind Boost**: a 7 s horizontal burst at 2.5× speed, then a 3 s recharge. Wind-gust zones ready it. | 30% per boost; each gust recharges 40% |

All rovers recharge at 2.5%/s from solar power; Spirit doesn't recharge while sliding. A low battery only refuses the ability, showing "LOW POWER" on the bar; it never causes failure.

## Project structure

```
index.html                 entry point: Phaser CDN + scripts + DOM UI layer
css/style.css              VT323 font, menu, HUD, terminals, quiz, codex
js/main.js                 Phaser config + app flow (menu first, loader, mission launch)
js/scenes/BootScene.js     loads shared sprites + all level JSON, reports progress to the menu
js/scenes/GameScene.js     data-driven mission runtime (all three rovers)
js/core/LevelSchema.js     level validator (also used by the Node build)
js/core/LevelManager.js    builds terrain/hazards/landmarks from level JSON; spatial queries
js/core/Abilities.js       rover -> exclusive ability registry (bounce / slide / boost)
js/core/TimeCoordinator.js slow-motion reasons with precedence (tutorial > fragment)
js/core/SaveStore.js       versioned save, best progress, fastest clear, Codex unlocks
js/core/PixelTextures.js   procedural pixel textures for the Sojourner/Opportunity worlds
js/UIController.js         DOM UI: menu cards, HUD, tutorials, fragments, terminals, quiz, codex
js/ContentDatabase.js      UI chrome strings only
js/data/GameData.js        GENERATED: mission cards + "Did you know?" facts
js/AssetManifest.js        GENERATED: raster sprite sizes
assets/data/levels/*.json  GENERATED: one compiled level per mission
content/*.json             reviewed mission text + correction ledger + menu facts (source, not deployed)
tools/                     asset pipelines, level compiler + reachability simulations, checks
```

## Build tools

These need Node 18+ and Python 3 with `numpy pillow scipy opencv-python-headless`, plus `ffmpeg` for the sprite stages. Each one is deterministic.

```bash
python3 tools/build_assets.py
```

```bash
python3 tools/build_sojourner.py
```

```bash
node tools/build_levels.mjs
```

```bash
node tools/check_content.mjs
```

```bash
node tools/render_ledger.mjs
```

- **`build_assets.py`** builds the Spirit/Opportunity sprites, hazards and backgrounds from the supplied art.
- **`build_sojourner.py`** builds the Sojourner sheet + clip manifest from `Sojourner_sprite sheet.jpeg` and `Sojourner_animations.mp4`.
- **`build_levels.mjs`** compiles content + layouts → level JSON, runs schema checks and trajectory simulations, and fails on any unreachable route.
- **`check_content.mjs`** checks the wording against the scripts and ledger, counts, the 12-word fragment limit, quiz references, sources, and removal of V1 text.
- **`render_ledger.mjs`** renders the correction ledger → `docs/content-corrections.md`.

`build_levels.mjs` proves each course is fair. For example:
- Sojourner's hop clears every pebble but no boulder.
- Its wide flood-plain channels can't be crossed by a ground bounce but can by SPACE then a delayed SHIFT.
- Opportunity's wide Endurance gaps need the boost, and each one has a wind-gust zone before it.
- The storm section never depends on the boost.
- Every energy budget holds.

## Content and accuracy

The mission text comes from `rover_rush_{sojourner,spirit,opportunity}_script.md`. Every change made for scientific accuracy is listed with its official NASA source in [docs/content-corrections.md](docs/content-corrections.md). Examples:
- Sojourner never jumped; the Airbag Bounce is inspired by Pathfinder's landing airbags.
- Spirit's last contact was March 2010, and its mission formally ended in May 2011.
- Opportunity's final contact came during a planet-wide dust storm that blocked sunlight.

Each Codex lists its sources. SYSTEM LOG entries are dramatizations, and Opportunity's course distance is narrative scale.

## Asset licensing note

`Mars.jpg`, `Solar battery.png` and `Energy bar.jpeg` are stock-site preview images with faint watermarks (Adobe Stock / pngtree). License or replace them before a public release, then rerun `tools/build_assets.py`.
