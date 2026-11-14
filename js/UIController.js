/**
 * UIController — every HTML/DOM element layered above the Phaser canvas
 * (#ui-layer, z-index 10): mission menu + loader, HUD, intro overlay, tutorial
 * prompts, fragment pop-ups, checkpoint terminals, quiz, Codex, game over.
 * The DOM layer is never affected by the world camera's storm effects.
 * Mission text comes from the compiled level JSON; chrome from ContentDatabase.
 */
class UIController {
    constructor(content) {
        this.c = content;
        this.$ = (id) => document.getElementById(id);
        this.stage = this.$('stage');
        this.modal = this.$('modal');
        this.panel = this.$('modal-panel');
        this._typeTimer = null;
        this._lastHp = null;
        this._onResize = this._onResize.bind(this);
        window.addEventListener('resize', this._onResize);
        this._onResize();
        this._buildHearts(3);
    }

    _onResize() {
        const w = this.stage.getBoundingClientRect().width || 1280;
        document.documentElement.style.setProperty('--u', (w / 1280) + 'px');
    }

    static escape(s) {
        return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // ================================================================= HUD
    showHUD(on = true) { this.$('hud').classList.toggle('hidden', !on); }

    configureHUD({ energy, abilityLabel, narrative, checkpoints }) {
        this.$('hud-energy').classList.toggle('hidden', !energy);
        this.$('hud-ability-label').textContent = abilityLabel;
        this.$('progress-scale').textContent = narrative ? `${narrative}` : '';
        const ticks = this.$('progress-ticks');
        ticks.innerHTML = (checkpoints || []).map((p) => `<div class="progress-tick" style="left:${p * 100}%"></div>`).join('');
        this._lastHp = null;
    }

    _buildHearts(max) {
        const box = this.$('hud-hearts');
        box.innerHTML = '';
        for (let i = 0; i < max; i++) {
            const img = document.createElement('img');
            img.src = 'assets/ui/heart.png';
            img.alt = '';
            box.appendChild(img);
        }
    }

    updateHUD({ hp, maxHp, energy, progress, fragments, totalFragments, status, ability, timeMs }) {
        const hearts = this.$('hud-hearts');
        if (hearts.children.length !== maxHp) this._buildHearts(maxHp);
        [...hearts.children].forEach((img, i) => {
            const src = i < hp ? 'assets/ui/heart.png' : 'assets/ui/heart_empty.png';
            if (!img.src.endsWith(src)) img.src = src;
            img.classList.toggle('lost', i >= hp);
        });
        if (this._lastHp !== null && hp < this._lastHp) {
            hearts.classList.remove('hit'); void hearts.offsetWidth; hearts.classList.add('hit');
        }
        this._lastHp = hp;

        const e = Math.max(0, Math.min(1, energy / 100));
        this.$('energy-full').style.clipPath = `inset(0 ${(10 + (1 - e) * 84).toFixed(1)}% 0 0)`;
        this.$('energy-label').textContent = Math.round(e * 100) + '%';
        this.$('hud-energy').classList.toggle('low', e < 0.2);

        if (ability) {
            const pill = this.$('hud-ability');
            pill.dataset.state = ability.state;
            this.$('hud-ability-label').textContent = ability.label;
            this.$('hud-ability-state').textContent = ability.state.toUpperCase();
            this.$('hud-ability-fill').style.width = (ability.fill * 100).toFixed(0) + '%';
        }
        const p = Math.max(0, Math.min(1, progress));
        this.$('progress-fill').style.width = (p * 100).toFixed(2) + '%';
        this.$('progress-rover').style.left = (p * 100).toFixed(2) + '%';
        this.$('progress-label').textContent = Math.floor(p * 100) + '%';
        this.$('hud-fragments').textContent = `DATA ${fragments}/${totalFragments}`;
        this.$('hud-time').textContent = SaveStore.formatMs(Math.round(timeMs || 0));
        this.$('hud-status').textContent = status || '';
    }

    flashEnergy() {
        const el = this.$('hud-energy');
        el.classList.remove('denied'); void el.offsetWidth; el.classList.add('denied');
    }

    // ============================================================ overlays
    showIntro(label, onSkip) {
        this.$('intro-label').textContent = label;
        const b = this.$('intro-skip');
        b.textContent = this.c.ui.skip;
        b.onclick = () => onSkip();
        this.$('intro').classList.remove('hidden');
    }

    hideIntro() { this.$('intro').classList.add('hidden'); }

    showTutorial(t, onContinue) {
        this.$('tutorial-tag').textContent = this.c.ui.trainingSim;
        this.$('tutorial-text').textContent = t.text;
        this.$('tutorial-note').textContent = t.note || '';
        this.$('tutorial-note').classList.toggle('hidden', !t.note);
        const key = this.$('tutorial-key');
        key.textContent = t.keyCaption;
        key.classList.remove('ok');
        const cont = this.$('tutorial-continue');
        cont.textContent = this.c.ui.confirmTutorial;
        cont.onclick = (ev) => { ev.preventDefault(); cont.blur(); onContinue(); };
        this.$('tutorial-hint').textContent = this.c.ui.confirmHint;
        this.$('tutorial').classList.remove('hidden');
    }

    markTutorialDone() { this.$('tutorial-key').classList.add('ok'); }

    hideTutorial() { this.$('tutorial').classList.add('hidden'); }

    showFragment(def, total) {
        this.$('fragment-header').textContent = `${this.c.ui.fragmentHeader}  [${String(def.n).padStart(2, '0')}/${String(total).padStart(2, '0')}]`;
        this.$('fragment-text').textContent = def.displayText;
        this.$('fragment').classList.remove('hidden');
    }

    hideFragment() { this.$('fragment').classList.add('hidden'); }

    showFatal(msg) {
        this._open(`<div class="term-head"><span>ERROR</span></div><pre class="term-body">${UIController.escape(msg)}</pre>
            <div class="btn-row"><button class="btn" id="b-menu">${this.c.ui.menu}</button></div>`, 'bad');
        this._bind('b-menu', () => { this.close(); window.RoverRush.openMenu(); });
    }

    // ============================================================== modals
    _open(html, cls = '') {
        this.panel.className = 'panel ' + cls;
        this.panel.innerHTML = html;
        this.modal.classList.remove('hidden');
        const first = this.panel.querySelector('[data-autofocus]') || this.panel.querySelector('button:not([disabled])');
        this.panel.scrollTop = 0;
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    }

    close() {
        clearInterval(this._typeTimer);
        this.modal.classList.add('hidden');
        this.panel.innerHTML = '';
    }

    isModalOpen() { return !this.modal.classList.contains('hidden'); }

    _bind(id, fn) { const el = this.panel.querySelector('#' + id); if (el) el.addEventListener('click', fn); }

    _type(el, text, onDone, cps = 55) {
        clearInterval(this._typeTimer);
        let i = 0;
        el.classList.add('cursor');
        const finish = () => { clearInterval(this._typeTimer); el.textContent = text; el.classList.remove('cursor'); if (onDone) onDone(); onDone = null; };
        this._typeTimer = setInterval(() => { i += 2; el.textContent = text.slice(0, i); if (i >= text.length) finish(); }, 1000 / cps * 2);
        return finish;
    }

    // ================================================================ menu
    /**
     * Mission menu (first visible screen). opts = { missions, levels, load: {state, progress, error},
     * onLaunch(id), onRetry(), highlight }
     */
    showMenu(opts) {
        this.menuOpts = opts;
        const E = UIController.escape, ui = this.c.ui, m = this.c.meta;
        const ready = opts.load.state === 'ready';
        const cards = opts.missions.map((mi) => {
            const rec = SaveStore.get(mi.id);
            const prog = rec.completed ? ui.completed : `${ui.bestProgress}: ${Math.floor(rec.bestProgress * 100)}%`;
            const fast = rec.fastestMs ? `${ui.fastest}: ${SaveStore.formatMs(rec.fastestMs)}` : `${ui.fastest}: ${ui.noClear}`;
            return `<div class="card" data-id="${mi.id}">
                <button class="card-main" id="card-${mi.id}" data-id="${mi.id}" ${ready ? '' : 'disabled'} aria-label="${ui.play} ${E(mi.title)}">
                    <span class="card-title">${E(mi.title.toUpperCase())}</span>
                    <span class="card-sub">${E(mi.subtitle)}</span>
                    <span class="card-ability">SHIFT: ${E(this.c.abilityNames[mi.ability])}</span>
                    <span class="card-rec" id="rec-prog-${mi.id}">${E(prog)}</span>
                    <span class="card-rec" id="rec-fast-${mi.id}">${E(fast)}</span>
                </button>
                <button class="btn small" id="codex-${mi.id}" data-codex="${mi.id}" ${ready && rec.codexUnlocked ? '' : 'disabled'}>${E(rec.codexUnlocked ? ui.codex : ui.codexLocked)}</button>
            </div>`;
        }).join('');
        const load = opts.load;
        const loader = load.state === 'error'
            ? `<div class="loader bad">${E(ui.loadFailed)} ${E(load.error || '')} <button class="btn small" id="b-retry">${E(ui.retry)}</button></div>`
            : `<div class="loader"><span id="load-label">${E(ready ? ui.loaded : ui.loading)} <span id="load-pct">${Math.round(load.progress * 100)}%</span></span>
               <div class="loadbar"><div class="loadfill" id="load-fill" style="width:${Math.round(load.progress * 100)}%"></div></div></div>`;
        this._open(`
            <div class="center menu">
                <div class="tag">${E(m.challenge)}</div>
                <h1>${E(m.title)}</h1>
                <div class="sub">${E(m.subtitle)}</div>
                <div class="notice" role="note">${E(ui.mobileNotice)}</div>
                ${loader}
                <div class="cards">${cards}</div>
                <div class="fact" aria-live="polite"><span class="fact-tag">${E(ui.didYouKnow)}</span> <span id="fact-text"></span>
                    <a id="fact-src" target="_blank" rel="noopener" class="fact-src">${E(ui.source)}</a></div>
                <div class="controls">${E(ui.controls)}</div>
            </div>`, 'amber wide');
        this.panel.querySelectorAll('.card-main').forEach((b) => {
            b.addEventListener('click', () => { if (!b.disabled) opts.onLaunch(b.dataset.id); });
            b.addEventListener('focus', () => this.setFact(b.dataset.id));
            b.addEventListener('mouseenter', () => this.setFact(b.dataset.id));
            b.addEventListener('keydown', (ev) => this._cardNav(ev, b));
        });
        this.panel.querySelectorAll('[data-codex]').forEach((b) => b.addEventListener('click', () => {
            const lvl = opts.levels[b.dataset.codex];
            if (lvl) this.showCodex(lvl, () => this.showMenu(this.menuOpts));
        }));
        this._bind('b-retry', () => opts.onRetry());
        this.setFact(opts.highlight || opts.missions[0].id);
        if (ready) { const c = this.panel.querySelector(`#card-${opts.highlight || opts.missions[0].id}`); if (c) setTimeout(() => c.focus({ preventScroll: true }), 40); }
    }

    _cardNav(ev, b) {
        const all = [...this.panel.querySelectorAll('.card-main')];
        const i = all.indexOf(b);
        const go = (j) => { ev.preventDefault(); all[(j + all.length) % all.length].focus(); };
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') go(i + 1);
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') go(i - 1);
    }

    /** One bundled fact at a time; follows the highlighted rover. */
    setFact(roverId) {
        const pool = GameData.facts.filter((f) => f.rover === roverId);
        const list = pool.length ? pool : GameData.facts;
        this._factIdx = ((this._factIdx || 0) + 1) % list.length;
        const f = list[this._factIdx % list.length];
        const t = this.panel.querySelector('#fact-text');
        const a = this.panel.querySelector('#fact-src');
        if (!t || !a) return;
        t.textContent = f.text;
        a.href = f.source;
        a.title = f.source;
    }

    /** Live loader updates without rebuilding the menu. */
    setLoadProgress(p) {
        if (!this.menuOpts || !this.isModalOpen()) return;
        this.menuOpts.load.progress = p;
        const pct = this.panel.querySelector('#load-pct'), fill = this.panel.querySelector('#load-fill');
        if (pct) pct.textContent = Math.round(p * 100) + '%';
        if (fill) fill.style.width = Math.round(p * 100) + '%';
    }

    // ================================================== checkpoint terminal
    showCheckpoint(cp, onConfirm) {
        const E = UIController.escape, ui = this.c.ui;
        this._open(`
            <div class="term-head"><span>${E(ui.terminalHeader)}</span><span>${E(cp.title)}</span></div>
            <div class="term-body" id="t-body"></div>
            <div class="btn-row"><button class="btn" id="b-ok" disabled>${E(ui.confirm)}</button></div>`);
        const btn = this.panel.querySelector('#b-ok');
        const skip = this._type(this.panel.querySelector('#t-body'), cp.log, () => { btn.disabled = false; btn.focus(); });
        this.panel.querySelector('#t-body').addEventListener('click', skip);
        btn.addEventListener('click', () => { this.close(); onConfirm(); });
    }

    // ======================================================= decryption quiz
    showQuiz(level, { clearMs, fastestMs, onDecrypted, onComplete }) {
        const E = UIController.escape, ui = this.c.ui;
        let qi = 0;
        const render = () => {
            const q = level.quiz[qi];
            this._open(`
                <div class="term-head"><span>${E(ui.quizTitle)}</span><span>KEY ${qi + 1}/${level.quiz.length}</span></div>
                <p class="tag">${E(ui.quizIntro)}</p>
                <h3>${E(q.question)}</h3>
                <div class="quiz-opts">${q.options.map((o, i) => `<button class="quiz-opt" data-id="${o.id}">${String.fromCharCode(65 + i)}) ${E(o.text)}</button>`).join('')}</div>
                <div class="quiz-msg" id="q-msg"></div>`);
            this.panel.querySelectorAll('.quiz-opt').forEach((b) => b.addEventListener('click', () => {
                const msg = this.panel.querySelector('#q-msg');
                if (b.dataset.id === q.correct) {
                    b.classList.add('right');
                    msg.className = 'quiz-msg good';
                    msg.textContent = ui.quizAccepted;
                    this.panel.querySelectorAll('.quiz-opt').forEach((x) => { x.disabled = true; });
                    setTimeout(() => { qi++; if (qi < level.quiz.length) render(); else { onDecrypted(); this._quizSuccess(level, clearMs, fastestMs, onComplete); } }, 700);
                } else {                       // explanation + retry, no level replay
                    b.classList.add('wrong');
                    b.disabled = true;
                    msg.className = 'quiz-msg bad';
                    msg.textContent = `${ui.quizWrong} ${q.explanation}`;
                }
            }));
        };
        render();
    }

