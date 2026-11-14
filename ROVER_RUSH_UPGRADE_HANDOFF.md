# Rover Rush Master Upgrade: Handoff

Working handoff for the three-mission upgrade (Sojourner, Spirit V2, Opportunity). **Read this first when resuming.**

## Resume prompt

> Read the Rover Rush Master Upgrade PRD and ROVER_RUSH_UPGRADE_HANDOFF.md. Inspect the current branch, working tree, and diff. Reconcile any edits made after the last checkpoint, preserve existing work, and continue from the first unfinished action. Update the handoff as you go and run the remaining acceptance checks.

## Session facts

| Field | Value |
| --- | --- |
| Last updated | 2026-11-14, M2 done (content), starting M3 (shared runtime) |
| PRD | Not in the checkout. It was attached to the session as `Rover_Rush_-_Final_Claude_Code_Master_Upgrade_Prompt.md`. **Re-attach it when resuming.** |
| Branch | `claude/clever-galileo-t5dz1n` (pushed to origin; `main` receives merges on request) |
| Starting commit | `b15ac95` (merge of `origin/main`: new scripts and Sojourner art) |
| Pre-existing local edits | none (clean tree at start) |
| Last known buildable state | `b15ac95`: Spirit-only game, all checks passing (bot playthrough 3/3 HP, 10/10 fragments) |

## Repository reality vs PRD assumptions

| PRD assumes | Actual |
| --- | --- |
| package scripts, build system, lint, tests | None. Static site: `index.html` + classic `<script>` files, Phaser **3.60.0 from CDN**. Vercel build = `cp index.html css js assets public/`. |
| Three.js globe, app navigation | Do not exist. Nothing to preserve. |
| LevelManager, JSON schema | Do not exist. Spirit layout is the `LEVEL_MAP` const in `js/scenes/GameScene.js`. **Must be created.** |
| versioned save data | Single localStorage key `roverRush.codex.MER-A` = `'1'`. **Must be migrated.** |
| `spirit_spritesheet.png` | `assets/sprites/rover.png` (176×136 cells, 10 frames), built by `tools/build_assets.py` from `Rover_rush Spritesheet.jpeg`. |
| `game_content_script_*_level.md` | `rover_rush_sojourner_script.md`, `rover_rush_spirit_script.md` (V2), `rover_rush_opportunity_script.md` at repo root. The old V1 `game_content_script_spirit_level.md` was deleted on `main`. |
| Physics engine | Arcade. Physics is stepped manually: `physics.disableUpdate()`, `fixedStep=false`, `world.update(time, delta / world.timeScale)` once per frame in `GameScene.stepPhysics`. |

Supporting test tooling (not in repo): Playwright + Chromium are preinstalled in the container. Phaser 3.60.0 is mirrored for offline tests at `<scratchpad>/npm/package/dist/phaser.min.js` (`npm pack phaser@3.60.0`).

## Input inventory

| Input | Path | Notes |
| --- | --- | --- |
| Sojourner sprite sheet | `Sojourner_sprite sheet.jpeg` | 2752×1536 RGB JPEG, magenta chroma key (no alpha). 5 labelled single poses: IDLE, RUN, SHORT JUMP, AIRBAG BOUNCE, DAMAGE. |
| Sojourner animation | `Sojourner_animations.mp4` | 700×320, 30 fps, 340 frames, 11.33 s, magenta key. Contains the motion clips. Some frames carry a preview-player overlay (grey panel + share/heart icons), which must be excluded. |
| Spirit / Opportunity sprite | `assets/sprites/rover.png` (source `Rover_rush Spritesheet.jpeg`) | Shared texture key `rover`, one load. |
| Mission scripts | `rover_rush_*_script.md` | All three present. |
| NASA reference text | `docs/nasa-mars-pathfinder.md`, `docs/nasa-mars-exploration-rovers-spirit-and-opportunity.md` | Retrieved 2026-11-13. |
| Network | `science.nasa.gov` allowed via the personal "Rover-Rush" cloud environment. | |

## Spirit regression baseline (measured from code at `b15ac95`)

| Parameter | Value |
| --- | --- |
| Cruise speed V | 300 px/s (auto-run) |
| Gravity G | 800 px/s² (world gravity) |
| Jump J (initial) | 336 px/s (tap ≈ 65 px apex). Hold adds 1400 px/s² for ≤ 300 ms game time (≈ 265 px apex). Coyote time 90 ms real. |
| Slide (SHIFT) | Held while SHIFT is down. Body height 84 → 42, bottom-anchored. Costs 15% energy per start, refused below 15%. No solar regen while sliding. Fast-fall +1400 px/s² in air. **No fixed duration or cooldown** (hold-based). |
| Boost (E, or hold SPACE > 500 ms) | **Exists.** Speed × 1.5 = 450 px/s. Drains 24 %/s. Regen 2.5 %/s paused only while sliding, so the net drain while boosting is 21.5 %/s. From a full battery a boost lasts ≈ 4.65 s (measure in browser). |
| Sand | × 0.3 speed unless sliding or boosting. |
| Damage | 3 HP, 1500 ms invulnerability (real time). Devil contact also drains 15% energy. |
| Level | 30,000 px, GROUND_Y 620, LEVEL_MAP by percent (see GameScene). |
| Time dilation | Tutorial 0.5× / 400 ms ease (PRD now asks for 25%; see decisions). Fragment 0.85× / 200 ms. |

