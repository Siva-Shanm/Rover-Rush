/**
 * LevelManager — builds a mission's world from its level JSON and answers
 * spatial queries for GameScene (damage, slowdown, triggers, headroom).
 * ---------------------------------------------------------------------------
 * Every placed instance has an explicit collision role:
 *   solid      ground segments / platforms (Arcade static bodies)
 *   damage     overlap rectangles composed to follow the visible silhouette
 *   slow       Troy sand (Spirit)
 *   trigger    embedded silica, wind-gust zones
 *   pickup     fragments, batteries
 *   decoration landmarks, parallax, pit interiors (never collide)
 * Pits are genuinely absent terrain with a kill plane below, not decals.
 */
class LevelManager {
    constructor(scene, level) {
        this.scene = scene;
        this.L = level;
        this.theme = level.theme.id;
        this.raster = !!level.theme.raster;          // Spirit keeps its original raster art
        this.layers = [];
        this.overhangs = [];
        this.devils = [];
        this.clouds = [];
        this.solidRects = [];
        this.sandZones = [];
        this.embedded = [];
        this.gusts = [];
        this.rocks = [];
        this.gameMs = 0;
    }

    build() {
        this.buildParallax();
        this.buildGround();
        this.buildHazards();
        this.buildLandmarks();
        this.buildGates();
        return this;
    }

    // ------------------------------------------------------------ parallax
    buildParallax() {
        const s = this.scene;
        if (this.raster) {   // Spirit: original raster layers and factors (regression baseline)
            const W = 1280 / 4;
            const mk = (key, y, factor, depth) => {
                const h = AssetManifest.images[key].height;
                const t = s.add.tileSprite(0, y, W, h, key).setOrigin(0, 0).setScale(4).setScrollFactor(0).setDepth(depth);
                t.parallax = factor; t.scaleUnit = 4;
                this.layers.push(t);
            };
            mk('sky', -150, 0.03, -40); mk('mountains', 272, 0.12, -30); mk('dunes', 509, 0.32, -20);
            return;
        }
        // procedural chunks at increasing parallax factors 0, 0.15, 0.4 (foreground = 1)
        const T = this.theme;
        const sky = PixelTextures.parallax(s, T, 'sky');
        const ridge = PixelTextures.parallax(s, T, 'ridge');
        const rim = PixelTextures.parallax(s, T, 'rim');
        const add = (key, y, factor, depth, scale) => {
            const tex = s.textures.get(key).getSourceImage();
            const t = s.add.tileSprite(0, y, Math.ceil(1280 / scale) + 2, tex.height, key).setOrigin(0, 0).setScale(scale).setScrollFactor(0).setDepth(depth);
            t.parallax = factor; t.scaleUnit = scale;
            this.layers.push(t);
            return t;
        };
        add(sky, -20, 0, -40, 3);
        add(ridge, 300, 0.15, -30, 3);
        add(rim, 470, 0.4, -20, 2);
    }

    updateParallax(scrollX) {
        for (const l of this.layers) l.tilePositionX = (scrollX * l.parallax) / l.scaleUnit;
    }

    // ------------------------------------------------------------ terrain
    buildGround() {
        const s = this.scene;
        this.groundGroup = s.physics.add.staticGroup();
        const segs = this.L.terrain.ground;
        const bottom = this.L.world.killY + 400;
        const CHUNK = 2048;   // visual tiles are chunked: one huge TileSprite exceeds max texture size
        segs.forEach((g, i) => {
            const w = g.x1 - g.x0;
            for (let cx = g.x0; cx < g.x1; cx += CHUNK) {
                const cw = Math.min(CHUNK, g.x1 - cx);
                let ts;
                if (this.raster) {
                    const gh = AssetManifest.images.ground.height;
                    ts = s.add.tileSprite(cx, g.top, cw, gh * 2, 'ground').setOrigin(0, 0).setDepth(5);
                    ts.tilePositionX = cx % AssetManifest.images.ground.width;
                } else {
                    const key = PixelTextures.ground(s, this.theme, g.style || 'plain');
                    ts = s.add.tileSprite(cx, g.top, cw, bottom - g.top, key).setOrigin(0, 0).setDepth(5);
                    ts.tilePositionX = cx % s.textures.get(key).getSourceImage().width;
                }
            }
            // one invisible static body per segment (no texture -> any width, no internal seams)
            const bodyH = this.raster ? AssetManifest.images.ground.height * 2 : bottom - g.top;
            const zone = s.add.zone(g.x0, g.top, w, bodyH).setOrigin(0, 0);
            s.physics.add.existing(zone, true);
            this.groundGroup.add(zone);
            this.solidRects.push(new Phaser.Geom.Rectangle(g.x0, g.top, w, bottom - g.top));
            const next = segs[i + 1];
            if (next && next.x0 > g.x1) this.buildPit(g.x1, next.x0, Math.max(g.top, next.top));
        });
        (this.L.terrain.platforms || []).forEach((p) => {
            const key = PixelTextures.ground(s, this.theme, 'outcrop');
            const ts = s.add.tileSprite(p.x, p.y, p.w, p.h, key).setOrigin(0, 0).setDepth(5);
            s.physics.add.existing(ts, true);
            this.groundGroup.add(ts);
            this.solidRects.push(new Phaser.Geom.Rectangle(p.x, p.y, p.w, p.h));
        });
    }

