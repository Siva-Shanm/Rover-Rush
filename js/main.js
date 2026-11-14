/**
 * main.js — Phaser configuration & app flow.
 * The DOM mission menu is the first visible screen; it shows loader progress
 * while BootScene loads shared assets, then enables the three rover cards.
 * WebGL is forced with strict pixel-art settings (no anti-aliasing, no
 * sub-pixel rendering).
 */
(function bootstrap() {
    const config = {
        type: Phaser.WEBGL,
        width: 1280,
        height: 720,              // 16:9 2DHD aspect ratio
        pixelArt: true,           // MANDATORY: disables anti-aliasing
        roundPixels: true,        // prevents sub-pixel rendering blur
        parent: 'game-root',
        backgroundColor: '#1a0b10',
        physics: { default: 'arcade', arcade: { gravity: { y: 800 }, debug: false } },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [BootScene, GameScene],
    };

    const app = {
        levels: {},
        load: { state: 'loading', progress: 0, error: '' },
        highlight: GameData.missions[0].id,

        menuOpts() {
            return {
                missions: GameData.missions, levels: this.levels, load: this.load, highlight: this.highlight,
                onLaunch: (id) => this.startMission(id),
                onRetry: () => this.retryLoad(),
            };
        },
        openMenu() {
            SaveStore.load();                       // refresh records whenever the menu opens
            UI.showHUD(false);
            UI.showMenu(this.menuOpts());
        },
        onLoadProgress(p) { this.load.progress = p; UI.setLoadProgress(p); },
        onLoadComplete(levels) {
            this.levels = levels;
            this.load = { state: 'ready', progress: 1, error: '' };
            this.openMenu();
        },
        onLoadError(msg) {
            this.load = { state: 'error', progress: this.load.progress, error: `(${msg})` };
            this.openMenu();
        },
        retryLoad() {
            this.load = { state: 'loading', progress: 0, error: '' };
            this.openMenu();
            window.game.scene.start('BootScene');
        },
        startMission(id) {
            if (this.load.state !== 'ready' || !this.levels[id]) return;
            this.highlight = id;
            UI.close();
            const sm = window.game.scene;
            if (sm.isActive('GameScene') || sm.isPaused('GameScene')) sm.stop('GameScene');
            sm.start('GameScene', { missionId: id });
        },
    };
    window.RoverRush = app;

    const gameScene = () => window.game && window.game.scene.keys.GameScene;
    const togglePause = () => {
        const g = gameScene();
        if (!g || !g.sys.isActive() && !g.sys.isPaused()) return;
        if (UI.isPauseOpen()) g.resumeGame();
        else if (!UI.isModalOpen() && g.state === 'run') g.pauseGame();
    };
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !ev.repeat) { ev.preventDefault(); togglePause(); } });
    document.getElementById('hud-pause').addEventListener('click', (ev) => { ev.currentTarget.blur(); togglePause(); });

    const start = () => {
        window.UI = new UIController(ContentDatabase);
        app.openMenu();                              // menu first, with live loader
        window.game = new Phaser.Game(config);
    };

    const fontReady = document.fonts && document.fonts.load
        ? Promise.race([document.fonts.load('32px "VT323"'), new Promise((r) => setTimeout(r, 2500))])
        : Promise.resolve();
    fontReady.then(start, start);
})();
