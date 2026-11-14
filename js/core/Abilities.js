/**
 * Abilities — rover -> exclusive SHIFT ability registry (no shared Shift logic).
 * ---------------------------------------------------------------------------
 *  trenchScrapeSlide (Spirit only)     held slide, body height halved at the feet,
 *                                      headroom-checked exit, 15% energy per start
 *  airbagBounce      (Sojourner only)  one charge per genuine landing; fresh press
 *                                      sets vy := -bounce (ground or air), no stacking
 *  solarWindBoost    (Opportunity only) fresh press: horizontal burst; ready ->
 *                                      active -> recharging; gust zones ready it once
 *
 * Each ability receives a per-frame context from GameScene:
 *   { dtMs (game time), grounded, landed (genuine descent-to-ground this frame),
 *     shiftDown, shiftPressed (fresh edge), jumpPressed (fresh edge), body }
 * and returns { suppressJump, speed } overrides. Ability timers run on game time
 * only, so they freeze with the scene during modals.
 */
const Abilities = (() => {
    class Base {
        constructor(scene, params) { this.scene = scene; this.p = params; this.reset(); }
        reset() {}
        cancel() { this.reset(); }
        update() { return {}; }
        onLanded() {}
        gust() {}
        isSliding() { return false; }
        hud() { return { label: '', state: 'ready', fill: 1 }; }
    }

    class TrenchScrapeSlide extends Base {
        reset() { this.sliding = false; this.blocked = false; this.heldForHeadroom = false; }
        cancel() { if (this.sliding) this.scene.setBodyHeight(null); this.reset(); }
        isSliding() { return this.sliding; }
        update(ctx) {
            const s = this.scene;
            if (ctx.shiftDown && !this.sliding) {
                if (s.spendEnergy(this.p.energyCost)) {
                    this.sliding = true; this.blocked = false;
                    s.setBodyHeight(this.p.slideBodyH);
                    s.tutorialInput('SHIFT');
                } else if (!this.blocked) {
                    this.blocked = true;
                    s.lowPowerFeedback();
                }
            } else if (!ctx.shiftDown) {
                this.blocked = false;
                if (this.sliding) {
                    // headroom: never stand up into an overhang / ceiling
                    if (s.levelManager.headroomClear(s.standingRect())) { this.sliding = false; this.heldForHeadroom = false; s.setBodyHeight(null); }
                    else this.heldForHeadroom = true;
                }
            }
            if (this.sliding && !ctx.grounded) s.rover.body.setVelocityY(s.rover.body.velocity.y + this.p.fastFall * ctx.dtMs / 1000);
            return {};
        }
        hud() {
            return { label: this.heldForHeadroom ? 'SLIDE: LOW CLEARANCE' : 'SLIDE', state: this.sliding ? 'active' : (this.blocked ? 'blocked' : 'ready'), fill: 1 };
        }
    }

    class AirbagBounce extends Base {
        reset() { this.charges = this.p.charges; this.fxUntil = 0; }
        onLanded() { this.charges = this.p.charges; }
        update(ctx) {
            if (!ctx.shiftPressed || this.charges <= 0) return {};
            if (!this.scene.spendEnergy(this.p.energyCost)) { this.scene.lowPowerFeedback(); return {}; }   // refused: a normal hop may still happen
            this.charges -= 1;                                   // spend before applying: no double fire
            const body = this.scene.rover.body;
            body.setVelocityY(-this.p.bounceVelocity);           // set, never add
            this.scene.onBounce();
            this.scene.tutorialInput('SHIFT');
            return { suppressJump: true };                       // SPACE+SHIFT together -> bounce only
        }
        hud() { return { label: 'AIRBAGS', state: this.charges > 0 ? 'ready' : 'spent', fill: this.charges / this.p.charges }; }
    }

    class SolarWindBoost extends Base {
        reset() { this.state = 'ready'; this.left = 0; this.queued = false; this.usedGusts = this.usedGusts || new Set(); }
        resetRun() { this.usedGusts = new Set(); this.reset(); }
        update(ctx) {
            if (this.state === 'active') {
                this.left -= ctx.dtMs;
                if (this.left <= 0) {
                    if (this.queued) { this.state = 'ready'; this.queued = false; }
                    else { this.state = 'recharging'; this.left = this.p.rechargeMs; }
                }
            } else if (this.state === 'recharging') {
                this.left -= ctx.dtMs;
                if (this.left <= 0) { this.state = 'ready'; this.left = 0; }
            }
            if (ctx.shiftPressed && this.state === 'ready') {     // fresh press only; ignored while active
                if (!this.scene.spendEnergy(this.p.energyCost)) { this.scene.lowPowerFeedback(); return {}; }
                this.state = 'active';
                this.left = this.p.durationMs;
                this.scene.onBoost();
                this.scene.tutorialInput('SHIFT');
            }
            return this.state === 'active' ? { speed: this.p.boostSpeed } : {};
        }
        /** Gust zone entry: readies the next boost once per zone per run. */
        gust(zoneId) {
            if (this.usedGusts.has(zoneId)) return false;
            if (this.state === 'ready') { this.usedGusts.add(zoneId); this.scene.gainEnergy('gust'); return true; }
            this.usedGusts.add(zoneId);
            // During an active burst the gust only queues readiness: refilling here would
            // instantly overwrite the visible boost deduction on the battery gauge.
            if (this.state === 'active') { this.queued = true; return true; }
            this.scene.gainEnergy('gust');
            this.state = 'ready'; this.left = 0;
            return true;
        }
        hud() {
            const fill = this.state === 'ready' ? 1 : this.state === 'active' ? this.left / this.p.durationMs : 1 - this.left / this.p.rechargeMs;
            return { label: 'SOLAR WIND BOOST', state: this.state, fill: Math.max(0, Math.min(1, fill)) };
        }
    }

    const REGISTRY = { trenchScrapeSlide: TrenchScrapeSlide, airbagBounce: AirbagBounce, solarWindBoost: SolarWindBoost };

    function create(scene, roverId, ability) {
        const legal = LevelSchema.ABILITY_FOR_ROVER[roverId];
        if (legal !== ability.id) throw new Error(`Illegal ability '${ability.id}' for rover '${roverId}' (expected '${legal}')`);
        const Cls = REGISTRY[ability.id];
        if (!Cls) throw new Error(`Unknown ability '${ability.id}'`);
        return new Cls(scene, ability.params);
    }

    return { create, REGISTRY };
})();
