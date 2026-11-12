/**
 * UIController
 * ---------------------------------------------------------------------------
 * Owns every HTML/DOM element layered above the Phaser canvas (#ui-layer,
 * z-index 10): HUD, slow-mo tutorial prompts, memory-fragment pop-ups,
 * checkpoint terminals, the decryption quiz, the Codex and menus.
 * All copy is read from ContentDatabase - nothing narrative is hard-coded here.
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

    // --------------------------------------------------------------- layout
    _onResize() {
        const w = this.stage.getBoundingClientRect().width || 1280;
        document.documentElement.style.setProperty('--u', (w / 1280) + 'px');
    }

    static escape(s) {
        return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // ------------------------------------------------------------------ HUD
    showHUD(on = true) { this.$('hud').classList.toggle('hidden', !on); }

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

    updateHUD({ hp, maxHp, energy, progress, fragments, totalFragments, status }) {
        const hearts = this.$('hud-hearts');
        if (hearts.children.length !== maxHp) this._buildHearts(maxHp);
        [...hearts.children].forEach((img, i) => {
            const full = i < hp;
            const src = full ? 'assets/ui/heart.png' : 'assets/ui/heart_empty.png';
            if (!img.src.endsWith(src)) img.src = src;
            img.classList.toggle('lost', !full);
        });
        if (this._lastHp !== null && hp < this._lastHp) {
            hearts.classList.remove('hit');
            void hearts.offsetWidth; // restart CSS animation
            hearts.classList.add('hit');
        }
        this._lastHp = hp;

        // Energy: the raster bar's fill spans ~6%..90% of the image width;
        // clip the "full" layer from the right to reveal the dark "empty" layer.
        const e = Math.max(0, Math.min(1, energy / 100));
        const right = 10 + (1 - e) * 84;
        this.$('energy-full').style.clipPath = `inset(0 ${right.toFixed(1)}% 0 0)`;
        this.$('energy-label').textContent = Math.round(e * 100) + '%';
        this.$('energy-label').parentElement.classList.toggle('low', e < 0.2);

        const p = Math.max(0, Math.min(1, progress));
        this.$('progress-fill').style.width = (p * 100).toFixed(2) + '%';
        this.$('progress-rover').style.left = (p * 100).toFixed(2) + '%';
        this.$('progress-label').textContent = Math.floor(p * 100) + '%  // ' + this.c.meta.missionTag.split('//')[1].trim();
        this.$('hud-fragments').textContent = `DATA ${fragments}/${totalFragments}`;
        this.$('hud-status').textContent = status || '';
    }

    // ------------------------------------------------------------ tutorials
    showTutorial(tut) {
        this.$('tutorial-text').textContent = tut.text;
        const key = this.$('tutorial-key');
        key.textContent = tut.key;
        key.classList.remove('ok');
        this.$('tutorial').classList.remove('hidden');
    }

    markTutorialDone() { this.$('tutorial-key').classList.add('ok'); }

    hideTutorial() { this.$('tutorial').classList.add('hidden'); }

    // ------------------------------------------------------------ fragments
    showFragment(index, total) {
        this.$('fragment-header').textContent = `${this.c.ui.fragmentHeader}  [${String(index).padStart(2, '0')}/${String(total).padStart(2, '0')}]`;
        this.$('fragment-text').textContent = this.c.fragments[index];
        this.$('fragment').classList.remove('hidden');
    }

    hideFragment() { this.$('fragment').classList.add('hidden'); }

    // --------------------------------------------------------------- modals
    _open(html, cls = '') {
        this.panel.className = 'panel ' + cls;
        this.panel.innerHTML = html;
        this.modal.classList.remove('hidden');
        const first = this.panel.querySelector('button:not([disabled])');
        this.panel.scrollTop = 0;
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    }

    close() {
        clearInterval(this._typeTimer);
        this.modal.classList.add('hidden');
        this.panel.innerHTML = '';
    }

    isModalOpen() { return !this.modal.classList.contains('hidden'); }

    _bind(id, fn) {
        const el = this.panel.querySelector('#' + id);
        if (el) el.addEventListener('click', fn);
    }

    /** Typewriter effect for terminal text. Click / key skips to the end. */
    _type(el, text, onDone, cps = 55) {
        clearInterval(this._typeTimer);
        let i = 0;
        el.classList.add('cursor');
        const finish = () => {
            clearInterval(this._typeTimer);
            el.textContent = text;
            el.classList.remove('cursor');
            if (onDone) onDone();
        };
        this._typeTimer = setInterval(() => {
            i += 2;
            el.textContent = text.slice(0, i);
            if (i >= text.length) finish();
        }, 1000 / cps * 2);
        return finish;
    }

    // ----------------------------------------------------------- main menu
    showMenu({ onStart, codexUnlocked }) {
        const m = this.c.meta, ui = this.c.ui;
        this._open(`
            <div class="center">
                <div class="tag">${UIController.escape(m.challenge)}</div>
                <h1>${UIController.escape(m.title)}</h1>
                <div class="sub">${UIController.escape(m.subtitle)}</div>
                <p class="tag" style="margin-top:calc(var(--u)*14)">${UIController.escape(m.missionTag)}</p>
                <div class="btn-row">
                    <button class="btn amber" id="b-start">${UIController.escape(ui.start)}</button>
                    <button class="btn" id="b-codex" ${codexUnlocked ? '' : 'disabled'}>${UIController.escape(codexUnlocked ? ui.codex : ui.codexLocked)}</button>
                </div>
                <div class="controls">${UIController.escape(ui.controls)}</div>
            </div>`, 'amber');
        this._bind('b-start', () => { this.close(); onStart(); });
        this._bind('b-codex', () => this.showCodex(() => this.showMenu({ onStart, codexUnlocked })));
    }

    // ------------------------------------------------- checkpoint terminal
    showCheckpoint(n, onConfirm) {
        const cp = this.c.checkpoints[n], ui = this.c.ui;
        this._open(`
            <div class="term-head"><span>${UIController.escape(ui.terminalHeader)}</span><span>${UIController.escape(cp.title)}</span></div>
            <div class="term-body" id="t-body"></div>
            <div class="btn-row"><button class="btn" id="b-ok" disabled>${UIController.escape(ui.confirm)}</button></div>`);
        const btn = this.panel.querySelector('#b-ok');
        const skip = this._type(this.panel.querySelector('#t-body'), cp.log, () => {
            btn.disabled = false;
            btn.focus();
        });
        this.panel.querySelector('#t-body').addEventListener('click', skip);
        btn.addEventListener('click', () => { this.close(); onConfirm(); });
    }

    // ------------------------------------------------------ decryption quiz
    showQuiz({ onComplete, onDecrypted }) {
        const qz = this.c.quiz;
        let qi = 0;
        const render = () => {
            const q = qz.questions[qi];
            this._open(`
                <div class="term-head"><span>${UIController.escape(qz.title)}</span><span>KEY ${qi + 1}/${qz.questions.length}</span></div>
                <p class="tag">${UIController.escape(qz.intro)}</p>
                <h3>${UIController.escape(q.q)}</h3>
                <div class="quiz-opts">
                    ${q.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${String.fromCharCode(65 + i)}) ${UIController.escape(o)}</button>`).join('')}
                </div>
                <div class="quiz-msg" id="q-msg"></div>`);
            this.panel.querySelectorAll('.quiz-opt').forEach((b) => b.addEventListener('click', () => {
                const pick = Number(b.dataset.i);
                const msg = this.panel.querySelector('#q-msg');
                if (pick === q.correct) {
                    b.classList.add('right');
                    msg.className = 'quiz-msg good';
                    msg.textContent = '> KEY ACCEPTED';
                    this.panel.querySelectorAll('.quiz-opt').forEach((x) => { x.disabled = true; });
                    setTimeout(() => {
                        qi++;
                        if (qi < qz.questions.length) render();
                        else { if (onDecrypted) onDecrypted(); this._quizSuccess(onComplete); }
                    }, 700);
                } else {
                    b.classList.add('wrong');
                    b.disabled = true;
                    msg.className = 'quiz-msg bad';
                    msg.textContent = qz.wrong;
                }
            }));
        };
        render();
    }

    _quizSuccess(onComplete) {
        const ui = this.c.ui, qz = this.c.quiz;
        this._open(`
            <div class="term-head"><span>${UIController.escape(ui.incoming)}</span><span>${UIController.escape(ui.missionComplete)}</span></div>
            <div class="term-body" id="t-body"></div>
            <div class="btn-row hidden" id="row">
                <button class="btn amber" id="b-codex">${UIController.escape(ui.codex)}</button>
                <button class="btn" id="b-menu">${UIController.escape(ui.menu)}</button>
            </div>`);
        const text = `${qz.success}\n\n> ${this.c.fragments[10]}`;
        const body = this.panel.querySelector('#t-body');
        body.style.whiteSpace = 'pre-wrap';
        const skip = this._type(body, text, () => this.panel.querySelector('#row').classList.remove('hidden'));
        body.addEventListener('click', skip);
        this._bind('b-codex', () => this.showCodex(() => onComplete()));
        this._bind('b-menu', () => { this.close(); onComplete(); });
    }

    // ---------------------------------------------------------------- codex
    showCodex(onClose) {
        const cx = this.c.codex, ui = this.c.ui;
        this._open(`
            <div class="term-head"><span>CODEX</span><span>NASA / JPL MER-A</span></div>
            <h2>${UIController.escape(cx.file)}</h2>
            ${cx.sections.map((s) => `<h3>${UIController.escape(s.heading)}</h3><p>${UIController.escape(s.body)}</p>`).join('')}
            <div class="btn-row"><button class="btn" id="b-close">${UIController.escape(ui.close)}</button></div>`);
        this._bind('b-close', () => { this.close(); if (onClose) onClose(); });
    }

    // ------------------------------------------------------------ game over
    showGameOver({ onRetry, onMenu }) {
        const ui = this.c.ui;
        this._open(`
            <div class="center">
                <h1 style="color:var(--bad)">${UIController.escape(ui.signalLost)}</h1>
                <p>${UIController.escape(ui.signalLostSub)}</p>
                <div class="btn-row">
                    <button class="btn amber" id="b-retry">${UIController.escape(ui.retry)}</button>
                    <button class="btn" id="b-menu">${UIController.escape(ui.menu)}</button>
                </div>
            </div>`, 'bad');
        this._bind('b-retry', () => { this.close(); onRetry(); });
        this._bind('b-menu', () => { this.close(); onMenu(); });
    }
}
