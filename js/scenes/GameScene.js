/**
 * GameScene - core gameplay loop.
 * ---------------------------------------------------------------------------
 *  - Deterministic level: every hazard / pickup / checkpoint is placed from
 *    LEVEL_MAP by percentage of LEVEL_LENGTH. There is no RNG in level layout.
 *  - Arcade physics for the rover and ground; hazards use explicit AABB tests
 *    so their hitboxes are exact and frame-rate independent.
 *  - Time dilation (tutorial 25%, memory fragment 20%) is applied uniformly to
 *    physics, tweens, timers, animations and particle emitters.
 */
const LEVEL_LENGTH = 12000;
const GROUND_Y = 620;          // world y of the walkable surface
const BASE_SPEED = 300;        // px/s
const BOOST_MULT = 1.5;        // +50% forward speed
const SAND_MULT = 0.3;         // -70% speed in Troy sand
const JUMP_VY = -600;
const MAX_HP = 3;
const INVULN_MS = 1500;
const CAMERA_LEAD = 300;       // rover screen x
const pct = (p) => (LEVEL_LENGTH * p) / 100;

// Rover hitbox (frame is 176x136, wheels touch y=134 inside the frame)
const BODY = { w: 100, h: 84, slideH: 42, ox: 38, bottom: 134 };

/**
 * LEVEL_MAP - the full deterministic layout (percent of 12,000 units).
 * Required beats from the PRD are marked [PRD]; the remaining entries are
 * fixed filler that teaches/reinforces each mechanic and places the other
 * memory fragments from the content script.
 */
const LEVEL_MAP = {
    tutorials: [
        { at: 2,  id: 'crater',    clearAt: 6 },     // [PRD] 2%
        { at: 12, id: 'silica',    clearAt: 15.8 },  // [PRD] 12%
        { at: 27, id: 'dustDevil', clearAt: 31.5 },  // [PRD] 27%
        { at: 52, id: 'sandTrap',  clearAt: 56.5 },  // [PRD] 52%
    ],
    craters: [
        { at: 4, w: 170 }, { at: 10, w: 180 }, { at: 22, w: 190 }, { at: 33, w: 200 },
        { at: 47, w: 190 }, { at: 70, w: 210 }, { at: 78, w: 200 }, { at: 93, w: 220 },
    ],
    // slide-under silica; each ends >=150 units before the next crater so the jump is fair
    overhangs: [{ at: 14 }, { at: 19 }, { at: 44 }, { at: 66.5 }, { at: 90 }],
    dustDevils: [{ at: 30, range: 90 }, { at: 37, range: 110 }, { at: 65, range: 120 }, { at: 83.2, range: 110 }], // [PRD] 30%
    sandTraps: [{ from: 55, to: 60 }, { from: 85, to: 89 }],                     // [PRD] 55%
    batteries: [{ at: 18 }, { at: 39 }, { at: 60.6 }, { at: 72 }, { at: 88 }],   // [PRD] 18%
    fragments: [
        { n: 1, at: 8 },                 // [PRD] 8%
        { n: 2, at: 10.75, high: true },  // floats over the 10% crater: grab it at the jump apex
        { n: 3, at: 24.2 },
        { n: 5, at: 31.5 },               // between the 30% devil and the 33% crater
        { n: 4, at: 41 },                // [PRD] 41%
        { n: 6, at: 57.5 },
        { n: 8, at: 73.5 },
        { n: 9, at: 82 },                // [PRD] 82%
        { n: 10, at: 96 },
    ],
    embeddedSilica: [{ at: 62, fragment: 7 }],   // [PRD] 62% slide over -> Fragment 7
    checkpoints: [{ at: 25, n: 1 }, { at: 50, n: 2 }, { at: 75, n: 3 }],        // [PRD]
    finalGate: { at: 100 },                                                       // [PRD]
};
const TOTAL_FRAGMENTS = Object.keys(ContentDatabase.fragments).length;