    _quizSuccess(level, clearMs, fastestMs, onComplete) {
        const E = UIController.escape, ui = this.c.ui;
        this._open(`
            <div class="term-head"><span>${E(ui.decrypted)}</span><span>${E(ui.missionComplete)}</span></div>
            <div class="term-body" id="t-body"></div>
            <div class="btn-row hidden" id="row">
                <button class="btn amber" id="b-codex">${E(ui.codex)}</button>
                <button class="btn" id="b-menu">${E(ui.menu)}</button>
            </div>`);
        const times = `${ui.clearTime}: ${SaveStore.formatMs(clearMs)}` + (fastestMs ? `   ${ui.fastest}: ${SaveStore.formatMs(fastestMs)}` : '');
        const text = `${level.codex.file}\n${ui.archiveUnlocked}\n\n${times}`;
        const body = this.panel.querySelector('#t-body');
        body.style.whiteSpace = 'pre-wrap';
        const skip = this._type(body, text, () => this.panel.querySelector('#row').classList.remove('hidden'));
        body.addEventListener('click', skip);
        this._bind('b-codex', () => this.showCodex(level, () => { this.close(); onComplete(); }));
        this._bind('b-menu', () => { this.close(); onComplete(); });
    }

    // =============================================================== codex
    showCodex(level, onClose) {
        const E = UIController.escape, ui = this.c.ui, cx = level.codex;
        const notes = [...(cx.notes || []), ...(cx.archiveNotes || [])];
        this._open(`
            <div class="term-head"><span>${E(ui.codex)}</span><span>${E(level.title.toUpperCase())} // ${E(level.subtitle)}</span></div>
            <h2>${E(cx.file)}</h2>
            ${cx.sections.map((s) => `<h3>${E(s.heading)}</h3><p>${E(s.body)}</p>`).join('')}
            <h3>${E(ui.notesHeading)}</h3><ul class="notes">${notes.map((n) => `<li>${E(n)}</li>`).join('')}</ul>
            <h3>${E(ui.sourcesHeading)}</h3><ul class="notes">${cx.sources.map((s) => `<li><a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.label)}</a></li>`).join('')}</ul>
            <div class="btn-row"><button class="btn" id="b-close">${E(ui.close)}</button></div>`);
        this._bind('b-close', () => { this.close(); if (onClose) onClose(); });
    }

    // ============================================================== pause
    showPause({ onResume, onMenu }) {
        const E = UIController.escape, ui = this.c.ui;
        this._pauseCb = { onResume, onMenu };
        this._open(`
            <div class="center">
                <h1>${E(ui.paused)}</h1>
                <div class="btn-row">
                    <button class="btn amber" id="b-resume" data-autofocus>${E(ui.resume)}</button>
                    <button class="btn" id="b-menu">${E(ui.menu)}</button>
                </div>
                <p class="tag">${E(ui.pauseHint)}</p>
            </div>`, 'pause');
        this._bind('b-resume', () => onResume());
        this._bind('b-menu', () => onMenu());
    }

    isPauseOpen() { return this.isModalOpen() && this.panel.classList.contains('pause'); }

    // ============================================================ game over
    showGameOver({ onRetry, onMenu }) {
        const E = UIController.escape, ui = this.c.ui;
        this._open(`
            <div class="center">
                <h1 style="color:var(--bad)">${E(ui.signalLost)}</h1>
                <p>${E(ui.signalLostSub)}</p>
                <div class="btn-row">
                    <button class="btn amber" id="b-retry">${E(ui.retryCheckpoint)}</button>
                    <button class="btn" id="b-menu">${E(ui.menu)}</button>
                </div>
            </div>`, 'bad');
        this._bind('b-retry', () => { this.close(); onRetry(); });
        this._bind('b-menu', () => { this.close(); onMenu(); });
    }
}
