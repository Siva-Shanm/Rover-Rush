#!/usr/bin/env python3
"""
Sojourner sprite pipeline
=========================
Builds a game-ready Sojourner spritesheet + clip manifest from the two
user-supplied files (originals are never modified):

  Sojourner_sprite sheet.jpeg  2752x1536, magenta key, 5 labelled single poses
  Sojourner_animations.mp4     700x320 @ 30 fps, magenta key, authored motion clips

Source of truth per gameplay state (PRD section 6):
  * IDLE           -> the clean sheet pose (the video's idle clip is static).
  * RUN, SHORT JUMP, AIRBAG BOUNCE, DAMAGE -> the video, the only source with
    in-between frames; authored order and 30 fps timing are preserved (frames
    are sampled every 2nd frame -> 15 fps, durations recorded per frame).
The video loops twice; the second pass (frames 205-340) is used where the
first pass carries a preview-player overlay (frames 57-77).

Every frame is aligned on the solar panel (top-centre of the blue panel), so
the vertical travel baked into the video is removed (physics moves the rover)
and the foot anchor stays constant. Output:
  assets/sprites/sojourner.png   uniform grid (verified uniform -> spritesheet loader)
  assets/sprites/sojourner.json  frame + clip manifest (source file/index, durations, anchor)

usage: python3 tools/build_sojourner.py      (needs ffmpeg, numpy, pillow, scipy)
"""
import json
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHEET = os.path.join(ROOT, 'Sojourner_sprite sheet.jpeg')
VIDEO = os.path.join(ROOT, 'Sojourner_animations.mp4')
OUT_PNG = os.path.join(ROOT, 'assets', 'sprites', 'sojourner.png')
OUT_JSON = os.path.join(ROOT, 'assets', 'sprites', 'sojourner.json')

FPS = 30
STEP = 2                     # sample every 2nd video frame -> 15 fps clips
TARGET_CHASSIS_H = 67        # ~60% of Spirit's 111 px visible run pose height

# Clip -> inclusive video frame range (1-based), from frame-diff/bbox analysis
# and visual contact sheets (see ROVER_RUSH_UPGRADE_HANDOFF.md, M1).
CLIPS = {
    # anchor: 'track' = per-frame panel top-centre (rover translates in the video);
    #         'x'     = horizontal from the idle frame, vertical tracked (rover only rises);
    #         'fixed' = idle frame anchor (rover stationary; panel tilts/smokes over)
    'run':    {'frames': (288, 330), 'repeat': -1, 'keep_detached': False, 'anchor': 'track'},
    'jump':   {'frames': (131, 153), 'repeat': 0,  'keep_detached': False, 'anchor': 'x'},
    'bounce': {'frames': (155, 209), 'repeat': 0,  'keep_detached': True,  'anchor': 'x'},
    'damage': {'frames': (233, 263), 'repeat': 0,  'keep_detached': True,  'anchor': 'fixed'},
}
# Sheet pose boxes (x0, y0, x1, y1) in the 2752x1536 sheet, labels excluded.
SHEET_POSES = {'idle': (60, 560, 560, 980)}


def key_and_despill(rgb):
    """Magenta key (incl. the darker magenta ground shadow) + magenta despill."""
    a = rgb.astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mn = np.minimum(r, b)
    key = (mn > 90) & (g < 0.45 * mn)
    # despill: pull red/blue down toward green where both exceed it (pink smoke
    # and anti-aliased fringes become neutral instead of magenta-tinted)
    spill = np.clip(mn - g, 0, None)
    out = a.copy()
    out[..., 0] = r - spill * 0.85
    out[..., 2] = b - spill * 0.85
    alpha = ~key
    alpha = ndimage.binary_opening(alpha, iterations=1)
    return np.clip(out, 0, 255).astype(np.uint8), alpha


def panel_anchor(rgb, alpha):
    """Top-centre of the largest blue solar-panel region."""
    a = rgb.astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # deep panel blue only (airbag shading is pale blue-white: high red)
    panel = alpha & (b > 110) & (r < 100) & (b > g + 30)
    lab, n = ndimage.label(panel)
    if n == 0:
        raise RuntimeError('no panel found')
    sizes = ndimage.sum(panel, lab, range(1, n + 1))
    k = 1 + int(np.argmax(sizes))
    ys, xs = np.nonzero(lab == k)
    return (xs.min() + xs.max()) / 2.0, float(ys.min())


def main_component_mask(alpha, keep_detached):
    lab, n = ndimage.label(alpha)
    if n == 0:
        return alpha
    sizes = ndimage.sum(alpha, lab, range(1, n + 1))
    big = 1 + int(np.argmax(sizes))
    body = lab == big
    if keep_detached:
        # keep effects (sparks, smoke, airbags) near the rover, drop far specks
        near = ndimage.binary_dilation(body, iterations=40)
        keep = np.zeros_like(alpha)
        for i in range(1, n + 1):
            comp = lab == i
            if (comp & near).any():
                keep |= comp
        return keep
    # run/jump: rover only, plus anything touching it (drops the dust trail)
    near = ndimage.binary_dilation(body, iterations=3)
    keep = body.copy()
    for i in range(1, n + 1):
        comp = lab == i
        if i != big and (comp & near).any() and sizes[i - 1] > 30:
            keep |= comp
    return keep


