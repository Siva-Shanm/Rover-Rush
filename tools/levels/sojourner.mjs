/**
 * Sojourner — Ares Vallis, 1997. Airbag Bounce course.
 *
 * Tuning (gameplay units relative to Spirit: V = 300 px/s, G = 800 px/s^2, J = 336 px/s):
 *   cruise 0.80 V = 240 px/s (PRD default)
 *   bounce 1.35 J = 454 px/s (PRD default) -> ~129 px apex
 *   hop    0.55 J = 185 px/s (PRD default 0.45 J = 151 px/s gives a 14 px apex; with
 *          the tight 56 px body at 240 px/s that cannot clear any pebble with the
 *          required margin, so the hop was raised to the smallest ratio that does —
 *          ~21 px apex, still far below every tall boulder). Verified by verify().
 */
import { GROUND_Y, SPIRIT, sojournerRover, physics, contentFields, codexSources } from './common.mjs';
import { arc, apex, spanAbove, clears, crosses } from './sim.mjs';

const LENGTH = 18000;
const PHYS = { cruiseSpeed: Math.round(0.8 * SPIRIT.cruise), gravity: SPIRIT.gravity, jumpVelocity: Math.round(0.55 * SPIRIT.jump), jumpHoldAccel: 0, jumpHoldMaxMs: 0 };
const ABILITY = { bounceVelocity: Math.round(1.35 * SPIRIT.jump), charges: 1 };
const BODY_W = 56;

const PEBBLES = [[1400, 12, 8], [1950, 12, 8], [2400, 10, 7], [6300, 12, 8], [9600, 12, 8], [12900, 10, 7], [15000, 12, 8]];
const BOULDERS = [[2900, 48, 50], [3600, 56, 64], [7400, 60, 72], [11800, 64, 80], [15400, 52, 56], [16600, 48, 48]];   // x, w, h (all mandatory)
const DUST = [[5800, 90, 56, 24], [6900, 84, 54, 24], [12400, 90, 56, 24], [16000, 84, 52, 24]];                    // x, w, plume height, drift amplitude
const CHANNELS = [[8000, 200, 'bounce'], [10600, 340, 'combo'], [14300, 340, 'combo']];                              // x, width, intended route
const FRAG = { 1: [1700, 30], 2: [3628, 120], 3: [4900, 30], 4: [6560, 30], 5: [7430, 120], 6: [9500, 30], 7: [11200, 30], 8: [12455, 120], 9: [15200, 30], 10: [17200, 30] };

