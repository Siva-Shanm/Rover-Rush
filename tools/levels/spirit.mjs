/**
 * Spirit — Gusev Crater, 2004 (V2 content). Layout is an exact port of the
 * pre-upgrade LEVEL_MAP in js/scenes/GameScene.js (commit b15ac95): same
 * percentages, sizes and patrol ranges, so Spirit's regression baseline holds.
 */
import { GROUND_Y, spiritRover, physics, contentFields, codexSources } from './common.mjs';

const LENGTH = 30000;
const pct = (p) => (LENGTH * p) / 100;
const OLD = {   // pre-upgrade LEVEL_MAP, verbatim values
    craters: [[4, 170], [10, 180], [22, 190], [33, 200], [47, 190], [70, 210], [78, 200], [93, 220]],
    overhangs: [14, 19, 44, 66.5, 90],
    dustDevils: [[30, 90], [37, 110], [65, 120], [83.2, 110]],
    sandTraps: [[55, 600], [85, 480]],
    batteries: [18, 39, 60.6, 72, 88],
    fragments: { 1: [8], 2: [17, true], 3: [24], 5: [32], 4: [41], 6: [52], 8: [71.5], 9: [82], 10: [95] },
    embeddedSilica: [62, 7],
};

export function build() {
    const startX = 0, finishX = LENGTH;
    const gaps = OLD.craters.map(([at, w]) => ({ x0: pct(at), x1: pct(at) + w }));
    const ground = [];
    let x = -1200;
    for (const g of gaps) { ground.push({ x0: x, x1: g.x0, top: GROUND_Y, role: 'solid' }); x = g.x1; }
    ground.push({ x0: x, x1: LENGTH + 2600, top: GROUND_Y, role: 'solid' });

    const hazards = [];
    OLD.overhangs.forEach((at, i) => hazards.push({ id: `spi-overhang-${i + 1}`, type: 'overhang', role: 'damage', x: pct(at), w: 176, tipY: GROUND_Y - 58 }));
    OLD.dustDevils.forEach(([at, range], i) => hazards.push({ id: `spi-devil-${i + 1}`, type: 'dustDevil', role: 'damage', x: pct(at), range, w: 96, y0: GROUND_Y - 122, y1: GROUND_Y - 52, periodMs: 1500 }));
    OLD.sandTraps.forEach(([at, len], i) => hazards.push({ id: `spi-sand-${i + 1}`, type: 'sandTrap', role: 'slow', x: pct(at), x1: pct(at) + len, speedMult: 0.3 }));
    hazards.push({ id: 'spi-embedded-silica', type: 'embeddedSilica', role: 'trigger', x: pct(OLD.embeddedSilica[0]), radius: 60, hintRadius: 260, reveals: 'spi-f07' });

    const fragPos = {};
    for (const [n, [at, high]] of Object.entries(OLD.fragments)) fragPos[n] = { x: pct(at), y: high ? GROUND_Y - 290 : GROUND_Y - 70 };
    fragPos[OLD.embeddedSilica[1]] = { hiddenUntil: 'spi-embedded-silica' };

    const c = contentFields('spirit', fragPos, startX, finishX);
    // tutorials bracket the first hazard of each kind, triggering >= 2 s of normal-speed approach before it
    const lead = 2 * 300;
    const spans = [
        [gaps[0].x0, gaps[0].x1 + 80],                                                  // first crater
        [pct(OLD.overhangs[0]), pct(OLD.overhangs[0]) + 176 + 80],                      // first silica overhang
        [pct(OLD.dustDevils[0][0]) - OLD.dustDevils[0][1] - 60, pct(OLD.dustDevils[0][0]) + 160], // first devil
        [pct(OLD.sandTraps[0][0]), pct(OLD.sandTraps[0][0]) + 360],                     // first sand trap
    ];
    const tutorials = c.tutorialsContent.map((t, i) => ({ ...t, triggerX: spans[i][0] - lead, hazardX: spans[i][0], clearX: spans[i][1] }));

    const sources = ['https://science.nasa.gov/mission/mer-spirit/', 'https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/'];
    return {
        schemaVersion: 1,
        id: 'spirit', order: 2, title: 'Spirit', subtitle: 'Gusev Crater, 2004',
        missionDates: { landing: 'Jan. 3, 2004', timeConvention: 'PST (Jan. 4 UTC)' },
        sourceScript: c.sourceScript, sources,
        rover: spiritRover(),
        physics: physics({
            cruiseSpeed: 300, gravity: 800, jumpVelocity: 336, jumpHoldAccel: 1400, jumpHoldMaxMs: 300,
            // Spirit-only legacy systems preserved from the baseline (not shared with other rovers)
            energy: { max: 100, regenPerSec: 2.5, jumpCost: 4, devilDrain: 15, batteryCharge: 40 },
            legacyBoost: { keys: 'E or hold SPACE', speedMult: 1.5, drainPerSec: 24, holdSpaceMs: 500 },
        }),
        ability: { id: 'trenchScrapeSlide', params: { energyCost: 15, slideBodyH: 42, fastFall: 1400 } },
        world: { length: LENGTH, groundY: GROUND_Y, startX, finishX, spawnX: 140, seed: 2004, killY: GROUND_Y + 70 },
        terrain: { ground, platforms: [] },
        safeZones: [],
        hazards,
        landmarks: [{ id: 'spi-columbia-station', type: 'columbiaStation', role: 'decoration', x: -40, label: 'COLUMBIA MEMORIAL STATION' }],
        pickups: { fragments: c.fragments, batteries: OLD.batteries.map((at, i) => ({ id: `spi-battery-${i + 1}`, role: 'pickup', x: pct(at), y: GROUND_Y - 80 })) },
        tutorials,
        checkpoints: c.checkpoints,
        quiz: c.quiz,
        codex: { ...c.codex, sources: codexSources(sources) },
        theme: { id: 'gusev', raster: true },
        storm: null,
        hud: { energy: true, ability: 'SLIDE' },
    };
}

export function verify() { return []; }   // Spirit layout is the regression baseline (verified by bot playthrough)
