"""Slice the per-class green-screen sheets (run cycles and effect sheets) into small atlases the game
loads on demand. The grid is found automatically from the black lines, so sheets don't need exact
pixel layouts as long as they keep the 8 rows x 6 frames format.

    python art/build_art.py   -> art/<class>-atlas.webp/.json, art/fx-<class>-atlas.webp/.json, art/fx-preview.png
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
STAND_H = 64
CLASSES = ["berserker", "sorcerer", "shadow", "necromancer", "angel"]
FX_CLASSES = ["knight", "berserker", "sorcerer", "shadow", "necromancer", "angel"]
RUN_DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
RUN_MIRROR = {"NW"}  # like the knight sheet, this row is drawn facing right
FX_ROWS = {
    "knight": ["sword", "swing", "wave", "wave_hit", "judgment", "blade", "charge", "aura"],
    "berserker": ["axe", "swing", "fireball", "explosion", "landing", "eruption", "burning", "bloodlust"],
    "sorcerer": ["staff", "orb", "missile", "lightning", "meteor", "phase", "ooze", "rift"],
    "shadow": ["daggers", "swing", "dagger", "dagger_hit", "smoke", "strike", "step", "crit"],
    "necromancer": ["scythe", "lantern", "soul", "soul_hit", "raise", "nova", "swap", "minion_death"],
    "angel": ["spear", "wings", "lance", "lance_hit", "starfall", "radiance", "ward", "halo"],
}


def green_mask(a):
    a = a.astype(np.int16)
    return (a[..., 1] > 140) & (a[..., 1] - np.maximum(a[..., 0], a[..., 2]) > 60)


def spans(frac, lo):
    """runs of indices where frac >= lo (cells), as (start, end) pairs"""
    on = frac >= lo
    out, s = [], None
    for i, v in enumerate(on):
        if v and s is None: s = i
        if not v and s is not None: out.append((s, i)); s = None
    if s is not None: out.append((s, len(on)))
    return out


def grid(img):
    """cells are the gaps between the black grid lines (and the black label column / header row)"""
    a = img.astype(np.int16)
    dark = a.sum(2) < 110
    h, w = dark.shape
    cols = spans(1 - dark[int(h * .1):].mean(0), .4)
    cols = [c for c in cols if c[1] - c[0] > w * .08]
    x0 = cols[0][0]
    rows = spans(1 - dark[:, x0:].mean(1), .4)
    rows = [r for r in rows if r[1] - r[0] > h * .05]
    if len(rows) != 8:  # no horizontal lines on this sheet: split the area under the header evenly
        top, bot = rows[0][0], rows[-1][1]
        rows = [(round(top + (bot - top) * i / 8), round(top + (bot - top) * (i + 1) / 8)) for i in range(8)]
    assert len(cols) == 6, len(cols)
    return rows, cols


def key(rgb, blobs=True):
    a = rgb.astype(np.float32)
    other = np.maximum(a[..., 0], a[..., 2])
    green = a[..., 1] - other
    alpha = np.clip(1 - (green - 18) / 50, 0, 1)
    fg = ndimage.binary_opening(alpha > .5, iterations=1)
    if blobs:  # characters: keep the body and pieces touching it, drop stray specks
        lab, n = ndimage.label(fg)
        if n == 0: return None
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        main = int(np.argmax(sizes)) + 1
        my = ndimage.find_objects(lab)[main - 1]
        for i, (s, sl) in enumerate(zip(sizes, ndimage.find_objects(lab)), 1):
            near = sl[0].start < my[0].stop + 8 and sl[0].stop > my[0].start - 8 and sl[1].start < my[1].stop + 8 and sl[1].stop > my[1].start - 8
            keep[i] = i == main or (s >= 30 and near)
        fg = keep[lab]
    alpha = alpha * ndimage.binary_dilation(fg, iterations=1)
    out = a.copy()
    out[..., 1] = np.minimum(a[..., 1], other * 1.02 + 4)  # despill
    return np.dstack([out.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])


def crop(rgba):
    ys, xs = np.nonzero(rgba[..., 3] > 40)
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def pack(frames, AW=1024):
    x = y = rowh = 0
    pos = {}
    for name, im in frames:
        if x + im.width > AW: x, y, rowh = 0, y + rowh + 2, 0
        pos[name] = (x, y); x += im.width + 2; rowh = max(rowh, im.height)
    atlas = Image.new("RGBA", (AW, y + rowh), (0, 0, 0, 0))
    for name, im in frames: atlas.paste(im, pos[name])
    return atlas, pos


def knight_scale():
    """sheet px -> atlas px, the same factor the knight's run sheet uses, so every class stands as tall"""
    meta = json.load(open(os.path.join(HERE, "knight-atlas.json")))
    sheet = np.array(Image.open(os.path.join(HERE, "knight-run8-sheet.webp")).convert("RGB"))
    k = key(sheet[0 + 3:126 - 3, 110 + 3:326 - 3])  # the S_0 cell, as build_knight.py cuts it
    return meta["frames"]["run8_S_0"][3] / crop(k).shape[0]


