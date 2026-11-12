/**
 * BootScene - preloads every raster asset listed in the generated AssetManifest
 * and registers all sprite animations. Shows a pixel loading bar.
 */
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }

    preload() {
        const { width, height } = this.scale;
        const label = this.add.text(width / 2, height / 2 - 40, 'ESTABLISHING UPLINK...', {
            fontFamily: 'VT323', fontSize: '40px', color: '#3ff6ff',
        }).setOrigin(0.5);
        // Loading bar built from discrete 8px blocks (no smooth shapes)
        const blocks = [];
        const n = 40, bw = 12, gap = 4, x0 = width / 2 - (n * (bw + gap)) / 2;
        for (let i = 0; i < n; i++) {
            blocks.push(this.add.rectangle(x0 + i * (bw + gap), height / 2 + 10, bw, 20, 0x1d3a40).setOrigin(0, 0.5));
        }
        this.load.on('progress', (p) => {
            const lit = Math.round(p * n);
            blocks.forEach((b, i) => b.setFillStyle(i < lit ? 0x3ff6ff : 0x1d3a40));
        });
        this.load.on('complete', () => label.setText('UPLINK ESTABLISHED'));

        for (const [key, s] of Object.entries(AssetManifest.spritesheets)) {
            this.load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
        }
        for (const [key, img] of Object.entries(AssetManifest.images)) {
            this.load.image(key, img.url);
        }
    }

    create() {
        const a = this.anims;
        const R = (name) => AssetManifest.roverFrames.indexOf(name);
        a.create({ key: 'rover-idle', frames: a.generateFrameNumbers('rover', { frames: [R('idle_0'), R('idle_1')] }), frameRate: 2, repeat: -1 });
        a.create({ key: 'rover-run', frames: a.generateFrameNumbers('rover', { frames: [R('run_0'), R('run_1'), R('run_2'), R('run_3')] }), frameRate: 12, repeat: -1 });
        a.create({ key: 'rover-jump', frames: a.generateFrameNumbers('rover', { frames: [R('jump_0')] }), frameRate: 1, repeat: -1 });
        a.create({ key: 'rover-slide', frames: a.generateFrameNumbers('rover', { frames: [R('slide_0')] }), frameRate: 1, repeat: -1 });
        a.create({ key: 'rover-damage', frames: a.generateFrameNumbers('rover', { frames: [R('damage_0'), R('damage_1')] }), frameRate: 14, repeat: -1 });

        const n = (key) => this.textures.get(key).frameTotal - 1; // minus __BASE
        a.create({ key: 'fragment-spin', frames: a.generateFrameNumbers('fragment', { start: 0, end: n('fragment') - 1 }), frameRate: 8, repeat: -1, yoyo: true });
        a.create({ key: 'devil-spin', frames: a.generateFrameNumbers('dustdevil', { start: 0, end: n('dustdevil') - 1 }), frameRate: 10, repeat: -1, yoyo: true });

        this.scene.start('GameScene');
    }
}
