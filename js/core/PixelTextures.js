/**
 * PixelTextures — deterministic, seed-based procedural pixel-art texture factory.
 * ---------------------------------------------------------------------------
 * Every new environment object / hazard / landmark / effect / background for
 * the Sojourner and Opportunity missions is baked here from code:
 *   - off-screen Graphics: scene.make.graphics({x:0,y:0,add:false})
 *   - integer logical-pixel grid (P screen px per art pixel), fillRect only
 *   - 1-2 px dark outline #1a0f0a, 4-6 flat colours per material,
 *     top-left highlights, lower-right shadows, stepped silhouettes,
 *     sparse checkerboard dithering — no gradients, no curves
 *   - namespaced + versioned keys ('px1:<theme>:<kind>:<variant>'), baked once
 *     (textures.exists check), the temporary Graphics destroyed after baking.
 * Spirit keeps its existing raster art; nothing here touches it.
 */
const PixelTextures = (() => {
    const VERSION = 'px1';
    const P = 2;                          // screen pixels per logical art pixel
    const OUTLINE = 0x1a0f0a;

    const hex = (s) => (typeof s === 'number' ? s : parseInt(s.replace('#', ''), 16));

    /** mulberry32 — small deterministic PRNG */
    function rng(seed) {
        let a = seed >>> 0;
        return () => {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const THEMES = {
        ares: {   // Ares Vallis: grey-brown flood plain, butterscotch sky
            rock: [0x3e342b, 0x594d42, 0x8c7d70, 0xa69688, 0xc4b6a6],
            soil: [0x594d42, 0x7a6a5c, 0x8c7d70, 0xa69688],
            sky: [0xc98a45, 0xd9a35b, 0xe6b877, 0xf0cb92],
            ridge: [0x8a6a50, 0x9c7a5c],
            rim: [0x7a6250, 0x8c7360],
            pit: [0x2a211b, 0x3a2e25],
        },
        meridiani: {   // Meridiani Planum: muted ochre plains, pale sediment bands
            rock: [0x4a3624, 0x7a5a3a, 0xa8814f, 0xc9a46c, 0xe0c899],
            soil: [0x8a6a44, 0xa8814f, 0xb8925a, 0xc9a46c],
            sky: [0x7a2416, 0x9e3320, 0xc0482a, 0xdb6a3c],     // clearly red Martian sky (pre-storm)
            ridge: [0x6e2718, 0x823221],
            rim: [0x8a3a22, 0x9c472a],
            pit: [0x2b1d12, 0x3d2a1a],
        },
    };

    function bake(scene, key, w, h, draw) {
        if (scene.textures.exists(key)) return key;
        const g = scene.make.graphics({ x: 0, y: 0, add: false });
        const px = (x, y, c) => { g.fillStyle(c, 1); g.fillRect(x * P, y * P, P, P); };
        const rect = (x, y, rw, rh, c) => { g.fillStyle(c, 1); g.fillRect(x * P, y * P, rw * P, rh * P); };
        draw({ px, rect, w, h });
        g.generateTexture(key, w * P, h * P);
        g.destroy();
        const tex = scene.textures.get(key);
        if (tex && tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
        return key;
    }

    /** Outline every opaque logical pixel bordering transparency (run after filling a mask). */
    function outlined(mask, w, h, colorAt, px) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!mask[y][x]) continue;
                const edge = !mask[y - 1]?.[x] || !mask[y + 1]?.[x] || !mask[y][x - 1] || !mask[y][x + 1];
                px(x, y, edge ? OUTLINE : colorAt(x, y));
            }
        }
    }

    // ------------------------------------------------------------ objects
    /** Irregular stepped boulder with faceted interior and ground shadow. */
    function boulder(scene, theme, wPx, hPx, variant) {
        const key = `${VERSION}:${theme}:boulder:${wPx}x${hPx}:${variant}`;
        const w = Math.max(6, Math.round(wPx / P)), h = Math.max(5, Math.round(hPx / P));
        const pal = THEMES[theme].rock;
        return bake(scene, key, w + 4, h + 2, ({ px, rect }) => {
            const r = rng(hPx * 131 + wPx * 7 + variant * 977);
            // stepped silhouette: per-column top height from a few chunky steps
            const tops = [];
            const peak = 0.35 + r() * 0.3;
            for (let x = 0; x < w; x++) {
                const t = x / (w - 1);
                const bell = 1 - Math.pow(Math.abs(t - peak) / Math.max(peak, 1 - peak), 2.2);
                tops.push(Math.round((1 - Math.max(0.15, bell)) * (h - 2) / 2) * 2);   // quantised to 2-px steps
            }
            const mask = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => y >= tops[x]));
            // ground-contact shadow
            rect(1, h, w + 2, 2, 0x2a1c14);
            const shade = (x, y) => {
                const lx = x / w, ly = (y - tops[x]) / Math.max(1, h - tops[x]);
                let c = 2;
                if (lx < 0.35 && ly < 0.45) c = 3;                // top-left highlight
                if (lx < 0.2 && ly < 0.2) c = 4;
                if (lx > 0.65 || ly > 0.7) c = 1;                 // lower-right shadow
                if (lx > 0.85 && ly > 0.6) c = 0;
                // faceted interior patches
                if (((x * 3 + y * 5 + variant) % 11) === 0) c = Math.max(0, c - 1);
                if (((x + y * 2) % 4 === 0) && c === 2 && r() < 0.15) c = 3;     // sparse dither
                return pal[c];
            };
            outlined(mask, w, h, shade, (x, y, c) => px(x + 2, y, c));
        });
    }

    function pebble(scene, theme, wPx, hPx, variant) {
        const key = `${VERSION}:${theme}:pebble:${wPx}x${hPx}:${variant}`;
        const w = Math.max(3, Math.round(wPx / P)), h = Math.max(2, Math.round(hPx / P));
        const pal = THEMES[theme].rock;
        return bake(scene, key, w + 2, h + 1, ({ px, rect }) => {
            rect(0, h, w + 2, 1, 0x140c08);                                   // darker contact shadow
            const mask = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => !(y === 0 && (x === 0 || x === w - 1))));
            outlined(mask, w, h, (x, y) => (x < w / 2 && y < h / 2 ? 0xf2e6d4 : (y >= h - 2 ? pal[1] : pal[3])), (x, y, c) => px(x + 1, y, c));
        });
    }

    /** Tileable ground strip: bright crust, banded strata, outlined cobbles, darker base. */
    function ground(scene, theme, style) {
        const key = `${VERSION}:${theme}:ground:${style || 'plain'}`;
        const T = THEMES[theme];
        const W = 96, H = 64;
        return bake(scene, key, W, H, ({ px, rect }) => {
            const r = rng(theme.length * 999 + (style || 'p').length * 17);
            const soil = style === 'craterFloor' ? [T.pit[1], T.soil[0], T.soil[0], T.soil[1]] : T.soil;
            // strata: alternating bands with jagged (periodic) seams, darker with depth
            const seam = (x, k) => Math.round(2 * Math.sin((x / W) * Math.PI * 2 * (k + 2) + k));
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const band = Math.floor((y + seam(x, Math.floor(y / 12))) / 12);
                    let c = band % 2 === 0 ? soil[2] : soil[1];
                    if (y > 40) c = band % 2 === 0 ? soil[1] : soil[0];
                    if (y > 54) c = soil[0];
                    px(x, y, c);
                    if ((x + y) % 2 === 0 && r() < 0.12) px(x, y, y < 20 ? soil[3] : soil[0]);   // sparse checker dither
                }
            }
            if (style === 'outcrop') {       // pale horizontal sediment bands (Meridiani layered outcrops)
                for (let b = 6; b < H; b += 7) { rect(0, b, W, 2, T.rock[4]); rect(0, b + 2, W, 1, T.rock[1]); }
            }
            // outlined cobbles: top-left highlight, lower-right shadow (wrap horizontally)
            for (let i = 0; i < 16; i++) {
                const sw = 3 + Math.floor(r() * 4), sh = 2 + Math.floor(r() * 3);
                const sx = Math.floor(r() * W), sy = 7 + Math.floor(r() * (H - 14));
                for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
                    const edge = y === 0 || y === sh - 1 || x === 0 || x === sw - 1;
                    const corner = (y === 0 || y === sh - 1) && (x === 0 || x === sw - 1);
                    if (corner) continue;
                    const c = edge ? OUTLINE : (x <= 1 && y <= 1 ? T.rock[4] : (x >= sw - 2 || y >= sh - 2 ? T.rock[1] : T.rock[2]));
                    px((sx + x) % W, sy + y, c);
                }
            }
            rect(0, 0, W, 1, T.rock[4]); rect(0, 1, W, 2, T.rock[3]);
            for (let x = 0; x < W; x += 2) px(x + (x % 4 === 0 ? 1 : 0), 3, T.rock[2]);
            rect(0, 4, W, 1, OUTLINE);
        });
    }

    /** Recessed pit interior with broken rim teeth (gaps are absent collision). */
    function pit(scene, theme) {
        const key = `${VERSION}:${theme}:pit`;
        const T = THEMES[theme];
        return bake(scene, key, 32, 48, ({ px, rect }) => {
            rect(0, 0, 32, 48, T.pit[0]);
            for (let y = 0; y < 48; y += 2) for (let x = (y / 2) % 2; x < 32; x += 2) if (y < 18) px(x, y, T.pit[1]);
        });
    }

    function rimTooth(scene, theme, side) {
        const key = `${VERSION}:${theme}:rim:${side}`;
        const T = THEMES[theme];
        return bake(scene, key, 8, 16, ({ px, rect }) => {
            const cols = side === 'left' ? [6, 8, 9, 12, 14, 16, 16, 16] : [16, 16, 16, 14, 12, 9, 8, 6];
            cols.forEach((hh, x) => {
                for (let y = 0; y < hh; y++) px(x, y, y === 0 || y === hh - 1 ? OUTLINE : (y < 3 ? T.rock[3] : T.rock[1]));
            });
        });
    }

    /** Parallax chunk: tileable silhouette band with stepped ridgeline. kind: sky|ridge|rim */
    function parallax(scene, theme, kind) {
        const key = `${VERSION}:${theme}:parallax:${kind}`;
        const T = THEMES[theme];
        const W = 320, H = kind === 'sky' ? 120 : 60;
        return bake(scene, key, W, H, ({ px, rect }) => {
            if (kind === 'sky') {
                const bands = T.sky;
                const bh = Math.ceil(H / bands.length);
                bands.forEach((c, i) => rect(0, i * bh, W, bh, c));
                for (let i = 1; i < bands.length; i++) {       // checker-dither the band seams
                    for (let x = 0; x < W; x += 2) { px(x + ((i) % 2), i * bh - 1, bands[i]); px(x + ((i + 1) % 2), i * bh, bands[i - 1]); }
                }
                const r = rng(42 + theme.length);
                for (let i = 0; i < 40; i++) px(Math.floor(r() * W), Math.floor(r() * 30), 0xfff0d0);
                return;
            }
            const cols = kind === 'ridge' ? T.ridge : T.rim;
            const amp = kind === 'ridge' ? 34 : 22;
            for (let x = 0; x < W; x++) {
                // periodic sum of sines (integer cycles over W) -> seamless wrap; quantised steps
                const t = (x / W) * Math.PI * 2;
                const n = Math.sin(t * 2 + 1) * 0.5 + Math.sin(t * 5 + 2) * 0.3 + Math.sin(t * 11) * 0.2;
                const top = Math.round((H - 6 - amp * (0.5 + 0.5 * n)) / 2) * 2;
                for (let y = top; y < H; y++) px(x, y, y === top ? OUTLINE : (y < top + 3 ? cols[1] : cols[0]));
            }
        });
    }

    // ------------------------------------------------------------ effects (cached once, reused by pooled particles)
    function puff(scene, kind) {
        const key = `${VERSION}:fx:puff:${kind}`;
        const C = {
            magnetic: [0x1f0a26, 0x7a3c9c, 0xc58ae6],     // DAMAGING magnetic dust: violet, dark outline
            plume: [0x1a0a04, 0x5a2410, 0x9a4a22],        // DAMAGING dust plume: dark rust, dark outline
            smoke: [0x2a2626, 0x4a4444, 0x6a6262],        // damage smoke
            airbag: [0xb8bcc4, 0xe8ecf0, 0xffffff],       // cosmetic airbag lobe
            gust: [0x9fe8ff, 0xd8f6ff, 0xffffff],         // beneficial wind gust (pale cyan)
        }[kind];
        return bake(scene, key, 8, 8, ({ px }) => {
            const m = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'];
            m.forEach((row, y) => [...row].forEach((ch, x) => {
                if (ch !== 'X') return;
                const edge = m[y - 1]?.[x] !== 'X' || m[y + 1]?.[x] !== 'X' || row[x - 1] !== 'X' || row[x + 1] !== 'X';
                px(x, y, edge ? C[0] : (x < 4 && y < 4 ? C[2] : C[1]));
            }));
        });
    }

    function streak(scene, kind) {
        const key = `${VERSION}:fx:streak:${kind}`;
        const C = kind === 'gold' ? [0xffd76a, 0xfff2b8] : [0x7fe3ff, 0xd8f6ff];
        return bake(scene, key, 10, 2, ({ px }) => {
            for (let x = 0; x < 10; x++) { px(x, 0, x < 7 ? C[0] : C[1]); if (x > 2 && x < 9) px(x, 1, C[1]); }
        });
    }

    /** Storm overlay tile: sparse checker dither of amber/umber dust. */
    function stormDither(scene) {
        const key = `${VERSION}:fx:storm`;
        return bake(scene, key, 32, 32, ({ px }) => {
            const r = rng(2018);
            for (let y = 0; y < 32; y++) for (let x = (y % 2); x < 32; x += 2) if (r() < 0.45) px(x, y, r() < 0.5 ? 0x8a5a2a : 0x5a3a1e);
        });
    }

    // ------------------------------------------------------------ landmarks
    /** Pathfinder lander: low petal shape, deflated airbag lobes, 20-degree ramp. */
    function pathfinderLander(scene) {
        const key = `${VERSION}:landmark:pathfinder`;
        return bake(scene, key, 90, 34, ({ px, rect }) => {
            const T = THEMES.ares;
            // deflated airbag lobes (white/grey) piled around the base
            for (let i = 0; i < 9; i++) {
                const cx = 6 + i * 9, cy = 26 + (i % 2) * 2;
                for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) {
                    if (x * x / 25 + y * y / 16 > 1) continue;
                    const edge = (x * x / 25 + y * y / 16) > 0.7;
                    px(cx + x, cy + y, edge ? 0x7d8088 : (y < 0 && x < 0 ? 0xffffff : 0xc8ccd2));
                }
            }
            // three petals (low trapezoids) + central body
            rect(14, 20, 62, 4, 0x5a6a8a); rect(14, 20, 62, 1, OUTLINE); rect(14, 23, 62, 1, OUTLINE);
            for (let x = 16; x < 74; x += 4) rect(x, 21, 2, 2, 0x2c3a66);     // solar cells
            rect(36, 12, 18, 8, 0xb8a888); rect(36, 12, 18, 1, OUTLINE); rect(36, 19, 18, 1, OUTLINE);
            rect(36, 12, 1, 8, OUTLINE); rect(53, 12, 1, 8, OUTLINE);
            rect(44, 4, 2, 8, 0x8a8a8a); rect(41, 2, 8, 3, 0xd0d0d0);           // camera mast
            // 20-degree deployment ramp (visual only): rise 1 per ~2.75 run
            for (let x = 0; x < 16; x++) { const y = 20 + Math.round(x * 0.364); rect(74 + x, y, 1, 2, 0x9a9a9a); px(74 + x, y + 2, OUTLINE); }
        });
    }

    /** Columbia Memorial Station (MER lander): petals spread flat, airbag remnants. */
    function columbiaStation(scene) {
        const key = `${VERSION}:landmark:columbia`;
        return bake(scene, key, 70, 22, ({ px, rect }) => {
            for (let i = 0; i < 7; i++) {
                const cx = 5 + i * 10, cy = 17;
                for (let y = -3; y <= 3; y++) for (let x = -5; x <= 5; x++) if (x * x / 25 + y * y / 9 <= 1) px(cx + x, cy + y, (x * x / 25 + y * y / 9) > 0.65 ? 0x6e5a4e : 0xb4a69a);
            }
            rect(4, 12, 62, 3, 0x7a6a58); rect(4, 12, 62, 1, OUTLINE);
            rect(10, 9, 50, 3, 0x2c3a66); for (let x = 11; x < 59; x += 3) px(x, 10, 0x5a78b8);
            rect(28, 5, 14, 4, 0x9a8a78); rect(28, 5, 14, 1, OUTLINE);
        });
    }

    function craterRim(scene, theme) {
        const key = `${VERSION}:${theme}:landmark:craterRim`;
        const T = THEMES[theme];
        return bake(scene, key, 80, 26, ({ px }) => {
            for (let x = 0; x < 80; x++) {
                const t = x / 79;
                const top = Math.round((1 - Math.sin(t * Math.PI) * 0.9) * 22 / 2) * 2 + 2;
                for (let y = top; y < 26; y++) px(x, y, y === top ? OUTLINE : (y < top + 3 ? T.rock[3] : (x > 50 ? T.rock[0] : T.rock[1])));
            }
        });
    }

    return { VERSION, P, THEMES, rng, bake, boulder, pebble, ground, pit, rimTooth, parallax, puff, streak, stormDither, pathfinderLander, columbiaStation, craterRim };
})();