    buildPit(x0, x1, top) {
        const s = this.scene;
        this.pits = this.pits || [];
        this.pits.push({ x0, x1 });
        if (this.raster) {   // Spirit's original crater visual
            const gh = AssetManifest.images.ground.height;
            s.add.tileSprite(x0, top + 52, x1 - x0, gh, 'ground').setOrigin(0, 0).setTint(0x4a2018).setDepth(7);
            return;
        }
        const key = PixelTextures.pit(s, this.theme);
        s.add.tileSprite(x0, top + 14, x1 - x0, 200, key).setOrigin(0, 0).setDepth(4);          // dark recessed interior
        const l = PixelTextures.rimTooth(s, this.theme, 'left'), r = PixelTextures.rimTooth(s, this.theme, 'right');
        s.add.image(x0, top - 2, l).setOrigin(0, 0).setDepth(7);                                     // broken rim teeth (decor)
        s.add.image(x1 - 16, top - 2, r).setOrigin(0, 0).setDepth(7);
    }

    groundTopAt(x) {
        const g = this.L.terrain.ground.find((s) => x >= s.x0 && x <= s.x1);
        return g ? g.top : null;
    }

    pitAt(x) { return (this.pits || []).find((p) => x > p.x0 - 120 && x < p.x1 + 120) || null; }

