/**
 * LevelSchema - validation for compiled level JSON (assets/data/levels/*.json).
 * Shared by the dev build (node tools/build_levels.mjs) and the runtime loader,
 * so a malformed level is rejected with readable errors instead of crashing.
 *
 * Units: positions px, speeds px/s, accelerations px/s^2, durations ms.
 */
(function (root) {
    const SCHEMA_VERSION = 1;

    /** The only legal rover -> signature ability pairings. */
    const ABILITY_FOR_ROVER = Object.freeze({
        sojourner: 'airbagBounce',
        spirit: 'trenchScrapeSlide',
        opportunity: 'solarWindBoost',
    });

    /** Collision roles every placed instance must declare. */
    const ROLES = Object.freeze(['solid', 'damage', 'slow', 'pickup', 'trigger', 'decoration']);

    const HAZARD_TYPES = Object.freeze({
        overhang: 'damage', dustDevil: 'damage', sandTrap: 'slow', embeddedSilica: 'trigger',
        pebble: 'damage', boulder: 'damage', magneticDust: 'damage', dustPlume: 'damage',
        gust: 'trigger',
    });

    const finite = (v) => typeof v === 'number' && Number.isFinite(v);

    function validate(level, opts) {
        const o = opts || {};
        const errors = [];
        const err = (m) => errors.push(m);
        const need = (cond, m) => { if (!cond) err(m); return cond; };
        const ids = new Set();
        const uid = (id, where) => {
            if (need(typeof id === 'string' && id.length > 0, `${where}: missing string id`)) {
                need(!ids.has(id), `${where}: duplicate id '${id}'`);
                ids.add(id);
            }
        };
        if (!need(level && typeof level === 'object', 'level is not an object')) return errors;

        need(level.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`);
        need(typeof level.id === 'string' && /^[a-z]+$/.test(level.id), 'id must be a lowercase string');
        need(finite(level.order), 'order must be a number');
        ['title', 'subtitle'].forEach((k) => need(typeof level[k] === 'string' && level[k], `${k} required`));
        need(level.missionDates && typeof level.missionDates.timeConvention === 'string', 'missionDates.timeConvention required');
        need(level.sourceScript && level.sourceScript.file && level.sourceScript.version, 'sourceScript {file, version} required');
        need(Array.isArray(level.sources) && level.sources.length > 0 && level.sources.every((u) => /^https:\/\/science\.nasa\.gov\//.test(u)),
            'sources must list official science.nasa.gov URLs');

        // rover / sprite
        const r = level.rover || {};
        need(typeof r.id === 'string', 'rover.id required');
        need(ABILITY_FOR_ROVER[r.id] !== undefined, `unknown rover '${r.id}'`);
        need(typeof r.texture === 'string', 'rover.texture required');
        need(finite(r.frameWidth) && finite(r.frameHeight) && r.frameWidth > 0 && r.frameHeight > 0, 'rover frame size must be finite > 0');
        need(r.origin && finite(r.origin.x) && finite(r.origin.y), 'rover.origin {x,y} required');
        need(finite(r.displayScale) && r.displayScale > 0, 'rover.displayScale > 0');
        const b = r.body || {};
        need(['w', 'h', 'offsetX', 'footY'].every((k) => finite(b[k]) && b[k] >= 0), 'rover.body {w,h,offsetX,footY} finite');
        need(b.w > 0 && b.h > 0 && b.footY <= r.frameHeight && b.offsetX + b.w <= r.frameWidth, 'rover.body must fit inside the frame');
        need(r.clips && typeof r.clips === 'object', 'rover.clips required');
        const totalFrames = o.frameCounts && o.frameCounts[r.texture];
        Object.entries(r.clips || {}).forEach(([k, c]) => {
            need(Array.isArray(c.frames) && c.frames.length > 0 && c.frames.every((f) => Number.isInteger(f) && f >= 0), `clip ${k}: frames must be non-negative ints`);
            if (totalFrames) need(c.frames.every((f) => f < totalFrames), `clip ${k}: frame index beyond texture '${r.texture}' (${totalFrames} frames)`);
            need(finite(c.frameDurationMs) && c.frameDurationMs > 0, `clip ${k}: frameDurationMs > 0`);
            need(c.repeat === -1 || c.repeat === 0, `clip ${k}: repeat must be -1 or 0`);
        });
        ['idle', 'run', 'jump', 'damage'].forEach((k) => need(r.clips && r.clips[k], `rover.clips.${k} required`));
        if (r.id !== 'spirit') need(!(r.clips && r.clips.slide), 'only Spirit may define a slide clip');

        // physics
        const p = level.physics || {};
        ['cruiseSpeed', 'gravity', 'jumpVelocity', 'jumpHoldAccel', 'jumpHoldMaxMs', 'coyoteMs'].forEach((k) =>
            need(finite(p[k]) && p[k] >= 0, `physics.${k} must be finite >= 0`));
        need(p.units === 'px, px/s, px/s^2, ms', "physics.units must be 'px, px/s, px/s^2, ms'");

        // ability pairing
        const a = level.ability || {};
        need(a.id === ABILITY_FOR_ROVER[r.id], `illegal ability '${a.id}' for rover '${r.id}' (must be '${ABILITY_FOR_ROVER[r.id]}')`);
        need(a.params && typeof a.params === 'object', 'ability.params required');
        Object.entries(a.params || {}).forEach(([k, v]) => need(finite(v), `ability.params.${k} must be finite`));

        // world
        const w = level.world || {};
        ['length', 'groundY', 'startX', 'finishX', 'seed', 'killY'].forEach((k) => need(finite(w[k]), `world.${k} finite`));
        need(w.finishX > w.startX, 'world.finishX > startX');
        need(w.killY > w.groundY, 'world.killY below groundY');
        const inWorld = (x) => finite(x) && x >= w.startX - 2000 && x <= w.finishX + 3000;

        // terrain
        const t = level.terrain || {};
        need(Array.isArray(t.ground) && t.ground.length > 0, 'terrain.ground segments required');
        let lastEnd = -Infinity;
        (t.ground || []).forEach((g, i) => {
            need(finite(g.x0) && finite(g.x1) && finite(g.top) && g.x1 > g.x0, `ground[${i}] finite x0<x1, top`);
            need(g.x0 >= lastEnd, `ground[${i}] overlaps previous segment`);
            need(g.role === 'solid', `ground[${i}] role must be solid`);
            lastEnd = g.x1;
        });
        need((t.ground || []).some((g) => g.x0 <= w.startX && g.x1 >= w.startX), 'startX must be on solid ground');
        (t.platforms || []).forEach((pl) => {
            uid(pl.id, 'platform');
            need(['x', 'y', 'w', 'h'].every((k) => finite(pl[k])) && pl.w > 0 && pl.h > 0, `platform ${pl.id}: finite x,y,w,h > 0`);
            need(pl.role === 'solid', `platform ${pl.id}: role must be solid`);
        });

        // hazards
        (level.hazards || []).forEach((h) => {
            uid(h.id, 'hazard');
            need(HAZARD_TYPES[h.type] !== undefined, `hazard ${h.id}: unknown type '${h.type}'`);
            need(ROLES.includes(h.role), `hazard ${h.id}: role '${h.role}' invalid`);
            need(h.role === HAZARD_TYPES[h.type], `hazard ${h.id}: type ${h.type} must have role ${HAZARD_TYPES[h.type]}`);
            need(inWorld(h.x), `hazard ${h.id}: x out of world bounds`);
            Object.entries(h).forEach(([k, v]) => { if (typeof v === 'number') need(finite(v), `hazard ${h.id}.${k} not finite`); });
        });
        (level.landmarks || []).forEach((l) => { uid(l.id, 'landmark'); need(l.role === 'decoration', `landmark ${l.id}: must be decoration (non-colliding)`); need(inWorld(l.x), `landmark ${l.id}: x`); });

        // pickups
        const pk = level.pickups || {};
        need(Array.isArray(pk.fragments) && pk.fragments.length === 10, 'exactly 10 fragments required');
        const ns = new Set();
        (pk.fragments || []).forEach((f) => {
            uid(f.id, 'fragment');
            ns.add(f.n);
            need(f.role === 'pickup', `fragment ${f.id}: role must be pickup`);
            need(typeof f.displayText === 'string' && f.displayText.trim().split(/\s+/).length <= 12, `fragment ${f.id}: displayText <= 12 words`);
            need(f.hiddenUntil ? typeof f.hiddenUntil === 'string' : (finite(f.x) && finite(f.y) && inWorld(f.x)), `fragment ${f.id}: position or hiddenUntil trigger`);
        });
        need(ns.size === 10, 'fragment numbers must be unique 1..10');
        (pk.batteries || []).forEach((bt) => { uid(bt.id, 'battery'); need(finite(bt.x) && finite(bt.y), `battery ${bt.id}: x,y`); });

        // ordered triggers
        const tut = level.tutorials || [];
        need(tut.length === 4, 'exactly 4 tutorials required');
        tut.forEach((x, i) => {
            uid(x.id, 'tutorial');
            need(x.slot === i + 1, `tutorial ${x.id}: slot order`);
            need(finite(x.triggerX) && finite(x.clearX) && x.clearX > x.triggerX, `tutorial ${x.id}: triggerX < clearX`);
            need(x.triggerX > w.startX && x.clearX < w.finishX, `tutorial ${x.id}: inside the course`);
            if (i > 0) need(x.triggerX >= tut[i - 1].clearX, `tutorial ${x.id}: overlaps previous tutorial`);
            need(typeof x.text === 'string' && x.text, `tutorial ${x.id}: text`);
        });
        const cps = level.checkpoints || [];
        need(cps.length === 3, 'exactly 3 checkpoints required');
        [0.25, 0.5, 0.75].forEach((pp, i) => {
            const c = cps[i];
            if (!need(c, `checkpoint ${i + 1} missing`)) return;
            uid(c.id, 'checkpoint');
            need(c.p === pp, `checkpoint ${c.id}: p must be ${pp}`);
            const expectX = w.startX + pp * (w.finishX - w.startX);
            need(finite(c.x) && Math.abs(c.x - expectX) < 1, `checkpoint ${c.id}: x must equal startX + p*(finish-start) = ${expectX}`);
            need(typeof c.log === 'string' && /^SYSTEM LOG/.test(c.log), `checkpoint ${c.id}: log`);
        });
        (level.safeZones || []).forEach((z, i) => need(finite(z.x0) && finite(z.x1) && z.x1 > z.x0, `safeZones[${i}]`));

        // quiz
        const qz = level.quiz || [];
        need(qz.length === 2, 'exactly 2 quiz questions required');
        qz.forEach((q) => {
            uid(q.id, 'quiz');
            need(Array.isArray(q.options) && q.options.length === 3, `quiz ${q.id}: 3 options`);
            (q.options || []).forEach((op) => uid(op.id, `quiz ${q.id} option`));
            need((q.options || []).filter((op) => op.id === q.correct).length === 1, `quiz ${q.id}: correct must reference exactly one option id`);
        });

        // codex
        const cx = level.codex || {};
        need(typeof cx.file === 'string' && Array.isArray(cx.sections) && cx.sections.length >= 4 && cx.sections.every((s) => s.heading && s.body),
            'codex {file, sections[>=4] with heading/body} required');
        need(Array.isArray(cx.sources) && cx.sources.length > 0, 'codex.sources required');

        // theme / storm
        need(level.theme && typeof level.theme.id === 'string', 'theme.id required');
        if (level.storm) need(finite(level.storm.startP) && finite(level.storm.maxOverlay) && level.storm.maxOverlay <= 0.65, 'storm {startP, maxOverlay<=0.65}');

        return errors;
    }

    const api = { SCHEMA_VERSION, ABILITY_FOR_ROVER, ROLES, HAZARD_TYPES, validate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.LevelSchema = api;
})(typeof window !== 'undefined' ? window : globalThis);