def build_class(name, scale):
    sheet = np.array(Image.open(os.path.join(HERE, f"{name}-run8-sheet.webp")).convert("RGB"))
    rows, cols = grid(sheet)
    frames = []
    for r, d in enumerate(RUN_DIRS):
        for c in range(6):
            (y0, y1), (x0, x1) = rows[r], cols[c]
            cell = sheet[y0 + 3:y1 - 3, x0 + 3:x1 - 3]
            if d in RUN_MIRROR: cell = cell[:, ::-1]
            k = key(cell)
            if k is None: print(name, "empty", d, c); continue
            im = Image.fromarray(crop(k), "RGBA")
            frames.append((f"run8_{d}_{c}", im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)))
    atlas, pos = pack(frames)
    table = {}
    for nm, im in frames:
        al = np.array(im)[..., 3]
        xs = np.nonzero((al[int(im.height * .82):] > 100).any(0))[0]
        ax = int(round((xs.min() + xs.max()) / 2)) if len(xs) else im.width // 2
        table[nm] = [*pos[nm], im.width, im.height, ax]
    out = os.path.join(HERE, f"{name}-atlas.webp")
    atlas.save(out, "WEBP", quality=88, alpha_quality=90, method=6)
    json.dump({"stand": STAND_H, "frames": table}, open(os.path.join(HERE, f"{name}-atlas.json"), "w"), separators=(",", ":"))
    print(name, len(frames), "frames", atlas.size, os.path.getsize(out), "bytes")


def build_fx(name, scale):
    sheet = np.array(Image.open(os.path.join(HERE, f"fx-{name}-sheet.webp")).convert("RGB"))
    rows, cols = grid(sheet)
    cw = min(c[1] - c[0] for c in cols) - 8
    ch = min(r[1] - r[0] for r in rows) - 8
    W, H = round(cw * scale), round(ch * scale)
    frames = []
    for r, row in enumerate(FX_ROWS[name]):
        for c in range(6):
            (y0, y1), (x0, x1) = rows[r], cols[c]
            cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
            cell = sheet[cy - ch // 2:cy + ch // 2, cx - cw // 2:cx + cw // 2]
            k = key(cell, blobs=False)
            im = Image.fromarray(k, "RGBA").resize((W, H), Image.LANCZOS)
            frames.append((f"{row}_{c}", im))
    atlas, pos = pack(frames)
    out = os.path.join(HERE, f"fx-{name}-atlas.webp")
    atlas.save(out, "WEBP", quality=86, alpha_quality=90, method=6)
    json.dump({"stand": STAND_H, "cell": [W, H], "rows": FX_ROWS[name], "frames": {nm: list(pos[nm]) for nm, _ in frames}},
              open(os.path.join(HERE, f"fx-{name}-atlas.json"), "w"), separators=(",", ":"))
    print("fx", name, len(frames), "frames", atlas.size, os.path.getsize(out), "bytes")
    return atlas


def main():
    s = knight_scale()
    print("scale", round(s, 3))
    for c in CLASSES: build_class(c, s)
    prev = []
    for c in FX_CLASSES: prev.append(build_fx(c, s))
    pw, ph = max(a.width for a in prev), sum(a.height + 4 for a in prev)
    sheet = Image.new("RGBA", (pw, ph), (30, 20, 40, 255)); y = 0
    for a in prev: sheet.alpha_composite(a, (0, y)); y += a.height + 4
    sheet.convert("RGB").save(os.path.join(HERE, "fx-preview.png"))


main()