class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    init(data) {
        this.autostart = !!(data && data.autostart);
        this.state = 'menu';             // menu | run | paused | over | finished
        this.hp = MAX_HP;
        this.energy = 100;
        this.collected = new Set();
        this.realTime = 0;               // unscaled ms since scene start
        this.realTimers = [];
        this.invulnUntil = 0;
        this.damageAnimUntil = 0;
        this.sliding = false;
        this.boosting = false;
        this.spaceDownAt = -1;
        this.lastGroundedAt = 0;
        this.slow = { tutorial: 1, fragment: 1 };
        this.appliedScale = 1;
        this.activeTutorial = null;
        this.fragmentQueue = [];
        this.fragmentShowing = false;
        this.respawn = { x: 140 };
        this.hudTimer = 0;
    }

    // =====================================================================
    create() {
        this.cam = this.cameras.main;
        this.physics.world.setBounds(-1000, -400, LEVEL_LENGTH + 4000, 1400);

        this.buildParallax();
        this.buildGround();
        this.buildHazards();
        this.buildPickups();
        this.buildCheckpoints();
        this.buildRover();
        this.buildParticles();
        this.buildFX();
        this.buildInput();

        this.cam.scrollX = this.rover.x - CAMERA_LEAD;

        UI.showHUD(false);
        UI.hideTutorial();
        UI.hideFragment();
        if (this.autostart) this.beginRun();
        else UI.showMenu({ onStart: () => this.beginRun(), codexUnlocked: GameScene.codexUnlocked() });

        this.events.once('shutdown', () => { this.anims.globalTimeScale = 1; });
    }

    /** `?fx=0` disables post-processing / glow FX (low-end GPUs, software WebGL). */
    static fxEnabled() {
        return new URLSearchParams(window.location.search).get('fx') !== '0';
    }

    static codexUnlocked() {
        try { return localStorage.getItem('roverRush.codex.MER-A') === '1'; } catch (e) { return false; }
    }

    // ------------------------------------------------------------ builders
    buildParallax() {
        // Each layer is a pixel texture drawn at x4 (2DHD chunky far-field),
        // pinned to the camera and scrolled at its own rate.
        const W = 1280 / 4;
        const mk = (key, y, factor) => {
            const h = AssetManifest.images[key].height;
            const t = this.add.tileSprite(0, y, W, h, key).setOrigin(0, 0).setScale(4).setScrollFactor(0);
            t.parallax = factor;
            return t;
        };
        this.layers = [
            mk('sky', -150, 0.03).setDepth(-40),        // Sky + planets
            mk('mountains', 272, 0.12).setDepth(-30),   // Distant Gusev Crater rim
            mk('dunes', 509, 0.32).setDepth(-20),       // Midground dunes
        ];
    }

    buildGround() {
        // Foreground red dirt: tiled raster strip, split by crater gaps.
        this.craters = LEVEL_MAP.craters.map((c) => ({ x0: pct(c.at), x1: pct(c.at) + c.w }));
        this.groundGroup = this.physics.add.staticGroup();
        const gh = AssetManifest.images.ground.height;
        let x = -1200;
        const segs = [];
        for (const c of this.craters) { segs.push([x, c.x0]); x = c.x1; }
        segs.push([x, LEVEL_LENGTH + 2600]);
        for (const [a, b] of segs) {
            const ts = this.add.tileSprite(a, GROUND_Y, b - a, gh * 2, 'ground').setOrigin(0, 0).setDepth(5);
            ts.tilePositionX = a % AssetManifest.images.ground.width;
            this.physics.add.existing(ts, true);
            this.groundGroup.add(ts);
        }
        // Crater pits: the same regolith, sunk and shadowed (drawn over the rover so it "falls in")
        for (const c of this.craters) {
            this.add.tileSprite(c.x0, GROUND_Y + 52, c.x1 - c.x0, gh, 'ground')
                .setOrigin(0, 0).setTint(0x4a2018).setDepth(7);
        }
    }

    buildHazards() {
        // --- Silica overhangs (slide under) -----------------------------
        this.overhangs = LEVEL_MAP.overhangs.map((o) => {
            const x = pct(o.at), w = 176;
            const tipY = GROUND_Y - 58;                    // crystal tips
            const slabBottom = tipY - 64;
            this.add.tileSprite(x - 12, slabBottom - 40, w + 24, 40, 'ground').setOrigin(0, 0).setFlipY(true).setDepth(4);
            for (let i = 0; i < 2; i++) {
                this.add.image(x + i * 88, slabBottom - 4, 'silica').setOrigin(0, 0).setFlipY(true).setDepth(4);
            }
            return { rect: new Phaser.Geom.Rectangle(x + 6, slabBottom - 40, w - 12, tipY - (slabBottom - 40)) };
        });

        // --- Dust devils (moving hitbox) ---------------------------------
        this.devils = LEVEL_MAP.dustDevils.map((d) => {
            const x = pct(d.at);
            const s = this.add.sprite(x, GROUND_Y + 8, 'dustdevil').setOrigin(0.5, 1).setDepth(8).setAlpha(0.95);
            s.play('devil-spin');
            this.tweens.add({ targets: s, x: x - d.range, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
            return { sprite: s, rect: new Phaser.Geom.Rectangle() };
        });

        // --- Troy sand traps ---------------------------------------------
        this.sandZones = LEVEL_MAP.sandTraps.map((z) => {
            const x0 = pct(z.from), x1 = pct(z.to);
            const fw = AssetManifest.spritesheets.sandtrap.frameWidth;
            for (let x = x0; x < x1 - fw * 0.5; x += fw - 14) {
                this.add.image(x, GROUND_Y + 36, 'sandtrap').setOrigin(0, 1).setDepth(7);
            }
            return { x0, x1 };
        });

        // --- Embedded silica (slide over it to unearth Fragment 7) ------
        this.embedded = LEVEL_MAP.embeddedSilica.map((e) => {
            const x = pct(e.at);
            const s = this.add.image(x, GROUND_Y + 30, 'silica').setOrigin(0.5, 1).setDepth(4);
            if (s.preFX && GameScene.fxEnabled()) s.preFX.addGlow(0xbffcff, 2, 0, false, 0.1, 6);
            return { x, sprite: s, fragment: e.fragment, done: false };
        });
    }

    buildPickups() {
        this.fragments = LEVEL_MAP.fragments.map((f) => this.makeFragment(pct(f.at), f.high ? GROUND_Y - 262 : GROUND_Y - 70, f.n));
        this.batteries = LEVEL_MAP.batteries.map((b) => {
            const s = this.add.image(pct(b.at), GROUND_Y - 80, 'battery').setDepth(6);
            if (s.preFX && GameScene.fxEnabled()) { s.preFX.padding = 6; s.preFX.addGlow(0xffd23f, 3, 0, false, 0.1, 8); }
            this.tweens.add({ targets: s, y: s.y - 10, duration: 700, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [4] });
            return { sprite: s, taken: false };
        });
    }

    makeFragment(x, y, n) {
        const s = this.add.sprite(x, y, 'fragment').setDepth(6);
        s.play('fragment-spin');
        if (s.preFX && GameScene.fxEnabled()) { s.preFX.padding = 10; s.preFX.addGlow(0x3ff6ff, 4, 0, false, 0.1, 10); }
        this.tweens.add({ targets: s, y: y - 12, duration: 900, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [6] });
        return { sprite: s, n, taken: false };
    }

    buildCheckpoints() {
        const mk = (x) => {
            const g = this.add.image(x, GROUND_Y + 4, 'gate').setOrigin(0.5, 1).setDepth(4);
            if (g.preFX && GameScene.fxEnabled()) { g.preFX.padding = 8; g.preFX.addGlow(0x3ff6ff, 1.5, 0, false, 0.1, 6); }
            return g;
        };
        this.checkpoints = LEVEL_MAP.checkpoints.map((c) => ({ x: pct(c.at), n: c.n, done: false, sprite: mk(pct(c.at)) }));
        this.finalGate = { x: pct(LEVEL_MAP.finalGate.at), done: false, sprite: mk(pct(LEVEL_MAP.finalGate.at)) };
        this.tutorials = LEVEL_MAP.tutorials.map((t) => ({ ...t, x: pct(t.at), clearX: pct(t.clearAt), state: 'pending' }));
    }

    buildRover() {
        const r = this.physics.add.sprite(this.respawn.x, GROUND_Y - 68, 'rover').setDepth(6);
        r.body.setSize(BODY.w, BODY.h, false).setOffset(BODY.ox, BODY.bottom - BODY.h);
        r.body.setMaxVelocity(2000, 1400);
        r.play('rover-idle');
        this.physics.add.collider(r, this.groundGroup);
        this.rover = r;
    }

    buildParticles() {
        const common = { blendMode: 'ADD', emitting: false };
        // Red/orange regolith kicked up by the wheels
        this.dust = this.add.particles(0, 0, 'px4', {
            ...common,
            speedX: { min: -220, max: -80 }, speedY: { min: -110, max: -20 },
            gravityY: 380, lifespan: { min: 280, max: 560 },
            scale: { start: 1.5, end: 0.5 }, alpha: { start: 0.85, end: 0 },
            tint: [0xd2691e, 0xff7f3f, 0xa0522d, 0xe8743b], frequency: 22, quantity: 1,
        }).setDepth(5.9);
        this.dust.startFollow(this.rover, -52, 60);

        // Blue/yellow thruster exhaust (boost + jump)
        this.thruster = this.add.particles(0, 0, 'px4', {
            ...common,
            speedX: { min: -420, max: -240 }, speedY: { min: -30, max: 60 },
            lifespan: { min: 160, max: 320 }, scale: { start: 1.6, end: 0.25 },
            alpha: { start: 1, end: 0 }, tint: [0x5fd3ff, 0x9be8ff, 0xffe066, 0xfff6c0], frequency: 10, quantity: 2,
        }).setDepth(5.8);
        this.thruster.startFollow(this.rover, -64, 18);

        // Electrical yellow sparks (damage)
        this.sparks = this.add.particles(0, 0, 'px4', {
            ...common,
            speed: { min: 120, max: 320 }, angle: { min: 0, max: 360 }, gravityY: 600,
            lifespan: { min: 220, max: 520 }, scale: { start: 1.2, end: 0.3 },
            alpha: { start: 1, end: 0 }, tint: [0xffff66, 0xffcc00, 0xffffff],
        }).setDepth(9);

        // Cyan data burst (fragments) + white silica shards
        this.dataBurst = this.add.particles(0, 0, 'px4', {
            ...common,
            speed: { min: 80, max: 260 }, angle: { min: 0, max: 360 },
            lifespan: { min: 300, max: 700 }, scale: { start: 1.4, end: 0 },
            alpha: { start: 1, end: 0 }, tint: [0x3ff6ff, 0xb9ffff, 0xffffff],
        }).setDepth(9);
        this.shards = this.add.particles(0, 0, 'px4', {
            emitting: false, speed: { min: 100, max: 260 }, angle: { min: 200, max: 340 }, gravityY: 700,
            lifespan: { min: 400, max: 800 }, scale: { start: 1.5, end: 0.6 },
            tint: [0xf2f2ff, 0xc9c9d6, 0x9a8f8f],
        }).setDepth(9);

        // Ambient airborne dust (screen space) for atmosphere
        this.ambient = this.add.particles(0, 0, 'px4', {
            x: { min: 0, max: 1400 }, y: { min: 60, max: 640 },
            speedX: { min: -60, max: -20 }, speedY: { min: -6, max: 10 },
            lifespan: 6000, scale: { min: 0.5, max: 1 }, alpha: { start: 0, end: 0.5, ease: 'Sine.inOut' },
            tint: [0xffc98a, 0xff9a5c], frequency: 140, blendMode: 'ADD',
        }).setScrollFactor(0).setDepth(9.5);

        this.emitters = [this.dust, this.thruster, this.sparks, this.dataBurst, this.shards, this.ambient];
    }

    buildFX() {
        // 2DHD post-processing (WebGL only): soft bloom on bright pixels + vignette.
        // (No tilt-shift/DOF: it blurs the play plane and breaks pixel crispness.)
        if (this.renderer.type !== Phaser.WEBGL || !this.cam.postFX || !GameScene.fxEnabled()) return;
        this.cam.postFX.addBloom(0xffffff, 1, 1, 0.6, 0.7, 4);
        this.cam.postFX.addVignette(0.5, 0.5, 0.92, 0.38);
    }

    buildInput() {
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = this.input.keyboard.addKeys({ space: K.SPACE, shift: K.SHIFT, e: K.E, up: K.UP, down: K.DOWN, w: K.W, s: K.S });
        this.input.keyboard.on('keydown-SPACE', () => this.onJumpPressed());
        this.input.keyboard.on('keydown-UP', () => this.onJumpPressed());
        this.input.keyboard.on('keydown-W', () => this.onJumpPressed());
        // Don't let the DOM UI keep focus-stealing keys while playing
        this.input.keyboard.addCapture([K.SPACE, K.SHIFT, K.UP, K.DOWN]);
    }

    // ------------------------------------------------------------- flow
    beginRun() {
        this.state = 'run';
        UI.showHUD(true);
        this.rover.play('rover-run');
    }

    pauseFor(cb) {
        this.state = 'paused';
        this.rover.body.setVelocity(0, 0);
        this.scene.pause();
        cb(() => {
            this.state = 'run';
            this.scene.resume();
        });
    }

    // Time dilation (applies to physics, tweens, timers, anims and particles)
    setSlow(channel, f) {
        this.slow[channel] = f;
        const s = Math.min(this.slow.tutorial, this.slow.fragment);
        if (s === this.appliedScale) return;
        this.appliedScale = s;
        this.physics.world.timeScale = 1 / s;      // arcade: >1 = slower
        this.tweens.timeScale = s;
        this.time.timeScale = s;
        this.anims.globalTimeScale = s;
        this.emitters.forEach((em) => { em.timeScale = s; });
    }

    after(ms, fn) { this.realTimers.push({ at: this.realTime + ms, fn }); }

    // -------------------------------------------------------------- input
    grounded() { return this.rover.body.blocked.down || this.rover.body.touching.down; }

    // coyote time: still counts as grounded for 90 ms (real) after leaving the floor
    canJump() {
        return (this.grounded() || this.realTime - this.lastGroundedAt < 90) && this.rover.body.velocity.y >= 0;
    }

    onJumpPressed() {
        if (this.state !== 'run') return;
        this.spaceDownAt = this.realTime;
        if (this.canJump() && !this.sliding) {
            this.lastGroundedAt = -1e9;
            this.rover.body.setVelocityY(JUMP_VY);
            this.energy = Math.max(0, this.energy - 4);
            this.thruster.explode(18);
            this.tutorialInput('SPACE');
        }
    }

    tutorialInput(key) {
        const t = this.activeTutorial;
        if (!t) return;
        const want = ContentDatabase.tutorials[t.id].key;
        if (want.split('/').map((s) => s.trim()).includes(key)) UI.markTutorialDone();
    }

    // ------------------------------------------------------------- update
    update(time, delta) {
        const dtReal = Math.min(delta, 50);
        this.realTime += dtReal;
        // fire real-time timers (unaffected by slow-mo)
        for (let i = this.realTimers.length - 1; i >= 0; i--) {
            if (this.realTime >= this.realTimers[i].at) { const t = this.realTimers.splice(i, 1)[0]; t.fn(); }
        }

        this.updateParallax();
        if (this.state === 'menu') { this.rover.body.setVelocityX(0); return; }
        if (this.state !== 'run') return;

        const dt = (dtReal / 1000) * this.appliedScale;   // game-time seconds
        const r = this.rover, body = r.body;
        const onGround = this.grounded();
        if (onGround) this.lastGroundedAt = this.realTime;

        // --- abilities ---------------------------------------------------
        const shiftHeld = this.keys.shift.isDown || this.keys.down.isDown || this.keys.s.isDown;
        const spaceHeld = this.keys.space.isDown;
        if (!spaceHeld) this.spaceDownAt = -1;
        const boostKey = this.keys.e.isDown || (spaceHeld && this.spaceDownAt >= 0 && this.realTime - this.spaceDownAt > 280);

        // Slide while SHIFT is held (on the ground or as a fast-fall in the air).
        // Not gated on `onGround`: shrinking the body can drop ground contact for
        // one step, which would otherwise make the slide flicker on/off.
        const wantSlide = shiftHeld;
        if (wantSlide !== this.sliding) this.setSliding(wantSlide);
        if (shiftHeld) this.tutorialInput('SHIFT');
        if (shiftHeld && !onGround) body.setVelocityY(body.velocity.y + 1400 * dt);   // fast-fall

        this.boosting = boostKey && this.energy > 0;
        if (this.boosting) { this.energy = Math.max(0, this.energy - 24 * dt); this.tutorialInput('E'); }
        this.energy = Math.min(100, this.energy + 2.5 * dt);   // solar trickle charge

        // --- forward speed -----------------------------------------------
        let speed = BASE_SPEED * (this.boosting ? BOOST_MULT : 1);
        const inSand = onGround && this.sandZones.some((z) => r.x > z.x0 && r.x < z.x1);
        if (inSand && !this.sliding && !this.boosting) speed *= SAND_MULT;
        body.setVelocityX(speed);

        // --- particles ---------------------------------------------------
        this.dust.emitting = onGround;
        this.dust.frequency = inSand ? 8 : this.sliding ? 10 : 22;
        this.thruster.emitting = this.boosting;

        // --- animation ---------------------------------------------------
        let anim = 'rover-run';
        if (this.realTime < this.damageAnimUntil) anim = 'rover-damage';
        else if (!onGround) anim = 'rover-jump';
        else if (this.sliding) anim = 'rover-slide';
        if (r.anims.currentAnim?.key !== anim) r.play(anim);
        r.anims.msPerFrame = anim === 'rover-run' ? 1000 / (12 * speed / BASE_SPEED) : r.anims.msPerFrame;

        // invulnerability flicker (real time, stepped)
        const inv = this.realTime < this.invulnUntil;
        r.setAlpha(inv ? (Math.floor(this.realTime / 90) % 2 ? 0.25 : 1) : 1);

        // --- level logic -------------------------------------------------
        this.checkTutorials();
        this.checkHazards();
        this.checkPickups();
        this.checkGates();
        if (this.state !== 'run') return;

        // crater fall
        if (r.body.bottom > GROUND_Y + 70) this.fellInCrater();

        // --- camera ------------------------------------------------------
        this.cam.scrollX = Math.round(r.x - CAMERA_LEAD);

        this.hudTimer -= dtReal;
        if (this.hudTimer <= 0) { this.hudTimer = 80; this.pushHUD(inSand); }
    }

    updateParallax() {
        const sx = this.cam.scrollX;
        for (const l of this.layers) l.tilePositionX = (sx * l.parallax) / 4;
    }

    setSliding(on) {
        this.sliding = on;
        const b = this.rover.body;
        const h = on ? BODY.slideH : BODY.h;
        b.setSize(BODY.w, h, false).setOffset(BODY.ox, BODY.bottom - h);
    }

    roverRect() {
        const b = this.rover.body;
        return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
    }

    // ----------------------------------------------------------- tutorials
    checkTutorials() {
        const x = this.rover.x;
        for (const t of this.tutorials) {
            if (t.state === 'pending' && x >= t.x) {
                t.state = 'active';
                this.activeTutorial = t;
                UI.showTutorial(ContentDatabase.tutorials[t.id]);
                this.setSlow('tutorial', 0.25);
            } else if (t.state === 'active' && x >= t.clearX) {
                t.state = 'done';
                this.activeTutorial = null;
                UI.hideTutorial();
                this.setSlow('tutorial', 1);
            }
        }
    }

    // ------------------------------------------------------------- hazards
    checkHazards() {
        const rr = this.roverRect();
        for (const o of this.overhangs) {
            if (Phaser.Geom.Rectangle.Overlaps(rr, o.rect)) this.damage('silica');
        }
        for (const d of this.devils) {
            const s = d.sprite;
            // Damaging funnel band: above slide height, below jump apex.
            d.rect.setTo(s.x - 48, GROUND_Y - 122, 96, 70);
            if (Phaser.Geom.Rectangle.Overlaps(rr, d.rect)) this.damage('devil');
        }
        // embedded silica: slide across it to scrape it open
        const st = this.embedded.find((e) => !e.done && Math.abs(e.x - this.rover.x) < 260);
        this.silicaHint = !!st;
        for (const e of this.embedded) {
            if (e.done) continue;
            if (this.sliding && Math.abs(e.x - this.rover.x) < 60) this.unearth(e);
        }
    }

    damage(source) {
        if (this.realTime < this.invulnUntil) return;
        this.hp -= 1;
        this.invulnUntil = this.realTime + INVULN_MS;
        this.damageAnimUntil = this.realTime + 420;
        this.sparks.explode(26, this.rover.x + 10, this.rover.y - 10);
        this.after(140, () => this.sparks.explode(14, this.rover.x + 20, this.rover.y - 30));
        this.cam.shake(220, 0.008);
        if (source === 'devil') this.energy = Math.max(0, this.energy - 15);   // dust on the panels
        this.pushHUD(false);
        if (this.hp <= 0) this.gameOver();
    }

    fellInCrater() {
        const r = this.rover;
        const c = this.craters.find((k) => r.x > k.x0 - 80 && r.x < k.x1 + 80) || { x1: r.x };
        const hadInv = this.realTime < this.invulnUntil;
        if (!hadInv) this.damage('crater');
        else this.invulnUntil = this.realTime + INVULN_MS;
        if (this.state !== 'run') return;
        r.setPosition(c.x1 + 70, GROUND_Y - 80);
        r.body.setVelocity(0, 0);
    }

    unearth(e) {
        e.done = true;
        this.shards.explode(30, e.x, GROUND_Y - 10);
        this.tweens.add({ targets: e.sprite, y: e.sprite.y + 26, duration: 300, ease: 'Stepped', easeParams: [3] });
        const f = this.makeFragment(e.x, GROUND_Y - 10, e.fragment);
        this.fragments.push(f);
        this.tweens.add({
            targets: f.sprite, y: GROUND_Y - 120, duration: 350, ease: 'Back.out',
            onComplete: () => this.collectFragment(f),
        });
    }

    // ------------------------------------------------------------- pickups
    checkPickups() {
        // Pickups use the rover's full visible silhouette (mast included),
        // so fragments/batteries are collectable while sliding or jumping.
        const b = this.rover.body;
        const rr = new Phaser.Geom.Rectangle(b.x - 12, b.bottom - 118, b.width + 24, 128);
        for (const f of this.fragments) {
            if (!f.taken && !this.collected.has(f.n) && rr.contains(f.sprite.x, f.sprite.y)) this.collectFragment(f);
            else if (!f.taken && this.collected.has(f.n)) { f.taken = true; f.sprite.destroy(); }
        }
        for (const b of this.batteries) {
            if (!b.taken && rr.contains(b.sprite.x, b.sprite.y)) {
                b.taken = true;
                this.energy = Math.min(100, this.energy + 40);
                this.dataBurst.explode(16, b.sprite.x, b.sprite.y);
                this.floatText(b.sprite.x, b.sprite.y - 20, '+40 SOLAR CHARGE', '#ffd23f');
                b.sprite.destroy();
            }
        }
    }

    collectFragment(f) {
        if (f.taken) return;
        f.taken = true;
        this.collected.add(f.n);
        this.dataBurst.explode(30, f.sprite.x, f.sprite.y);
        f.sprite.destroy();
        this.fragmentQueue.push(f.n);
        this.showNextFragment();
    }

    showNextFragment() {
        if (this.fragmentShowing || !this.fragmentQueue.length) return;
        const n = this.fragmentQueue.shift();
        this.fragmentShowing = true;
        UI.showFragment(n, TOTAL_FRAGMENTS);
        this.setSlow('fragment', 0.2);
        this.after(2000, () => {          // 2 s of *real* time
            UI.hideFragment();
            this.setSlow('fragment', 1);
            this.fragmentShowing = false;
            this.showNextFragment();
        });
    }

    floatText(x, y, msg, color) {
        const t = this.add.text(x, y, msg, { fontFamily: 'VT323', fontSize: '28px', color, stroke: '#000', strokeThickness: 4 })
            .setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 900, ease: 'Stepped', easeParams: [8], onComplete: () => t.destroy() });
    }

    // --------------------------------------------------------------- gates
    checkGates() {
        const x = this.rover.x;
        for (const cp of this.checkpoints) {
            if (!cp.done && x >= cp.x) {
                cp.done = true;
                this.respawn = { x: cp.x + 60 };
                // clear any slow-mo before pausing for the terminal
                UI.hideFragment(); this.fragmentQueue = []; this.fragmentShowing = false;
                this.setSlow('fragment', 1);
                this.pushHUD(false);
                this.pauseFor((resume) => UI.showCheckpoint(cp.n, resume));
                return;
            }
        }
        if (!this.finalGate.done && x >= this.finalGate.x) {
            this.finalGate.done = true;
            this.finish();
        }
    }

    finish() {
        this.state = 'finished';
        this.rover.body.setVelocity(0, 0);
        this.rover.play('rover-idle');
        this.dust.emitting = false;
        this.thruster.emitting = false;
        UI.hideFragment(); UI.hideTutorial();
        this.setSlow('fragment', 1); this.setSlow('tutorial', 1);
        this.pushHUD(false);
        UI.showQuiz({
            onDecrypted: () => {   // the Codex unlocks once the final story is decrypted
                try { localStorage.setItem('roverRush.codex.MER-A', '1'); } catch (e) { /* storage blocked */ }
            },
            onComplete: () => this.scene.restart({}),
        });
    }

    gameOver() {
        this.state = 'over';
        this.rover.body.setVelocity(0, 0);
        this.dust.emitting = false;
        this.thruster.emitting = false;
        this.setSlow('fragment', 1); this.setSlow('tutorial', 1);
        UI.hideTutorial(); UI.hideFragment();
        this.after(700, () => UI.showGameOver({
            onRetry: () => this.respawnAtCheckpoint(),
            onMenu: () => this.scene.restart({}),
        }));
    }

    respawnAtCheckpoint() {
        this.hp = MAX_HP;
        this.energy = 100;
        this.invulnUntil = this.realTime + INVULN_MS;
        this.fragmentQueue = []; this.fragmentShowing = false;
        // tutorials already seen don't replay
        this.tutorials.forEach((t) => { if (t.x < this.respawn.x || t.state === 'active') t.state = 'done'; });
        this.activeTutorial = null;
        this.rover.setPosition(this.respawn.x, GROUND_Y - 80);
        this.rover.body.setVelocity(0, 0);
        this.setSliding(false);
        this.state = 'run';
        this.pushHUD(false);
    }

    pushHUD(inSand) {
        let status = '';
        if (this.silicaHint) status = 'SILICA DETECTED: SLIDE [SHIFT] TO SCRAPE';
        else if (inSand && !this.sliding && !this.boosting) status = 'SOFT SAND: TRACTION -70%';
        else if (this.boosting) status = 'BOOST';
        UI.updateHUD({
            hp: this.hp, maxHp: MAX_HP, energy: this.energy,
            progress: Math.max(0, this.rover.x) / LEVEL_LENGTH,
            fragments: this.collected.size, totalFragments: TOTAL_FRAGMENTS, status,
        });
    }
}
