/**
 * TimeCoordinator — one owner for gameplay time dilation.
 * ---------------------------------------------------------------------------
 * Reasons have explicit precedence (PRD §9):
 *     modal/death freeze  >  tutorial slow motion  >  fragment slow motion  >  normal
 * Freezes are implemented by pausing the whole GameScene (DOM UI stays live).
 * Slow-motion reasons each own an eased value; the *highest-precedence active*
 * reason decides the speed, so ending one reason never resumes over another.
 *
 * Applied consistently to: Arcade physics (our manual step uses
 * delta / world.timeScale — Arcade's scale is reciprocal: 4 = quarter speed),
 * scene clock, tweens, animations and particle emitters. No double scaling:
 * custom update logic derives its game-time dt from world.timeScale too.
 */
class TimeCoordinator {
    constructor(scene, emitters) {
        this.scene = scene;
        this.emitters = emitters || [];
        this.order = ['tutorial', 'fragment'];     // precedence (first wins)
        this.reasons = {};                         // name -> { value, tween }
        this.speed = 1;
        this.apply(1);
    }

    /** Effective game speed (1 = normal). */
    get current() { return this.speed; }

    /** Ease a reason's speed to `target` over `ms` of real time. */
    set(reason, target, ms) {
        const r = this.reasons[reason] || (this.reasons[reason] = { value: 1, tween: null, active: false });
        r.active = true;
        this._ease(r, target, ms, () => {});
    }

    /** Ease a reason back to 1 and drop it. Other reasons are untouched. */
    clear(reason, ms) {
        const r = this.reasons[reason];
        if (!r) return;
        this._ease(r, 1, ms, () => { r.active = false; });
    }

    has(reason) { return !!(this.reasons[reason] && this.reasons[reason].active); }

    /** Immediately drop every reason (restart/exit/respawn). */
    reset() {
        Object.values(this.reasons).forEach((r) => { if (r.tween) r.tween.stop(); });
        this.reasons = {};
        this.apply(1);
    }

    _ease(r, target, ms, done) {
        if (r.tween) { r.tween.stop(); r.tween = null; }
        if (!ms) { r.value = target; done(); this._recompute(); return; }
        const tw = this.scene.tweens.add({
            targets: r, value: target, duration: ms, ease: 'Sine.easeInOut',
            onUpdate: () => { this._recompute(); tw.timeScale = 1 / this.scene.tweens.timeScale; },
            onComplete: () => { r.tween = null; done(); this._recompute(); },
        });
        tw.timeScale = 1 / this.scene.tweens.timeScale;   // compensate: real-time ease
        r.tween = tw;
    }

    _recompute() {
        let s = 1;
        for (const name of this.order) {
            const r = this.reasons[name];
            if (r && (r.active || r.tween)) { s = r.value; break; }
        }
        this.apply(s);
    }

    apply(s) {
        this.speed = s;
        const sc = this.scene;
        sc.physics.world.timeScale = 1 / s;
        sc.time.timeScale = s;
        sc.tweens.timeScale = s;
        sc.anims.globalTimeScale = s;
        this.emitters.forEach((em) => { if (em && em.active !== false) em.timeScale = s; });
    }
}
