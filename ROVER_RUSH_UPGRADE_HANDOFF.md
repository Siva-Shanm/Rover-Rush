# Rover Rush Master Upgrade: Handoff

Working handoff for the three-mission upgrade (Sojourner, Spirit V2, Opportunity). **Read this first when resuming.**

## Resume prompt

> Read the Rover Rush Master Upgrade PRD and ROVER_RUSH_UPGRADE_HANDOFF.md. Inspect the current branch, working tree, and diff. Reconcile any edits made after the last checkpoint, preserve existing work, and continue from the first unfinished action. Update the handoff as you go and run the remaining acceptance checks.

## Session facts

| Field | Value |
| --- | --- |
| Last updated | 2026-11-14: **Round 2 complete** (all 8 + zero-energy check), pushed to main |
| PRD | Not in the checkout. It was attached to the session as `Rover_Rush_-_Final_Claude_Code_Master_Upgrade_Prompt.md`. **Re-attach it when resuming.** |
| Branch | `claude/clever-galileo-t5dz1n` (pushed to origin; `main` receives merges on request) |
| Starting commit | `b15ac95` (merge of `origin/main`: new scripts and Sojourner art) |
| Pre-existing local edits | none (clean tree at start) |
| Last known buildable state | `b15ac95`: Spirit-only game, all checks passing (bot playthrough 3/3 HP, 10/10 fragments) |

## Round 2 (8 requirements + Opportunity zero-energy check)

Baseline at `a4352a2`:
- Sojourner: cruise 240 px/s, hop 202 px/s, bounce 454 px/s, gravity 800.
- Opportunity: boost cost 30% (kept), gust +40%, regen 2.5 %/s.
- Spirit: jumpCost 4 → must become 0.

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Opportunity red background, storm only from p 0.75 trigger | done ✓ |
| 2 | Boost energy once per activation; free jumps (Spirit jumpCost→0) | done ✓ |
| 3 | Damaging dust + pebble visibility | done ✓ |
| 4 | Sojourner cruise ×1.10 = 264, slightly higher hop | done ✓ |
| 5 | Pause button + Esc (Resume / Main Menu) | done ✓ |
| 6 | Sojourner t2 wording | done ✓ |
| 7 | X / click Confirm on every tutorial | done ✓ |
| 8 | Mobile notice on menu | done ✓ |
| + | Opportunity zero-energy recovery at tightest crossing | done ✓ |

