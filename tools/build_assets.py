#!/usr/bin/env python3
"""
Rover Rush - raster asset pipeline
==================================
Converts the raw art supplied in the repo root into game-ready, transparent,
pixel-perfect PNGs under /assets. Nothing here *draws* art: every output pixel
is sampled from a source raster (spritesheet, stills, or frames of the
hazard/checkpoint animation video).

Sources (repo root):
  Rover_rush Spritesheet.jpeg       -> assets/sprites/rover.png (+ rover.json)
  Hazards&checkpoint_animations.mp4 -> fragment / dust devil / silica / sand trap / gate / ground
  Solar battery.png                 -> assets/sprites/battery.png
  Energy bar.jpeg (webp)            -> assets/ui/energy_bar.png
  Mars.jpg                          -> assets/bg/sky.png, mountains.png, dunes.png

Usage:
  pip install numpy pillow scipy
  python3 tools/build_assets.py            # needs ffmpeg on PATH for video stages
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from asset_lib import (load_rgb, checker_mask, components, pixel_downscale,  # noqa: E402
                       quantize, trim, save, flood_from_border)
from scipy import ndimage  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "assets")
SPR = os.path.join(OUT, "sprites")
BG = os.path.join(OUT, "bg")
UI = os.path.join(OUT, "ui")
for d in (SPR, BG, UI):
    os.makedirs(d, exist_ok=True)


def src(name):
    return os.path.join(ROOT, name)


# ---------------------------------------------------------------------------
# 1. ROVER SPRITESHEET
# ---------------------------------------------------------------------------
ROVER_POSES = {  # (x0, x1, y0, y1) in the 2400x1792 source sheet
    "idle":   (150, 1080, 140, 820),
    "run":    (1330, 2190, 140, 820),
    "jump":   (80, 790, 900, 1540),
    "slide":  (850, 1560, 960, 1700),
    "damage": (1555, 2290, 960, 1710),
}
ROVER_NATIVE = 7.5   # source px per art pixel (measured via autocorrelation)
ROVER_BLOCK = 11     # sample block on the x2 sheet => ~1.36 game px per art pixel
CELL_W, CELL_H = 176, 136


def build_rover():
    rgb = load_rgb(src("Rover_rush Spritesheet.jpeg"))
    h, w = rgb.shape[:2]
    # Checkerboard is a fixed 60px grid: light (194) when (cx+cy) even, else dark (149).
    yy, xx = np.mgrid[0:h, 0:w]
    # Checkerboard is a fixed 60px grid (rows break at y=56,116,...):
    # light (194) when (cx+cy) even, else dark (149).
    expected = np.where(((xx // 60) + ((yy + 4) // 60)) % 2 == 0, 194, 149)
    v = rgb.mean(-1).astype(float)
    lowsat = (rgb.max(-1) - rgb.min(-1)) <= 14
    # (a) everything checker-coloured that is connected to the sheet border
    bg = flood_from_border(checker_mask(rgb, [194, 149, 168], tol=8, sat_tol=14) | checker_mask(rgb, [194, 149], tol=16, sat_tol=16))
    # (b) enclosed checker (between wheels): must match the expected cell grey AND be
    #     locally flat - shaded silver metal (mast, hubs) is never this flat.
    #     (One patch of the sheet uses a third 'mid' checker grey of ~167.)
    mu = ndimage.uniform_filter(v, 9)
    sd = np.sqrt(np.maximum(ndimage.uniform_filter(v * v, 9) - mu * mu, 0))
    cand = ndimage.binary_opening(lowsat & ((np.abs(v - expected) <= 9) | (np.abs(v - 167) <= 5)) & (sd < 3.0), iterations=2)
    lab, n = ndimage.label(cand)
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    bg |= np.isin(lab, 1 + np.nonzero(sizes >= 120)[0])
    # (c) swallow JPEG seam pixels between background squares
    seam = lowsat & (v > 135) & (v < 210)
    for _ in range(4):
        bg |= ndimage.binary_dilation(bg) & seam
    alpha = ~bg
    alpha = ndimage.binary_opening(alpha, iterations=2)

    # Remove the black text labels (IDLE/RUN/...) - small, dark, short components
    lab, comps = components(alpha, 1)
    for sl, i, area in comps:
        hgt = sl[0].stop - sl[0].start
        mean_v = v[sl][lab[sl] == i].mean()
        if area < 1600 and hgt < 45 and mean_v < 90:
            alpha[lab == i] = False

    rgba = np.dstack([rgb.astype(np.uint8), np.where(alpha, 255, 0).astype(np.uint8)])

    # upsample x2 (nearest) so the 7.5px art grid becomes an integer 15px grid
    up = np.asarray(Image.fromarray(rgba, "RGBA").resize((w * 2, h * 2), Image.NEAREST))
    poses = {}
    for name, (x0, x1, y0, y1) in ROVER_POSES.items():
        crop = up[y0 * 2:y1 * 2, x0 * 2:x1 * 2].copy()
        # keep only components belonging to the rover (drop stray specks)
        a = crop[..., 3] > 0
        lab, comps = components(a, 1)
        keep = np.zeros_like(a)
        big = max(comps, key=lambda c: c[2])[1]
        cv = crop[..., :3].astype(int)
        greyish = ((cv.max(-1) - cv.min(-1)) <= 18) & (cv.mean(-1) > 135) & (cv.mean(-1) < 210)
        for sl, i, area in comps:
            m = lab == i
            if i != big and greyish[m].mean() > 0.6:
                continue                  # stray checker square
            if i == big or area > 2500:   # rover body + dust/spark clusters
                keep |= m
        crop[..., 3] = np.where(keep, 255, 0)
        small = pixel_downscale(crop, ROVER_BLOCK)
        poses[name] = trim(small)

    # Shared palette so every frame matches
    allpx = np.concatenate([p.reshape(-1, 4) for p in poses.values()])
    allpx = allpx[allpx[:, 3] > 0][:, :3]
    pal_img = Image.fromarray(allpx.reshape(1, -1, 3).astype(np.uint8)).quantize(
        40, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

    def palettize(p):
        im = Image.fromarray(p[..., :3].astype(np.uint8)).quantize(
            palette=pal_img, dither=Image.Dither.NONE).convert("RGB")
        return np.dstack([np.asarray(im), p[..., 3]])

    poses = {k: palettize(p) for k, p in poses.items()}

    def place(p, dy=0, flash=False):
        cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
        ph, pw = p.shape[:2]
        ph, pw = min(ph, CELL_H - 2), min(pw, CELL_W)
        p = p[-ph:, :pw]
        ox = (CELL_W - pw) // 2
        oy = max(0, CELL_H - ph - 2 + dy)  # bottom-anchored (wheels on the floor)
        cell[oy:oy + ph, ox:ox + pw] = p
        if flash:  # damage flicker frame: same pixels pushed toward white
            m = cell[..., 3] > 0
            cell[..., :3][m] = (cell[..., :3][m].astype(int) * 0.4 + 255 * 0.6).astype(np.uint8)
        return cell

    # Animation frames (one source pose per state; run/idle get a 1px suspension bob)
    frames = [
        ("idle_0", place(poses["idle"])),
        ("idle_1", place(poses["idle"], dy=-1)),
        ("run_0", place(poses["run"])),
        ("run_1", place(poses["run"], dy=-1)),
        ("run_2", place(poses["run"], dy=-2)),
        ("run_3", place(poses["run"], dy=-1)),
        ("jump_0", place(poses["jump"])),
        ("slide_0", place(poses["slide"])),
        ("damage_0", place(poses["damage"])),
        ("damage_1", place(poses["damage"], flash=True)),
    ]
    sheet = np.concatenate([f for _, f in frames], axis=1)
    save(sheet, os.path.join(SPR, "rover.png"))
    meta = {"frameWidth": CELL_W, "frameHeight": CELL_H,
            "frames": [n for n, _ in frames],
            "poseSizes": {k: [int(p.shape[1]), int(p.shape[0])] for k, p in poses.items()}}
    with open(os.path.join(SPR, "rover.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("rover:", meta["poseSizes"])


# ---------------------------------------------------------------------------
# 2. HAZARD / CHECKPOINT ANIMATION VIDEO
# ---------------------------------------------------------------------------
_FRAMES = None


def video_frame(i):
    """1-based frame index of Hazards&checkpoint_animations.mp4 as float32 RGB."""
    global _FRAMES
    if _FRAMES is None:
        _FRAMES = tempfile.mkdtemp(prefix="rr_frames_")
        subprocess.run(["ffmpeg", "-v", "error", "-i", src("Hazards&checkpoint_animations.mp4"),
                        "-vsync", "0", os.path.join(_FRAMES, "f%03d.png")], check=True)
    return np.asarray(Image.open(os.path.join(_FRAMES, "f%03d.png" % i)).convert("RGB")).astype(np.float32)


def shifted(f, dx):
    """g[:, x] = f[:, x + dx] (camera pan compensation); NaN where undefined."""
    g = np.full_like(f, np.nan)
    w = f.shape[1]
    x0, x1 = max(0, -dx), min(w, w - dx)
    g[:, x0:x1] = f[:, x0 + dx:x1 + dx]
    return g


def grabcut(rgb, rect, fg_seed=None, bg_seed=None, iters=6):
    import cv2
    y0, y1, x0, x1 = rect
    mask = np.full(rgb.shape[:2], cv2.GC_BGD, np.uint8)
    mask[y0:y1, x0:x1] = cv2.GC_PR_BGD
    roi = np.zeros(rgb.shape[:2], bool)
    roi[y0:y1, x0:x1] = True
    if fg_seed is not None:
        mask[roi & fg_seed] = cv2.GC_FGD
    if bg_seed is not None:
        mask[roi & bg_seed] = cv2.GC_BGD
    # anything not seeded inside the rect starts as "probably foreground"
    mask[roi & (mask == cv2.GC_PR_BGD)] = cv2.GC_PR_FGD
    if bg_seed is not None:
        mask[roi & bg_seed] = cv2.GC_BGD
    bgm = np.zeros((1, 65), np.float64)
    fgm = np.zeros((1, 65), np.float64)
    img = np.clip(rgb, 0, 255).astype(np.uint8)[..., ::-1].copy()
    cv2.grabCut(img, mask, None, bgm, fgm, iters, cv2.GC_INIT_WITH_MASK)
    return np.isin(mask, [cv2.GC_FGD, cv2.GC_PR_FGD])


def keep_main(alpha, min_frac=0.02):
    """Drop specks: keep components >= min_frac of the largest one."""
    lab, n = ndimage.label(alpha)
    if n == 0:
        return alpha
    sizes = ndimage.sum(alpha, lab, range(1, n + 1))
    return np.isin(lab, 1 + np.nonzero(sizes >= sizes.max() * min_frac)[0])


def to_sprite(rgb, alpha, target_h, colors=32, box=None):
    """Crop to alpha, box-downscale to target height, re-harden into pixel art."""
    rgba = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), np.where(alpha, 255, 0).astype(np.uint8)])
    rgba = trim(rgba) if box is None else rgba[box[0]:box[1], box[2]:box[3]]
    h, w = rgba.shape[:2]
    tw = max(1, round(w * target_h / h))
    im = Image.fromarray(rgba, "RGBA")
    # premultiply so transparent background colour does not bleed into edges
    rgb_s = np.asarray(Image.fromarray(np.where(rgba[..., 3:] > 0, rgba[..., :3], 0).astype(np.uint8))
                       .resize((tw, target_h), Image.BOX)).astype(float)
    a_s = np.asarray(im.getchannel("A").resize((tw, target_h), Image.BOX)).astype(float)
    with np.errstate(all="ignore"):
        rgb_s = np.nan_to_num(rgb_s * 255.0 / a_s[..., None])
    out = np.dstack([np.clip(rgb_s, 0, 255), np.where(a_s >= 128, 255, 0)]).astype(np.uint8)
    return quantize(out, colors)


def strip(frames):
    """Horizontally pack equal-height frames into a bottom-aligned strip."""
    h = max(f.shape[0] for f in frames)
    w = max(f.shape[1] for f in frames)
    cells = []
    for f in frames:
        c = np.zeros((h, w, 4), np.uint8)
        oy, ox = h - f.shape[0], (w - f.shape[1]) // 2
        c[oy:, ox:ox + f.shape[1]] = f
        cells.append(c)
    return np.concatenate(cells, axis=1), w, h


def write_sheet(name, frames):
    sheet, w, h = strip(frames)
    save(sheet, os.path.join(SPR, name + ".png"))
    print(f"{name}: {len(frames)} frames @ {w}x{h}")
    return {"frameWidth": int(w), "frameHeight": int(h), "frames": len(frames)}


def build_video():
    meta = {}

    # -- Memory fragment: cyan data crystal rotating (frames 1-20) ----------
    frags = []
    for i in (1, 4, 7, 10, 13, 16):
        f = video_frame(i)
        r, g, b = f[..., 0], f[..., 1], f[..., 2]
        a = (b > r + 8) & (g > r)            # cyan core + glow; Mars backdrop is always R-dominant
        a[:, :300] = False
        a[:, 700:] = False
        a[560:] = False
        a = keep_main(ndimage.binary_closing(a, iterations=2), 0.2)
        frags.append(to_sprite(f, a, 44, colors=24))
    meta["fragment"] = write_sheet("fragment", frags)

    # -- Dust devil (frames 33-41): pan-compensated clean plate + GrabCut ----
    T = 37
    plate = np.nanmedian(np.stack([shifted(video_frame(j), dx) for j, dx in
                                   [(68, -315), (72, -356), (76, -397), (80, -438)]]), axis=0)
    devils = []
    for j, dxj in [(35, 19), (37, 0), (39, -20), (41, -40)]:
        f = video_frame(j)
        p = shifted(np.nan_to_num(plate, nan=-999), -dxj) if dxj else np.nan_to_num(plate, nan=-999)
        p = np.nan_to_num(p, nan=-999)
        valid = (p >= 0).all(-1)
        crystal = (p.max(-1) - p.min(-1) < 90) & (p.mean(-1) > 60)   # silica in the plate
        crystal = ndimage.binary_dilation(ndimage.binary_opening(crystal, iterations=2), iterations=10)
        d = np.abs(f - p).mean(-1)
        ok = valid & ~crystal
        x0, x1 = 330 + dxj, 1160 + dxj     # frame-j x = frame-37 x + dx
        fg = grabcut(f, (10, 560, max(0, x0), min(1344, x1)), fg_seed=ok & (d > 45), bg_seed=ok & (d < 14))
        fg = ndimage.binary_closing(fg, structure=np.ones((3, 9)))
        fg = keep_main(fg, 0.01)
        devils.append(to_sprite(f, fg, 128, colors=24))
    meta["dustdevil"] = write_sheet("dustdevil", devils)

    # -- Silica crystal cluster (frame 67) -----------------------------------
    f = video_frame(67)
    sat = f.max(-1) - f.min(-1)
    fg = grabcut(f, (40, 600, 100, 860), fg_seed=(sat < 45) & (f.mean(-1) > 120), bg_seed=sat > 110)
    fg = keep_main(fg, 0.05)
    meta["silica"] = write_sheet("silica", [to_sprite(f, fg, 64, colors=20)])

    # -- Checkpoint gate (frame 127: full arch w/ solar panel & screen) ------
    f = video_frame(127)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    sat = f.max(-1) - f.min(-1)
    metal = (sat < 60) | (b > r) | (g > r)
    fg = grabcut(f, (150, 590, 610, 1200), fg_seed=metal & (f.mean(-1) > 40), bg_seed=sat > 120)
    fg = keep_main(fg, 0.05)
    meta["gate"] = write_sheet("gate", [to_sprite(f, fg, 176, colors=32)])

    # -- Sand trap (frame 88): soft sand mound sunk into a ground gap --------
    f = video_frame(88)
    y0, y1, x0, x1 = 370, 768, 215, 1050
    fg_seed = np.zeros(f.shape[:2], bool)
    fg_seed[560:740, 270:1020] = True       # inside the trap pit: always sand
    bg_seed = np.zeros_like(fg_seed)
    bg_seed[y0:y0 + 15] = True
    fg = grabcut(f, (y0, y1, x0, x1), fg_seed=fg_seed, bg_seed=bg_seed)
    fg = keep_main(ndimage.binary_fill_holes(fg), 0.2)
    meta["sandtrap"] = write_sheet("sandtrap", [to_sprite(f, fg, 84, colors=24)])

    # -- Ground strip (frame 121: continuous cobbled regolith band) ----------
    f = video_frame(121)
    band = f[568:768, 20:1320]
    a = np.ones(band.shape[:2], bool)
    g = to_sprite(band, a, 60, colors=24)
    g = np.concatenate([g, g[:, ::-1]], axis=1)   # mirror-tile => seamless horizontal repeat
    save(g, os.path.join(SPR, "ground.png"))
    print("ground:", g.shape[1], "x", g.shape[0])

    with open(os.path.join(SPR, "video_sprites.json"), "w") as fh:
        json.dump(meta, fh, indent=2)


# ---------------------------------------------------------------------------
# 3. STILLS: battery pickup, energy-bar HUD, parallax layers
# ---------------------------------------------------------------------------
def build_stills():
    import cv2

    # -- Solar battery pickup (PNG with real alpha) --------------------------
    b = np.asarray(Image.open(src("Solar battery.png")).convert("RGBA"))
    a = keep_main(b[..., 3] > 128, 0.2)
    save(to_sprite(b[..., :3].astype(float), a, 36, colors=20), os.path.join(SPR, "battery.png"))

    # -- Energy bar (webp w/ baked white/grey checker) -> full + empty states
    e = load_rgb(src("Energy bar.jpeg"))
    bg = flood_from_border(checker_mask(e, [255, 231], tol=14, sat_tol=12))
    a = ~bg
    a[440:, :] = False                       # drop the "CHARGE" caption, keep the battery
    a = keep_main(ndimage.binary_opening(a, iterations=1), 0.3)
    full = to_sprite(e.astype(float), a, 64, colors=32)
    save(full, os.path.join(UI, "energy_full.png"))
    empty = full.copy()
    lum = full[..., :3].astype(float).mean(-1, keepdims=True)
    empty[..., :3] = np.clip(lum * np.array([0.30, 0.26, 0.32]), 0, 255).astype(np.uint8)
    save(empty, os.path.join(UI, "energy_empty.png"))
    print("energy bar:", full.shape[1], "x", full.shape[0])

    # -- Parallax layers from Mars.jpg ---------------------------------------
    m = load_rgb(src("Mars.jpg")).astype(np.float32)[:, 40:]   # crop stock id strip on left edge
    H, W = m.shape[:2]
    # mountain silhouette: the ridges are bluish/desaturated (B>66, S<160) whereas
    # the sky and the large planet are strongly saturated orange/red.
    sat = m.max(-1) - m.min(-1)
    ridge = (m[..., 2] > 66) & (sat < 160) & (m.mean(-1) < 200)
    ridge[:370] = False
    ridge = keep_main(ndimage.binary_opening(ridge, iterations=2), 0.01)
    # everything below a column's first ridge pixel is mountain/plain
    mtn = np.maximum.accumulate(ridge, axis=0)
    mtn[520:] = True
    # sky: inpaint the mountains away so parallax never reveals a duplicate ridge
    hole = ndimage.binary_dilation(mtn, iterations=6).astype(np.uint8) * 255
    sky = cv2.inpaint(np.clip(m, 0, 255).astype(np.uint8)[..., ::-1].copy(), hole, 9,
                      cv2.INPAINT_TELEA)[..., ::-1].astype(np.float32)

    def layer(rgb, alpha, y0, y1, name, colors):
        h = round((y1 - y0) / 3.125)           # 1/3.125 => drawn at x4 in-game
        w = round(W / 3.125)
        crop = rgb[y0:y1]
        al = alpha[y0:y1]
        lay = to_sprite(crop, al, h, colors=colors, box=(0, y1 - y0, 0, W))
        lay = np.concatenate([lay, lay[:, ::-1]], axis=1)      # mirror-tile => seamless
        save(lay, os.path.join(BG, name + ".png"))
        print(name, lay.shape[1], "x", lay.shape[0], "(drawn x4)")

    layer(sky, np.ones((H, W), bool), 0, 560, "sky", 48)
    layer(m, mtn, 330, 560, "mountains", 40)
    layer(m, np.ones((H, W), bool), 515, H, "dunes", 40)


# ---------------------------------------------------------------------------
# 4. FALLBACK PIXEL-GRID SPRITES (no source raster exists for these)
#    Built strictly from discrete 4x4 blocks - no curves/vectors.
# ---------------------------------------------------------------------------
HEART = [
    "..RR..RR..",
    ".RWRRRRRR.",
    "RWWRRRRRRD",
    "RRRRRRRRRD",
    ".RRRRRRRD.",
    "..RRRRRD..",
    "...RRRD...",
    "....RD....",
]
PAL = {"R": (226, 62, 52), "W": (255, 196, 170), "D": (140, 28, 30), "K": (40, 20, 24)}


def blocks(rows, pal, block=4):
    h, w = len(rows), len(rows[0])
    out = np.zeros((h * block, w * block, 4), np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in pal:
                out[y * block:(y + 1) * block, x * block:(x + 1) * block] = (*pal[ch], 255)
    return out


def build_fallback():
    heart = blocks(HEART, PAL)
    empty = blocks(HEART, {k: (60, 34, 40) if k != "W" else (90, 60, 66) for k in PAL})
    save(heart, os.path.join(UI, "heart.png"))
    save(empty, os.path.join(UI, "heart_empty.png"))
    save(blocks(["W"], {"W": (255, 255, 255)}), os.path.join(SPR, "px4.png"))   # particle
    print("fallback: heart, heart_empty, px4")


# ---------------------------------------------------------------------------
# 5. MANIFEST -> js/AssetManifest.js (frame sizes are never hand-copied)
# ---------------------------------------------------------------------------
def build_manifest():
    with open(os.path.join(SPR, "rover.json")) as fh:
        rover = json.load(fh)
    with open(os.path.join(SPR, "video_sprites.json")) as fh:
        vid = json.load(fh)

    def size(rel):
        w, h = Image.open(os.path.join(OUT, rel)).size
        return w, h

    sheets = {"rover": {"url": "assets/sprites/rover.png", "frameWidth": rover["frameWidth"],
                        "frameHeight": rover["frameHeight"]}}
    for k in ("fragment", "dustdevil", "silica", "gate", "sandtrap"):
        sheets[k] = {"url": f"assets/sprites/{k}.png", "frameWidth": vid[k]["frameWidth"],
                     "frameHeight": vid[k]["frameHeight"]}
    images = {}
    for key, rel in [("ground", "sprites/ground.png"), ("battery", "sprites/battery.png"),
                     ("px4", "sprites/px4.png"), ("sky", "bg/sky.png"),
                     ("mountains", "bg/mountains.png"), ("dunes", "bg/dunes.png")]:
        w, h = size(rel)
        images[key] = {"url": "assets/" + rel, "width": w, "height": h}
    manifest = {"spritesheets": sheets, "images": images,
                "roverFrames": rover["frames"], "roverPoseSizes": rover["poseSizes"]}
    js = ("/* AUTO-GENERATED by tools/build_assets.py - do not edit by hand. */\n"
          "const AssetManifest = Object.freeze(" + json.dumps(manifest, indent=2) + ");\n")
    with open(os.path.join(ROOT, "js", "AssetManifest.js"), "w") as fh:
        fh.write(js)
    print("manifest: js/AssetManifest.js")


if __name__ == "__main__":
    stages = sys.argv[1:] or ["rover", "video", "stills", "fallback", "manifest"]
    for s in stages:
        globals()["build_" + s]()