    // ------------------------------------------------------------ hazards
    buildHazards() {
        const s = this.scene;
        const G = this.L.world.groundY;
        for (const h of this.L.hazards) {
            switch (h.type) {
            case 'overhang': {   // Spirit silica overhang (raster, unchanged)
                const w = h.w, tipY = h.tipY, slabBottom = tipY - 64;
                s.add.tileSprite(h.x - 12, slabBottom - 40, w + 24, 40, 'ground').setOrigin(0, 0).setFlipY(true).setDepth(4);
                for (let i = 0; i < 2; i++) s.add.image(h.x + i * 88, slabBottom - 4, 'silica').setOrigin(0, 0).setFlipY(true).setDepth(4);
                this.overhangs.push({ h, rect: new Phaser.Geom.Rectangle(h.x + 6, slabBottom - 40, w - 12, tipY - (slabBottom - 40)) });
                break;
            }
            case 'dustDevil': {
                const spr = s.add.sprite(h.x, G + 8, 'dustdevil').setOrigin(0.5, 1).setDepth(8).setAlpha(0.95);
                spr.play('devil-spin');
                s.tweens.add({ targets: spr, x: h.x - h.range, duration: h.periodMs, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
                this.devils.push({ h, sprite: spr, rect: new Phaser.Geom.Rectangle() });
                break;
            }
            case 'sandTrap': {
                const fw = AssetManifest.spritesheets.sandtrap.frameWidth;
                for (let x = h.x; x < h.x1 - fw * 0.5; x += fw - 14) s.add.image(x, G + 36, 'sandtrap').setOrigin(0, 1).setDepth(7);
                this.sandZones.push({ x0: h.x, x1: h.x1, mult: h.speedMult });
                break;
            }
            case 'embeddedSilica': {
                const spr = s.add.image(h.x, G + 30, 'silica').setOrigin(0.5, 1).setDepth(4);
                if (spr.preFX && GameScene.fxEnabled()) spr.preFX.addGlow(0xbffcff, 2, 0, false, 0.1, 6);
                this.embedded.push({ h, sprite: spr, done: false });
                break;
            }
            case 'pebble':
            case 'boulder': {
                const top = this.groundTopAt(h.x + h.w / 2) ?? G;
                const P = PixelTextures.P;
                const key = h.type === 'boulder' ? PixelTextures.boulder(s, this.theme, h.w, h.h, h.variant) : PixelTextures.pebble(s, this.theme, h.w, h.h, h.variant);
                const pad = (h.type === 'boulder' ? 2 : 1) * P;
                const img = s.add.image(h.x - pad, top, key).setOrigin(0, 0).setDepth(6);
                img.y = top - Math.round(h.h / P) * P;
                // composed collision: core column + lower base (follows the stepped silhouette)
                const rects = h.type === 'boulder'
                    ? [new Phaser.Geom.Rectangle(h.x + h.w * 0.15, top - h.h, h.w * 0.7, h.h), new Phaser.Geom.Rectangle(h.x, top - h.h * 0.6, h.w, h.h * 0.6)]
                    : [new Phaser.Geom.Rectangle(h.x, top - h.h, h.w, h.h)];
                this.rocks.push({ h, rects, img });
                break;
            }
            case 'magneticDust':
            case 'dustPlume': {
                const kind = h.type === 'magneticDust' ? 'magnetic' : 'plume';
                const key = PixelTextures.puff(s, kind);
                const em = s.add.particles(0, 0, key, {
                    x: { min: -h.w / 2, max: h.w / 2 }, y: { min: 0, max: h.y1 - h.y0 - 8 },
                    speedX: { min: -14, max: 14 }, speedY: { min: -18, max: 6 },
                    lifespan: { min: 700, max: 1300 }, scale: { start: 1.25, end: 0.8 }, alpha: { start: 1, end: 0.15 },
                    frequency: 28, quantity: 1, maxParticles: 56,
                }).setDepth(8);
                s.emitters.push(em);
                this.clouds.push({ h, em, cx: h.x + h.w / 2, rect: new Phaser.Geom.Rectangle(), lastTick: -Infinity });
                break;
            }
            case 'gust': {
                const key = PixelTextures.streak(s, 'cyan');
                const em = s.add.particles(0, 0, key, {
                    x: { min: 0, max: h.x1 - h.x }, y: { min: G - 220, max: G - 20 },
                    speedX: { min: 160, max: 280 }, speedY: { min: -10, max: 10 },
                    lifespan: { min: 500, max: 900 }, alpha: { start: 0.8, end: 0 }, frequency: 50, maxParticles: 24,
                }).setDepth(9).setPosition(h.x, 0);
                s.emitters.push(em);
                this.gusts.push({ h, em, rect: new Phaser.Geom.Rectangle(h.x, G - 400, h.x1 - h.x, 400), inside: false });
                break;
            }
            default: break;
            }
        }
    }

    /** Advance hazard animation in game time (dtMs already time-scaled). */
    update(dtMs) {
        this.gameMs += dtMs;
        for (const c of this.clouds) {
            const h = c.h;
            c.cx = h.x + h.w / 2 + h.drift * Math.sin((2 * Math.PI * this.gameMs) / h.periodMs);
            c.em.setPosition(c.cx, h.y0);
            c.rect.setTo(c.cx - h.w / 2, h.y0, h.w, h.y1 - h.y0);
        }
        for (const d of this.devils) d.rect.setTo(d.sprite.x - d.h.w / 2, d.h.y0, d.h.w, d.h.y1 - d.h.y0);
    }

    /** First damaging instance overlapping rect, or null. Tick hazards carry their own cooldown. */
    damageAt(rect) {
        const O = Phaser.Geom.Rectangle.Overlaps;
        for (const o of this.overhangs) if (O(rect, o.rect)) return { id: o.h.id, type: 'overhang' };
        for (const d of this.devils) if (O(rect, d.rect)) return { id: d.h.id, type: 'devil' };
        for (const r of this.rocks) if (r.rects.some((rr) => O(rect, rr))) return { id: r.h.id, type: r.h.type };
        for (const c of this.clouds) if (O(rect, c.rect)) return { id: c.h.id, type: c.h.type, tick: c };
        return null;
    }

    slowAt(x) { const z = this.sandZones.find((q) => x > q.x0 && x < q.x1); return z ? z.mult : 1; }

    /** True if a standing body rect would not intersect any overhang or solid ceiling. */
    headroomClear(rect) {
        const O = Phaser.Geom.Rectangle.Overlaps;
        if (this.overhangs.some((o) => O(rect, o.rect))) return false;
        const shrunk = new Phaser.Geom.Rectangle(rect.x + 2, rect.y, rect.width - 4, rect.height - 4);   // ignore the floor we stand on
        return !this.solidRects.some((r) => O(shrunk, r));
    }

    // ------------------------------------------------------------ landmarks, gates
    buildLandmarks() {
        const s = this.scene;
        for (const l of this.L.landmarks || []) {
            const top = this.groundTopAt(l.x) ?? this.L.world.groundY;
            let key = null;
            if (l.type === 'pathfinderLander') key = PixelTextures.pathfinderLander(s);
            else if (l.type === 'columbiaStation') key = PixelTextures.columbiaStation(s);
            else if (l.type === 'craterRim') key = PixelTextures.craterRim(s, this.theme);
            if (!key) continue;
            const img = s.add.image(l.x, top + 2, key).setOrigin(0.5, 1).setDepth(4);
            if (l.label) {
                s.add.text(l.x, img.y - img.height - 6, l.label, { fontFamily: 'VT323', fontSize: '20px', color: '#ffe9c4', stroke: '#1a0f0a', strokeThickness: 4 })
                    .setOrigin(0.5, 1).setDepth(4).setResolution(1);
            }
            l.sprite = img;
        }
    }

    buildGates() {
        const s = this.scene;
        const mk = (x) => {
            const top = this.groundTopAt(x) ?? this.L.world.groundY;
            const g = s.add.image(x, top + 4, 'gate').setOrigin(0.5, 1).setDepth(4);
            if (g.preFX && GameScene.fxEnabled()) { g.preFX.padding = 8; g.preFX.addGlow(0x3ff6ff, 1.5, 0, false, 0.1, 6); }
            return g;
        };
        this.gateSprites = this.L.checkpoints.map((c) => mk(c.x));
        this.finishGate = mk(this.L.world.finishX);
    }

    progress(x) {
        const w = this.L.world;
        return Math.max(0, Math.min(1, (x - w.startX) / (w.finishX - w.startX)));
    }
}
