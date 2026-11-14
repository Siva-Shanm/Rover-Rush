/**
 * SaveStore — versioned save data + personal bests, keyed by stable mission ID.
 * ---------------------------------------------------------------------------
 * Format v2 (localStorage 'roverRush.save'):
 *   { version: 2, missions: { <id>: { bestProgress, completed, fastestMs, codexUnlocked } }, ...unknown fields kept }
 * Migration: the v1 flag 'roverRush.codex.MER-A' === '1' marks Spirit completed +
 * Codex unlocked, with NO fabricated clear time. If storage is unavailable the
 * store keeps working in memory for the session.
 */
const SaveStore = (() => {
    const KEY = 'roverRush.save';
    const LEGACY_SPIRIT = 'roverRush.codex.MER-A';
    const MISSIONS = ['sojourner', 'spirit', 'opportunity'];
    const MAX_MS = 6 * 60 * 60 * 1000;   // sanity bound for a stored clear time

    let memory = null;
    let storageOk = true;

    const blank = () => ({ bestProgress: 0, completed: false, fastestMs: null, codexUnlocked: false });

    function storage() {
        try { const s = window.localStorage; s.getItem('x'); return s; } catch (e) { storageOk = false; return null; }
    }

    function sanitize(m) {
        const out = blank();
        if (!m || typeof m !== 'object') return out;
        const bp = Number(m.bestProgress);
        out.completed = m.completed === true;
        out.bestProgress = Number.isFinite(bp) ? Math.max(0, Math.min(out.completed ? 1 : 0.99, bp)) : 0;
        const ms = m.fastestMs;
        out.fastestMs = Number.isInteger(ms) && ms > 0 && ms < MAX_MS ? ms : null;
        if (out.fastestMs !== null) out.completed = true;
        out.codexUnlocked = m.codexUnlocked === true;
        return out;
    }

    function load() {
        if (memory) return memory;
        const s = storage();
        let data = null;
        if (s) { try { data = JSON.parse(s.getItem(KEY) || 'null'); } catch (e) { data = null; } }
        if (!data || typeof data !== 'object') data = { version: 2, missions: {} };
        data.version = 2;
        data.missions = data.missions && typeof data.missions === 'object' ? data.missions : {};
        for (const id of MISSIONS) data.missions[id] = sanitize(data.missions[id]);
        // v1 -> v2 migration (idempotent)
        if (s) {
            try {
                if (s.getItem(LEGACY_SPIRIT) === '1') {
                    const sp = data.missions.spirit;
                    sp.completed = true; sp.codexUnlocked = true; sp.bestProgress = 1;
                    s.removeItem(LEGACY_SPIRIT);
                }
            } catch (e) { /* ignore */ }
        }
        memory = data;
        persist();
        return memory;
    }

    function persist() {
        const s = storage();
        if (!s) return false;
        try { s.setItem(KEY, JSON.stringify(memory)); return true; } catch (e) { storageOk = false; return false; }
    }

    const get = (id) => load().missions[id] || blank();

    /** Record progress p in [0,1]; persisted at whole-percent milestones; never lowers. */
    function recordProgress(id, p) {
        const m = get(id);
        const cap = m.completed ? 1 : 0.99;
        const v = Math.max(0, Math.min(cap, p));
        if (Math.floor(v * 100) > Math.floor(m.bestProgress * 100)) { m.bestProgress = Math.floor(v * 100) / 100; persist(); return true; }
        return false;
    }

    /** First valid finish of an attempt: mark completed, keep the fastest integer ms. */
    function recordFinish(id, ms) {
        const m = get(id);
        m.completed = true;
        m.bestProgress = 1;
        const t = Math.round(ms);
        if (Number.isInteger(t) && t > 0 && t < MAX_MS && (m.fastestMs === null || t < m.fastestMs)) m.fastestMs = t;
        persist();
        return m.fastestMs;
    }

    function unlockCodex(id) { const m = get(id); if (!m.codexUnlocked) { m.codexUnlocked = true; persist(); } }

    function formatMs(ms) {
        const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
        return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
    }

    /** Test hook: drop the in-memory cache (re-read storage). */
    function _reload() { memory = null; return load(); }

    return { KEY, LEGACY_SPIRIT, load, get, recordProgress, recordFinish, unlockCodex, formatMs, isPersistent: () => storageOk, _reload };
})();
