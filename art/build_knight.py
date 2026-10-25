"""Slice the green-screen knight sprite sheets, chroma-key them, and pack every
frame into one atlas + frame table, then embed it into index.html.

    python art/build_knight.py   -> art/knight-atlas.webp, art/knight-atlas.json, art/preview.png
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
STAND_H = 64  # a standing knight is this many px tall in the atlas (game: STAND_H px -> KROWS text rows)
# reference frames used to put both sheets at the same knight size (a running knight crouches a bit)
SCALE_REF = {"run8": ("run8_S_0", STAND_H * .93), "moves": ("idle_S", STAND_H), "hero": ("idle_hero", STAND_H)}

# run sheet: 8 directions x 6 frames. rows S, SW, W, NW, N, NE, E, SE
RUN_COLS = [110, 326, 568, 797, 1032, 1268, 1536]
RUN_ROWS = [0, 126, 244, 366, 485, 613, 736, 857, 985]
RUN_DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
RUN_MIRROR = {"NW"}  # the sheet draws this row facing right; flip it

# single hero idle (front, turned slightly right), the whole image is one frame
IDLE_HERO = "knight-idle-hero.webp"

# moves sheet: 5 rows x 6 poses
MOV_COLS = [0, 220, 438, 656, 874, 1092, 1312]
MOV_ROWS = [(34, 233), (289, 457), (512, 686), (742, 912), (970, 1151)]
MOV_NAMES = [
    ["idle_S", "idle_SE", "idle_E", "idle_N", "idle_W", "idle_SW"],
    ["run_start", "run_1", "run_2", "run_3", "run_slow", "run_stop"],
    ["atk_wind", "atk_hslash", "atk_vslash", "atk_thrust", "atk_spin", "atk_recover"],
    ["block_front", "block_left", "block_right", "shield_bash", "hit", "hit_recover"],
    ["jump_start", "jump_air", "land", "roll", "crouch", "get_up"],
]


def key_cell(rgb):
    """Chroma-key the green screen; returns RGBA (despilled) or None."""
    a = rgb.astype(np.float32)
    other = np.maximum(a[..., 0], a[..., 2])
    green = a[..., 1] - other                      # how much greener than red/blue
    alpha = np.clip(1 - (green - 18) / 50, 0, 1)   # soft edge between 18..68
    fg = alpha > .5
    fg = ndimage.binary_opening(fg, iterations=1)
    # keep the knight: biggest blob plus sizeable pieces overlapping it (sword, cape); drops labels
    lab, n = ndimage.label(fg)
    if n == 0:
        return None
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    my = ndimage.find_objects(lab)[main - 1]
    keep = np.zeros(n + 1, bool)
    for i, (s, sl) in enumerate(zip(sizes, ndimage.find_objects(lab)), 1):
        near = sl[0].start < my[0].stop + 8 and sl[0].stop > my[0].start - 8 and sl[1].start < my[1].stop + 8 and sl[1].stop > my[1].start - 8
        if i == main or (s >= 30 and near):
            keep[i] = True
    mask = keep[lab]
    alpha = alpha * ndimage.binary_dilation(mask, iterations=1)
    # despill: no channel-green glow on the steel edges
    out = a.copy()
    out[..., 1] = np.minimum(a[..., 1], other * 1.02 + 4)
    return np.dstack([out.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])


def crop(rgba):
    ys, xs = np.nonzero(rgba[..., 3] > 40)
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def cells():
    run = np.array(Image.open(os.path.join(HERE, "knight-run8-sheet.webp")).convert("RGB"))
    for r, d in enumerate(RUN_DIRS):
        for c in range(6):
            y0, y1, x0, x1 = RUN_ROWS[r], RUN_ROWS[r + 1], RUN_COLS[c], RUN_COLS[c + 1]
            cell = run[y0 + 3:y1 - 3, x0 + 3:x1 - 3]
            yield "run8", f"run8_{d}_{c}", cell[:, ::-1] if d in RUN_MIRROR else cell
    yield "hero", "idle_hero", np.array(Image.open(os.path.join(HERE, IDLE_HERO)).convert("RGB"))
    mov = np.array(Image.open(os.path.join(HERE, "knight-moves-sheet.webp")).convert("RGB"))
    for r, names in enumerate(MOV_NAMES):
        y0, y1 = MOV_ROWS[r]
        for c, nm in enumerate(names):
            x0, x1 = MOV_COLS[c], MOV_COLS[c + 1]
            yield "moves", nm, mov[y0 + 4:y1 - 2, x0 + 4:x1 - 4]


def main():
    raw = []
    for sheet, name, cell in cells():
        k = key_cell(cell)
        if k is None:
            print("empty", name); continue
        raw.append((sheet, name, Image.fromarray(crop(k), "RGBA")))
    heights = {name: im.height for _, name, im in raw}
    scale = {sh: target / heights[ref] for sh, (ref, target) in SCALE_REF.items()}
    frames = []
    for sheet, name, im in raw:
        s = scale[sheet]
        frames.append((name, im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)))
    # pack in shelves
    AW = 1024
    x = y = rowh = 0
    table = {}
    for name, im in frames:
        if x + im.width > AW:
            x, y = 0, y + rowh + 2
            rowh = 0
        # anchor x: centre of the feet (bottom rows), so the cape changing width doesn't make him jitter
        al = np.array(im)[..., 3]
        feet = al[int(im.height * .82):] > 100
        xs = np.nonzero(feet.any(0))[0]
        ax = int(round((xs.min() + xs.max()) / 2)) if len(xs) else im.width // 2
        table[name] = [x, y, im.width, im.height, ax]
        x += im.width + 2
        rowh = max(rowh, im.height)
    atlas = Image.new("RGBA", (AW, y + rowh), (0, 0, 0, 0))
    for name, im in frames:
        atlas.paste(im, tuple(table[name][:2]))
    out = os.path.join(HERE, "knight-atlas.webp")
    atlas.save(out, "WEBP", quality=88, alpha_quality=90, method=6)
    with open(os.path.join(HERE, "knight-atlas.json"), "w") as f:
        json.dump(table, f, separators=(",", ":"))
    prev = Image.new("RGBA", atlas.size, (200, 60, 200, 255))
    prev.alpha_composite(atlas)
    prev = prev.convert("RGB")
    prev.resize((prev.width * 2, prev.height * 2), Image.NEAREST).save(os.path.join(HERE, "preview.png"))
    print(len(frames), "frames", atlas.size, os.path.getsize(out), "bytes")
    embed(out, table)


def embed(atlas_path, table):
    """Swap the knight atlas line in index.html (file:// pages can't read pixels of external images)."""
    import base64
    page = os.path.join(HERE, "..", "index.html")
    with open(page, encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    b64 = base64.b64encode(open(atlas_path, "rb").read()).decode()
    line = (f'const KATLAS = "data:image/webp;base64,{b64}", KSTAND = {STAND_H}, '
            f'KFR = {json.dumps(table, separators=(",", ":"))};')
    idx = [i for i, l in enumerate(lines) if l.startswith("const KATLAS =") or l.startswith("const KSRC =")]
    assert len(idx) == 1, idx
    lines[idx[0]] = line + ("\r" if lines[idx[0]].endswith("\r") or lines[0].endswith("\r") else "")
    with open(page, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))
    print("embedded into index.html line", idx[0] + 1)


main()
