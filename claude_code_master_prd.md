# Claude Code Implementation Spec & Master Prompt: Rover Rush (Spirit 2DHD)

**Target AI:** Claude Code (Repository Integration)
**Engine Architecture:** Phaser 3 (WebGL) + Modular Vanilla JavaScript
**Visual Standard:** Authentic 16-Bit Pixel Art (Nearest-Neighbor Scaling, No Anti-Aliasing)
**Repository Context:** `Siva-Shanm/Rover-Rush` (main branch)

---

## 🛑 CLAUDE CODE INSTRUCTIONS: READ FIRST 🛑
Act as a Principal 2DHD Graphics Architect and Lead Game Engine Programmer. You are building a high-performance HTML5/Phaser 3 platformer for the NASA Space Apps Challenge 2026. 
You have direct read/write access to this repository. 

**CRITICAL RULES FOR ASSETS:**
1. **DO NOT generate smooth, vector-based procedural shapes** (no `arc`, `bezierCurve`, or abstract colored `fillRect` polygons) for the game entities. 
2. You MUST use the actual raster image files (PNG/GIF) located in the `/assets/` directory of this repository. 
3. Prior to writing code, scan the `/assets/` directory to identify the exact file names for the rover sprite sheet, memory fragments, dust devils, sand traps, silica rocks, and UI batteries. 
4. If an asset is truly missing, use a strict pixel-grid generation method (drawing discrete 4x4 pixel blocks) to create a temporary sprite. NEVER use smooth canvas curves.

---

## 1. PROJECT STRUCTURE & TECH STACK
Create a modular, production-ready project structure:
* `/index.html` (Entry point, loads Phaser via CDN and modular JS scripts)
* `/css/style.css` (Handles custom font loading and UI overlays)
* `/js/main.js` (Phaser configuration and initialization)
* `/js/scenes/BootScene.js` (Asset preloading)
* `/js/scenes/GameScene.js` (Core gameplay loop, physics, deterministic mapping)
* `/js/UIController.js` (HTML DOM manipulation for HUD, popups, and quizzes)
* `/js/ContentDatabase.js` (Stores all text, logs, and historical facts)

**Tech Stack Mandates:**
* **Engine:** Phaser 3 via CDN (`<script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>`).
* **Font:** Google Font `VT323` injected via CSS. All DOM and Canvas text MUST use this font.
* **Rendering:** Force WebGL with strict pixel art settings:
  ```javascript
  const config = {
      type: Phaser.WEBGL,
      width: 1280, height: 720, // 16:9 2DHD Aspect Ratio
      pixelArt: true,           // MANDATORY: Disables anti-aliasing
      roundPixels: true,        // Prevents sub-pixel rendering blur
      physics: { default: 'arcade', arcade: { gravity: { y: 800 } } },
      scene: [BootScene, GameScene]
  };
  ```

---

## 2. VISUAL ENGINE & 2DHD STANDARDS
* **Spritesheets:** The Spirit Rover sprite is a $48\times36$ (or similar) pixel art sheet. Configure Phaser animations for `idle`, `run`, `jump`, `slide`, and `damage`. 
* **Parallax Background:** Implement a multi-layer scrolling background (Sky, Distant Mountains/Gusev Crater, Midground Dunes, Foreground Red Dirt) moving at different speeds relative to the camera.
* **Particles:** Use Phaser's built-in WebGL Particle Emitters with `blendMode: 'ADD'` for:
  * Red/Orange dust kicking up behind the wheels during `run`.
  * Blue/Yellow thruster exhaust during `boost` or `jump`.
  * Electrical yellow sparks during `damage` state.

---

## 3. GAMEPLAY & PHYSICS MECHANICS
The player controls the Spirit Rover (MER-A). The camera auto-scrolls, or the rover runs continuously to the right at a constant base speed.
* **Jump (`SPACE`):** Applies negative Y velocity.
* **Slide (`SHIFT`):** Shrinks the arcade physics hitbox height by 50% to pass under debris and avoid wind hazards.
* **Dash/Boost (`E` or hold `SPACE`):** Consumes battery energy, increases forward speed by 50%, and triggers thruster particles.
* **Health:** 3 hits (hearts). Collision triggers 1.5s invulnerability flashing.
* **Energy Bar:** Renders as an HTML overlay or Phaser Graphics UI. Drains from abilities; refills by picking up Solar Batteries.

---

## 4. DETERMINISTIC LEVEL MAPPING
Do NOT use RNG for level generation. Map the hazards, collectibles, and checkpoints strictly to the following progression percentages (Total Distance = 12,000 units):

**0% - 25% (Arrival):**
* `2%`: Slow-mo Tutorial ("Jump! Press [SPACE] to clear craters.")
* `8%`: Memory Fragment 1 (Load text from ContentDatabase)
* `12%`: Slow-mo Tutorial ("Press [SHIFT] to Trench-Scrape Slide underneath.")
* `18%`: Solar Battery Pickup
* `25%`: Checkpoint Gate 1 (Pauses game, opens HTML terminal UI for Log 01)

**25% - 50% (Extreme Weather):**
* `27%`: Slow-mo Tutorial ("Warning: Dust Devils drain health!")
* `30%`: Dust Devil Hazard (Moving hitbox)
* `41%`: Memory Fragment 4
* `50%`: Checkpoint Gate 2 (Terminal Log 02)

**50% - 75% (The Great Discovery):**
* `52%`: Slow-mo Tutorial ("Troy Sand Traps slow you down.")
* `55%`: Sand Trap Terrain (Reduces player speed by 70% if not sliding/boosting)
* `62%`: Embedded Silica Rock (Sliding over it unearths Memory Fragment 7)
* `75%`: Checkpoint Gate 3 (Terminal Log 03)

**75% - 100% (Troy & Legacy):**
* `82%`: Memory Fragment 9
* `100%`: Final Gate -> Triggers HTML Decryption Quiz.

---

## 5. UI, TEXT, & CONTENT INTEGRATION
* All text strings, UI dialogs, and terminal logs MUST be pulled from `ContentDatabase.js`, which should be populated with the exact text from the provided `spirit_content_script.md` file in this repository.
* When a Memory Fragment is collected, scale the game time (e.g., `this.scene.timeScale = 0.2`) for 2 seconds while displaying the fragment text in a centered HTML overlay with a cyan retro terminal border, then resume speed.
* The Checkpoint Terminals and Final Quiz must be built using HTML/CSS DOM elements layered strictly *above* the canvas (`z-index: 10`), perfectly matching the 2DHD retro aesthetic.

---
**CLAUDE CODE:** Once you have read this PRD and scanned the assets directory, begin generating the project files directly into the repository.