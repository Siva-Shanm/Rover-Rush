/**
 * main.js - Phaser configuration & bootstrap.
 * WebGL is forced with strict pixel-art settings (no anti-aliasing, no
 * sub-pixel rendering). The game waits for the VT323 web font so that any
 * canvas text renders in the correct face on the first frame.
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

    const start = () => {
        window.UI = new UIController(ContentDatabase);
        window.game = new Phaser.Game(config);
    };

    const fontReady = document.fonts && document.fonts.load
        ? Promise.race([document.fonts.load('32px "VT323"'), new Promise((r) => setTimeout(r, 2500))])
        : Promise.resolve();
    fontReady.then(start, start);
})();