export function build() {
    const startX = 0, finishX = LENGTH;
    const ground = [];
    let x = -1200;
    for (const [cx, w] of CHANNELS) { ground.push({ x0: x, x1: cx, top: GROUND_Y, role: 'solid' }); x = cx + w; }
    ground.push({ x0: x, x1: LENGTH + 2600, top: GROUND_Y, role: 'solid' });

    const hazards = [
        ...PEBBLES.map(([px, w, h], i) => ({ id: `soj-pebble-${i + 1}`, type: 'pebble', role: 'damage', x: px, w, h, variant: i % 3 })),
        ...BOULDERS.map(([bx, w, h], i) => ({ id: `soj-boulder-${i + 1}`, type: 'boulder', role: 'damage', x: bx, w, h, mandatory: true, variant: i % 4 })),
        ...DUST.map(([dx, w, h, drift], i) => ({ id: `soj-dust-${i + 1}`, type: 'magneticDust', role: 'damage', x: dx, w, y0: GROUND_Y - h, y1: GROUND_Y, drift, periodMs: 3000, tickMs: 900 })),
    ];
    const fragPos = Object.fromEntries(Object.entries(FRAG).map(([n, [fx, hgt]]) => [n, { x: fx, y: GROUND_Y - hgt }]));
    const c = contentFields('sojourner', fragPos, startX, finishX);

    const lead = 2 * PHYS.cruiseSpeed;   // >= 2 s of normal-speed approach
    const firstDust = DUST[0];
    const spans = [
        [PEBBLES[0][0], PEBBLES[0][0] + PEBBLES[0][1] + 80],
        [BOULDERS[0][0], BOULDERS[0][0] + BOULDERS[0][1] + 80],
        [firstDust[0] - firstDust[3], firstDust[0] + firstDust[1] + firstDust[3] + 80],
        [CHANNELS[1][0], CHANNELS[1][0] + CHANNELS[1][1] + 80],
    ];
    const tutorials = c.tutorialsContent.map((t, i) => ({ ...t, triggerX: spans[i][0] - lead, hazardX: spans[i][0], clearX: spans[i][1] }));
    const safeZones = c.checkpoints.map((cp) => ({ x0: cp.x - 300, x1: cp.x + 300 }));
    const sources = ['https://science.nasa.gov/mission/mars-pathfinder/', 'https://science.nasa.gov/blogs/perseverance-mars-rover/2026/10/12/nasas-perseverance-sets-off-world-record-for-total-distance-driven/'];
    return {
        schemaVersion: 1,
        id: 'sojourner', order: 1, title: 'Sojourner', subtitle: 'Ares Vallis, 1997',
        missionDates: { landing: 'July 4, 1997', timeConvention: 'Earth calendar date (UTC)' },
        sourceScript: c.sourceScript, sources,
        rover: sojournerRover(),
        physics: physics({ ...PHYS }),
        ability: { id: 'airbagBounce', params: { bounceVelocity: ABILITY.bounceVelocity, charges: ABILITY.charges, airbagFxMs: 450 } },
        world: { length: LENGTH, groundY: GROUND_Y, startX, finishX, spawnX: 380, seed: 1997, killY: GROUND_Y + 90 },
        intro: { type: 'pathfinderLanding', label: 'Condensed landing reenactment', landerX: 150, rampTopX: 250, rampBottomX: 330, rampDeg: 20, bounces: 4 },
        terrain: { ground, platforms: [] },
        safeZones,
        hazards,
        landmarks: [{ id: 'soj-pathfinder-lander', type: 'pathfinderLander', role: 'decoration', x: 150, label: 'CARL SAGAN MEMORIAL STATION' }],
        pickups: { fragments: c.fragments, batteries: [] },
        tutorials,
        checkpoints: c.checkpoints,
        quiz: c.quiz,
        codex: { ...c.codex, sources: codexSources(sources) },
        theme: { id: 'ares', palette: ['#8c7d70', '#a69688', '#594d42'], sky: '#d9a35b' },
        storm: null,
        hud: { energy: false, ability: 'AIRBAGS' },
    };
}