def video_frames():
    tmp = tempfile.mkdtemp(prefix='soj_frames_')
    subprocess.run(['ffmpeg', '-v', 'error', '-i', VIDEO, '-vsync', '0',
                    os.path.join(tmp, 'f%03d.png')], check=True)
    return tmp


def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB'))


def main():
    frames_dir = video_frames()
    raw = []  # (state, frame name, rgba, anchor, source)

    # --- IDLE from the clean sheet pose; scale it to video resolution first so
    #     every frame shares one scale reference (video idle == sheet idle size).
    sheet = load_rgb(SHEET)
    x0, y0, x1, y1 = SHEET_POSES['idle']
    crop = sheet[y0:y1, x0:x1]
    rgb, alpha = key_and_despill(crop)
    alpha = main_component_mask(alpha, keep_detached=False)
    # reference: video idle (frame 220) panel width -> sheet scale factor
    vref_rgb, vref_a = key_and_despill(load_rgb(os.path.join(frames_dir, 'f220.png')))
    vref_a = main_component_mask(vref_a, False)

    def body_width(a_):
        # overall rover width (wheels + rocker arms); robust to the sheet's
        # differently foreshortened panel and its antenna
        xs = np.nonzero(a_)[1]
        return xs.max() - xs.min() + 1

    s = body_width(vref_a) / body_width(alpha)
    idle_ref_anchor = panel_anchor(vref_rgb, vref_a)
    im = Image.fromarray(np.dstack([rgb, np.where(alpha, 255, 0).astype(np.uint8)]), 'RGBA')
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    arr = np.asarray(im)
    rgb_i, alpha_i = arr[..., :3], arr[..., 3] > 127
    raw.append(('idle', 'idle_0', rgb_i, alpha_i, panel_anchor(rgb_i, alpha_i),
                {'file': os.path.basename(SHEET), 'rect': [x0, y0, x1 - x0, y1 - y0], 'note': 'sheet IDLE pose'}))

    # --- motion clips from the video
    for state, spec in CLIPS.items():
        a0, a1 = spec['frames']
        for k, fi in enumerate(range(a0, a1 + 1, STEP)):
            rgb, alpha = key_and_despill(load_rgb(os.path.join(frames_dir, f'f{fi:03d}.png')))
            alpha = main_component_mask(alpha, spec['keep_detached'])
            mode = spec['anchor']
            if mode == 'fixed':
                anc = idle_ref_anchor
            elif mode == 'x':
                anc = (idle_ref_anchor[0], panel_anchor(rgb, alpha)[1])
            else:
                anc = panel_anchor(rgb, alpha)
            raw.append((state, f'{state}_{k}', rgb, alpha, anc,
                        {'file': os.path.basename(VIDEO), 'frameIndex': fi, 'timeMs': round((fi - 1) * 1000 / FPS, 1)}))

    # --- scale: idle chassis height (panel top -> wheel bottom) -> TARGET_CHASSIS_H
    _, _, rgb_i, alpha_i, (ax, ay), _ = raw[0]
    ys = np.nonzero(alpha_i)[0]
    idle_h = ys.max() - ay + 1
    scale = TARGET_CHASSIS_H / idle_h

    # --- common cell around the anchor (union of all frame extents)
    ext = [0, 0, 0, 0]  # left, up, right, down (source px from anchor)
    for _, _, rgb, alpha, (ax, ay), _ in raw:
        ys, xs = np.nonzero(alpha)
        ext = [max(ext[0], ax - xs.min()), max(ext[1], ay - ys.min()),
               max(ext[2], xs.max() - ax), max(ext[3], ys.max() - ay)]
    pad = 2
    cell_w = int(np.ceil((ext[0] + ext[2]) * scale)) + 2 * pad
    cell_h = int(np.ceil((ext[1] + ext[3]) * scale)) + 2 * pad
    anchor_cx = int(round(ext[0] * scale)) + pad
    anchor_cy = int(round(ext[1] * scale)) + pad

    cells = []
    for state, name, rgb, alpha, (ax, ay), src in raw:
        rgba = np.dstack([rgb, np.where(alpha, 255, 0).astype(np.uint8)])
        # premultiplied box downscale so transparent colour never bleeds in
        im = Image.fromarray(np.where(alpha[..., None], rgb, 0).astype(np.uint8))
        w2, h2 = max(1, round(rgb.shape[1] * scale)), max(1, round(rgb.shape[0] * scale))
        rgb_s = np.asarray(im.resize((w2, h2), Image.BOX)).astype(float)
        a_s = np.asarray(Image.fromarray(rgba[..., 3]).resize((w2, h2), Image.BOX)).astype(float)
        with np.errstate(all='ignore'):
            rgb_s = np.nan_to_num(rgb_s * 255.0 / a_s[..., None])
        a_s = a_s >= 110
        cell = np.zeros((cell_h, cell_w, 4), np.uint8)
        ox = anchor_cx - int(round(ax * scale))
        oy = anchor_cy - int(round(ay * scale))
        ys, xs = np.nonzero(a_s)
        ty, tx = ys + oy, xs + ox
        ok = (ty >= 0) & (ty < cell_h) & (tx >= 0) & (tx < cell_w)
        cell[ty[ok], tx[ok], :3] = np.clip(rgb_s[ys[ok], xs[ok]], 0, 255).astype(np.uint8)
        cell[ty[ok], tx[ok], 3] = 255
        cells.append((state, name, cell, src))

    # --- one shared palette for every frame (pixel-art consistency)
    opaque = np.concatenate([c[..., :3][c[..., 3] > 0] for _, _, c, _ in cells])
    pal = Image.fromarray(opaque.reshape(1, -1, 3)).quantize(48, method=Image.Quantize.MEDIANCUT,
                                                              dither=Image.Dither.NONE)
    for i, (state, name, cell, src) in enumerate(cells):
        q = np.asarray(Image.fromarray(cell[..., :3]).quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB'))
        cell[..., :3] = np.where(cell[..., 3:] > 0, q, 0)

    # pack into a grid: a single 79-frame row would be ~15500 px wide, beyond the
    # WebGL max texture size on many GPUs (8192). Phaser's spritesheet loader reads
    # uniform grids row-major, so frame indices are unchanged.
    cols = 10
    rows = (len(cells) + cols - 1) // cols
    sheet_out = np.zeros((rows * cell_h, cols * cell_w, 4), np.uint8)
    for i, (_, _, c, _) in enumerate(cells):
        r_, c_ = divmod(i, cols)
        sheet_out[r_ * cell_h:(r_ + 1) * cell_h, c_ * cell_w:(c_ + 1) * cell_w] = c
    Image.fromarray(sheet_out, 'RGBA').save(OUT_PNG, optimize=True)

    # --- foot anchor: wheel bottom of the idle frame, relative to the cell
    run_cells = [c for st, _, c, _ in cells if st == 'run']
    foot_y = int(np.median([np.nonzero(c[..., 3])[0].max() + 1 for c in run_cells]))
    frame_ms = round(1000 * STEP / FPS, 2)
    manifest = {
        'texture': 'sojourner',
        'image': 'assets/sprites/sojourner.png',
        'frameWidth': cell_w, 'frameHeight': cell_h,
        'uniformGrid': True, 'columns': 10,
        'scaleFromVideo': round(scale, 4),
        'anchor': {'panelTop': [anchor_cx, anchor_cy], 'footY': foot_y},
        'frames': [{'index': i, 'name': n, 'state': st, 'source': src} for i, (st, n, _, src) in enumerate(cells)],
        'clips': {},
        'notes': [
            'IDLE uses the clean sheet pose (video idle clip is static).',
            'RUN/JUMP/BOUNCE/DAMAGE are authored video clips sampled every 2nd frame (15 fps).',
            'Video pass 2 (frames 205-340) used; pass 1 frames 57-77 contain a preview-player overlay.',
            'DAMAGE uses the spark+flame part (233-263); the long smoke tail (265-284) is replaced by pooled procedural smoke in game.',
            'Frames are aligned on the solar-panel top-centre so baked-in vertical travel is removed.',
        ],
    }
    def idx(state):
        return [i for i, (st, _, _, _) in enumerate(cells) if st == state]

    # Airborne part holds its last pose until physics lands; the authored landing
    # frames play once on touchdown (PRD 6.3). Split points come from the video:
    # jump lands at video frame 149 (clip frame 9), bounce airbags squash at 203 (24).
    J, B = idx('jump'), idx('bounce')
    clips = {
        'idle':       {'frames': idx('idle'), 'frameDurationMs': 500, 'repeat': -1},
        'run':        {'frames': idx('run'), 'frameDurationMs': frame_ms, 'repeat': -1},
        'jump':       {'frames': J[:9], 'frameDurationMs': frame_ms, 'repeat': 0, 'holdLastFrame': True},
        'jumpLand':   {'frames': J[9:], 'frameDurationMs': frame_ms, 'repeat': 0},
        'bounce':     {'frames': B[:24], 'frameDurationMs': frame_ms, 'repeat': 0, 'holdLastFrame': True},
        'bounceLand': {'frames': B[24:], 'frameDurationMs': frame_ms, 'repeat': 0},
        'damage':     {'frames': idx('damage'), 'frameDurationMs': frame_ms, 'repeat': 0},
    }
    manifest['clips'] = clips
    with open(OUT_JSON, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print(f'sojourner: {len(cells)} frames {cell_w}x{cell_h}, scale {scale:.3f}, foot y {foot_y}, '
          f'idle chassis h {TARGET_CHASSIS_H}')
    for st, c in manifest['clips'].items():
        print(f'  {st:10s} {len(c["frames"]):2d} frames @ {c["frameDurationMs"]} ms repeat={c["repeat"]}')


if __name__ == '__main__':
    main()
