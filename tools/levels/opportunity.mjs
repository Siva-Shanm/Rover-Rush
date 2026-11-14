/**
 * Opportunity — Meridiani Planum, 2004. Solar Wind Boost course (dedicated layout,
 * independent of Spirit's Gusev course; only the rover texture is shared).
 *
 * Tuning (V = 300 px/s, G = 800, J = 336 from Spirit's baseline):
 *   cruise 1.15 V = 345 px/s; jump = J with Spirit's hold lift.
 *   Boost must beat Spirit's existing boost (E / hold SPACE) by >= 1.5x in both
 *   top speed and duration. Spirit boost = 1.5 V = 450 px/s, lasting
 *   100 % / (24 - 2.5) %/s = 4651 ms from a full battery. Therefore:
 *   boost speed = max(2.5 V, 1.5 * 450) = 750 px/s; duration = max(1200, 1.5 * 4651) -> 7000 ms;
 *   recharge 3000 ms after the burst. Re-measured in the browser in M6.
 */
import { GROUND_Y, SPIRIT, opportunityRover, physics, contentFields, codexSources } from './common.mjs';
import { arc, apex, crosses } from './sim.mjs';

const LENGTH = 48000;
const SPIRIT_BOOST = { speed: 1.5 * SPIRIT.cruise, durationMs: Math.round(100 / (24 - 2.5) * 1000) };
const PHYS = { cruiseSpeed: Math.round(1.15 * SPIRIT.cruise), gravity: SPIRIT.gravity, jumpVelocity: SPIRIT.jump, jumpHoldAccel: 1400, jumpHoldMaxMs: 300 };
const BOOST = {
    boostSpeed: Math.max(Math.round(2.5 * SPIRIT.cruise), Math.ceil(1.5 * SPIRIT_BOOST.speed)),
    durationMs: Math.max(1200, Math.ceil(1.5 * SPIRIT_BOOST.durationMs / 100) * 100),
    rechargeMs: 3000,
};

// ground segments [x0, x1, top]; gaps between them are real pits with a kill plane
const GROUND = [
    [-1200, 1400, 690], [1400, 1700, 645], [1700, 5200, 620],          // Eagle Crater floor -> wall step -> plains
    [5600, 6400, 620], [6400, 7300, 520], [7300, 9800, 620],            // ridge 1 (layered outcrop, 100 px)
    [10250, 14600, 620], [14600, 15600, 500], [15600, 17000, 620],     // ridge 2 (120 px)
    [17880, 21500, 620], [21950, 26200, 620],                          // first wide (boost) crossing at 17000
    [27100, 28000, 620], [28000, 28800, 540], [28800, 30200, 620],     // Endurance Crater section
    [31130, 33400, 620], [34300, 39000, 620],
    [39420, 42500, 620], [42950, 45000, 620], [45000, 45700, 540], [45700, LENGTH + 2600, 620],   // storm
];
const GUSTS = [[3500, 3800], [15800, 16100], [24800, 25100], [28900, 29200], [32300, 32600]];
const PLUMES = [[8400, 90, 60], [19500, 100, 64], [37200, 100, 60], [41000, 110, 64], [44000, 100, 60]];   // x, w, height
const FRAG = { 1: [2200, 620], 2: [4400, 620], 3: [6800, 520], 4: [9000, 620], 5: [13000, 620], 6: [16500, 620], 7: [18900, 620], 8: [29500, 620], 9: [31800, 620], 10: [46500, 620] };

