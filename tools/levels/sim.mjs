/**
 * Deterministic trajectory simulation used at build time to prove that
 * mandatory routes and collectibles are reachable (and that intended
 * shortcuts are NOT possible). Mirrors the runtime rules in GameScene:
 * constant forward speed, world gravity, impulse jumps, Spirit-style hold
 * lift, Sojourner airbag bounce (vy := -bounce), Opportunity horizontal boost.
 * Units: px, px/s, px/s^2, ms. Fixed step 1/240 s.
 */
export const DT = 1 / 240;

/**
 * Simulate one airborne arc starting on the ground at x0 (rover body left edge = x0).
 * actions: { holdMs, bounceAtMs (Sojourner SHIFT time, -1 none, 0 = ground bounce),
 *            boostAtMs, boostMs, boostSpeed, jump (bool) }
 * Returns samples [{t, x, h}] where h = body bottom height above the takeoff ground.
 */
export function arc(phys, ability, actions, maxT = 4) {
    const out = [];
    let t = 0, x = 0, h = 0;
    let vy = 0;                           // upward positive
    let vx = phys.cruiseSpeed;
    let holdLeft = 0;
    if (actions.jump) { vy = phys.jumpVelocity; holdLeft = Math.min(actions.holdMs || 0, phys.jumpHoldMaxMs) / 1000; }
    let bounced = false;
    if (actions.bounceAtMs === 0) { vy = ability.bounceVelocity; bounced = true; }
    let boostUntil = -1;
    while (t < maxT) {
        const ms = t * 1000;
        if (!bounced && actions.bounceAtMs > 0 && ms >= actions.bounceAtMs) { vy = ability.bounceVelocity; bounced = true; holdLeft = 0; }
        if (actions.boostAtMs >= 0 && boostUntil < 0 && ms >= actions.boostAtMs) boostUntil = ms + actions.boostMs;
        vx = (boostUntil >= 0 && ms < boostUntil) ? actions.boostSpeed : phys.cruiseSpeed;
        let ay = -phys.gravity;
        if (holdLeft > 0 && vy > 0) { ay += phys.jumpHoldAccel; holdLeft -= DT; }
        vy += ay * DT;
        h += vy * DT;
        x += vx * DT;
        t += DT;
        out.push({ t, x, h });
        if (h <= 0 && vy < 0 && t > 0.02) { out[out.length - 1].h = 0; break; }
    }
    return out;
}

export const apex = (samples) => Math.max(...samples.map((s) => s.h));
export const airDistance = (samples) => samples[samples.length - 1].x;

/** Horizontal distance during which the body bottom is above height H. */
export function spanAbove(samples, H) {
    const above = samples.filter((s) => s.h > H);
    return above.length ? above[above.length - 1].x - above[0].x : 0;
}

/** Can an arc clear an obstacle of width w, height H with body width bw? margin = ratio. */
export function clears(samples, H, w, bw) {
    const span = spanAbove(samples, H);
    return { ok: span >= w + bw, margin: span / (w + bw) };
}

/**
 * Gap crossing. The body stays supported while any part overlaps ground and
 * lands as soon as any part overlaps the far side, so:
 *   bestReach = travel + bodyWidth  (latest possible takeoff: left edge at the brink)
 *   safeReach = travel              (comfortable takeoff: whole body still on ground)
 * A route is reliably crossable when safeReach >= gap AND bestReach >= 1.15 * gap.
 * A route is impossible when even bestReach < gap.
 */
export function crosses(samples, gap, bw) {
    const travel = airDistance(samples);
    return {
        reliable: travel >= gap && (travel + bw) / gap >= 1.15,
        impossible: travel + bw < gap,
        safeReach: travel,
        bestReach: travel + bw,
        margin: (travel + bw) / gap,
    };
}