## Decisions log

1. **Tutorial slow motion = 25%** per PRD §7, replacing the earlier 0.5× tuning. The smooth 400 ms ease is kept.
2. **Spirit's existing boost (E / hold SPACE) is kept unchanged** (PRD §4 Spirit). Tutorial 4 keeps "Boost or Slide to escape!" because both work in the baseline.
3. Opportunity's boost must exceed Spirit's measured boost: ≥ 1.5 × 450 = 675 px/s and ≥ 1.5 × Spirit's measured boost duration. Measure Spirit in the browser before finalising.

## Milestones

- [x] M0: Inventory, baseline, handoff (this file)
- [x] M1: Sojourner art extraction: frame/clip manifest from sheet + video (in-game playback check pending → M5)
- [x] M2: Content: corrected per-mission JSON, correction ledger, menu facts, validator (V1 runtime-text check fails until M4 replaces `js/ContentDatabase.js`, which is expected)
- [ ] M3: Shared runtime: LevelManager, level JSON schema, ability registry, time coordinator, save v2 and migration, procedural texture factory
- [ ] M4: Spirit V2 on the new runtime (layout/tuning unchanged) + regression checks
- [ ] M5: Sojourner level: Airbag Bounce, intro reenactment, boulders/channel, reachability sim
- [ ] M6: Opportunity level: Solar Wind Boost, Eagle/Endurance/storm layout, gusts
- [ ] M7: Menu: rover cards, facts, loader, personal bests
- [ ] M8: Integration: acceptance checks, browser playthroughs, report

## Sojourner frame map (M1)

`tools/build_sojourner.py` → `assets/sprites/sojourner.png` (79 frames, uniform 196×163 grid) + `assets/sprites/sojourner.json` (per-frame source file/frame index/time, clips, anchor).

| Clip | Source | Frames | Timing | Notes |
| --- | --- | --- | --- | --- |
| idle | sheet IDLE pose (60,560)-(560,980) | 1 | loop | Video idle (213–232) is static; the sheet pose is cleaner. Scaled by rover width vs video f220. |
| run | video 288–330, every 2nd | 22 | 66.67 ms, loop | Dust trail dropped (particles do dust). Per-frame panel anchor (rover translates). |
| jump / jumpLand | video 131–153 | 9 / 3 | 66.67 ms, once, hold last | Split at touchdown (video f149). |
| bounce / bounceLand | video 155–209 | 24 / 4 | 66.67 ms, once, hold last | Airbags inflate → apex → squash. Split at f203. |
| damage | video 233–263 | 16 | 66.67 ms, once | Sparks + flame; long smoke tail 265–284 replaced by pooled procedural smoke. |

- Excluded: video pass 1 overlay frames 57–77, transition frames 85/286, labels on the sheet.
- Key: magenta (`min(r,b) > 90 && g < 0.45·min(r,b)`) incl. dark-magenta shadow, then magenta despill.
- Anchor: deep-blue panel top-centre. Jump/bounce use the idle x (video rover is horizontally static); damage is fully fixed to the idle anchor (the panel tilts).
- Scale 0.691 of video → idle chassis (panel top → wheel bottom) = 67 px ≈ 60% of Spirit's 111 px. Cell anchor: panelTop (99,49), footY 121.

## Content (M2)

- Reviewed strings: `content/{sojourner,spirit,opportunity}.json`. These are dev-time sources, compiled into level JSON in M3/M4; `content/` is not deployed.
- Ledger: `content/corrections.json` (31 entries) → `docs/content-corrections.md` via `node tools/render_ledger.mjs`.
- Menu facts: `content/facts.json` (10 facts, ≥ 1 per rover, science.nasa.gov sources) and an archive-wide dramatization note.
- Checker: `node tools/check_content.mjs` covers verbatim-or-ledgered wording, counts, the 12-word limit, unique IDs, quiz correct-option IDs, `taughtBy` logs, official sources, facts absent from fragments, and V1 text in shipped files. It extracts the V1 strings from `git show cdd546b^:game_content_script_spirit_level.md`.
- NASA reference pages for the PRD URLs were fetched to `<scratchpad>/md_ref/*.md`; key facts are summarised in the ledger reasons.

## Next action

M3: Create the shared runtime.
- `js/core/LevelSchema.js`: validator, usable in Node and the browser.
- `tools/build_levels.mjs`: content + layout → `assets/data/levels/*.json`, validating as it goes.
- `js/core/TimeCoordinator.js`: reasons and precedence.
- `js/core/SaveStore.js`: v2 save, migrating `roverRush.codex.MER-A`.
- `js/core/Abilities.js`: registry.
- `js/core/PixelTextures.js`: procedural pixel textures.

Then refactor `GameScene` to read the level JSON. Check: build_levels and the validators pass, and the Spirit bot run matches the baseline.

## Commands run / results

- `git merge origin/main` → b15ac95 (brought in scripts + Sojourner art). OK.
- `node tools/check_content.mjs` → 862 assertions; only the 15 expected V1 failures (`js/ContentDatabase.js`).
- `python3 tools/build_sojourner.py` → 79 frames 196×163, scale 0.691, footY 121. Visually checked contact sheets (all clips aligned on the foot line).