export function build() {
    const startX = 0, finishX = LENGTH;
    const ground = GROUND.map(([x0, x1, top]) => ({ x0, x1, top, role: 'solid', style: top < GROUND_Y ? 'outcrop' : (top > GROUND_Y ? 'craterFloor' : 'plain') }));
    const hazards = [
        ...GUSTS.map(([x0, x1], i) => ({ id: `opp-gust-${i + 1}`, type: 'gust', role: 'trigger', x: x0, x1 })),
        ...PLUMES.map(([x, w, h], i) => ({ id: `opp-plume-${i + 1}`, type: 'dustPlume', role: 'damage', x, w, y0: GROUND_Y - h, y1: GROUND_Y, drift: 30, periodMs: 2400, tickMs: 900 })),
    ];
    const fragPos = Object.fromEntries(Object.entries(FRAG).map(([n, [x, top]]) => [n, { x, y: top - 70 }]));
    const c = contentFields('opportunity', fragPos, startX, finishX);
    const lead = 2 * PHYS.cruiseSpeed;
    const spans = [
        [1400, 1780],             // first crater-rim step
        [GUSTS[0][0], GUSTS[0][1] + 80],
        [6400, 6560],             // first layered outcrop
        [39000, 39500],           // first storm gap
    ];
    const tutorials = c.tutorialsContent.map((t, i) => ({ ...t, triggerX: spans[i][0] - lead, hazardX: spans[i][0], clearX: spans[i][1] }));
    const safeZones = c.checkpoints.map((cp) => ({ x0: cp.x - 400, x1: cp.x + 400 }));
    const sources = ['https://science.nasa.gov/mission/mer-opportunity/', 'https://science.nasa.gov/resource/lion-king-panorama/',
        'https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/',
        'https://science.nasa.gov/blogs/perseverance-mars-rover/2026/10/12/nasas-perseverance-sets-off-world-record-for-total-distance-driven/'];
    return {
        schemaVersion: 1,
        id: 'opportunity', order: 3, title: 'Opportunity', subtitle: 'Meridiani Planum, 2004',
        missionDates: { landing: 'Jan. 24, 2004', timeConvention: 'PST (Jan. 25 UTC)' },
        sourceScript: c.sourceScript, sources,
        rover: opportunityRover(),
        physics: physics({ ...PHYS }),
        ability: { id: 'solarWindBoost', params: { ...BOOST, spiritBoostSpeed: SPIRIT_BOOST.speed, spiritBoostMs: SPIRIT_BOOST.durationMs } },
        world: { length: LENGTH, groundY: GROUND_Y, startX, finishX, spawnX: 140, seed: 2018, killY: GROUND_Y + 170 },
        terrain: { ground, platforms: [] },
        safeZones,
        hazards,
        landmarks: [
            { id: 'opp-eagle-rim', type: 'craterRim', role: 'decoration', x: 1400, label: 'EAGLE CRATER' },
            { id: 'opp-endurance-rim', type: 'craterRim', role: 'decoration', x: 26200, label: 'ENDURANCE CRATER' },
        ],
        pickups: { fragments: c.fragments, batteries: [] },
        tutorials,
        checkpoints: c.checkpoints,
        quiz: c.quiz,
        codex: { ...c.codex, sources: codexSources(sources) },
        theme: { id: 'meridiani', palette: ['#b8925a', '#d6b98a', '#7a5a3a'], sky: '#c9a06a' },
        storm: { startP: 0.75, maxOverlay: 0.65, color: '#7a4a1e' },
        hud: { energy: false, ability: 'BOOST', distanceLabel: 'Narrative scale' },
    };
}

