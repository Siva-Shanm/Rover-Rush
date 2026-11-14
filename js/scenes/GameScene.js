/**
 * GameScene — data-driven mission runtime (Sojourner, Spirit, Opportunity).
 * ---------------------------------------------------------------------------
 * The level JSON (compiled by tools/build_levels.mjs) supplies every number:
 * world, terrain, hazards, physics, the rover sprite map and the single
 * signature ability. State is kept in separate machines:
 *   locomotion: grounded / airborne (+ genuine-landing detection)
 *   ability:    owned by the ability object (ready / active / recharging / ...)
 *   life:       alive / dead (+ real-time invulnerability window)
 *   run:        intro / run / finished / over  (modal freezes pause the scene)
 * Time dilation goes through TimeCoordinator; physics is stepped manually once
 * per rendered frame with delta / world.timeScale (smooth slow motion).
 */
class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    /** `?fx=0` disables post-processing / glow FX (low-end GPUs, software WebGL). */
    static fxEnabled() { return new URLSearchParams(window.location.search).get('fx') !== '0'; }

    init(data) {
        this.missionId = (data && data.missionId) || 'spirit';
        this.state = 'intro';
        this.realTime = 0;
        this.realTimers = [];
        this.emitters = [];
        this.collected = new Set();
        this.confirmedLogs = new Set();
        this.fragmentQueue = [];
        this.fragmentShowing = false;
        this.invulnUntil = 0;
        this.damageAnimUntil = 0;
        this.lastGroundedAt = 0;
        this.airborneMs = 0;
        this.jumpHolding = false;
        this.jumpHoldMs = 0;
        this.spaceHoldMs = 0;
        this.legacyBoosting = false;
        this.airMode = 'fall';
        this.landAnimUntil = 0;
        this.prevX = null;
        this.activeTutorial = null;
        this.playMs = 0;                  // active-play clock for personal bests
        this.timing = false;
        this.finishRecorded = false;
        this.pausedByUser = false;
        this.lowPowerUntil = 0;
        this.hudTimer = 0;
    }

    // =====================================================================
    create() {
        const level = this.cache.json.get(`level:${this.missionId}`);
        const errs = LevelSchema.validate(level, { frameCounts: { rover: this.textures.get('rover').frameTotal - 1, sojourner: this.textures.get('sojourner').frameTotal - 1 } });
        if (errs.length) { UI.showFatal(`Level '${this.missionId}' failed validation:\n` + errs.slice(0, 8).join('\n')); return; }
        this.L = level;
        this.P = level.physics;
        this.W = level.world;
        this.hp = 3;
        this.maxHp = 3;
        this.energy = this.P.energy ? this.P.energy.max : 100;
        this.respawnX = this.W.spawnX;

        this.cam = this.cameras.main;
        this.physics.world.setBounds(this.W.startX - 1500, -600, this.W.finishX - this.W.startX + 5000, 2000);
        this.physics.world.gravity.y = this.P.gravity;
        this.physics.disableUpdate();               // stepped manually in stepPhysics()
        this.physics.world.fixedStep = false;

        this.buildParticles();
        this.levelManager = new LevelManager(this, level).build();
        this.buildPickups();
        this.buildRover();
        this.buildFX();
        this.buildInput();
        this.time_ = new TimeCoordinator(this, this.emitters);
        this.ability = Abilities.create(this, level.rover.id, level.ability);
        this.tutorials = level.tutorials.map((t) => ({ ...t, state: 'pending' }));
        this.checkpoints = level.checkpoints.map((c) => ({ ...c, done: false }));
        this.storm = level.storm ? this.buildStorm(level.storm) : null;
        if (this.storm) this.ambient.emitting = false;   // no decorative storm specks before the storm trigger

        this.events.on('postupdate', this.updateCamera, this);
        this.events.once('shutdown', this.cleanup, this);
        this.cam.scrollX = Math.round(this.rover.x - 300);
        this.levelManager.updateParallax(this.cam.scrollX);

        UI.configureHUD({ energy: !!level.hud.energy, abilityLabel: level.hud.ability, narrative: level.hud.distanceLabel || '', checkpoints: level.checkpoints.map((c) => c.p) });
        UI.showHUD(true);
        UI.hideTutorial();
        UI.hideFragment();
        if (level.intro) this.playIntro(level.intro); else this.beginControl();
    }

    cleanup() {
        if (this.time_) this.time_.reset();
        this.anims.globalTimeScale = 1;
        this.events.off('postupdate', this.updateCamera, this);
        this.realTimers = [];
        if (this.input && this.input.keyboard) this.input.keyboard.enableGlobalCapture();
        UI.hideTutorial(); UI.hideFragment(); UI.hideIntro(); UI.showHUD(false);
        UI.clearFragmentQueue && UI.clearFragmentQueue();
    }

    // ------------------------------------------------------------ builders
    buildRover() {
        const R = this.L.rover;
        this.registerClips(R);
        const top = this.levelManager.groundTopAt(this.W.spawnX) ?? this.W.groundY;
        const r = this.physics.add.sprite(this.W.spawnX, this.yForFoot(top), R.texture).setDepth(6).setOrigin(R.origin.x, R.origin.y).setScale(R.displayScale);
        r.body.setMaxVelocity(4000, 2000);
        this.rover = r;
        this.setBodyHeight(null);
        this.physics.add.collider(r, this.levelManager.groundGroup);
        this.playClip('idle');
    }

    /** Sprite centre y that puts the rover's foot line on ground top `y`. */
    yForFoot(y) { const R = this.L.rover; return y - (R.body.footY - R.frameHeight * R.origin.y) * R.displayScale; }

    registerClips(R) {
        for (const [name, c] of Object.entries(R.clips)) {
            const key = `${R.texture}:${name}`;
            if (this.anims.exists(key)) continue;           // registered once per game instance
            this.anims.create({
                key, frames: this.anims.generateFrameNumbers(R.texture, { frames: c.frames }),
                duration: undefined, frameRate: 1000 / c.frameDurationMs, repeat: c.repeat,
            });
        }
    }

    playClip(name, ignoreIfPlaying = true) {
        const key = `${this.L.rover.texture}:${name}`;
        if (!this.anims.exists(key)) return;
        if (ignoreIfPlaying && this.rover.anims.currentAnim && this.rover.anims.currentAnim.key === key) return;
        this.rover.play(key);
    }

    /** null = standing body; number = shorter body anchored at the feet (Spirit slide only). */
    setBodyHeight(h) {
        const B = this.L.rover.body;
        const height = h || B.h;
        this.rover.body.setSize(B.w, height, false).setOffset(B.offsetX, B.footY - height);
        this.bodyH = height;
    }

    roverFootY() { const R = this.L.rover; return this.rover.y + (R.body.footY - R.frameHeight * R.origin.y) * R.displayScale; }

    /** Current hitbox from the sprite (always fresh; Arcade repositions a resized body next step). */
    roverRect() {
        const R = this.L.rover;
        const left = this.rover.x - R.frameWidth * R.origin.x * R.displayScale + R.body.offsetX;
        return new Phaser.Geom.Rectangle(left, this.roverFootY() - this.bodyH, R.body.w, this.bodyH);
    }

    standingRect() { const r = this.roverRect(); const h = this.L.rover.body.h; return new Phaser.Geom.Rectangle(r.x, r.bottom - h, r.width, h); }

    buildPickups() {
        const G = this.W.groundY;
        this.fragments = this.L.pickups.fragments.filter((f) => !f.hiddenUntil).map((f) => this.makeFragment(f, f.x, f.y));
        this.hiddenFragments = this.L.pickups.fragments.filter((f) => f.hiddenUntil);
        this.batteries = this.L.pickups.batteries.map((b) => {
            const s = this.add.image(b.x, b.y, 'battery').setDepth(6);
            if (s.preFX && GameScene.fxEnabled()) { s.preFX.padding = 6; s.preFX.addGlow(0xffd23f, 3, 0, false, 0.1, 8); }
            this.tweens.add({ targets: s, y: s.y - 10, duration: 700, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [4] });
            return { def: b, sprite: s, taken: false };
        });
        void G;
    }

    makeFragment(def, x, y) {
        const s = this.add.sprite(x, y, 'fragment').setDepth(6);
        s.play('fragment-spin');
        if (s.preFX && GameScene.fxEnabled()) { s.preFX.padding = 10; s.preFX.addGlow(0x3ff6ff, 4, 0, false, 0.1, 10); }
        this.tweens.add({ targets: s, y: y - 12, duration: 900, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [6] });
        return { def, sprite: s, taken: false };
    }

    buildParticles() {
        const common = { blendMode: 'ADD', emitting: false };
        const add = (cfg, depth) => { const e = this.add.particles(0, 0, 'px4', { ...common, ...cfg }).setDepth(depth); this.emitters.push(e); return e; };
        this.dust = add({ speedX: { min: -220, max: -80 }, speedY: { min: -110, max: -20 }, gravityY: 380, lifespan: { min: 280, max: 560 },
            scale: { start: 1.5, end: 0.5 }, alpha: { start: 0.85, end: 0 }, tint: [0xd2691e, 0xff7f3f, 0xa0522d, 0xe8743b], frequency: 22 }, 5.9);
        this.thruster = add({ speedX: { min: -420, max: -240 }, speedY: { min: -30, max: 60 }, lifespan: { min: 160, max: 320 }, scale: { start: 1.6, end: 0.25 },
            alpha: { start: 1, end: 0 }, tint: [0x5fd3ff, 0x9be8ff, 0xffe066, 0xfff6c0], frequency: 10, quantity: 2 }, 5.8);
        this.sparks = add({ speed: { min: 120, max: 320 }, angle: { min: 0, max: 360 }, gravityY: 600, lifespan: { min: 220, max: 520 },
            scale: { start: 1.2, end: 0.3 }, alpha: { start: 1, end: 0 }, tint: [0xffff66, 0xffcc00, 0xffffff] }, 9);
        this.dataBurst = add({ speed: { min: 80, max: 260 }, angle: { min: 0, max: 360 }, lifespan: { min: 300, max: 700 }, scale: { start: 1.4, end: 0 },
            alpha: { start: 1, end: 0 }, tint: [0x3ff6ff, 0xb9ffff, 0xffffff] }, 9);
        this.shards = this.add.particles(0, 0, 'px4', { emitting: false, speed: { min: 100, max: 260 }, angle: { min: 200, max: 340 }, gravityY: 700,
            lifespan: { min: 400, max: 800 }, scale: { start: 1.5, end: 0.6 }, tint: [0xf2f2ff, 0xc9c9d6, 0x9a8f8f] }).setDepth(9);
        this.emitters.push(this.shards);
        this.ambient = this.add.particles(0, 0, 'px4', { x: { min: 0, max: 1400 }, y: { min: 60, max: 640 }, speedX: { min: -60, max: -20 }, speedY: { min: -6, max: 10 },
            lifespan: 6000, scale: { min: 0.5, max: 1 }, alpha: { start: 0, end: 0.5, ease: 'Sine.inOut' }, tint: [0xffc98a, 0xff9a5c], frequency: 140, blendMode: 'ADD' })
            .setScrollFactor(0).setDepth(9.5);
        this.emitters.push(this.ambient);
        // pooled procedural effects (textures cached once; bounded particle counts)
        this.smoke = this.add.particles(0, 0, PixelTextures.puff(this, 'smoke'), { emitting: false, speedX: { min: -50, max: 10 }, speedY: { min: -70, max: -30 },
            lifespan: { min: 500, max: 900 }, scale: { start: 1, end: 1.6 }, alpha: { start: 0.85, end: 0 }, maxParticles: 24 }).setDepth(9);
        this.airbags = this.add.particles(0, 0, PixelTextures.puff(this, 'airbag'), { emitting: false, speed: { min: 40, max: 110 }, angle: { min: 200, max: 340 },
            lifespan: { min: 250, max: 420 }, scale: { start: 1.6, end: 0.9 }, alpha: { start: 1, end: 0 }, maxParticles: 16 }).setDepth(7);
        this.windTrail = this.add.particles(0, 0, PixelTextures.streak(this, 'cyan'), { emitting: false, speedX: { min: -520, max: -360 }, speedY: { min: -12, max: 12 },
            lifespan: { min: 180, max: 320 }, alpha: { start: 0.95, end: 0 }, frequency: 16, quantity: 2, maxParticles: 40 }).setDepth(5.8);
        this.panelGlow = this.add.particles(0, 0, PixelTextures.streak(this, 'gold'), { emitting: false, speedX: { min: -80, max: 40 }, speedY: { min: -40, max: -10 },
            lifespan: { min: 200, max: 360 }, alpha: { start: 1, end: 0 }, frequency: 30, maxParticles: 20, blendMode: 'ADD' }).setDepth(6.5);
        [this.smoke, this.airbags, this.windTrail, this.panelGlow].forEach((e) => this.emitters.push(e));
    }

    attachFollowers() {
        const R = this.L.rover;
        const footOff = (R.body.footY - R.frameHeight * R.origin.y) * R.displayScale;
        const halfW = R.body.w / 2;
        this.dust.startFollow(this.rover, -halfW, footOff - 4);
        this.thruster.startFollow(this.rover, -halfW - 14, footOff - 50);
        this.windTrail.startFollow(this.rover, -halfW - 10, footOff - 40);
        this.panelGlow.startFollow(this.rover, 0, footOff - this.L.rover.body.h - 6);
    }

    buildFX() {
        this.attachFollowers();
        if (this.renderer.type !== Phaser.WEBGL || !this.cam.postFX || !GameScene.fxEnabled()) return;
        this.cam.postFX.addBloom(0xffffff, 1, 1, 0.6, 0.7, 4);
        this.cam.postFX.addVignette(0.5, 0.5, 0.92, 0.38);
    }

    buildInput() {
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = this.input.keyboard.addKeys({ space: K.SPACE, up: K.UP, w: K.W, shift: K.SHIFT, down: K.DOWN, s: K.S, e: K.E, enter: K.ENTER, esc: K.ESC, x: K.X });
        this.input.keyboard.addCapture([K.SPACE, K.SHIFT, K.UP, K.DOWN]);
        this.onBlur = () => this.input.keyboard.resetKeys();
        window.addEventListener('blur', this.onBlur);
        this.events.once('shutdown', () => window.removeEventListener('blur', this.onBlur));
    }

    /** Opportunity storm: cached dither overlay + fog (Canvas-safe) and a WebGL colour grade. */
    buildStorm(cfg) {
        const key = PixelTextures.stormDither(this);
        const fog = this.add.rectangle(0, 0, 1280, 720, Phaser.Display.Color.HexStringToColor(cfg.color).color, 1).setOrigin(0).setScrollFactor(0).setDepth(40).setAlpha(0);
        const dither = this.add.tileSprite(0, 0, 640, 360, key).setOrigin(0).setScale(2).setScrollFactor(0).setDepth(41).setAlpha(0);
        let grade = null;
        if (this.renderer.type === Phaser.WEBGL && this.cam.postFX && GameScene.fxEnabled()) grade = this.cam.postFX.addColorMatrix();
        return { cfg, fog, dither, grade, blackout: 0 };
    }

    updateStorm(p) {
        const S = this.storm;
        const q = Phaser.Math.Clamp((p - S.cfg.startP) / (1 - S.cfg.startP), 0, 1);
        const cap = S.cfg.maxOverlay;
        S.fog.setAlpha(Math.max(Math.min(cap * 0.75, q * cap * 0.75), S.blackout));
        S.dither.setAlpha(q * 0.45);
        S.dither.tilePositionX += 0.6 + q * 2.4;
        S.dither.tilePositionY -= 0.2;
        if (S.grade) { S.grade.reset(); if (q > 0) { S.grade.brightness(1 - 0.25 * q, true); S.grade.saturate(-0.35 * q, true); } }
        // decorative storm specks (tiny amber, non-damaging) start at the trigger and thicken with q
        this.ambient.emitting = q > 0;
        if (q > 0) this.ambient.frequency = Math.max(20, 140 - 120 * q);
        this.stormQ = q;
    }

    // ------------------------------------------------------------ flow
    playIntro(intro) {
        this.state = 'intro';
        const lander = this.levelManager.L.landmarks.find((l) => l.type === 'pathfinderLander');
        const top = this.levelManager.groundTopAt(intro.landerX) ?? this.W.groundY;
        // condensed cinematic: airbag-wrapped lander bounces in, deflates, rover rolls down the ramp
        if (lander && lander.sprite) lander.sprite.setVisible(false);
        const ball = this.add.image(intro.landerX - 900, top - 420, PixelTextures.puff(this, 'airbag')).setScale(14).setDepth(8);
        this.rover.setVisible(false);
        this.rover.body.enable = false;
        this.cam.scrollX = 0;
        UI.showIntro(intro.label, () => this.finishIntro());
        const hops = [];
        const n = intro.bounces;
        for (let i = 0; i < n; i++) {
            const t = (i + 1) / n;
            const x = intro.landerX - 900 + 900 * t;
            hops.push({ x, y: top - 60, duration: 420, ease: 'Quad.easeIn' });
            if (i < n - 1) hops.push({ x: x + 900 / n / 2, y: top - 60 - 260 * (1 - t), duration: 380, ease: 'Quad.easeOut' });
        }
        this.introTween = this.tweens.chain({
            targets: ball, tweens: hops,
            onComplete: () => {
                this.tweens.add({ targets: ball, scaleY: 4, scaleX: 16, alpha: 0, duration: 500, onComplete: () => ball.destroy() });
                if (lander && lander.sprite) lander.sprite.setVisible(true);
                this.rover.setVisible(true);
                this.rover.setPosition(intro.rampTopX, this.yForFoot(top - 28));
                this.playClip('run');
                this.introTween = this.tweens.add({ targets: this.rover, x: intro.rampBottomX + 40, y: this.yForFoot(top), duration: 1300, ease: 'Linear', onComplete: () => this.finishIntro() });
            },
        });
        this.introBall = ball;
    }

    /** Skip and natural completion converge here: same clean starting state. */
    finishIntro() {
        if (this.state !== 'intro') return;
        if (this.introTween) { this.introTween.stop(); this.introTween = null; }
        if (this.introBall && this.introBall.active) this.introBall.destroy();
        const lander = (this.L.landmarks || []).find((l) => l.type === 'pathfinderLander');
        if (lander && lander.sprite) lander.sprite.setVisible(true);
        UI.hideIntro();
        const top = this.levelManager.groundTopAt(this.W.spawnX) ?? this.W.groundY;
        this.rover.setVisible(true);
        this.rover.body.enable = true;
        this.rover.body.reset(this.W.spawnX, this.yForFoot(top));
        this.beginControl();
    }

    beginControl() {
        this.state = 'run';
        this.timing = true;
        this.input.keyboard.resetKeys();
        this.rover.body.enable = true;
        this.playClip('run');
    }

    pauseFor(open) {
        const prev = this.state;
        this.state = 'paused';
        this.timing = false;
        this.rover.body.setVelocityX(0);
        this.input.keyboard.disableGlobalCapture();      // let the DOM modal receive Space/Enter
        this.scene.pause();
        open(() => {
            this.input.keyboard.enableGlobalCapture();
            this.input.keyboard.resetKeys();                // no accidental jump/ability on confirm
            this.state = prev;
            this.timing = prev === 'run';
            this.scene.resume();
        });
    }

    after(ms, fn) { this.realTimers.push({ at: this.realTime + ms, fn }); }

    // ------------------------------------------------------------ input helpers
    grounded() { return this.rover.body.blocked.down; }

    canJump() {
        return (this.grounded() || this.realTime - this.lastGroundedAt < this.P.coyoteMs) && this.rover.body.velocity.y >= 0 && !this.ability.isSliding();
    }

    jumpKeyHeld() { return this.keys.space.isDown || this.keys.up.isDown || this.keys.w.isDown; }

    /** Taught action performed: mark it (the box stays until the player confirms with X or the button). */
    tutorialInput(key) {
        const t = this.activeTutorial;
        if (!t || t.accepted) return;
        if (t.accepts.includes(key)) { t.accepted = true; UI.markTutorialDone(); }
    }

    // ------------------------------------------------------------ pause (button / Esc)
    pauseGame() {
        if (this.state !== 'run' || this.pausedByUser) return;
        this.pausedByUser = true;
        this.input.keyboard.disableGlobalCapture();
        this.scene.pause();                      // freezes physics, timers, damage, energy and the clear clock
        UI.showPause({ onResume: () => this.resumeGame(), onMenu: () => this.abandonToMenu() });
    }

    resumeGame() {
        if (!this.pausedByUser) return;
        UI.close();
        this.pausedByUser = false;
        this.input.keyboard.enableGlobalCapture();
        this.input.keyboard.resetKeys();         // no input leaks from the pause menu
        this.scene.resume();                     // tutorial overlay / slow motion beneath are untouched
    }

    /** Abandon: keep best legitimate progress, never record a clear. */
    abandonToMenu() {
        SaveStore.recordProgress(this.missionId, this.levelManager.progress(this.rover.x));
        UI.close();
        this.pausedByUser = false;
        this.exitToMenu();
    }

    // ------------------------------------------------------------ ability hooks
    onBounce() {
        this.airMode = 'bounce';
        this.playClip('bounce', false);
        const foot = this.roverFootY();
        this.airbags.explode(10, this.rover.x, foot - 10);
        this.airborneMs = 0;
    }

    onBoost() { this.thruster.explode(12); }

    /** Spend energy for an ability; false (and nothing spent) if the battery is too low. */
    spendEnergy(cost) {
        if (!this.P.energy || this.energy < cost) return false;
        this.energy -= cost;
        this.pushHUD(false, false);
        return true;
    }

    /** Refill from an energy source ('gust': wind-cleaned panels). */
    gainEnergy(source) {
        const E = this.P.energy;
        const amt = source === 'gust' ? (E.gustCharge || 0) : 0;
        if (!amt) return;
        this.energy = Math.min(E.max, this.energy + amt);
        this.floatText(this.rover.x, this.rover.y - 120, `+${amt} SOLAR CHARGE`, '#ffd23f');
    }

    lowPowerFeedback() {
        const a = this.ability.hud();
        this.lowPowerUntil = this.realTime + 1200;
        this.floatText(this.rover.x, this.rover.y - 80, `LOW POWER: ${a.label} NEEDS ${this.L.ability.params.energyCost}%`, '#ff5a4e');
        UI.flashEnergy();
    }

    // ------------------------------------------------------------ update
    stepPhysics(time, dtReal) {
        const world = this.physics.world;
        world.update(time, dtReal / world.timeScale);
    }

    update(time, delta) {
        if (!this.L) return;
        const dtReal = Math.min(delta, 50);
        this.realTime += dtReal;
        this.stepPhysics(time, dtReal);
        for (let i = this.realTimers.length - 1; i >= 0; i--) {
            if (this.realTime >= this.realTimers[i].at) { const t = this.realTimers.splice(i, 1)[0]; t.fn(); }
        }
        if (this.state === 'intro') {
            if (Phaser.Input.Keyboard.JustDown(this.keys.enter)) this.finishIntro();
            return;
        }
        if (this.state !== 'run') return;
        // active-play clock: real time incl. slow motion; modal pauses / hidden tab never reach update
        if (this.timing && delta < 250) this.playMs += delta;

        // tutorial confirm: fresh X press only (held/auto-repeat X never dismisses a later box)
        if (Phaser.Input.Keyboard.JustDown(this.keys.x) && this.activeTutorial && !(this.keys.x.originalEvent && this.keys.x.originalEvent.repeat)) this.endTutorial(this.activeTutorial);
        const dt = dtReal / 1000 / this.physics.world.timeScale;     // game seconds (same scale as physics)
        const dtMs = dt * 1000;
        const r = this.rover, body = r.body;
        const onGround = this.grounded();
        const JD = Phaser.Input.Keyboard.JustDown;
        const jumpPressed = JD(this.keys.space) | JD(this.keys.up) | JD(this.keys.w);
        const shiftPressed = JD(this.keys.shift) | JD(this.keys.down) | JD(this.keys.s);
        const shiftDown = this.keys.shift.isDown || this.keys.down.isDown || this.keys.s.isDown;

        // locomotion: genuine landing = descent onto ground after real air time
        let landed = false;
        if (onGround) {
            if (this.airborneMs > 40 && body.velocity.y >= 0) landed = true;
            this.airborneMs = 0;
            this.lastGroundedAt = this.realTime;
        } else this.airborneMs += dtMs;
        if (landed) { this.ability.onLanded(); this.onLanded(); }

        this.levelManager.update(dtMs);

        // exclusive SHIFT ability (processed before jump: Sojourner SPACE+SHIFT -> bounce only)
        const ab = this.ability.update({ dtMs, grounded: onGround, landed, shiftDown, shiftPressed: !!shiftPressed, jumpPressed: !!jumpPressed });
        if (jumpPressed && !ab.suppressJump) this.tryJump();

        // variable jump height (Spirit/Opportunity; Sojourner has jumpHoldMaxMs = 0)
        const jumpHeld = this.jumpKeyHeld();
        this.spaceHoldMs = jumpHeld ? this.spaceHoldMs + dtMs : 0;
        if (this.jumpHolding) {
            if (jumpHeld && body.velocity.y < 0 && this.jumpHoldMs < this.P.jumpHoldMaxMs) {
                const step = Math.min(dtMs, this.P.jumpHoldMaxMs - this.jumpHoldMs);
                this.jumpHoldMs += step;
                body.setVelocityY(body.velocity.y - this.P.jumpHoldAccel * step / 1000);
            } else this.jumpHolding = false;
        }

        // Spirit-only legacy energy + boost (E / hold SPACE) — preserved baseline
        const E = this.P.energy;
        if (E) {
            const LB = this.P.legacyBoost;           // Spirit only (E / hold SPACE)
            if (LB) {
                const want = this.keys.e.isDown || this.spaceHoldMs > LB.holdSpaceMs;
                this.legacyBoosting = want && this.energy > 0;
                if (this.legacyBoosting) { this.energy = Math.max(0, this.energy - LB.drainPerSec * dt); this.tutorialInput('E'); }
            }
            // solar trickle charge (paused while Spirit slides so it can't refund the cost)
            if (!this.ability.isSliding()) this.energy = Math.min(E.max, this.energy + E.regenPerSec * dt);
        }

        // forward speed
        let speed = this.P.cruiseSpeed;
        if (this.legacyBoosting) speed *= this.P.legacyBoost.speedMult;
        if (ab.speed) speed = ab.speed;                                   // Opportunity burst (horizontal only)
        const slow = onGround ? this.levelManager.slowAt(r.x) : 1;
        const inSand = slow < 1;
        if (inSand && !this.ability.isSliding() && !this.legacyBoosting) speed *= slow;
        body.setVelocityX(speed);

        // particles
        const boosting = this.legacyBoosting || !!ab.speed;
        this.dust.emitting = onGround;
        this.dust.frequency = inSand ? 8 : this.ability.isSliding() ? 10 : 22;
        this.thruster.emitting = this.legacyBoosting;
        this.windTrail.emitting = !!ab.speed;
        this.panelGlow.emitting = !!ab.speed;

        this.updateAnimation(onGround);
        const inv = this.realTime < this.invulnUntil;
        if (this.L.rover.id === 'sojourner') r.setAlpha(inv ? 0.75 + 0.25 * Math.sin(this.realTime / 120) : 1);   // gentle, no strobing
        else r.setAlpha(inv ? (Math.floor(this.realTime / 90) % 2 ? 0.25 : 1) : 1);

        // level logic
        const p = this.levelManager.progress(r.x);
        this.checkTutorials();
        this.checkHazards(dtMs);
        this.checkPickups();
        this.checkGusts();
        this.checkCheckpoints(p);
        if (this.state !== 'run') return;
        if (this.storm) this.updateStorm(p);
        SaveStore.recordProgress(this.missionId, p);
        if (r.x >= this.W.finishX) { this.finish(); return; }
        if (this.roverFootY() > this.W.killY) this.fellInPit();
        this.prevX = r.x;

        this.hudTimer -= dtReal;
        if (this.hudTimer <= 0) { this.hudTimer = 80; this.pushHUD(inSand, boosting); }
    }

    tryJump() {
        if (!this.canJump()) return;
        this.lastGroundedAt = -1e9;
        this.rover.body.setVelocityY(-this.P.jumpVelocity);
        this.jumpHolding = this.P.jumpHoldMaxMs > 0;
        this.jumpHoldMs = 0;
        this.spaceHoldMs = 0;
        if (this.P.energy) this.energy = Math.max(0, this.energy - this.P.energy.jumpCost);
        this.airMode = 'jump';
        this.thruster.explode(this.L.rover.id === 'sojourner' ? 6 : 18);
        if (this.L.rover.id === 'sojourner') this.playClip('jump', false);
        this.tutorialInput('SPACE');
    }

    onLanded() {
        if (this.L.rover.id !== 'sojourner') return;
        const clip = this.airMode === 'bounce' ? 'bounceLand' : 'jumpLand';
        this.airMode = 'fall';
        this.playClip(clip, false);
        this.landAnimUntil = this.realTime + this.L.rover.clips[clip].frames.length * this.L.rover.clips[clip].frameDurationMs / this.time_.current;
    }

    updateAnimation(onGround) {
        const id = this.L.rover.id;
        if (this.realTime < this.damageAnimUntil) { this.playClip('damage'); return; }
        if (id === 'sojourner') {
            if (!onGround) { this.playClip(this.airMode === 'bounce' ? 'bounce' : 'jump'); return; }   // play once, hold last pose
            if (this.realTime < this.landAnimUntil) return;                                         // authored landing frames
            this.playClip('run');
            return;
        }
        if (!onGround) this.playClip('jump');
        else if (id === 'spirit' && this.ability.isSliding()) this.playClip('slide');
        else this.playClip('run');
        const a = this.rover.anims;
        if (a.currentAnim && a.currentAnim.key.endsWith(':run')) {
            const sp = Math.abs(this.rover.body.velocity.x) || this.P.cruiseSpeed;
            a.msPerFrame = this.L.rover.clips.run.frameDurationMs * this.P.cruiseSpeed / sp;
        }
    }

    updateCamera() {
        if (!this.rover) return;
        if (this.state === 'run' || this.state === 'finished') this.cam.scrollX = Math.round(this.rover.x - 300);
        this.levelManager.updateParallax(this.cam.scrollX);
    }

    // ------------------------------------------------------------ tutorials
    checkTutorials() {
        const x = this.rover.x;
        for (const t of this.tutorials) {
            if (t.state === 'pending' && x >= t.triggerX && !this.activeTutorial) {
                t.state = 'active';
                this.activeTutorial = t;
                this.keys.x.reset();                      // a held X from before cannot confirm this box
                UI.showTutorial(t, () => this.endTutorial(t));
                this.time_.set('tutorial', 0.25, 400);
            }
        }
    }

    endTutorial(t) {
        if (t.state !== 'active') return;
        t.state = 'done';
        if (this.activeTutorial === t) this.activeTutorial = null;
        UI.hideTutorial();
        this.time_.clear('tutorial', 0);          // immediately drop only the tutorial's slow motion
    }

    // ------------------------------------------------------------ hazards
    checkHazards() {
        const rr = this.roverRect();
        const hit = this.levelManager.damageAt(rr);
        if (hit) {
            if (hit.tick) {     // time-based damage with its own cooldown (no per-frame damage)
                if (this.realTime - hit.tick.lastTick >= hit.tick.h.tickMs) { hit.tick.lastTick = this.realTime; this.damage(hit.type); }
            } else this.damage(hit.type);
        }
        const lm = this.levelManager;
        this.silicaHint = false;
        for (const e of lm.embedded) {
            if (e.done) continue;
            if (Math.abs(e.h.x - this.rover.x) < e.h.hintRadius) this.silicaHint = true;
            if (this.ability.isSliding() && Math.abs(e.h.x - this.rover.x) < e.h.radius) this.unearth(e);
        }
    }

    damage(source) {
        if (this.state !== 'run' || this.realTime < this.invulnUntil) return;
        this.hp -= 1;
        this.invulnUntil = this.realTime + 1500;
        this.damageAnimUntil = this.realTime + (this.L.rover.id === 'sojourner' ? this.L.rover.clips.damage.frames.length * this.L.rover.clips.damage.frameDurationMs : 420);
        if (this.L.rover.id === 'sojourner') this.playClip('damage', false);
        this.sparks.explode(this.L.rover.id === 'sojourner' ? 10 : 26, this.rover.x + 10, this.roverFootY() - 40);
        this.smoke.explode(8, this.rover.x - 10, this.roverFootY() - 40);
        this.after(140, () => this.sparks.explode(10, this.rover.x + 20, this.roverFootY() - 50));
        this.cam.shake(220, this.L.rover.id === 'sojourner' ? 0.004 : 0.008);
        if (source === 'devil' && this.P.energy && this.P.energy.devilDrain) this.energy = Math.max(0, this.energy - this.P.energy.devilDrain);
        if (source === 'magneticDust' && this.P.energy && this.P.energy.dustDrain) this.energy = Math.max(0, this.energy - this.P.energy.dustDrain);   // magnetic dust drains power
        this.pushHUD(false, false);
        if (this.hp <= 0) this.die();
    }

    fellInPit() {
        const pit = this.levelManager.pitAt(this.rover.x);
        const hadInv = this.realTime < this.invulnUntil;
        if (!hadInv) this.damage('pit'); else this.invulnUntil = this.realTime + 1500;
        if (this.state !== 'run') return;
        const x = pit ? pit.x1 + 70 : this.rover.x + 120;
        const top = this.levelManager.groundTopAt(x) ?? this.W.groundY;
        this.rover.body.reset(x, this.yForFoot(top));
        this.airborneMs = 0;
        this.ability.onLanded();
    }

    unearth(e) {
        e.done = true;
        this.shards.explode(30, e.h.x, this.W.groundY - 10);
        this.tweens.add({ targets: e.sprite, y: e.sprite.y + 26, duration: 300, ease: 'Stepped', easeParams: [3] });
        const def = this.hiddenFragments.find((f) => f.hiddenUntil === e.h.id);
        if (!def || this.collected.has(def.id)) return;
        const f = this.makeFragment(def, e.h.x, this.W.groundY - 10);
        this.fragments.push(f);
        this.tweens.add({ targets: f.sprite, y: this.W.groundY - 120, duration: 350, ease: 'Back.out', onComplete: () => this.collectFragment(f) });
    }

    checkGusts() {
        const rr = this.roverRect();
        for (const g of this.levelManager.gusts) {
            const inside = Phaser.Geom.Rectangle.Overlaps(rr, g.rect);
            if (inside && !g.inside && this.ability.gust(g.h.id)) this.floatText(this.rover.x, this.rover.y - 90, 'WIND GUST: PANELS CLEANED', '#bff4ff');   // gust() also recharges energy
            g.inside = inside;
        }
    }

    // ------------------------------------------------------------ pickups
    checkPickups() {
        const body = this.roverRect();
        const R = this.L.rover;
        const sweep = this.prevX === null ? 0 : Math.max(0, this.rover.x - this.prevX);     // swept: never skip at boost speed
        const rr = new Phaser.Geom.Rectangle(body.x - 12 - sweep, body.bottom - R.pickupHeight, body.width + 24 + sweep, R.pickupHeight + 10);
        for (const f of this.fragments) {
            if (f.taken) continue;
            if (this.collected.has(f.def.id)) { f.taken = true; f.sprite.destroy(); continue; }
            if (rr.contains(f.sprite.x, f.sprite.y)) this.collectFragment(f);
        }
        for (const b of this.batteries) {
            if (!b.taken && rr.contains(b.sprite.x, b.sprite.y)) {
                b.taken = true;
                this.energy = Math.min(this.P.energy.max, this.energy + this.P.energy.batteryCharge);
                this.dataBurst.explode(16, b.sprite.x, b.sprite.y);
                this.floatText(b.sprite.x, b.sprite.y - 20, `+${this.P.energy.batteryCharge} SOLAR CHARGE`, '#ffd23f');
                b.sprite.destroy();
            }
        }
    }

    collectFragment(f) {
        if (f.taken || this.collected.has(f.def.id)) return;
        f.taken = true;
        this.collected.add(f.def.id);
        this.dataBurst.explode(30, f.sprite.x, f.sprite.y);
        f.sprite.destroy();
        this.fragmentQueue.push(f.def);
        this.showNextFragment();
    }

    showNextFragment() {
        if (this.fragmentShowing || !this.fragmentQueue.length) return;
        const def = this.fragmentQueue.shift();
        this.fragmentShowing = true;
        UI.showFragment(def, 10);
        this.time_.set('fragment', 0.85, 200);
        this.after(2000, () => {
            UI.hideFragment();
            this.time_.clear('fragment', 200);
            this.fragmentShowing = false;
            this.showNextFragment();
        });
    }

    floatText(x, y, msg, color) {
        const t = this.add.text(x, y, msg, { fontFamily: 'VT323', fontSize: '28px', color, stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 900, ease: 'Stepped', easeParams: [8], onComplete: () => t.destroy() });
    }

    // ------------------------------------------------------------ checkpoints / finish / death
    checkCheckpoints(p) {
        for (const cp of this.checkpoints) {
            if (cp.done || this.rover.x < cp.x) continue;        // threshold crossing, once per id
            cp.done = true;
            this.respawnX = cp.x + 60;
            this.pushHUD(false, false);
            this.pauseFor((resume) => UI.showCheckpoint(cp, () => { this.confirmedLogs.add(cp.id); resume(); }));
            return;
        }
        void p;
    }

    finish() {
        if (this.state !== 'run') return;
        this.state = 'finished';
        this.timing = false;
        let fastest = null;
        if (!this.finishRecorded) { this.finishRecorded = true; fastest = SaveStore.recordFinish(this.missionId, this.playMs); }
        this.ability.cancel();
        this.time_.reset();
        this.rover.body.setVelocity(0, 0);
        this.rover.body.enable = false;
        this.playClip('idle');
        [this.dust, this.thruster, this.windTrail, this.panelGlow].forEach((e) => { e.emitting = false; });
        UI.hideFragment(); UI.hideTutorial();
        this.pushHUD(false, false);
        const toQuiz = () => UI.showQuiz(this.L, {
            clearMs: Math.round(this.playMs), fastestMs: fastest,
            onDecrypted: () => SaveStore.unlockCodex(this.missionId),
            onComplete: () => this.exitToMenu(),
        });
        if (this.storm) {   // safe finish reached: storm may now fully black out
            this.tweens.add({ targets: this.storm, blackout: 1, duration: 1600, onUpdate: () => this.storm.fog.setAlpha(this.storm.blackout), onComplete: toQuiz });
        } else this.after(600, toQuiz);
    }

    die() {
        this.state = 'over';
        this.timing = false;
        this.ability.cancel();
        this.time_.reset();
        this.rover.body.setVelocity(0, 0);
        [this.dust, this.thruster, this.windTrail, this.panelGlow].forEach((e) => { e.emitting = false; });
        UI.hideTutorial(); UI.hideFragment();
        this.fragmentQueue = []; this.fragmentShowing = false;
        window.setTimeout(() => UI.showGameOver({ onRetry: () => this.respawnAtCheckpoint(), onMenu: () => this.exitToMenu() }), 700);
    }

    respawnAtCheckpoint() {
        this.hp = this.maxHp;
        if (this.P.energy) this.energy = this.P.energy.max;
        this.invulnUntil = this.realTime + 1500;
        this.ability.cancel();
        this.setBodyHeight(null);
        this.tutorials.forEach((t) => { if (t.triggerX < this.respawnX || t.state === 'active') t.state = 'done'; });
        this.activeTutorial = null;
        UI.hideTutorial();
        this.time_.reset();
        const top = this.levelManager.groundTopAt(this.respawnX) ?? this.W.groundY;
        this.rover.body.reset(this.respawnX, this.yForFoot(top));
        this.airborneMs = 0;
        this.prevX = null;
        this.state = 'run';
        this.timing = true;                     // same attempt: keeps accrued time
        this.input.keyboard.resetKeys();
        this.pushHUD(false, false);
    }

    exitToMenu() {
        UI.showHUD(false);
        this.scene.stop();
        window.RoverRush.openMenu();
    }

    pushHUD(inSand, boosting) {
        let status = '';
        const a = this.ability.hud();
        if (this.ability.blocked || this.realTime < (this.lowPowerUntil || 0)) status = `LOW POWER: ${a.label} NEEDS ${this.L.ability.params.energyCost}%`;
        else if (this.silicaHint) status = 'SILICA DETECTED: SLIDE [SHIFT] TO SCRAPE';
        else if (inSand && !this.ability.isSliding() && !this.legacyBoosting) status = 'SOFT SAND: TRACTION -70%';
        else if (this.stormQ > 0) status = 'DUST STORM: SUNLIGHT FADING';
        else if (boosting) status = 'BOOST';
        UI.updateHUD({
            hp: this.hp, maxHp: this.maxHp, energy: this.energy,
            progress: this.levelManager.progress(this.rover.x),
            fragments: this.collected.size, totalFragments: 10, status, ability: a,
            timeMs: this.playMs,
        });
    }
}