/** Simulated reachability + intended-failure checks. Returns a list of report lines; throws on failure. */
export function verify(level) {
    const out = [], fail = [];
    const P = level.physics, A = level.ability.params;
    const bw = level.rover.body.w;
    const hop = arc(P, { bounceVelocity: A.bounceVelocity }, { jump: true });
    const bounce = arc(P, { bounceVelocity: A.bounceVelocity }, { bounceAtMs: 0 });
    out.push(`hop apex ${apex(hop).toFixed(1)} px / travel ${hop[hop.length - 1].x.toFixed(0)} px; bounce apex ${apex(bounce).toFixed(1)} px / travel ${bounce[bounce.length - 1].x.toFixed(0)} px`);

    for (const h of level.hazards.filter((z) => z.type === 'pebble')) {
        const r = clears(hop, h.h, h.w, bw);
        if (!(r.margin >= 1.15)) fail.push(`${h.id}: hop margin ${r.margin.toFixed(2)} < 1.15`);
    }
    out.push(`pebbles: hop clears all ${level.hazards.filter((z) => z.type === 'pebble').length} (min margin ${Math.min(...level.hazards.filter((z) => z.type === 'pebble').map((h) => clears(hop, h.h, h.w, bw).margin)).toFixed(2)})`);
    const boulders = level.hazards.filter((z) => z.type === 'boulder');
    for (const h of boulders) {
        if (spanAbove(hop, h.h - 2) > 0) fail.push(`${h.id}: normal hop can clear (h ${h.h})`);
        const r = clears(bounce, h.h, h.w, bw);
        if (!(r.margin >= 1.15)) fail.push(`${h.id}: bounce margin ${r.margin.toFixed(2)} < 1.15`);
    }
    const outsideSafe = boulders.filter((b) => !level.safeZones.some((z) => b.x + b.w > z.x0 && b.x < z.x1) && b.mandatory);
    if (outsideSafe.length < 4) fail.push(`only ${outsideSafe.length} mandatory boulders outside safe zones (need >= 4)`);
    out.push(`boulders: ${boulders.length} mandatory (${outsideSafe.length} outside safe zones); hop clears none (apex ${apex(hop).toFixed(0)} < min top ${Math.min(...boulders.map((b) => b.h))}); bounce min margin ${Math.min(...boulders.map((h) => clears(bounce, h.h, h.w, bw).margin)).toFixed(2)}`);
    for (const d of level.hazards.filter((z) => z.type === 'magneticDust')) {
        // cloud oscillates x = x0 + drift*sin(2πt/period): worst case it closes on the rover
        // at its peak speed for the whole time the rover is above the plume
        const H = GROUND_Y - d.y0;
        const above = bounce.filter((s) => s.h > H);
        const tAbove = above.length ? above[above.length - 1].t - above[0].t : 0;
        const vCloud = 2 * Math.PI * d.drift / (d.periodMs / 1000);
        const need = d.w + bw + vCloud * tAbove;
        const margin = spanAbove(bounce, H) / need;
        if (margin < 1.05) fail.push(`${d.id}: bounce margin over moving plume ${margin.toFixed(2)} < 1.05`);
        out.push(`${d.id}: bounce clears ${d.w}px plume (h ${H}) moving ≤${vCloud.toFixed(0)} px/s, margin ${margin.toFixed(2)}; hop cannot (apex ${apex(hop).toFixed(0)} < ${H})`);
        if (apex(hop) > H) fail.push(`${d.id}: hop clears plume`);
    }
    // channels
    const gaps = [];
    for (let i = 0; i < level.terrain.ground.length - 1; i++) gaps.push({ x: level.terrain.ground[i].x1, w: level.terrain.ground[i + 1].x0 - level.terrain.ground[i].x1 });
    for (const g of gaps) {
        const ground = crosses(bounce, g.w, bw);
        const hopOnly = crosses(hop, g.w, bw);
        const hopT = hop[hop.length - 1].t * 1000;
        const okTimes = [];
        let best = null;
        for (let ms = 10; ms < hopT; ms += 5) {
            const r = crosses(arc(P, { bounceVelocity: A.bounceVelocity }, { jump: true, bounceAtMs: ms }), g.w, bw);
            if (r.reliable) okTimes.push(ms);
            if (!best || r.margin > best.margin) best = { ...r, ms };
        }
        if (g.w >= 300) {
            if (!ground.impossible) fail.push(`channel @${g.x} (${g.w}px): ground-only bounce can cross (best reach ${ground.bestReach.toFixed(0)})`);
            if (!okTimes.length) fail.push(`channel @${g.x}: SPACE + delayed SHIFT never reliable (best margin ${best.margin.toFixed(2)})`);
            out.push(`wide channel @${g.x} ${g.w}px: ground bounce best reach ${ground.bestReach.toFixed(0)} (impossible), SPACE→SHIFT reliable for SHIFT at ${okTimes[0]}–${okTimes[okTimes.length - 1]} ms of a ${hopT.toFixed(0)} ms hop, best margin ${best.margin.toFixed(2)}`);
        } else {
            if (!hopOnly.impossible) fail.push(`gap @${g.x}: hop alone can cross`);
            if (!ground.reliable) fail.push(`gap @${g.x}: ground bounce not reliable (margin ${ground.margin.toFixed(2)})`);
            out.push(`bounce gap @${g.x} ${g.w}px: ground bounce margin ${ground.margin.toFixed(2)}, hop impossible`);
        }
    }
    // safe zones + tutorial approaches free of damage
    const dmg = level.hazards.filter((h) => h.role === 'damage').map((h) => [h.x - (h.drift || 0) - (h.range || 0), h.x + (h.w || 0) + (h.drift || 0)]);
    for (const z of level.safeZones) if (dmg.some(([a, b]) => b > z.x0 && a < z.x1) || gaps.some((g) => g.x + g.w > z.x0 && g.x < z.x1)) fail.push(`safe zone ${z.x0}-${z.x1} contains a hazard`);
    for (const t of level.tutorials) if (dmg.some(([a, b]) => b > t.triggerX && a < t.hazardX - 1)) fail.push(`tutorial ${t.id}: approach overlaps a damage zone`);
    // fragments: run height or on a safe bounce arc
    const H = (f) => GROUND_Y - f.y;
    for (const f of level.pickups.fragments) {
        const h = H(f);
        if (h <= level.rover.pickupHeight - 10) continue;               // collected while driving
        const reach = bounce.some((s) => s.h >= h - level.rover.pickupHeight && s.h <= h + 10);
        if (!reach) fail.push(`${f.id}: height ${h} not reachable by bounce`);
    }
    out.push(`fragments: 10 placed (${level.pickups.fragments.filter((f) => H(f) > 60).length} on bounce arcs)`);
    if (fail.length) throw new Error('Sojourner verify failed:\n  ' + fail.join('\n  '));
    return out;
}