Round 2 results:
- Sojourner: cruise 240 → 264, hop 202 → 222 px/s (apex 25 → 30 px), bounce 454 and gravity 800 unchanged.
- Sojourner channels 340 → 380 px; bounce gap 200 → 240 px; one pebble moved 2400 → 2250 to keep the tutorial approach clear.
- Spirit jump cost 4 → 0. Opportunity boost cost 30% kept (gust +40%, regen 2.5%/s).
- Zero-energy check, tightest crossing (33400, 900 px, gust-5): 42% predicted by the sim, 49% measured in the browser, crossed with no damage.
- Verification:
  - `node tools/build_levels.mjs`: all sims ✓.
  - `node tools/check_content.mjs`: 1158 assertions, 0 failures.
  - Browser smoke `<scratchpad>/round2.js`: 17/18 passed. The one failure was an over-strict assertion: the storm q measured 0.87 against a 0.9 threshold at p 0.958, and its expected value there is about 0.83.

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
- [x] M3: Shared runtime: LevelManager, level JSON schema, ability registry, time coordinator, save v2 and migration, procedural texture factory
- [x] M4: Spirit V2 on the new runtime (layout/tuning unchanged) + regression checks
- [x] M5: Sojourner level: Airbag Bounce, intro reenactment, boulders/channel, reachability sim
- [x] M6: Opportunity level: Solar Wind Boost, Eagle/Endurance/storm layout, gusts
- [x] M7: Menu: rover cards, facts, loader, personal bests
- [~] M8: Integration (full acceptance suite written but not run to completion, stopped at the user's request to save usage): acceptance checks, browser playthroughs, report

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

## M3 status (in progress)

Done (committed as WIP):
- `js/core/LevelSchema.js`: validator (Node + browser).
- `js/core/TimeCoordinator.js`: reasons tutorial > fragment; freeze = scene.pause.
- `js/core/SaveStore.js`: v2 save, legacy migration, personal bests.
- `js/core/Abilities.js`: registry. trenchScrapeSlide / airbagBounce / solarWindBoost.
- `js/core/PixelTextures.js`: procedural textures.
- `js/core/LevelManager.js`: world build and queries.
- `js/scenes/GameScene.js`: data-driven rewrite.
- `tools/levels/{common,sim,spirit,sojourner,opportunity}.mjs` and `tools/build_levels.mjs`: all three levels pass schema + simulation checks. They write `assets/data/levels/*.json` and `js/data/GameData.js`.

Tuning decisions:
- Sojourner hop 0.55 J = 185 px/s (the PRD default 0.45 J gives a 14 px apex that cannot clear pebbles with margin).
- Sojourner bounce 454.
- Sojourner channels are 340 px. A ground bounce reaches at best 328 px; SPACE then SHIFT works for a SHIFT at 235–450 ms.
- Walking off the edge and then bouncing mid-air is also a valid airborne route.
- Opportunity: boost 750 px/s for 7000 ms, recharge 3000 ms. These come from Spirit's legacy boost (450 px/s, 4651 ms from a full battery) × 1.5. Course is 48000 (1.6×).

## User requests during M8

- **Energy for all rovers.** Sojourner and Opportunity use Spirit's raster energy bar.
  - Bounce costs 15% and boost costs 30%; each is refused below its cost with a LOW POWER message.
  - Magnetic dust drains 15%; wind gusts recharge 40%.
  - Build-time budget checks: Sojourner needs 13 bounces (195%) against 284% available.
  - Verified in-browser (energy_check.js): no errors.
- **Usage budget.** Do NOT rerun full levels or the full acceptance suite just because fragments were missed.

## Next action (optional)

Run `<scratchpad>/accept.js` only if the user asks. It covers schema/isolation, Spirit boost + headroom, Opportunity boost/gusts/storm, Sojourner bounce rules + clips, time precedence, checkpoint freeze, saves/migration, menu keyboard, restart cycles, load retry and blocked storage. Its Sojourner/Opportunity energy expectations need `g.energy = 100` before ability calls (already set in energy_check.js).

## Commands run / results

- Browser autopilot (`node run_mission.js <scratch> <id>`, Chromium/SwiftShader, `?fx=0`):
  - Spirit: 3/3 HP, 10/10 fragments, finish 2:02.2 play time, quiz + codex + save OK, 0 console errors.
  - Sojourner: finish, 10/10 fragments, 13 bounces, 9 hops, two-stage channels crossed. Last run: 1 plume hit, since fixed (plumes lowered → sim margin ≥ 1.18).
  - Opportunity: 3/3 HP, 10/10 fragments (fragments 7/8 moved onto boosted-landing ground), 3 boosts, all 4 wide gaps crossed.
- Fixed during M3–M6:
  - TimeCoordinator crash on scene shutdown, which broke the next mission launch.
  - Sojourner sheet 15.5k px wide (over the WebGL max texture size) → packed as a 10-column grid.
  - Ground TileSprites wider than 8192 → 2048 px visual chunks + one Zone body per segment.
  - Sojourner hop retuned 0.55 → 0.60 J (pebble window 80 → 138 ms).

- `git merge origin/main` → b15ac95 (brought in scripts + Sojourner art). OK.
- `node tools/build_levels.mjs` → ✓ all 3 levels (schema + sims), Opportunity 1.60× longest.
- `node tools/check_content.mjs` → 862 assertions; only the 15 expected V1 failures (`js/ContentDatabase.js`).
- `python3 tools/build_sojourner.py` → 79 frames 196×163, scale 0.691, footY 121. Visually checked contact sheets (all clips aligned on the foot line).
