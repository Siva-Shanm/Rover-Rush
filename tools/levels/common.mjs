/** Shared helpers for compiling mission content + layouts into level JSON. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export const GROUND_Y = 620;
export const SPIRIT = Object.freeze({ cruise: 300, gravity: 800, jump: 336 });   // regression baseline (V, G, J)

const UNITS = 'px, px/s, px/s^2, ms';

/** Spirit + Opportunity share the 'rover' texture (assets/sprites/rover.png). */
function roverSheet(withSlide) {
    const m = readJSON('assets/sprites/rover.json');
    const at = (n) => m.frames.indexOf(n);
    const clips = {
        idle: { frames: [at('idle_0'), at('idle_1')], frameDurationMs: 500, repeat: -1 },
        run: { frames: [at('run_0'), at('run_1'), at('run_2'), at('run_3')], frameDurationMs: 83.33, repeat: -1 },
        jump: { frames: [at('jump_0')], frameDurationMs: 100, repeat: 0 },
        damage: { frames: [at('damage_0'), at('damage_1')], frameDurationMs: 71.43, repeat: -1 },
    };
    if (withSlide) clips.slide = { frames: [at('slide_0')], frameDurationMs: 100, repeat: 0 };
    return {
        texture: 'rover', frameWidth: m.frameWidth, frameHeight: m.frameHeight,
        origin: { x: 0.5, y: 0.5 }, displayScale: 1,
        body: { w: 100, h: 84, offsetX: 38, footY: 134 },
        pickupHeight: 118,
        clips,
    };
}

export function spiritRover() { return { id: 'spirit', ...roverSheet(true), slideBody: { h: 42 } }; }
export function opportunityRover() { return { id: 'opportunity', ...roverSheet(false) }; }

export function sojournerRover() {
    const m = readJSON('assets/sprites/sojourner.json');
    const c = m.clips;
    const clip = (k) => ({ frames: c[k].frames, frameDurationMs: c[k].frameDurationMs, repeat: c[k].repeat, holdLastFrame: !!c[k].holdLastFrame });
    const bodyW = 56;
    return {
        id: 'sojourner', texture: 'sojourner', frameWidth: m.frameWidth, frameHeight: m.frameHeight,
        origin: { x: 0.5, y: 0.5 }, displayScale: 1,
        // tight chassis body centred under the solar panel, feet on the wheel line
        body: { w: bodyW, h: 48, offsetX: m.anchor.panelTop[0] - bodyW / 2, footY: m.anchor.footY },
        pickupHeight: 78,
        clips: {
            idle: clip('idle'), run: clip('run'), jump: clip('jump'), jumpLand: clip('jumpLand'),
            bounce: clip('bounce'), bounceLand: clip('bounceLand'), damage: clip('damage'),
        },
    };
}

export function physics(over) {
    return { units: UNITS, coyoteMs: 90, jumpHoldAccel: 0, jumpHoldMaxMs: 0, ...over };
}

/** Merge reviewed content (content/<id>.json) into level fields. */
export function contentFields(id, fragmentPositions, startX, finishX) {
    const c = readJSON(`content/${id}.json`);
    const facts = readJSON('content/facts.json');
    const ledger = readJSON('content/corrections.json');
    const fragments = c.fragments.map((f) => ({ role: 'pickup', ...f, ...fragmentPositions[f.n] }));
    const checkpoints = c.checkpoints.map((cp) => ({ ...cp, x: startX + cp.p * (finishX - startX) }));
    return {
        sourceScript: { file: c.sourceScript, version: c.scriptVersion },
        tutorialsContent: c.tutorials,
        fragments,
        checkpoints,
        quiz: c.quiz,
        codex: { ...c.codex, archiveNotes: facts.archiveNotes },
        ledgerSources: ledger.sources,
    };
}

export function codexSources(urls) {
    return urls.map((u) => ({ label: u.replace('https://science.nasa.gov/', 'science.nasa.gov/'), url: u }));
}