export function verify(level) {
    const out = [], fail = [];
    const P = level.physics, A = level.ability.params, bw = level.rover.body.w;
    if (A.boostSpeed < 1.5 * A.spiritBoostSpeed) fail.push(`boost speed ${A.boostSpeed} < 1.5x Spirit ${A.spiritBoostSpeed}`);
    if (A.durationMs < 1.5 * A.spiritBoostMs) fail.push(`boost duration ${A.durationMs} < 1.5x Spirit ${A.spiritBoostMs}`);
    if (A.boostSpeed < 2.5 * SPIRIT.cruise || A.durationMs < 1200) fail.push('boost below PRD floors');
    out.push(`boost ${A.boostSpeed} px/s for ${A.durationMs} ms (Spirit legacy boost ${A.spiritBoostSpeed} px/s, ${A.spiritBoostMs} ms from full battery → ratios ${(A.boostSpeed / A.spiritBoostSpeed).toFixed(2)}x, ${(A.durationMs / A.spiritBoostMs).toFixed(2)}x)`);
    const tap = arc(P, {}, { jump: true, holdMs: 0 });
    const full = arc(P, {}, { jump: true, holdMs: 300 });
    const boosted = arc(P, {}, { jump: true, holdMs: 300, boostAtMs: 0, boostMs: A.durationMs, boostSpeed: A.boostSpeed });
    out.push(`jump apex tap ${apex(tap).toFixed(0)} / full ${apex(full).toFixed(0)} px; travel full ${full[full.length - 1].x.toFixed(0)} px, boosted ${boosted[boosted.length - 1].x.toFixed(0)} px`);
    const g = level.terrain.ground;
    for (let i = 0; i < g.length - 1; i++) {
        const a = g[i], b = g[i + 1];
        if (b.x0 > a.x1) {                      // pit
            const w = b.x0 - a.x1;
            const stormy = a.x1 >= level.world.startX + level.storm.startP * (level.world.finishX - level.world.startX);
            const plain = crosses(full, w, bw), boost = crosses(boosted, w, bw);
            if (w > 700) {
                if (!plain.impossible) fail.push(`wide gap @${a.x1}: crossable without boost`);
                if (!boost.reliable) fail.push(`wide gap @${a.x1}: boost+jump not reliable (margin ${boost.margin.toFixed(2)})`);
                const gust = level.hazards.find((h) => h.type === 'gust' && h.x1 <= a.x1 && a.x1 - h.x1 < 2000);
                if (!gust) fail.push(`wide gap @${a.x1}: no wind-gust zone within 2000 px before it`);
                if (stormy) fail.push(`wide gap @${a.x1}: storm section must not depend on boost`);
                out.push(`wide gap @${a.x1} ${w}px: no-boost best reach ${plain.bestReach.toFixed(0)} (impossible), boost+jump margin ${boost.margin.toFixed(2)}, readied by ${gust && gust.id}`);
            } else {
                if (!plain.reliable) fail.push(`gap @${a.x1} (${w}px): full jump not reliable (margin ${plain.margin.toFixed(2)})`);
                out.push(`gap @${a.x1} ${w}px: full jump margin ${plain.margin.toFixed(2)}${stormy ? ' (storm, no boost needed)' : ''}`);
            }
        } else if (b.top < a.top) {             // step up (outcrop / crater wall)
            const H = a.top - b.top;
            const needs = apex(tap) > H + 8 ? 'tap' : (apex(full) > H + 8 ? 'held jump' : null);
            if (!needs) fail.push(`step @${b.x0} (${H}px) cannot be climbed`);
            out.push(`step up @${b.x0} ${H}px: climbable with ${needs}`);
        }
    }
    const dmg = level.hazards.filter((h) => h.role === 'damage');
    for (const d of dmg) {
        const span = d.w + 2 * d.drift, H = GROUND_Y - d.y0;
        const r = full.filter((s) => s.h > H);
        const clear = r.length ? r[r.length - 1].x - r[0].x : 0;
        if (clear < span + bw) fail.push(`${d.id}: full jump cannot clear drift span`);
    }
    out.push(`dust plumes: ${dmg.length}, all clearable by a full jump`);
    for (const z of level.safeZones) {
        if (dmg.some((h) => h.x + h.w + h.drift > z.x0 && h.x - h.drift < z.x1)) fail.push(`safe zone ${z.x0} has a hazard`);
        if (g.some((s, i) => i < g.length - 1 && g[i + 1].x0 > s.x1 && s.x1 < z.x1 && g[i + 1].x0 > z.x0)) fail.push(`safe zone ${z.x0} has a pit`);
    }
    for (const t of level.tutorials) if (dmg.some((h) => h.x + h.w + h.drift > t.triggerX && h.x - h.drift < t.hazardX)) fail.push(`tutorial ${t.id}: approach overlaps damage`);
    for (const f of level.pickups.fragments) {
        const seg = g.find((s) => f.x >= s.x0 && f.x <= s.x1);
        if (!seg) fail.push(`${f.id}: not above solid ground`);
        else if (seg.top - f.y > level.rover.pickupHeight - 10) fail.push(`${f.id}: too high to collect while driving`);
    }
    out.push('fragments: all 10 above solid ground at driving height');
    if (fail.length) throw new Error('Opportunity verify failed:\n  ' + fail.join('\n  '));
    return out;
}
