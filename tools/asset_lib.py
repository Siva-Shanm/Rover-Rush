"""Shared helpers for the Rover Rush raster asset pipeline (no procedural art)."""
import numpy as np
from PIL import Image
from collections import deque
from scipy import ndimage


def load_rgb(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int16)


def flood_from_border(candidate):
    """Mask of `candidate` pixels 4-connected to the image border."""
    lab, _ = ndimage.label(candidate)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(border))


def checker_mask(rgb, greys, tol=14, sat_tol=14):
    """Pixels that look like a baked-in transparency checkerboard."""
    mx, mn = rgb.max(-1), rgb.min(-1)
    low_sat = (mx - mn) <= sat_tol
    v = rgb.mean(-1)
    near = np.zeros(v.shape, bool)
    for g in greys:
        near |= np.abs(v - g) <= tol
    return low_sat & near


def components(alpha, min_area):
    lab, n = ndimage.label(alpha)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        area = (lab[sl] == i).sum()
        if area >= min_area:
            out.append((sl, i, area))
    return lab, out


def pixel_downscale(rgba, factor):
    """Downscale an RGBA array by an integer factor using the per-block median
    (keeps hard pixel-art edges instead of blending like bilinear/lanczos)."""
    h, w = rgba.shape[:2]
    h2, w2 = h // factor, w // factor
    a = rgba[: h2 * factor, : w2 * factor].reshape(h2, factor, w2, factor, 4)
    a = a.transpose(0, 2, 1, 3, 4).reshape(h2, w2, factor * factor, 4)
    alpha = (a[..., 3] > 127)
    cover = alpha.mean(-1)
    rgb = np.zeros((h2, w2, 3), np.uint8)
    for c in range(3):
        ch = a[..., c].astype(float)
        ch[~alpha] = np.nan
        with np.errstate(all="ignore"):
            med = np.nanmedian(ch, axis=-1)
        rgb[..., c] = np.nan_to_num(med).astype(np.uint8)
    out = np.dstack([rgb, np.where(cover >= 0.5, 255, 0).astype(np.uint8)])
    return out


def quantize(rgba, colors=48):
    """Snap to a limited palette (pixel art look) and keep hard 1-bit alpha."""
    img = Image.fromarray(rgba[..., :3].astype(np.uint8))
    q = np.asarray(img.quantize(colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB"))
    return np.dstack([q, rgba[..., 3]]).astype(np.uint8)


def trim(rgba, pad=0):
    ys, xs = np.nonzero(rgba[..., 3])
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = rgba[y0:y1, x0:x1]
    if pad:
        out = np.pad(out, ((pad, pad), (pad, pad), (0, 0)))
    return out


def save(rgba, path):
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(path, optimize=True)
