/**
 * BootScene — loads shared assets + every mission's level JSON while the DOM
 * mission menu (already visible) shows truthful loader progress. Registers the
 * shared animations once, then hands control back to the menu.
 * Load failures surface in the same menu with a Retry action.
 */
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }

    preload() {
        this.failed = [];
        this.load.on('progress', (p) => window.RoverRush.onLoadProgress(p));
        this.load.on('loaderror', (file) => this.failed.push(file.key));

        for (const [key, s] of Object.entries(AssetManifest.spritesheets)) {
            if (!this.textures.exists(key)) this.load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
        }
        for (const [key, img] of Object.entries(AssetManifest.images)) {
            if (!this.textures.exists(key)) this.load.image(key, img.url);
        }
        for (const [key, t] of Object.entries(GameData.textures)) {
            if (!this.textures.exists(key)) this.load.spritesheet(key, t.url, { frameWidth: t.frameWidth, frameHeight: t.frameHeight });
        }
        for (const m of GameData.missions) {
            if (!this.cache.json.exists(`level:${m.id}`)) this.load.json(`level:${m.id}`, m.url);
        }
    }

    create() {
        if (this.failed.length) { window.RoverRush.onLoadError(this.failed.join(', ')); return; }
        const a = this.anims;
        const n = (key) => this.textures.get(key).frameTotal - 1;   // minus __BASE
        if (!a.exists('fragment-spin')) a.create({ key: 'fragment-spin', frames: a.generateFrameNumbers('fragment', { start: 0, end: n('fragment') - 1 }), frameRate: 8, repeat: -1, yoyo: true });
        if (!a.exists('devil-spin')) a.create({ key: 'devil-spin', frames: a.generateFrameNumbers('dustdevil', { start: 0, end: n('dustdevil') - 1 }), frameRate: 10, repeat: -1, yoyo: true });
        const levels = {};
        for (const m of GameData.missions) levels[m.id] = this.cache.json.get(`level:${m.id}`);
        window.RoverRush.onLoadComplete(levels);
    }
}
