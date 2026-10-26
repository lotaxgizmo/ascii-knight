import "./style.css";
import KATLAS from "../art/knight-atlas.webp";
import KATLAS_META from "../art/knight-atlas.json";
import {connect, fetchTurn, selfId, relaysUp, RELAY_COUNT} from "./net.js";
import * as audio from "./audio.js";
const sfx = audio.sfx;

/* ============================== constants ============================== */
const VS = 2.0;                 // vertical squash: 1 cell down = 2 ground units (3/4 view)
const W = 1024, H = 640;        // world size in cells
const S = {x:512, y:355};       // stone circle centre / spawn
const G = {x:723, y:326};       // Old Barrow (graveyard)
const R = {x:285, y:454};       // Fallen Keep (ruins)
const T = {x:534, y:93};        // Moon Tower
const LAKE = {x:845, y:515, r:80};
const BR = {x:170, y:120};      // Broken Ring (a smaller, older stone circle in the north-west)
const CAMPS = [{x:860, y:170, name:"Ember Camp"}, {x:150, y:590, name:"Hunter's Camp"}, {x:640, y:590, name:"Southern Camp"}];
// waystones: glowing obelisks at every landmark; stand at one to travel to any other (final spots resolved in buildWorld)
const WAYSTONES = [
  {name: "Stone Circle", x: S.x + 24, y: S.y + 14}, {name: "Old Barrow", x: G.x - 8, y: G.y + 26}, {name: "Fallen Keep", x: R.x + 22, y: R.y + 26},
  {name: "Moon Tower", x: T.x + 18, y: T.y + 12}, {name: "Broken Ring", x: BR.x + 28, y: BR.y + 14}, {name: "Mirror Lake", x: LAKE.x - LAKE.r - 18, y: LAKE.y - 34},
  ...CAMPS.map(c => ({name: c.name, x: c.x + 20, y: c.y + 12})),
];
const MAX_LIGHTS = 16;

/* glyph sets per material, ordered light -> dense */
const SETS = [
  " .`,'\":;i|",   // 0 grass
  " .-~=≈",        // 1 water
  " .:;=+#%@",     // 2 stone
  " .,:;+*",       // 3 dirt / wood
  " .,:;&%@",      // 4 tree canopy
  " .,:*",         // 5 flowers
  " .:-~",         // 6 mist
  " .*+xX#@"       // 7 glow (runes, mushrooms)
];
const ATLAS = SETS.join("");
const STARTS = []; { let a = 0; for (const s of SETS) { STARTS.push(a); a += s.length; } }

/* ============================== noise ============================== */
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
let seed = 1337;
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ============================== world ============================== */
const COL = new Uint8ClampedArray(W * H * 4);
const MAT = new Uint8Array(W * H);
const BLK = new Uint8Array(W * H);
const occluders = [];
const staticLights = [];
const rc = new Float32Array(W), rw = new Float32Array(W);

function setC(x, y, r, g, b, m) {
  x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x; COL[i*4] = r; COL[i*4+1] = g; COL[i*4+2] = b; COL[i*4+3] = 255;
  if (m !== undefined) MAT[i] = m;
}
function mulC(x, y, k) {
  x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4; COL[i] *= k; COL[i+1] *= k; COL[i+2] *= k;
}
function block(x, y) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) BLK[y * W + x] = 1; }
function matAt(x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return 255; return MAT[y * W + x]; }
function shadow(cx, cy, rx, ry, k) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry, d = dx*dx + dy*dy;
      if (d < 1) mulC(x, y, k + (1 - k) * d * d);
    }
}
function riverDist(x, y) { const xi = clamp(x | 0, 0, W - 1); return Math.abs(y - rc[xi]) * VS - rw[xi]; }
// Slow-varying noise is sampled once on a coarse grid and read back with bilinear blending: same look,
// a fraction of the work (world generation was the slowest part of loading on phones).
function coarseField(step, fn) {
  const cw = Math.ceil(W / step) + 2, ch = Math.ceil(H / step) + 2, a = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) a[j * cw + i] = fn(i * step, j * step);
  return (x, y) => {
    const fx = clamp(x / step, 0, cw - 1.001), fy = clamp(y / step, 0, ch - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = j * cw + i;
    return (a[o] * (1 - u) + a[o + 1] * u) * (1 - v) + (a[o + cw] * (1 - u) + a[o + cw + 1] * u) * v;
  };
}
let lakeN = (x, y) => fbm(x * 0.02 + 40, y * VS * 0.02 + 40, 3);
function lakeDist(x, y) {
  const gx = x, gy = y * VS;
  const ln = lakeN(x, y);
  return Math.hypot(gx - LAKE.x, gy - LAKE.y * VS) - (LAKE.r + (ln - .5) * 40);
}
const gdist = (ax, ay, bx, by) => Math.hypot(ax - bx, (ay - by) * VS);

const HGT = new Float32Array(W * H); // rolling-hill height field, used for baked hill shading
function genGround() {
  for (let x = 0; x < W; x++) {
    rc[x] = 189 + Math.sin(x * 0.0081) * 38 + Math.sin(x * 0.0194 + 2) * 14 + (fbm(x * 0.0125, 7.3, 3) - .5) * 26;
    rw[x] = 10 + fbm(x * 0.019, 19.1, 2) * 9;
  }
  lakeN = coarseField(3, lakeN);
  const hillN = coarseField(3, (x, y) => fbm(x * .011 + 5, y * VS * .011 + 9, 4));
  const darkN = coarseField(4, (x, y) => fbm(x * .012 + 100, y * VS * .012 + 50, 3));
  const zoneN = coarseField(6, (x, y) => fbm(x * .006 + 70, y * VS * .006 + 20, 3));
  const dirtN = coarseField(3, (x, y) => fbm(x * .025 + 300, y * VS * .025 + 300, 3));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) HGT[y * W + x] = hillN(x, y) + vnoise(x * .05, y * VS * .05) * .12;
  const hAt = (x, y) => HGT[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = x, gy = y * VS, i = y * W + x, hh = hash2(x, y);
    const sd = Math.min(riverDist(x, y), lakeDist(x, y));
    // moonlight from the upper left: slopes facing it brighten, slopes facing away fall into shadow
    const shade = clamp(1 + ((hAt(x - 1, y) - hAt(x + 1, y)) * .8 + (hAt(x, y - 1) - hAt(x, y + 1)) * 1.1) * 16, .62, 1.38);
    let r, g, b, m = 0;
    if (sd < 0) {
      const depth = Math.min(1, -sd / 10), n = fbm(gx * .08, gy * .08, 2);
      const k = .75 + n * .5;
      r = (18 - 9 * depth) * k; g = (40 - 16 * depth) * k; b = (68 - 10 * depth) * k;
      if (sd > -1.4 && hh > .4) { r = 130; g = 150; b = 165; } // foam where water laps the bank
      m = 1; BLK[i] = 1;
    } else if (sd < 3.5) { // wet mud and pebbles along the shore, with reeds
      const k = .55 + hh * .7;
      r = 70 * k; g = 62 * k; b = 52 * k;
      if (hash2(x + 3, y) > .8) { r = 92 * k; g = 94 * k; b = 98 * k; m = 2; }
      if (sd > 1.2 && hash2(x, y + 7) > .62) { r = 46 * k; g = 96 * k; b = 44 * k; m = 0; } // reeds
      else if (m !== 2) m = 3;
      r *= shade; g *= shade; b *= shade;
    } else {
      const g1 = fbm(gx * .045, gy * .045, 3);
      const dark = darkN(x, y);
      r = 20 + 28 * g1; g = 52 + 66 * g1; b = 26 + 22 * g1;
      // meadow types: golden dry grass, ordinary green, deep blue-green moss
      const zone = zoneN(x, y);
      const dry = clamp((zone - .56) * 6, 0, 1), moss = clamp((.42 - zone) * 6, 0, 1);
      r += dry * 34 - moss * 6; g += dry * 8 + moss * 4; b += -dry * 8 + moss * 14;
      if (dark < .42) { const k = clamp(.55 + (dark - .3) * 3.5, .5, 1); r *= k; g *= k; b *= k * 1.1; }
      if (hh > .93) { r += 16; g += 34; b += 10; }
      r *= shade; g *= shade; b *= shade;
      const dp = dirtN(x, y);
      if (dp > .7) { const k = .7 + hh * .5; r = 66 * k; g = 54 * k; b = 38 * k; m = 3; }
      else if (hh < .0045 && dark > .45) {
        const f = hash2(x + 7, y);
        if (f < .45) { r = 150; g = 155; b = 140; } else if (f < .8) { r = 165; g = 145; b = 60; } else { r = 125; g = 90; b = 160; }
        m = 5;
      }
    }
    COL[i*4] = r; COL[i*4+1] = g; COL[i*4+2] = b; COL[i*4+3] = 255; MAT[i] = m;
    if (x < 5 || y < 4 || x >= W - 5 || y >= H - 4) BLK[i] = 1;
  }
}

function stampPath(pts, wid) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
    const len = gdist(ax, ay, bx, by), steps = Math.ceil(len * 1.5);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const px = ax + (bx - ax) * t + (vnoise(s * 9 + t * 6, 3.3) - .5) * 5;
      const py = ay + (by - ay) * t + (vnoise(s * 9 + t * 6, 8.1) - .5) * 2;
      for (let y = Math.floor(py - wid / VS); y <= py + wid / VS; y++)
        for (let x = Math.floor(px - wid); x <= px + wid; x++) {
          if (gdist(x + .5, y + .5, px, py) > wid + (hash2(x, y) - .5) * 1.4) continue;
          const m = matAt(x, y); if (m === 1 || m === 255) continue;
          const k = .72 + hash2(x * 3, y) * .5;
          setC(x, y, 74 * k, 60 * k, 42 * k, 3);
        }
    }
  }
}

function drawBridge(bx) {
  const c = rc[bx], half = rw[bx] / VS + 3;
  for (let y = Math.floor(c - half); y <= c + half; y++)
    for (let x = bx - 4; x <= bx + 4; x++) {
      if (x === bx - 4 || x === bx + 4) { setC(x, y, 52, 38, 26, 3); block(x, y); continue; }
      const k = (y % 2 ? .8 : 1) * (.85 + hash2(x, y) * .3);
      setC(x, y, 96 * k, 70 * k, 44 * k, 3);
      BLK[y * W + x] = 0;
    }
}

function drawStone(bx, by, w, h, sd, rune = true) {
  shadow(bx + w * .7, by + .3, w * 1.2, 2.2, .42);
  for (let yy = 0; yy < h; yy++) {
    const y = by - 1 - yy, t = yy / h;
    const half = w / 2 * (1 - Math.pow(t, 3) * .45) + (vnoise(yy * .7, sd) - .5) * .9;
    for (let x = Math.floor(bx - half - 1); x <= bx + half + 1; x++) {
      const u = (x + .5 - bx) / half;
      if (Math.abs(u) > 1) continue;
      if (t > .82 && Math.abs(u) > Math.sqrt(Math.max(0, 1 - Math.pow((t - .82) / .18, 2)))) continue;
      const n = vnoise(x * .9 + sd, y * .6);
      const k = (1 - u * .32 + t * .12) * (.72 + n * .5);
      let r = 90 * k, g = 96 * k, b = 108 * k;
      if (yy < 2 && hash2(x, y) > .35) { r *= .75; g *= 1.15; b *= .75; }
      setC(x, y, r, g, b, 2);
      if (yy < 2) block(x, y);
    }
  }
  if (rune) {
    const rx = Math.round(bx - .5), ry = by - Math.round(h * .62);
    setC(rx, ry, 110, 215, 255, 7); setC(rx, ry + 1, 90, 190, 245, 7); setC(rx, ry + 2, 110, 215, 255, 7);
    staticLights.push({x: rx + .5, y: by, r: 9, i: .55, c: [.35, .75, 1.0], ph: rnd() * 6, kind: 'rune'});
  }
  occluders.push({x0: bx - w / 2, x1: bx + w / 2, yTop: by - h, yBase: by});
}

function drawTree(bx, by, r, sd) {
  shadow(bx + r * .45, by + .4, r * 1.15, r * .42, .38);
  for (let yy = 0; yy < 4; yy++) for (let xx = -1; xx <= 0; xx++) {
    const k = xx < 0 ? 1 : .68;
    setC(bx + xx, by - 1 - yy, 60 * k, 42 * k, 28 * k, 3);
  }
  block(bx - 1, by - 1); block(bx, by - 1);
  const ry = r * .56, cy = by - 3 - ry * .85;
  const hue = hash2(sd * 7 | 0, 3);
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
    for (let x = Math.floor(bx - r - 1); x <= bx + r + 1; x++) {
      const dx = (x + .5 - bx) / r, dy = (y + .5 - cy) / ry, d = dx*dx + dy*dy;
      if (d > 1 + (vnoise(x * .6 + sd, y * .9) - .5) * .55) continue;
      const lit = clamp(.5 + (-dx * .35 - dy * .55) * .6 + vnoise(x * .5, y * .8 + sd) * .4, .2, 1.3);
      const k = lit * 1.35;
      setC(x, y, (22 + hue * 10) * k, (56 + hue * 8) * k, (34 - hue * 8) * k, 4);
    }
  occluders.push({x0: bx - r, x1: bx + r, yTop: cy - ry, yBase: by});
}

function drawDeadTree(bx, by, sd) {
  shadow(bx + 3, by + .3, 5, 1.6, .5);
  const h = 9;
  for (let yy = 0; yy < h; yy++) {
    const wob = Math.round((vnoise(yy * .4, sd) - .5) * 2);
    setC(bx + wob, by - 1 - yy, 70, 64, 58, 3); if (yy < 5) setC(bx + wob - 1, by - 1 - yy, 54, 48, 44, 3);
  }
  for (let k = 0; k < 4; k++) {
    const sy = by - 4 - k * 1.5 | 0, dir = k % 2 ? 1 : -1, ln = 3 + (hash2(k, sd | 0) * 3 | 0);
    for (let j = 1; j <= ln; j++) setC(bx + dir * j, sy - (j >> 1), 66, 60, 54, 3);
  }
  block(bx, by - 1); block(bx - 1, by - 1);
  occluders.push({x0: bx - 5, x1: bx + 5, yTop: by - h - 2, yBase: by});
}

function drawTomb(bx, by, sd) {
  shadow(bx + 1.5, by + .3, 2.6, 1, .5);
  const cross = sd > .78, h = cross ? 5 : 3 + (sd > .4 ? 1 : 0);
  for (let yy = 0; yy < h; yy++) for (let xx = -1; xx <= 1; xx++) {
    if (cross && yy > 0 && xx !== 0 && yy !== h - 2) continue;
    if (!cross && yy === h - 1 && xx !== 0 && hash2(bx, by) > .3) continue;
    const k = (xx < 0 ? 1.1 : xx > 0 ? .75 : .95) * (.8 + hash2(bx + xx, yy) * .35);
    setC(bx + xx, by - 1 - yy, 92 * k, 96 * k, 106 * k, 2);
  }
  block(bx - 1, by - 1); block(bx, by - 1); block(bx + 1, by - 1);
  occluders.push({x0: bx - 1.5, x1: bx + 1.5, yTop: by - h, yBase: by});
}

function drawWall(x0, by, len, h, sd) {
  for (let x = x0; x < x0 + len; x++) shadow(x + 1.5, by + .6, 1.6, 1.4, .55);
  for (let x = x0; x < x0 + len; x++) {
    const colH = Math.max(2, h - Math.floor(vnoise(x * .45, sd) * h * .7));
    for (let yy = 0; yy < colH; yy++) {
      const y = by - 1 - yy;
      const mortar = (yy % 2 === 1) || ((x + (yy >> 1) * 2) % 4 === 0);
      const k = (mortar ? .62 : 1) * (.78 + hash2(x, y) * .35) * (yy === colH - 1 ? 1.2 : 1);
      setC(x, y, 82 * k, 82 * k, 90 * k, 2);
      if (yy < 2) block(x, y);
    }
  }
  occluders.push({x0: x0, x1: x0 + len, yTop: by - h, yBase: by});
}

function drawTower(cx, by) {
  const w = 18, h = 30;
  shadow(cx + 9, by + 1, 16, 3, .4);
  for (let x = cx - w / 2; x < cx + w / 2; x++) {
    const u = (x + .5 - cx) / (w / 2);
    const colH = h - Math.floor(vnoise(x * .35, 9) * 10) - (Math.abs(u) > .8 ? 4 : 0);
    for (let yy = 0; yy < colH; yy++) {
      const y = by - 1 - yy;
      const mortar = (yy % 2 === 1) || ((x + (yy >> 1) * 2) % 4 === 0);
      const k = (mortar ? .6 : 1) * (1.05 - u * .35) * (.78 + hash2(x, y) * .32);
      let r = 80 * k, g = 80 * k, b = 92 * k;
      const door = Math.abs(x + .5 - cx) < 2.2 && yy < 6 + (Math.abs(x + .5 - cx) < 1 ? 1 : 0);
      const win = Math.abs(x + .5 - cx) < .8 && yy > 15 && yy < 19;
      if (door) { r = 8; g = 8; b = 12; }
      if (win) { setC(x, y, 190, 130, 255, 7); continue; }
      setC(x, y, r, g, b, 2);
      if (yy < 2) block(x, y);
    }
  }
  staticLights.push({x: cx, y: by - 2, r: 16, i: .9, c: [.7, .45, 1.0], ph: 1, kind: 'rune'});
  occluders.push({x0: cx - w / 2, x1: cx + w / 2, yTop: by - h, yBase: by});
}

function drawCampfire(cx, cy) {
  shadow(cx, cy, 6, 2.6, .55);
  for (let a = 0; a < 8; a++) {
    const t = a / 8 * Math.PI * 2;
    setC(Math.round(cx + Math.cos(t) * 3), Math.round(cy + Math.sin(t) * 1.5), 100, 98, 96, 2);
  }
  for (let x = -2; x <= 1; x++) { setC(cx + x, cy, 80, 54, 32, 3); setC(cx + x, cy - 1, 66, 44, 26, 3); block(cx + x, cy); }
  staticLights.push({x: cx + .5, y: cy + .5, r: 26, i: 1.35, c: [1.0, .55, .2], ph: 0, kind: 'fire'});
}

function drawPine(bx, by, h, sd) { // layered conifer: stacked tiers that widen toward the base
  shadow(bx + h * .3, by + .4, h * .55, h * .18, .4);
  for (let yy = 0; yy < 3; yy++) setC(bx, by - 1 - yy, 54, 38, 26, 3);
  block(bx, by - 1); block(bx - 1, by - 1);
  const hue = hash2(sd | 0, 9);
  for (let yy = 2; yy < h; yy++) {
    const t = (yy - 2) / (h - 2), tier = (yy - 2) % 4;
    const half = (1 - t) * h * .42 * (1 - tier * .12) + .4;
    const y = by - 1 - yy;
    for (let x = Math.floor(bx - half); x <= bx + half; x++) {
      const u = (x + .5 - bx) / (half + .01);
      const lit = clamp(.62 - u * .32 + (tier === 0 ? -.18 : .1) + vnoise(x * .7, y * .9 + sd) * .3, .25, 1.2);
      setC(x, y, (16 + hue * 8) * lit * 1.3, (50 + hue * 10) * lit * 1.3, (40 + hue * 6) * lit * 1.3, 4);
    }
  }
  occluders.push({x0: bx - h * .42, x1: bx + h * .42, yTop: by - h, yBase: by});
}
function drawRock(bx, by, r, sd) { // a lumpy boulder lit from the upper left, mossy at the base
  shadow(bx + r * .6, by + .3, r * 1.5, r * .55, .45);
  const ry = r * .75;
  for (let y = Math.floor(by - ry * 2); y <= by; y++) for (let x = Math.floor(bx - r - 1); x <= bx + r + 1; x++) {
    const dx = (x + .5 - bx) / r, dy = (y + .5 - (by - ry)) / ry, d = dx * dx + dy * dy;
    if (d > 1 + (vnoise(x * .9 + sd, y) - .5) * .5) continue;
    const lit = clamp(.75 - dx * .35 - dy * .3 + hash2(x, y) * .2, .35, 1.25);
    let c = [96 * lit, 98 * lit, 104 * lit];
    if (dy > .45 && hash2(x + 1, y) > .5) c = [c[0] * .7, c[1] * 1.05, c[2] * .7];
    setC(x, y, c[0], c[1], c[2], 2); if (dy > .2) block(x, y);
  }
}
function drawBush(bx, by, r, sd) {
  shadow(bx + r * .5, by + .3, r * 1.3, r * .5, .45);
  const ry = r * .6, berries = hash2(sd, 3) > .7;
  for (let y = Math.floor(by - ry * 2); y <= by; y++) for (let x = Math.floor(bx - r - 1); x <= bx + r + 1; x++) {
    const dx = (x + .5 - bx) / r, dy = (y + .5 - (by - ry)) / ry, d = dx * dx + dy * dy;
    if (d > 1 + (vnoise(x * .8 + sd, y * 1.1) - .5) * .6) continue;
    const lit = clamp(.7 - dx * .3 - dy * .35 + vnoise(x * .6, y + sd) * .35, .3, 1.25);
    if (berries && hash2(x, y + 2) > .85) setC(x, y, 170, 40, 60, 5);
    else setC(x, y, 26 * lit * 1.3, 64 * lit * 1.3, 34 * lit * 1.3, 4);
  }
}
function drawTent(bx, by, sd) { // a small A-frame of patched canvas with a dark doorway
  shadow(bx + 3, by + .4, 6, 1.6, .5);
  const h = 6, cloth = [[150, 120, 80], [120, 90, 110], [96, 110, 130]][sd % 3];
  for (let yy = 0; yy < h; yy++) {
    const half = (h - yy) * .9, y = by - 1 - yy;
    for (let x = Math.floor(bx - half); x <= bx + half; x++) {
      const u = (x + .5 - bx) / (half + .01), door = Math.abs(u) < .28 && yy < 3;
      const k = door ? .15 : (u < 0 ? 1.05 : .72) * (.85 + hash2(x, y) * .25);
      setC(x, y, cloth[0] * k, cloth[1] * k, cloth[2] * k, 3);
      if (yy < 2) block(x, y);
    }
  }
  occluders.push({x0: bx - h * .9, x1: bx + h * .9, yTop: by - h, yBase: by});
}

function drawWaystone(bx, by) { // dark obelisk with a glowing rune channel, on a ring of ground runes
  for (let a = 0; a < 14; a++) { const t = a / 14 * 6.283; setC(Math.round(bx + Math.cos(t) * 5), Math.round(by + 1 + Math.sin(t) * 2.2), 120, 90, 230, 7); }
  shadow(bx + 2, by + .4, 4, 1.4, .45);
  const h = 9;
  for (let yy = 0; yy < h; yy++) for (let xx = -1; xx <= 1; xx++) {
    const y = by - 1 - yy, top = yy === h - 1;
    if (top && xx !== 0) continue;
    if (xx === 0 && yy > 1 && yy < h - 1) { setC(bx, y, 150 + yy * 6, 120, 255, 7); continue; } // rune channel
    const k = (xx < 0 ? 1.05 : xx > 0 ? .7 : .9) * (.8 + hash2(bx + xx, y) * .3);
    setC(bx + xx, y, 52 * k, 54 * k, 70 * k, 2);
  }
  block(bx - 1, by - 1); block(bx, by - 1); block(bx + 1, by - 1);
  staticLights.push({x: bx + .5, y: by, r: 26, i: 1.5, c: [.62, .45, 1], ph: rnd() * 6, kind: "rune"});
  occluders.push({x0: bx - 1.5, x1: bx + 1.5, yTop: by - h, yBase: by});
}

function clearOf(x, y) {
  if (x < 8 || y < 6 || x > W - 9 || y > H - 6) return false;
  if (gdist(x, y, S.x, S.y) < 64) return false;
  if (gdist(x, y, G.x, G.y) < 36) return false;
  if (gdist(x, y, R.x, R.y) < 52) return false;
  if (gdist(x, y, T.x, T.y) < 30) return false;
  if (gdist(x, y, BR.x, BR.y) < 34) return false;
  for (const c of CAMPS) if (gdist(x, y, c.x, c.y) < 30) return false;
  for (const w of WAYSTONES) if (gdist(x, y, w.x, w.y) < 12) return false;
  if (Math.min(riverDist(x, y), lakeDist(x, y)) < 6) return false;
  for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (matAt(x + dx, y + dy) === 3) return false;
  return true;
}

function buildWorld() {
  genGround();
  // paths
  stampPath([[S.x, S.y + 6], [595, 362], [659, 342], [G.x, G.y + 4]], 2.4);
  stampPath([[S.x - 4, S.y + 8], [448, 387], [368, 422], [R.x + 10, R.y - 4]], 2.4);
  const BX = 525, BX2 = 210;
  stampPath([[S.x, S.y - 10], [509, 304], [518, 250], [BX, rc[BX] + rw[BX] / VS + 4]], 2.2);
  stampPath([[BX, rc[BX] - rw[BX] / VS - 4], [530, 138], [T.x, T.y + 3]], 2.2);
  stampPath([[R.x - 6, R.y - 14], [250, 380], [BX2, rc[BX2] + rw[BX2] / VS + 4]], 2);
  stampPath([[BX2, rc[BX2] - rw[BX2] / VS - 4], [BR.x + 8, BR.y + 12]], 2);
  stampPath([[G.x + 10, G.y - 8], [800, 260], [CAMPS[0].x - 6, CAMPS[0].y + 8]], 2);
  stampPath([[R.x - 8, R.y + 14], [CAMPS[1].x + 10, CAMPS[1].y - 6]], 2);
  stampPath([[S.x + 4, S.y + 16], [600, 480], [CAMPS[2].x, CAMPS[2].y - 8]], 2);
  drawBridge(BX); drawBridge(BX2);
  // graveyard ground desaturate
  for (let y = G.y - 22; y < G.y + 22; y++) for (let x = G.x - 46; x < G.x + 46; x++) {
    if (gdist(x, y, G.x, G.y) < 40 + (hash2(x, y) - .5) * 6 && MAT[y * W + x] !== 1) {
      const i = (y * W + x) * 4, l = (COL[i] + COL[i+1] + COL[i+2]) / 3;
      COL[i] = (COL[i] * .4 + l * .6) * .85; COL[i+1] = (COL[i+1] * .4 + l * .6) * .85; COL[i+2] = (COL[i+2] * .4 + l * .6) * .95;
    }
  }
  // scorched ring + inner circle stones of the spawn
  for (let y = S.y - 14; y < S.y + 14; y++) for (let x = S.x - 28; x < S.x + 28; x++) {
    const d = gdist(x, y, S.x, S.y);
    if (d < 20 && MAT[y * W + x] === 0) mulC(x, y, .8 + d / 100);
  }

  const objs = [];
  // stone circle
  const nS = 11;
  for (let k = 0; k < nS; k++) {
    const a = k / nS * Math.PI * 2 + .3;
    if (Math.abs(a - Math.PI / 2) < .36 || Math.abs(a - Math.PI * 1.5) < .2) continue;
    const bx = Math.round(S.x + Math.cos(a) * 36), by = Math.round(S.y + Math.sin(a) * 36 / VS);
    objs.push({y: by, f: () => drawStone(bx, by, 6 + (k % 2), 13 + ((k * 7) % 5), k * 13.1)});
  }
  objs.push({y: S.y + 1, f: () => drawCampfire(S.x, S.y)});
  // graveyard
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    if (hash2(r, c + 50) < .2) continue;
    const bx = G.x - 24 + c * 9 + Math.round((hash2(r, c) - .5) * 3);
    const by = G.y - 9 + r * 6 + Math.round((hash2(c, r) - .5) * 2);
    objs.push({y: by, f: () => drawTomb(bx, by, hash2(bx, by))});
  }
  objs.push({y: G.y - 12, f: () => drawDeadTree(G.x - 30, G.y - 12, 3.3)});
  objs.push({y: G.y + 14, f: () => drawDeadTree(G.x + 32, G.y + 14, 8.7)});
  objs.push({y: G.y - 14, f: () => drawWall(G.x + 10, G.y - 14, 16, 7, 4.4)});
  // fallen keep ruins
  objs.push({y: R.y - 12, f: () => drawWall(R.x - 24, R.y - 12, 20, 8, 1.1)});
  objs.push({y: R.y - 12, f: () => drawWall(R.x + 4, R.y - 12, 18, 9, 2.2)});
  objs.push({y: R.y + 10, f: () => drawWall(R.x - 22, R.y + 10, 12, 6, 3.3)});
  objs.push({y: R.y + 10, f: () => drawWall(R.x + 2, R.y + 10, 22, 7, 5.5)});
  objs.push({y: R.y - 1, f: () => drawStone(R.x - 26, R.y - 1, 3, 13, 7.7, false)});
  objs.push({y: R.y + 2, f: () => drawStone(R.x + 26, R.y + 2, 3, 11, 8.8, true)});
  for (let k = 0; k < 120; k++) {
    const x = R.x + (rnd() - .5) * 70 | 0, y = R.y + (rnd() - .5) * 30 | 0;
    if (MAT[y * W + x] !== 1) { const c = 60 + rnd() * 40; setC(x, y, c, c, c + 6, 2); }
  }
  // tower
  objs.push({y: T.y, f: () => drawTower(T.x, T.y)});
  // broken ring: a smaller, half-fallen stone circle
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + .2, bx = Math.round(BR.x + Math.cos(a) * 20), by = Math.round(BR.y + Math.sin(a) * 20 / VS);
    if (k % 3 === 2) { for (let j = 0; j < 7; j++) setC(bx - 3 + j, by - 1, 80, 84, 94, 2); continue; } // toppled
    objs.push({y: by, f: () => drawStone(bx, by, 5, 8 + (k * 5) % 6, k * 9.7, k % 2 === 0)});
  }
  // camps: campfire ringed by tents
  for (const c of CAMPS) {
    objs.push({y: c.y + 1, f: () => drawCampfire(c.x, c.y)});
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + .6, tx = Math.round(c.x + Math.cos(a) * 13), ty = Math.round(c.y + Math.sin(a) * 6); objs.push({y: ty, f: () => drawTent(tx, ty, k)}); }
  }
  // waystones: nudge each onto open, dry ground
  for (const w of WAYSTONES) {
    for (let k = 0; k < 200; k++) {
      const x = Math.round(w.x + (k ? (rnd() - .5) * k * .4 : 0)), y = Math.round(w.y + (k ? (rnd() - .5) * k * .2 : 0));
      let ok = true;
      for (let dy = -2; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) { const m = matAt(x + dx, y + dy); if (m === 1 || m === 255 || BLK[(y + dy) * W + x + dx]) { ok = false; break; } }
      if (ok) { w.x = x; w.y = y; break; }
    }
    objs.push({y: w.y, f: () => drawWaystone(w.x, w.y)});
  }
  // trees: round broadleaf trees in the south, pines north of the river
  for (let gy = 6; gy < H - 4; gy += 3) for (let gx = 4; gx < W - 4; gx += 5) {
    const x = gx + (rnd() * 5 | 0), y = gy + (rnd() * 3 | 0);
    const f = fbm(x * .008 + 11, y * VS * .008 + 23, 3);
    const edge = x < 14 || y < 10 || x > W - 15 || y > H - 9;
    const p = edge ? .95 : f > .56 ? .8 : f > .5 ? .25 : .025;
    if (rnd() > p) continue;
    if (!edge && !clearOf(x, y)) continue;
    if (edge && MAT[y * W + x] === 1) continue;
    const r = 4 + rnd() * 4.5, north = y < rc[clamp(x, 0, W - 1)] - 6;
    // glowing mushrooms under the forest
    if (f > .56 && rnd() < .25) { const mx = x + (rnd() * 8 - 4 | 0), my = y + 2; if (MAT[my * W + mx] === 0) setC(mx, my, 70, 210, 190, 7); }
    if (north && rnd() < .7) objs.push({y, f: () => drawPine(x, y, 9 + rnd() * 7, x * .37 + y)});
    else objs.push({y, f: () => drawTree(x, y, r, x * .37 + y)});
  }
  // boulders and bushes scattered across open ground
  for (let k = 0; k < W * H / 1400; k++) {
    const x = 10 + rnd() * (W - 20) | 0, y = 8 + rnd() * (H - 16) | 0;
    if (!clearOf(x, y)) continue;
    if (rnd() < .45) objs.push({y, f: () => drawRock(x, y, 1 + rnd() * 2.2, k)});
    else objs.push({y, f: () => drawBush(x, y, 1.6 + rnd() * 1.6, k)});
  }
  objs.sort((a, b) => a.y - b.y);
  for (const o of objs) o.f();
}

/* ============================== regions ============================== */
function regionAt(x, y) {
  if (gdist(x, y, S.x, S.y) < 52) return "Stone Circle";
  if (gdist(x, y, G.x, G.y) < 44) return "Old Barrow";
  if (gdist(x, y, R.x, R.y) < 56) return "Fallen Keep";
  if (gdist(x, y, T.x, T.y) < 46) return "Moon Tower";
  if (gdist(x, y, BR.x, BR.y) < 40) return "Broken Ring";
  for (const c of CAMPS) if (gdist(x, y, c.x, c.y) < 34) return c.name;
  if (lakeDist(x, y) < 14) return "Mirror Lake";
  if (riverDist(x, y) < 14) return "Silver River";
  if (y < rc[clamp(x | 0, 0, W - 1)]) return "Northern Wilds";
  if (fbm(x * .008 + 11, y * VS * .008 + 23, 3) > .52) return "Whisperwood";
  return "Moonlit Vale";
}
const REGION_XP = {"Broken Ring": 50, "Ember Camp": 35, "Hunter's Camp": 35, "Southern Camp": 35, "Stone Circle": 0, "Old Barrow": 40, "Fallen Keep": 40, "Moon Tower": 60, "Mirror Lake": 30, "Silver River": 20, "Northern Wilds": 30, "Whisperwood": 25, "Moonlit Vale": 15};

/* ============================== WebGL ============================== */
const glc = document.getElementById("gl"), ov = document.getElementById("ov"), octx = ov.getContext("2d");
const gl = glc.getContext("webgl", {antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance"});
function fail(msg) {
  const d = document.createElement("div"); d.id = "err"; d.textContent = msg; document.body.appendChild(d);
  document.getElementById("loading").classList.add("gone");
}
if (!gl) { fail("This realm needs WebGL. Try a recent version of Chrome, Safari or Firefox."); throw new Error("WebGL unavailable"); }

const VSRC = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const COMMON = `
precision highp float;
float h21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(h21(i),h21(i+vec2(1.,0.)),u.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){return vn(p)*.5+vn(p*2.03)*.3+vn(p*4.01)*.2;}
`;
let setGLSL = "";
SETS.forEach((s, i) => { setGLSL += `${i ? "else " : ""}if(sm<${i}.5){st=${STARTS[i]}.;ln=${[...s].length}.;}\n`; });

const FS_CELLS = COMMON + `
uniform sampler2D uWorld;uniform sampler2D uMat;
uniform vec2 uWS;uniform vec2 uOrigin;uniform float uTime;uniform vec3 uAmb;uniform float uVS;
uniform vec4 uL[${MAX_LIGHTS}];uniform vec4 uLC[${MAX_LIGHTS}];
void main(){
  vec2 cell=floor(gl_FragCoord.xy);
  vec2 w=uOrigin+cell;
  vec2 uv=(w+.5)/uWS;
  vec3 c=texture2D(uWorld,uv).rgb;
  float m=floor(texture2D(uMat,uv).r*255./16.+.5);
  vec2 g=vec2(w.x,w.y*uVS);
  float h=h21(w);
  float jit=(h-.5)*.28;
  if(m==1.){
    float wv=sin(g.x*.22+g.y*.1-uTime*1.6+vn(g*.06)*7.);
    float sp=pow(max(wv,0.),10.);
    c+=vec3(.2,.3,.42)*sp;
    jit+=sp*.5+sin(uTime*2.+h*30.)*.08;
  } else if(m==0.||m==4.||m==5.){
    float wind=vn(vec2(g.x*.04-uTime*.6,g.y*.04));
    jit+=(wind-.5)*.35;
    c*=.9+wind*.25;
  }
  // slow cloud shadows drifting across the moonlight (point lights shine through them)
  float cl=fbm(g*.0045+vec2(uTime*.012,uTime*.005));
  vec3 L=uAmb*(.72+.38*smoothstep(.3,.7,cl));
  for(int i=0;i<${MAX_LIGHTS};i++){
    vec4 l=uL[i];
    if(l.w<=0.)continue;
    vec2 d=vec2(w.x+.5-l.x,(w.y+.5-l.y)*uVS);
    float a=clamp(1.-length(d)/l.z,0.,1.);
    L+=uLC[i].rgb*l.w*a*a;
  }
  if(m==7.){L=max(L,vec3(1.))*(.85+.3*sin(uTime*2.5+h*6.28));}
  vec3 col=c*L;
  float mistN=fbm(g*.022+vec2(uTime*.05,-uTime*.02));
  float mist=smoothstep(.52,.82,mistN);
  vec3 mcol=vec3(.55,.62,.75)*(.2+dot(L,vec3(.3))*.55);
  col=mix(col,mcol,mist*.42);
  float lum=dot(col,vec3(.3,.59,.11));
  float sm=m;
  if(mist>.7&&m!=7.&&m!=2.&&m!=4.)sm=6.;
  float st=0.,ln=1.;
  ${setGLSL}
  float t=clamp(pow(lum*2.1,.62)+jit,0.,.999);
  float idx=st+floor(t*ln);
  if(lum<.012)idx=st;
  gl_FragColor=vec4(min(col*2.5,vec3(1.)),idx/255.);
}`;

const FS_DRAW = `
precision highp float;
uniform sampler2D uCells;uniform sampler2D uAtlas;
uniform vec2 uSize;uniform vec2 uOrigin;uniform vec2 uCellPx;uniform vec2 uTL;uniform vec2 uRes;uniform float uN;
void main(){
  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  vec2 wp=(uTL+p)/uCellPx;
  vec2 wc=floor(wp);
  vec2 cell=wc-uOrigin;
  vec2 lc=wp-wc;
  vec4 cd=texture2D(uCells,(cell+.5)/uSize);
  float idx=floor(cd.a*255.+.5);
  float gA=texture2D(uAtlas,vec2((idx+lc.x)/uN,lc.y)).r;
  vec3 col=cd.rgb*(gA+.15);
  // grade: shadows lean cool blue, highlights stay warm
  float lum=dot(col,vec3(.3,.59,.11));
  col=mix(col*vec3(.86,.98,1.18),col*vec3(1.04,1.,.94),smoothstep(.05,.45,lum));
  vec2 q=gl_FragCoord.xy/uRes-.5;
  col*=1.-dot(q,q)*.8;
  gl_FragColor=vec4(col,1.);
}`;

function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VSRC)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
  return {p, u};
}
function makeTex() {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

let P1, P2, texWorld, texMat, texAtlas, texCells, fbo;
const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

/* sizes */
let dpr = 1, CW = 6, CH = 10, Wpx = 0, Hpx = 0, SW = 0, SH = 0, FONT = "";
const isTouch = matchMedia("(hover:none) and (pointer:coarse)").matches;
if (isTouch) document.body.classList.add("touch"); // touch layout: big buttons, no hotbar
function buildAtlas() {
  const n = [...ATLAS].length;
  const c = document.createElement("canvas"); c.width = n * CW; c.height = CH;
  const x = c.getContext("2d");
  x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#fff"; x.font = FONT; x.textAlign = "center"; x.textBaseline = "middle";
  [...ATLAS].forEach((ch, i) => x.fillText(ch, i * CW + CW / 2, CH * .54));
  if (!texAtlas) texAtlas = makeTex(); gl.bindTexture(gl.TEXTURE_2D, texAtlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}
/* zoom = text cell size multiplier; smaller cells show more of the world */
const ZOOMS = [.4, .5, .6, .7, .8, .9, 1, 1.15, 1.3];
let zoomI = 1; // 50%
try { const z = ZOOMS.indexOf(+localStorage.getItem("ak.zoomv")); if (z >= 0) zoomI = z; } catch (e) {}
let zoomT = 0;
function setZoom(i) {
  i = clamp(i, 0, ZOOMS.length - 1); if (i === zoomI) return;
  zoomI = i;
  try { localStorage.setItem("ak.zoomv", ZOOMS[i]); } catch (e) {}
  $("zoomLv").textContent = Math.round(ZOOMS[i] * 100) + "%";
  clearTimeout(zoomT); zoomT = setTimeout(resize, 60); // coalesce wheel / pinch bursts
}
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, QUALITY[quality].dpr);
  const small = Math.min(innerWidth, innerHeight) < 600, z = ZOOMS[zoomI];
  const cw = small ? 4 : 5, ch = small ? 7 : 8;
  CW = Math.max(2, Math.round(cw * dpr * z)); CH = Math.max(3, Math.round(ch * dpr * z));
  Wpx = Math.round(innerWidth * dpr); Hpx = Math.round(innerHeight * dpr);
  glc.width = ov.width = Wpx; glc.height = ov.height = Hpx;
  FONT = `600 ${Math.round(CH * .9)}px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace`;
  SW = Math.ceil(Wpx / CW) + 3; SH = Math.ceil(Hpx / CH) + 3;
  buildAtlas(); bakeKnight();
  if (!texCells) texCells = makeTex();
  gl.bindTexture(gl.TEXTURE_2D, texCells);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SW, SH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  if (!fbo) fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texCells, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const mini = document.getElementById("mini");
  mini.width = Math.round(mini.clientWidth * dpr); mini.height = Math.round(mini.clientHeight * dpr);
}

/* ============================== game state ============================== */
const player = {kb: {kills: 0, dmg: 0, hp: 0, mp: 0}, tp: null, dead: 0, hurt: 0, prot: 0, lastHurt: -9, slam: null, shield: false, shieldUp: 0, roll: null, rollCd: 0, running: false, atk: 0, atkCd: 0, recoil: 0, combo: 0, lastAtk: -9, ghostT: 0, lastFr: 0, x: S.x, y: S.y + 16, face: 1, dx: 0, dy: -1, anim: 0, moving: false, hp: 120, mhp: 120, mp: 60, mmp: 60, lv: 1, xp: 0, gold: 0};
const cam = {x: player.x, y: player.y - 3};
const keys = {};
const stick = {id: null, x: 0, y: 0, ox: 0, oy: 0, t0: 0};
let shake = 0, cd = 0, time = 0, region = "", lastNoMana = 0;
const ghosts = [];
const visited = new Set();
const projectiles = [], particles = [], tempLights = [], fireflies = [], wisps = [];
let TLx = 0, TLy = 0, OX = 0, OY = 0;

/* ============================== character classes ============================== */
/* Four classes share the knight's animations but differ in armour colour, aura, base stats and how hard
   their sword and spells hit. Base HP differs per class but never grows during a match. */
const CLASSES = [
  {id: "knight", name: "Knight", icon: "⚔", desc: "Wide sweeping swing. Dash is a Shield Charge that bowls enemies over; blocking refunds mana.",
    hp: 120, mp: 60, speed: 1, melee: 1, spell: 1, regen: 1, dashCd: 1, arc: 1.35, reach: 1.25,
    tint: [.95, 1.02, 1.12], visor: [120, 220, 255], glow: [150, 200, 255], aura: "glint"},
  {id: "berserker", name: "Berserker", icon: "⚒", desc: "Burning brute. Bloodlust: under 40% HP his sword hits harder and heals him.",
    hp: 140, mp: 45, speed: 1.03, melee: 1.3, spell: .75, regen: .85, dashCd: 1, arc: 1, reach: 1,
    tint: [1.3, 1.02, .58], visor: [255, 110, 40], glow: [255, 110, 40], aura: "ember"},
  {id: "sorcerer", name: "Sorcerer", icon: "✦", desc: "Deep mana, huge spells. Dash is Phase Shift: teleport and leave all your mana behind as an exploding rift.",
    hp: 100, mp: 100, speed: .97, melee: .75, spell: 1.3, regen: 1.35, dashCd: 1.1, arc: 1, reach: 1,
    tint: [.78, .58, 1.45], visor: [210, 140, 255], glow: [170, 90, 255], aura: "arcane"},
  {id: "shadow", name: "Shadow", icon: "☾", desc: "Fastest on foot, cheap sprint. Backstab: hits from behind or out of smoke always crit.",
    hp: 105, mp: 60, speed: 1.15, melee: 1.1, spell: .9, regen: 1, dashCd: .6, arc: 1, reach: 1,
    tint: [.4, .5, .5], visor: [90, 255, 170], glow: [60, 255, 160], aura: "smoke"},
];
let savedClass = 0; try { savedClass = clamp(+localStorage.getItem("gk.class") || 0, 0, CLASSES.length - 1); } catch (e) {}
let myClass = savedClass;
const C = () => CLASSES[myClass];
function applyClass(ki) {
  myClass = clamp(ki | 0, 0, CLASSES.length - 1);
  const c = C();
  player.mhp = c.hp + player.kb.hp; player.mmp = c.mp + player.kb.mp + (player.lv - 1) * 10;
  player.hp = player.mhp; player.mp = player.mmp;
  $("status").querySelector(".cls").textContent = c.name;
  KNC = []; KN = knSet(net.color, myClass);
  refreshKitUI();
  try { localStorage.setItem("gk.class", myClass); } catch (e) {}
}
// a class aura: a few particles a second around any knight of that class
function classAura(x, y, ki, alpha, hpk = 1) {
  const cls = CLASSES[ki] || CLASSES[0], a = cls.aura;
  octx.globalCompositeOperation = "lighter";
  glow(x, y - 2.5, cls.glow, 9, (.28 + .08 * Math.sin(time * 3 + x)) * alpha);
  if (ki === 1 && hpk < BLOOD_HP && hpk > 0) glow(x, y - 3, [255, 30, 20], 13, (.45 + .25 * Math.sin(time * 14)) * alpha); // bloodlust
  if (a === "ember") glow(x, y - .3, [255, 80, 20], 7, (.35 + .15 * Math.sin(time * 9 + y)) * alpha); // fire at the feet
  octx.globalCompositeOperation = "source-over";
  if (!a || alpha < .6 || rnd() > (isTouch ? .12 : .35) * QUALITY[quality].fx) return;
  if (a === "glint") { particles.push({x: x + (rnd() - .5) * 3, y, z: 2 + rnd() * 5, vx: 0, vy: 0, vz: 1, g: 0, life: .35, max: .35, ch: "+", c0: [230, 245, 255], c1: [90, 150, 255]}); return; }
  if (a === "ember") { particles.push({x: x + (rnd() - .5) * 3.5, y, z: .5 + rnd() * 2, vx: (rnd() - .5) * 2, vy: 0, vz: 5 + rnd() * 4, g: 0, life: .55, max: .55, ch: rnd() < .5 ? "^" : "'", c0: [255, 220, 120], c1: [200, 40, 10]}); return; }
  if (a === "ember") particles.push({x: x + (rnd() - .5) * 3, y, z: 1 + rnd() * 4, vx: (rnd() - .5) * 2, vy: 0, vz: 4 + rnd() * 3, g: 0, life: .5, max: .5, ch: rnd() < .5 ? "'" : ".", c0: [255, 190, 90], c1: [180, 40, 10]});
  else if (a === "arcane") { const t = rnd() * 6.283; particles.push({x: x + Math.cos(t) * 3, y: y + Math.sin(t) * 1.4, z: 3 + rnd() * 3, vx: -Math.sin(t) * 4, vy: Math.cos(t) * 2, vz: .5, g: 0, life: .6, max: .6, ch: rnd() < .5 ? "*" : "·", c0: [220, 190, 255], c1: [100, 60, 220]}); }
  else if (a === "smoke") particles.push({x: x + (rnd() - .5) * 4, y: y + .3, z: .2, vx: (rnd() - .5) * 3, vy: 0, vz: .8 + rnd(), g: 0, life: .9, max: .9, ch: "~", c0: [110, 120, 125], c1: [20, 24, 28]});
}

/* ============================== knight sprite ============================== */
/* AI-rendered knight frames: 8-direction run, idle, sword combo. Cut out and packed by
   art/build_knight.py into art/knight-atlas.webp + .json, ASCII-fied at runtime */
const {stand: KSTAND, frames: KFR} = KATLAS_META;
const KROWS = 22;                // text rows for a standing knight
let KIMG = null, KN = {}, KNC = [];
// every player wears their own cape colour: sprite sets are baked per palette index, on first use
function bakeKnight() { if (!KIMG) return; KNC = []; KN = knSet(net.color, myClass); }
// Frames bake lazily, the first time each one is drawn, so a new player (new colour) or a zoom change
// costs a few frames' work spread over time instead of one long stall (matters on phones).
function knSet(ci, ki = 0) {
  const key = ci * 16 + ki;
  return KNC[key] || (KNC[key] = new Proxy({}, {get: (o, n) => o[n] || (KFR[n] && KIMG ? (o[n] = bakeFrame(ci, n, ki)) : undefined)}));
}
function bakeFrame(ci, name, ki = 0) {
  const tint = (CLASSES[ki] || CLASSES[0]).tint;
  const fw = Math.max(2, Math.round(CW * .5)), fh = Math.max(3, Math.round(CH * .42));
  const ramp = " .:-=+*#%@";
  const bgk = fw < 4 ? .85 : .62, pal = PALETTE[ci] || PALETTE[0];
  {
    const [sx0, sy0, sw, sh, sax] = KFR[name];
    const rows = Math.max(4, Math.round(sh * KROWS / KSTAND)), cols = Math.max(2, Math.round(rows * sw / sh * fh / fw));
    const c = document.createElement("canvas"); c.width = cols; c.height = rows;
    const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    x.drawImage(KIMG, sx0, sy0, sw, sh, 0, 0, cols, rows);
    const d = x.getImageData(0, 0, cols, rows).data;
    const mk = flip => {
      const k = document.createElement("canvas"); k.width = cols * fw; k.height = rows * fh;
      const g = k.getContext("2d");
      g.font = `600 ${Math.max(4, Math.round(fh * 1.08))}px "IBM Plex Mono", ui-monospace, monospace`;
      g.textAlign = "center"; g.textBaseline = "middle";
      for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
        const i = (r * cols + cc) * 4, al = d[i + 3];
        if (al < 70) continue;
        let R = d[i] * .95, G = d[i + 1] * .94, B = Math.min(255, d[i + 2] * 1.04);
        if (R > 50 && R > G * 1.5 && R > B * 1.3) { if (ci > 0) { const k = R / 170; R = pal[0] * k; G = pal[1] * k; B = pal[2] * k; } } // recolour cape + plume
        else { R = Math.min(255, R * tint[0]); G = Math.min(255, G * tint[1]); B = Math.min(255, B * tint[2]); } // class armour tint
        const lum = (.3 * R + .59 * G + .11 * B) / 255;
        const X = (flip ? cols - 1 - cc : cc) * fw, Y = r * fh;
        g.globalAlpha = Math.min(1, al / 200);
        g.fillStyle = `rgb(${R * bgk | 0},${G * bgk | 0},${B * bgk * 1.05 | 0})`; g.fillRect(X, Y, fw, fh);
        const ch = ramp[Math.min(9, 1 + Math.floor(Math.pow(lum, .85) * 9.5))];
        g.fillStyle = `rgb(${Math.min(255, R * 1.6 + 10) | 0},${Math.min(255, G * 1.6 + 10) | 0},${Math.min(255, B * 1.6 + 14) | 0})`;
        g.fillText(ch, X + fw / 2, Y + fh / 2 + .5);
      }
      return k;
    };
    return {R: mk(false), L: mk(true), w: cols * fw, h: rows * fh, ax: sax / sw * cols * fw};
  }
}

/* ============================== lights ============================== */
const AMB = [.6, .66, .86];
function flick(ph, k) { return 1 + (Math.sin(time * 9 + ph) * .5 + Math.sin(time * 23 + ph * 2) * .3 + Math.sin(time * 3.1 + ph) * .4) * k; }
let frameLights = [];
function gatherLights() {
  const L = [];
  L.push({x: player.x, y: player.y, r: 32, i: .75 * flick(4, .04), c: [1, .74, .45], pri: 100});
  for (const l of staticLights) {
    const d = gdist(l.x, l.y, cam.x, cam.y);
    if (d > 260) continue;
    const i = l.kind === "fire" ? l.i * flick(l.ph, .12) : l.i * (.8 + .25 * Math.sin(time * 1.7 + l.ph));
    L.push({x: l.x, y: l.y, r: l.r, i, c: l.c, pri: -d});
  }
  for (const p of projectiles) L.push({x: p.x, y: p.y, r: 15 * (1 + p.pow), i: (1.5 + p.pow) * flick(p.ph, .15), c: [1, .55, .2], pri: 50});
  if (charge.on && charge.t > .08) L.push({x: player.x, y: player.y, r: 10 + chargePower() * 14, i: .8 + chargePower(), c: colOf(charge.kind).map(v => v / 255), pri: 55});
  for (const s of sparks) L.push({x: s.x, y: s.y, r: 16, i: 1.8, c: [.6, .78, 1], pri: 52});
  for (const b of bolts) if (b.t >= 0) L.push({x: b.x, y: b.y, r: 70, i: 5 * boltBright(b.t), c: [.7, .82, 1], pri: 90});
  for (const r of residues) { if (r.kind === "crater" || r.kind === "smoke") continue; const k = r.life / r.max; L.push({x: r.x, y: r.y, r: r.r * 3, i: (r.kind === "fire" ? 1.1 * flick(r.x, .2) : .7 * (.7 + .3 * Math.sin(time * 40))) * k, c: r.kind === "fire" ? [1, .5, .15] : [.5, .7, 1], pri: 45}); }
  for (const t of tempLights) L.push({x: t.x, y: t.y, r: t.r, i: t.i * (t.life / t.max), c: t.c, pri: 60});
  for (const w of wisps) { const d = gdist(w.x, w.y, cam.x, cam.y); if (d < 220) L.push({x: w.x, y: w.y, r: 11, i: .7, c: [.55, 1, .7], pri: -d}); }
  L.sort((a, b) => b.pri - a.pri);
  frameLights = L.slice(0, MAX_LIGHTS);
  return frameLights;
}
function lightAt(x, y) {
  let r = AMB[0], g = AMB[1], b = AMB[2];
  for (const l of frameLights) {
    const d = gdist(x, y, l.x, l.y), a = clamp(1 - d / l.r, 0, 1), k = l.i * a * a;
    r += l.c[0] * k; g += l.c[1] * k; b += l.c[2] * k;
  }
  return [r, g, b];
}

/* ============================== HUD ============================== */
const $ = id => document.getElementById(id);
const logLines = [];
let logTab = "General";
function addLog(text, ch = "General", cls = "") {
  logLines.push({text, ch, cls}); if (logLines.length > 60) logLines.shift(); renderLog();
}
function renderLog() {
  const box = $("lines"); box.textContent = "";
  const rows = logLines.filter(l => logTab === "General" || l.ch === logTab).slice(-7);
  for (const l of rows) { const d = document.createElement("div"); d.textContent = l.text; if (l.cls) d.className = l.cls; box.appendChild(d); }
}
document.querySelectorAll("#log .tabs button[data-ch]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("#log .tabs button[data-ch]").forEach(x => x.classList.toggle("on", x === b));
  logTab = b.dataset.ch; renderLog();
}));
// chat collapses to one small button; starts collapsed on short (landscape phone) screens
function setLogOpen(open) {
  $("log").classList.toggle("collapsed", !open);
  const t = $("logToggle"); t.textContent = open ? "–" : "Chat +"; t.setAttribute("aria-expanded", open);
  t.setAttribute("aria-label", open ? "Collapse chat" : "Expand chat");
  try { localStorage.setItem("ak.logOpen", open ? "1" : "0"); } catch (e) {}
}
{
  let saved = null; try { saved = localStorage.getItem("ak.logOpen"); } catch (e) {}
  setLogOpen(saved !== null ? saved === "1" : innerHeight > 500 && innerWidth > 640);
  $("logToggle").addEventListener("click", () => setLogOpen($("log").classList.contains("collapsed")));
}
const hotbar = $("hotbar");
const SLOTS = [
  {g: "/", name: "Slash", cost: "combo: Sweep, Cleave, Lunge, Whirlwind · hold Space for Ground Slam", act: () => slashDir(player.dx, player.dy)},
  {g: "*", name: "Spell 1", cost: "F", act: () => castSlot("s1", 0, player.dx, player.dy)},
  {g: "ϟ", name: "Spell 2", cost: "G", act: () => castSlot("s2", 0, player.dx, player.dy)},
  {g: "†", name: "Spell 3", cost: "R", act: () => castSlot("s3", 0, player.dx, player.dy)},
  {g: "◊", name: "Shield", cost: "hold Q", act: () => { setShield(true); setTimeout(() => setShield(false), 900); }},
  {g: "»", name: "Dash", cost: "C or Ctrl · hold to keep sprinting (drains mana)", act: () => startRoll()},
  {}, {}];
SLOTS.forEach((s, i) => {
  const b = document.createElement("button"); b.className = "slot" + (s.act ? " ready" : "") + (i === 0 ? " steel" : ""); b.id = "slot" + (i + 1);
  b.innerHTML = `<span class="k">${i + 1}</span>${s.g || "·"}<span class="cd"></span>`;
  b.title = s.name ? `${s.name} · ${s.cost}` : "Empty slot";
  if (s.act) b.addEventListener("click", e => { e.stopPropagation(); s.act(); });
  else b.tabIndex = -1;
  hotbar.appendChild(b);
});
const slot1cd = document.querySelector("#slot2 .cd"), slot0cd = document.querySelector("#slot1 .cd");
const slotCds = [...document.querySelectorAll("#hotbar .cd")];
let bannerT = 0;
function banner(title, sub) {
  const b = $("banner"); b.innerHTML = ""; b.append(title);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; b.appendChild(s); }
  b.classList.add("show"); bannerT = 3.2;
}
let hudCache = "";
function updateHUD() {
  const key = `${Math.ceil(player.hp)}|${player.mp | 0}|${player.lv}|${player.xp}|${player.gold}|${player.kb.kills}|${player.mhp}`;
  if (key !== hudCache) {
    hudCache = key;
    $("hpf").style.width = (player.hp / player.mhp * 100) + "%"; $("hpt").textContent = `${Math.ceil(player.hp)}/${player.mhp}`;
    $("mpf").style.width = (player.mp / player.mmp * 100) + "%"; $("mpt").textContent = `${player.mp | 0}/${player.mmp}`;
    $("lv").textContent = player.kb.kills ? `LV ${player.lv} · ⚔ ${player.kb.kills} · +${Math.round(player.kb.dmg * 100)}% dmg` : `LV ${player.lv} · ${player.gold}g`;
    $("xpf").style.width = (player.xp / xpNeed() * 100) + "%";
  }
  kit().forEach((sp, i) => { slotCds[i + 1].style.height = Math.min(100, spellCd[SLOT_KEYS[i]] / sp.cd * 100) + "%"; });
  slot0cd.style.height = (player.atkCd > 0 ? player.atkCd / .38 * 100 : 0) + "%";
  slotCds[5].style.height = player.rollCd / (myClass === 2 ? PHASE_CD : ROLL_CD + ROLL_TIME) * 100 + "%";
  $("coords").textContent = `X: ${Math.round(player.x - S.x)} Y: ${Math.round((S.y - player.y) * VS)}`;
}
const xpNeed = () => 60 + player.lv * 40;
function gainXP(n) {
  player.xp += n;
  while (player.xp >= xpNeed()) {
    player.xp -= xpNeed(); player.lv++; player.hp = player.mhp; player.mmp += 10; player.mp = player.mmp; // max HP never grows: fights stay winnable
    addLog(`Level up! You are now level ${player.lv}.`, "System", "gold");
    for (let k = 0; k < 40; k++) { const a = rnd() * 6.28, s = 6 + rnd() * 10; particles.push({x: player.x, y: player.y, z: 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 6 + rnd() * 8, g: -14, life: 1, max: 1, ch: "+", c0: [255, 230, 140], c1: [216, 150, 44]}); }
  }
}

/* minimap */
let miniSrc;
function buildMini() {
  miniSrc = document.createElement("canvas"); miniSrc.width = W; miniSrc.height = H;
  const x = miniSrc.getContext("2d"), id = x.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const m = MAT[i], k = m === 1 ? 2.6 : m === 2 ? 2.2 : 1.9;
    id.data[i*4] = COL[i*4] * k; id.data[i*4+1] = COL[i*4+1] * k; id.data[i*4+2] = COL[i*4+2] * k; id.data[i*4+3] = 255;
  }
  x.putImageData(id, 0, 0);
}
function drawMini() {
  const c = $("mini"), x = c.getContext("2d"), w = c.width, h = c.height, w0 = w;
  const sw = 220, sh = sw * h / w / VS;
  const sx = clamp(player.x - sw / 2, 0, W - sw), sy = clamp(player.y - sh / 2, 0, H - sh);
  x.imageSmoothingEnabled = false;
  x.drawImage(miniSrc, sx, sy, sw, sh, 0, 0, w, h);
  const px = (player.x - sx) / sw * w, py = (player.y - sy) / sh * h;
  for (const p of livePeers()) { // other knights: team colour in TDM, their cape colour otherwise; enemies larger
    if (p.dead || (p.stealth && isEnemy(p.id))) continue;
    const qx = (p.x - sx) / sw * w, qy = (p.y - sy) / sh * h, z = (isEnemy(p.id) ? 3 : 2) * dpr;
    x.fillStyle = net.mode === "tdm" ? TEAM_COL[teamOf(p.id)] : `rgb(${PALETTE[colorOf(p.id)].map(v => Math.min(255, v + 60)).join(",")})`;
    x.fillRect(qx - z / 2, qy - z / 2, z, z);
  }
  x.fillStyle = "#b58cff"; // waystones
  for (const w of WAYSTONES) { const qx = (w.x - sx) / sw * w0, qy = (w.y - sy) / sh * h; if (qx > 0 && qy > 0 && qx < w0 && qy < h) { x.beginPath(); x.moveTo(qx, qy - 3 * dpr); x.lineTo(qx + 2.5 * dpr, qy); x.lineTo(qx, qy + 3 * dpr); x.lineTo(qx - 2.5 * dpr, qy); x.fill(); } }
  x.fillStyle = "#ffffff"; x.fillRect(px - 2.5 * dpr, py - 2.5 * dpr, 5 * dpr, 5 * dpr);
  x.fillStyle = "#ff4b3e"; x.fillRect(px - 2 * dpr, py - 2 * dpr, 4 * dpr, 4 * dpr);
  x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = dpr;
  const vw = Wpx / CW / sw * w, vh = Hpx / CH / sh * h;
  x.strokeRect((cam.x - sx) / sw * w - vw / 2, (cam.y - sy) / sh * h - vh / 2, vw, vh);
}

/* ============================== input ============================== */
const CHARGE_KEYS = {KeyF: "s1", KeyK: "s1", Digit2: "s1", KeyG: "s2", Digit3: "s2", KeyR: "s3", Digit4: "s3", Space: "slam", KeyJ: "slam", Digit1: "slam"};
const KEYMAP = {ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r", ShiftLeft: "run", ShiftRight: "run"};
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || !$("lobby").hidden) return; // typing a name, or still in the lobby
  if (e.code === "Tab") { e.preventDefault(); if (net.api) { $("board").hidden = false; renderBoard(); } return; }
  if (e.code === "KeyE" && !e.repeat) { $("travel").hidden ? openTravel() : ($("travel").hidden = true); return; }
  if (e.code === "Escape") { $("travel").hidden = true; return; }
  if (e.code === "KeyM" && !e.repeat) { toggleMute(); return; }
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "KeyJ" || e.code === "Digit1") { slashDir(player.dx, player.dy); startCharge("key", "slam"); e.preventDefault(); }
  if (e.code === "KeyF" || e.code === "KeyK" || e.code === "Digit2") { startCharge("key", "s1"); e.preventDefault(); }
  if (e.code === "KeyG" || e.code === "Digit3") startCharge("key", "s2");
  if (e.code === "KeyR" || e.code === "Digit4") startCharge("key", "s3");
  if (e.code === "KeyQ" || e.code === "Digit5") setShield(true);
  if (DASH_KEYS.has(e.code)) { dashHeld = true; startRoll(); e.preventDefault(); }
  if (e.code === "Minus" || e.code === "NumpadSubtract") setZoom(zoomI - 1);
  if (e.code === "Equal" || e.code === "NumpadAdd") setZoom(zoomI + 1);
});
addEventListener("wheel", e => { if (e.target.closest && e.target.closest("#log")) return; e.preventDefault(); setZoom(zoomI + (e.deltaY > 0 ? -1 : 1)); }, {passive: false});
$("zoomOut").addEventListener("click", () => setZoom(zoomI - 1));
$("zoomIn").addEventListener("click", () => setZoom(zoomI + 1));
$("zoomLv").textContent = Math.round(ZOOMS[zoomI] * 100) + "%";
addEventListener("keyup", e => {
  if (e.code === "Tab") $("board").hidden = true;
  if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
  if (charge.on && charge.src === "key" && CHARGE_KEYS[e.code] === charge.kind) releaseCharge(player.dx, player.dy);
  if (e.code === "KeyQ" || e.code === "Digit5") setShield(false);
  if (DASH_KEYS.has(e.code)) dashHeld = false;
});
addEventListener("blur", () => { for (const k in keys) keys[k] = false; charge.on = false; setShield(false); dashHeld = false; });
const touch = $("touch"), stickEl = $("stick"), knob = $("knob");
// two fingers on the world = pinch zoom (the move stick is dropped while pinching)
const pinchPts = new Map();
let pinchD = 0, pinching = false;
// stop the browser's own page zoom (double-tap / pinch, incl. iOS Safari, which ignores user-scalable=no)
for (const ev of ["gesturestart", "gesturechange", "gestureend", "dblclick"]) document.addEventListener(ev, e => e.preventDefault(), {passive: false});
document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, {passive: false});
const pinchDist = () => { const [a, b] = [...pinchPts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
// mouse: hold left button to walk toward the cursor, a quick click slashes, right-click casts
const mouseWalk = {on: false, id: null, cx: 0, cy: 0, t0: 0}, mouseXY = {x: 0, y: 0};
touch.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse") {
    mouseXY.x = e.clientX; mouseXY.y = e.clientY;
    if (e.button === 2) { startCharge("mouse"); try { touch.setPointerCapture(e.pointerId); } catch (err) {} return; }
    if (e.button !== 0) return;
    Object.assign(mouseWalk, {on: true, id: e.pointerId, cx: e.clientX, cy: e.clientY, t0: performance.now()});
    try { touch.setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }
  pinchPts.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (pinchPts.size === 2) {
    // only a deliberate pinch zooms: both fingers land together, before any movement. A second finger
    // tapping while you're already moving is ignored instead of zooming by accident.
    const fresh = performance.now() - stick.t0 < 220 && Math.hypot(stick.x, stick.y) < .25;
    if (!fresh) { pinchPts.delete(e.pointerId); return; }
    touch.setPointerCapture(e.pointerId); pinching = true;
    stick.id = null; stick.x = stick.y = 0; stickEl.hidden = true; pinchD = pinchDist(); return;
  }
  if (stick.id !== null || pinchPts.size > 2) return;
  stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0; stick.t0 = performance.now();
  stickEl.style.left = e.clientX + "px"; stickEl.style.top = e.clientY + "px"; knob.style.transform = ""; stickEl.hidden = false;
  touch.setPointerCapture(e.pointerId);
});
touch.addEventListener("pointermove", e => {
  if (e.pointerType === "mouse") { mouseXY.x = e.clientX; mouseXY.y = e.clientY; mouseXY.seen = true; }
  if (e.pointerId === mouseWalk.id) { mouseWalk.cx = e.clientX; mouseWalk.cy = e.clientY; return; }
  if (pinchPts.has(e.pointerId)) pinchPts.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (pinching && pinchPts.size === 2) {
    const d = pinchDist();
    if (d > pinchD * 1.3) { setZoom(zoomI + 1); pinchD = d; } else if (d < pinchD / 1.3) { setZoom(zoomI - 1); pinchD = d; }
    return;
  }
  if (e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const d = Math.hypot(dx, dy), R0 = 46;
  if (d > R0) { dx *= R0 / d; dy *= R0 / d; }
  stick.x = dx / R0; stick.y = dy / R0; knob.style.transform = `translate(${dx}px,${dy}px)`;
});
const endStick = e => {
  if (e.pointerType === "mouse" && e.button === 2 && charge.src === "mouse") {
    const d = aimAt(e.clientX, e.clientY);
    if (e.type === "pointerup") releaseCharge(d[0], d[1]); else charge.on = false;
    return;
  }
  if (e.pointerId === mouseWalk.id) {
    if (e.type === "pointerup" && performance.now() - mouseWalk.t0 < 200) { const d = aimAt(e.clientX, e.clientY); slashDir(d[0], d[1]); }
    mouseWalk.on = false; mouseWalk.id = null; return;
  }
  pinchPts.delete(e.pointerId); if (pinchPts.size < 2) pinching = false; if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; stickEl.hidden = true; };
touch.addEventListener("pointerup", endStick); touch.addEventListener("pointercancel", endStick);
touch.addEventListener("contextmenu", e => e.preventDefault());
const castBtn = $("castBtn");
const slashBtn = $("slashBtn");
// touch: press = act, hold = charge, lift = release the charge (same rules as the keyboard)
function holdBtn(b, kind, onDown) {
  b.hidden = false;
  b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch (err) {} if (onDown) onDown(); startCharge("btn", kind); });
  b.addEventListener("pointerup", e => { e.preventDefault(); if (charge.on && charge.src === "btn" && charge.kind === kind) releaseCharge(player.dx, player.dy); });
  b.addEventListener("pointercancel", () => { if (charge.src === "btn" && charge.kind === kind) charge.on = false; });
}
if (isTouch) holdBtn(slashBtn, "slam", () => slashDir(player.dx, player.dy));
if (isTouch) {
  castBtn.hidden = false;
  castBtn.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); try { castBtn.setPointerCapture(e.pointerId); } catch (err) {} startCharge("btn"); });
  castBtn.addEventListener("pointerup", e => { e.preventDefault(); if (charge.src === "btn") releaseCharge(player.dx, player.dy); });
  castBtn.addEventListener("pointercancel", () => { if (charge.src === "btn") charge.on = false; });
  const tap = (id, fn) => { const b = $(id); b.hidden = false; b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); fn(); }); return b; };
  holdBtn($("boltBtn"), "s2"); holdBtn($("bladeBtn"), "s3");
  const rb = tap("rollBtn", () => { dashHeld = true; startRoll(); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) rb.addEventListener(ev, () => { dashHeld = false; });
  const sb = tap("shieldBtn", () => setShield(true));
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) sb.addEventListener(ev, () => setShield(false));
}

/* ============================== actions ============================== */
function blockedAt(x, y) {
  const yy = Math.floor(y - .2);
  return BLK[yy * W + Math.floor(x - .7)] || BLK[yy * W + Math.floor(x + .7)] || BLK[Math.floor(y - .9) * W + Math.floor(x)];
}
function aimAt(cx, cy) {
  const wx = (TLx + cx * dpr) / CW, wy = (TLy + cy * dpr) / CH;
  return [wx - player.x, (wy + 4 - player.y) * VS];
}
function slashDir(dx, dy) {
  const l = Math.hypot(dx, dy); if (l < .001 || player.atkCd > 0 || player.roll || player.dead) return;
  dx /= l; dy /= l;
  player.combo = time - player.lastAtk < .7 ? (player.combo + 1) % ATK_COMBO.length : 0; player.lastAtk = time;
  const mv = MELEE[player.combo];
  player.atk = .26; player.atkCd = mv.cd; player.dx = dx; player.dy = dy;
  if (Math.abs(dx) > .2) player.face = dx > 0 ? 1 : -1;
  const x0 = player.x, y0 = player.y;
  // step in (the lunge drives right through, stopping at walls)
  for (let s = 0, n = Math.ceil(mv.step / .5); s < n; s++) {
    const st = mv.step / n, tx = player.x + dx * st, ty = player.y + dy * st / VS;
    if (!blockedAt(tx, player.y)) player.x = tx;
    if (!blockedAt(player.x, ty)) player.y = ty;
  }
  const base = Math.atan2(dy, dx), dirS = player.face;
  mv.fx(base, dirS, x0, y0, dx, dy);
  netFx({k: "sl", c: player.combo, dx, dy}); sfx.slash(player.combo);
  // hit test: an arc in front (sweep, cleave), all around (whirlwind) or the lane he lunged through
  let landed = false;
  for (const d of targets()) {
    if (d.dead) continue;
    const vx = d.x - player.x, vy = (d.y - player.y) * VS, dist = Math.hypot(vx, vy);
    let hit;
    if (mv.lane) { // distance from the dummy to the lunge segment (start -> a little past the end)
      const ax = x0, ay = y0 * VS, bx = player.x + dx * mv.reach, by = player.y * VS + dy * mv.reach, px = d.x, py = d.y * VS;
      const t = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1), 0, 1);
      hit = Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)) < mv.width;
    } else hit = dist < mv.reach * C().reach && (mv.arc >= Math.PI || Math.acos(clamp((vx * dx + vy * dy) / (dist || 1), -1, 1)) < Math.min(Math.PI, mv.arc * C().arc));
    if (!hit) continue;
    landed = true; damage(d, mv.dmg, "phys"); d.jit = .3; meleeMana(d);
    const away = Math.atan2(vy, vx);
    for (let k = 0; k < 14; k++) { const a = away + (rnd() - .5) * 1.6, s = 14 + rnd() * 20; particles.push({x: d.x, y: d.y, z: 3 + rnd() * 3, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: (rnd() - .5) * 8, g: -10, life: .3 + rnd() * .3, max: .6, ch: ["/", "\\", "-", "*"][k % 4], c0: [255, 255, 240], c1: [140, 190, 255]}); }
  }
  if (landed) {
    hitstop = Math.max(hitstop, mv.stop); shake = Math.max(shake, mv.shake);
    rings.push({x: player.x + dx * 3, y: player.y + dy * 3 / VS, r: 1, r1: mv.ring, t: 0, life: .22, c: [220, 235, 255]});
  }
  const fx = player.x + dx * 5, fy = player.y + dy * 5 / VS;
  tempLights.push({x: fx, y: fy, r: 14, i: 1.3, c: [.55, .8, 1], life: .22, max: .22});
  shake = Math.max(shake, .12);
}
// one swoosh of trail glyphs along an arc around the knight
// Mana sources: base regen, moving (see update), melee hits (here), kills (killBonus) and waystone light.
const MELEE_MP_KNIGHT = 8, MELEE_MP_DUMMY = 3, WAYSTONE_MP = 10;
function meleeMana(target) { player.mp = Math.min(player.mmp, player.mp + (target.buf ? MELEE_MP_KNIGHT : MELEE_MP_DUMMY)); }
function swoosh(base, from, span, r, z, delay, o = player) {
  for (let k = 0; k < 22; k++) {
    const u = k / 21, a = base + from + u * span, rr = r + Math.sin(u * Math.PI) * 1.8;
    const px = o.x + Math.cos(a) * rr, py = o.y + Math.sin(a) * rr / VS, sgn = Math.sign(span);
    const tx2 = -Math.sin(a) * sgn, ty2 = Math.cos(a) * sgn / VS * 1.6;
    const ang = ((Math.atan2(ty2, tx2) % Math.PI) + Math.PI) % Math.PI;
    const ch = ang < .39 || ang > 2.75 ? "-" : ang < 1.18 ? "\\" : ang < 1.96 ? "|" : "/";
    for (let j = 0; j < 2; j++) particles.push({x: px, y: py, z: z + j * .9, vx: tx2 * 6, vy: ty2 * 6, vz: 0, g: 0, delay: u * delay, life: .2, max: .2, ch, c0: [250, 252, 255], c1: [90, 170, 255]});
  }
}
/* The four-step combo (tap within .7 s to chain). Each is its own move:
   Sweep: wide horizontal arc. Cleave: overhead chop, narrow but long, cracks the ground ahead.
   Lunge: dashes forward through a lane, hitting everything in it. Whirlwind: full spin, hits all around. */
const MELEE = [
  {name: "Sweep", dmg: 55, reach: 7.5, arc: 1.35, step: 2.4, cd: .32, stop: .07, shake: .24, ring: 6,
    fx: (base, s) => swoosh(base, -1.25 * s * C().arc, 2.5 * s * C().arc, 6 * C().reach, 3.6, .09)},
  {name: "Cleave", dmg: 78, reach: 10, arc: .55, step: 1.8, cd: .38, stop: .09, shake: .32, ring: 6,
    fx: (base, s, x0, y0, dx, dy) => {
      for (let k = 0; k < 16; k++) { const u = k / 15, r = 2 + u * 8; // a vertical blade line slamming down ahead
        particles.push({x: player.x + dx * r, y: player.y + dy * r / VS, z: 7 - u * 6.5, vx: 0, vy: 0, vz: -30, g: 0, delay: u * .05, life: .18, max: .18, ch: "|", c0: [255, 255, 255], c1: [110, 170, 255]}); }
      for (let k = 0; k < 12; k++) { const r = 4 + k * .6; particles.push({x: player.x + dx * r + (rnd() - .5), y: player.y + dy * r / VS, z: .2, vx: (rnd() - .5) * 6, vy: 0, vz: 3 + rnd() * 5, g: -20, delay: .05, life: .5, max: .5, ch: [".", ",", "'"][k % 3], c0: [190, 170, 130], c1: [60, 50, 40]}); }
    }},
  {name: "Lunge", dmg: 88, reach: 3, lane: true, width: 3.2, step: 8, cd: .42, stop: .09, shake: .3, ring: 7,
    fx: (base, s, x0, y0, dx, dy) => { // a streak along the dash
      const L = Math.hypot(player.x - x0, (player.y - y0) * VS) + 3;
      for (let k = 0; k < 24; k++) { const r = k / 23 * L; particles.push({x: x0 + dx * r, y: y0 + dy * r / VS, z: 3.4 + (rnd() - .5), vx: dx * 20, vy: dy * 20 / VS, vz: 0, g: 0, delay: k / 23 * .06, life: .22, max: .22, ch: Math.abs(dx) > Math.abs(dy) ? "=" : "‖", c0: [255, 255, 255], c1: [110, 170, 255]}); }
      ghosts.push({x: x0, y: y0, ...knightPose(), life: .22});
    }},
  {name: "Whirlwind", dmg: 110, reach: 8.5, arc: Math.PI, step: 0, cd: .55, stop: .12, shake: .42, ring: 10,
    fx: base => { swoosh(base, 0, 6.283, 6.5, 3.4, .14); swoosh(base, Math.PI, 6.283, 5, 2.2, .14); }},
];
/* Charging (shared by every power): tap = the basic cast. Hold past CHARGE_MIN and the power keeps drawing
   mana for CHARGE_FULL[kind] s until it holds ALL of your MP; it scales with the mana poured in and fires on
   release. Fire: orb -> fireball. Bolt: more damage, more chains, extra strikes. Blades: more, bigger swords.
   Slam (hold the slash key): free, scales with hold time, a leaping ground slam. */
const ORB_COST = 12, CHARGE_MIN = .25, FIRE_DMG_PER_MP = 4.5;
const charge = {on: false, t: 0, src: "", kind: "s1"};
function noMana() { if (time - lastNoMana > 1.5) { addLog("Not enough mana.", "System", "warn"); lastNoMana = time; } }
// a slot's base cost; the legacy names are what the shared fire/lightning/blade casts charge themselves
const baseCost = kind => kind === "slam" ? 0 : spellOf(kind) ? spellOf(kind).cost : ({fire: ORB_COST, bolt: BOLT_COST, blades: BLADE_COST})[kind] || 0;
function startCharge(src, kind = "s1") {
  if (charge.on || player.roll || player.slam || player.dead) return;
  const ready = kind === "slam" ? slamCd <= 0 : slotReady(kind);
  if (!ready) return;
  if (player.mp < baseCost(kind)) { noMana(); return; }
  charge.on = true; charge.t = 0; charge.src = src; charge.kind = kind;
}
// nearest live target within maxAng (radians) of a direction (dx,dy in ground units) and within range
function seekTarget(x, y, dx, dy, maxAng, range) {
  let best = null, bs = Infinity;
  for (const d of targets()) {
    if (d.stealth) continue; // homing can't find a knight hidden in smoke
    const vx = d.x - x, vy = (d.y - y) * VS, l = Math.hypot(vx, vy);
    if (l > range || l < .5) continue;
    const ang = Math.acos(clamp((vx * dx + vy * dy) / l, -1, 1));
    if (ang < maxAng && ang * 20 + l < bs) { bs = ang * 20 + l; best = d; }
  }
  return best;
}
const HOMING_TURN = 1.5; // rad/s a fireball can bend toward its target: enough to correct, not enough to catch a dodger
function chargePower() { const sp = spellOf(charge.kind); return clamp((charge.t - CHARGE_MIN) / (sp ? sp.full : 1), 0, 1); }
const fireRadius = pow => 2.6 + pow * 5; // a charged fireball is physically bigger, so it's much harder to miss with
const chargeCost = (pow, kind = "fire") => { const b = baseCost(kind); return b ? Math.round(b + Math.max(0, player.mp - b) * pow) : 0; };
function releaseCharge(dx, dy) {
  if (!charge.on) return;
  const pow = chargePower(), held = charge.t; charge.on = false;
  if (charge.kind === "slam") { if (held >= CHARGE_MIN) doSlam(pow); } // a tap of the slash key already swung the sword
  else castSlot(charge.kind, pow, dx, dy);
}
function castDir(dx, dy, pow = 0) {
  const l = Math.hypot(dx, dy); if (l < .001) return;
  dx /= l; dy /= l;
  if (cd > 0) return;
  const cost = chargeCost(pow, "fire");
  if (player.mp < cost) { noMana(); return; }
  player.mp -= cost; cd = .35; player.recoil = .2 + pow * .15;
  if (Math.abs(dx) > .2) player.face = dx > 0 ? 1 : -1;
  player.dx = dx; player.dy = dy;
  const sp = 92 - pow * 18; // a charged fireball is heavier, but carries further
  // aim assist: nudge the launch toward a target that's already close to the line of fire
  const aimT = seekTarget(player.x, player.y, dx, dy, .3, 70);
  if (aimT) { const ax = aimT.x - player.x, ay = (aimT.y - player.y) * VS, al = Math.hypot(ax, ay); dx = dx * .4 + ax / al * .6; dy = dy * .4 + ay / al * .6; const nl = Math.hypot(dx, dy); dx /= nl; dy /= nl; }
  const proj = {x: player.x + dx * 2.5, y: player.y + dy * 1.2 / VS, z: 3.2, vx: dx * sp, vy: dy * sp / VS, life: .9 + pow * .4, ph: rnd() * 6, pow, dmg: cost * FIRE_DMG_PER_MP};
  projectiles.push({...proj, own: true, owner: selfId}); netFx({k: "fire", p: proj}); sfx.fireCast(pow);
  for (let k = 0; k < 14 + pow * 40; k++) particles.push({x: player.x + dx * 2, y: player.y, z: 3, vx: dx * (10 + pow * 14) + (rnd() - .5) * 10, vy: (dy * (10 + pow * 14) + (rnd() - .5) * 10) / VS, vz: (rnd() - .5) * 5, g: 0, life: .3 + pow * .2, max: .5, ch: "*", c0: [255, 230, 160], c1: [255, 110, 30]});
  if (pow > 0) { shake = Math.max(shake, .15 + pow * .3); tempLights.push({x: player.x, y: player.y, r: 26 + pow * 20, i: 1.6 + pow * 2, c: [1, .55, .2], life: .25, max: .25}); }
}
function explode(x, y, pow = 0, dmg = ORB_COST * FIRE_DMG_PER_MP, own = true) {
  sfx.explode(clamp(dmg / 270, .2, 1.6), ...heard(x, y));
  // size everything off the damage carried, so a full-mana fireball reads as a catastrophe
  const big = clamp(dmg / 270, .2, 2.2);
  tempLights.push({x, y, r: 34 + big * 40, i: 3 + big * 3, c: [1, .55, .18], life: .6 + big * .5, max: .6 + big * .5});
  shakeAt(x, y, .4 + big * .6); if (own) hitstop = Math.max(hitstop, .03 + big * .07);
  if (big > .5 && gdist(x, y, player.x, player.y) < 60) screenFlashAdd(.08 + big * .12, "#ffb070");
  rings.push({x, y, r: 2, r1: 8 + big * 16, t: 0, life: .35 + big * .2, c: [255, 160, 70]});
  if (big > .6) rings.push({x, y, r: 1, r1: 5 + big * 10, t: -.06, life: .3 + big * .2, c: [255, 230, 170]});
  for (let k = 0; k < 20 + big * 30; k++) { // chunks of earth thrown up
    const a = rnd() * 6.283, s = 6 + rnd() * 14 * (1 + big);
    particles.push({x, y, z: .5, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 8 + rnd() * 14 * (.6 + big * .5), g: -32, life: .7 + rnd() * .6, max: 1.3, ch: [".", ",", ":", ";"][k % 4], c0: [150, 120, 90], c1: [60, 46, 34]});
  }
  const CH_ = ["*", "+", "x", "'", "."];
  for (let k = 0; k < 60 * (1 + big * 1.4); k++) {
    const a = rnd() * 6.283, s = (10 + rnd() * 30) * (1 + big * .6);
    particles.push({x, y, z: 2.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: rnd() * 10, g: -18, life: .35 + rnd() * .45, max: .8, ch: CH_[k % 5], c0: [255, 236, 170], c1: [190, 50, 20]});
  }
  for (let k = 0; k < 14; k++) particles.push({x: x + (rnd() - .5) * 6, y: y + (rnd() - .5) * 3, z: 1, vx: 0, vy: 0, vz: 3 + rnd() * 4, g: 0, life: 1 + rnd(), max: 2, ch: "~", c0: [120, 110, 105], c1: [30, 30, 34]});
  const R = 6 + big * 6;
  if (own) hitDummies(x, y, R, (d, dist) => damage(d, dmg * (1 - .5 * dist / R), "fire"));
  addResidue("fire", x, y, 3 + big * 4, own);
}

/* ============================== combat: targets, damage, lightning, residue ============================== */
// Practice dummies below the stone circle: they take hits, flash, burn, get shocked, break and rebuild.
const dummies = [], floaters = [], bolts = [], residues = [], rings = [], sparks = [];
let hitstop = 0, skyFlash = 0, screenFlash = 0, boltCd = 0;
const fxFlash = {a: 0, c: "#ffffff"}; // full-screen flash from big impacts
function screenFlashAdd(a, c) { if (a >= fxFlash.a) { fxFlash.a = a; fxFlash.c = c; } }
const BOLT_COST = 18, BOLT_CD = .9, BOLT_RANGE = 30, BOLT_DMG_PER_MP = 2.2, ASPECT = 1.6; // ASPECT: cell height / width, for square-looking jags
function initDummies() {
  for (const [ox, oy] of [[-14, 25], [0, 29], [14, 25]]) {
    const x = S.x + ox; let y = S.y + oy;
    for (let k = 0; k < 20 && blockedAt(x, y); k++) y += 1;
    dummies.push({x, y, hp: 260, mhp: 260, flash: 0, jit: 0, burn: 0, burnT: 0, shock: 0, dead: 0});
  }
}
function hitDummies(x, y, r, fn) { for (const d of targets()) { const dist = gdist(d.x, d.y, x, y); if (dist < r) fn(d, dist); } }
const DMG_COL = {holy: [255, 226, 140], arcane: [210, 160, 255], poison: [150, 255, 140], phys: [236, 240, 248], blade: [190, 220, 255], fire: [255, 150, 60], burn: [255, 196, 96], shock: [150, 212, 255]};
function damage(d, amt, kind, shove) {
  if (d.dead) return;
  amt *= (1 + player.kb.dmg) * (kind === "phys" ? C().melee : C().spell); // kill bonus x class strength
  const blood = kind === "phys" && myClass === 1 && player.hp < player.mhp * BLOOD_HP;
  if (blood) amt *= 1.4;
  // Shadow: a blade from behind (they face away) or from inside smoke always crits
  const backstab = kind === "phys" && myClass === 3 && (player.stealth || (d.buf && d.face && Math.sign(player.x - d.x) === -Math.sign(d.face)));
  const crit = backstab || (kind !== "burn" && rnd() < .15);
  amt = Math.max(1, Math.round(amt * (crit ? 1.7 : 1) * (.9 + rnd() * .2)));
  if (backstab) floaters.push({x: d.x, y: d.y - 11, text: "BACKSTAB", c: [120, 255, 190], big: 1, life: .9, max: .9, vx: 0});
  if (blood && d.buf) { const h = Math.round(amt * .2); player.hp = Math.min(player.mhp, player.hp + h); floaters.push({x: player.x, y: player.y - 9, text: "+" + h, c: [120, 255, 120], big: .9, life: .9, max: .9, vx: 0}); }
  if (d.buf) { // another player's knight: show the number, tell them; they apply it (and may dodge or block)
    if (!isEnemy(d.id) || d.prot) return;
    floaters.push({x: d.x + (rnd() - .5) * 3, y: d.y - 7, text: crit ? amt + "!" : "" + amt, c: DMG_COL[kind], big: (crit ? 1.4 : 1) * (1 + Math.min(1.2, amt / 160)), life: 1.2, max: 1.2, vx: (rnd() - .5) * 5});
    if (kind !== "burn") { hitstop = Math.max(hitstop, crit ? .09 : .05); sfx.hit(crit ? 1 : .4); }
    net.api.send("hit", shove ? {dmg: amt, kind, x: player.x, y: player.y, kx: shove[0], ky: shove[1]} : {dmg: amt, kind, x: player.x, y: player.y}, d.id);
    return;
  }
  if (net.api && !net.host) net.api.send("dh", {i: dummies.indexOf(d), dmg: amt, kind}); // the host owns the dummies
  if (kind !== "burn") sfx.hit(crit ? 1 : .3, .7);
  d.hp -= amt; d.flash = .12; d.jit = Math.max(d.jit, kind === "burn" ? .05 : .2);
  if (kind !== "burn") hitstop = Math.max(hitstop, crit ? .09 : .05); // freeze a few frames so hits land with weight
  const size = (crit ? 1.4 : kind === "burn" ? .8 : 1) * (1 + Math.min(1.2, amt / 160)); // big hits get big numbers
  floaters.push({x: d.x + (rnd() - .5) * 3, y: d.y - 7, text: crit ? amt + "!" : "" + amt, c: DMG_COL[kind], big: size, life: 1.1 + size * .2, max: 1.1 + size * .2, vx: (rnd() - .5) * 5});
  if (kind === "fire") d.burn = Math.max(d.burn, 2.4);
  if (kind === "shock") d.shock = .7;
  if (d.hp <= 0) breakDummy(d);
}
function breakDummy(d) {
  d.dead = 4; d.hp = 0; d.burn = d.shock = 0;
  addLog("Training dummy destroyed. +12 XP", "General", "gold"); gainXP(12);
  for (let k = 0; k < 40; k++) {
    const a = rnd() * 6.283, s = 6 + rnd() * 16;
    particles.push({x: d.x, y: d.y, z: 2 + rnd() * 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 4 + rnd() * 8, g: -22, life: .6 + rnd() * .6, max: 1.2, ch: ["/", "\\", "|", "-", "'"][k % 5], c0: [214, 180, 116], c1: [90, 70, 40]});
  }
}

// Lightning geometry: recursive midpoint displacement gives the jagged, self-similar channel of a real bolt.
function jag(x0, y0, x1, y1, disp, out) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy * ASPECT);
  if (len < 1.4) { out.push([x1, y1]); return; }
  const n = (rnd() - .5) * disp * len, mx = (x0 + x1) / 2 - dy * ASPECT / len * n, my = (y0 + y1) / 2 + dx / len / ASPECT * n;
  jag(x0, y0, mx, my, disp, out); jag(mx, my, x1, y1, disp, out);
}
function makeBolt(x, y) {
  const top = [x + (rnd() - .5) * 20, y - 50 - rnd() * 12];
  const main = [top]; jag(top[0], top[1], x, y, .45, main);
  const branches = [];
  for (let b = 0, nb = 4 + (rnd() * 5 | 0); b < nb; b++) {
    const i = 2 + (rnd() * main.length * .75 | 0), p = main[i], rem = y - p[1], side = rnd() < .5 ? -1 : 1;
    const br = [p]; jag(p[0], p[1], p[0] + side * (3 + rnd() * rem * .5), p[1] + rem * (.2 + rnd() * .4), .5, br);
    branches.push({pts: br, a: .3 + rnd() * .4, at: i / main.length});
    if (rnd() < .5) { // forks off the forks
      const q = br[1 + (rnd() * br.length * .6 | 0)], sb = [q];
      jag(q[0], q[1], q[0] + side * (2 + rnd() * 7), q[1] + 2 + rnd() * 8, .55, sb);
      branches.push({pts: sb, a: .22, at: i / main.length});
    }
  }
  return {main, branches};
}
// a real flash is a dim stepped leader, a blinding return stroke, then a couple of fading re-strikes down the same channel
const BOLT_PULSES = [[.07, 1], [.19, .8], [.31, .55]];
function boltBright(t) {
  if (t < .07) return .25;
  let b = 0; for (const [s, k] of BOLT_PULSES) if (t >= s) b = Math.max(b, k * Math.exp(-(t - s) * 20));
  return Math.max(b, .06);
}
function screenToWorld(cx, cy) { return [(TLx + cx * dpr) / CW, (TLy + cy * dpr) / CH]; }
function castBolt(pow = 0) {
  if (boltCd > 0 || player.dead) return;
  const cost = chargeCost(pow, "bolt");
  if (player.mp < cost) { noMana(); return; }
  // aim at the cursor on desktop, otherwise ahead of the knight; then snap onto a target near that spot
  let tx, ty;
  if (!isTouch && mouseXY.seen) [tx, ty] = screenToWorld(mouseXY.x, mouseXY.y);
  else { tx = player.x + player.dx * 16; ty = player.y + player.dy * 16 / VS; }
  let vx = tx - player.x, vy = (ty - player.y) * VS; const l = Math.hypot(vx, vy);
  if (l > BOLT_RANGE) { vx *= BOLT_RANGE / l; vy *= BOLT_RANGE / l; tx = player.x + vx; ty = player.y + vy / VS; }
  let best = null, bd = 8;
  for (const d of targets()) { const dd = gdist(d.x, d.y, tx, ty); if (!d.dead && dd < bd) { bd = dd; best = d; } }
  if (best) { tx = best.x; ty = best.y; }
  player.mp -= cost; boltCd = BOLT_CD; player.recoil = .2 + pow * .15;
  if (Math.abs(tx - player.x) > .5) player.face = tx > player.x ? 1 : -1;
  if (l > .5) { player.dx = vx / l; player.dy = vy / l; }
  // damage follows the mana spent; a charged cast also calls extra strikes around the target and chains further.
  // The cast itself is a fast spark shot forward from his hand; the sky strike lands wherever it hits.
  const hx = player.x + player.face * 1.2, hy = player.y + .1;
  const L = Math.max(1, Math.hypot(tx - hx, (ty - hy) * VS)), sp = 150;
  const spk = {x: hx, y: hy, vx: (tx - hx) / L * sp, vy: (ty - hy) * VS / L * sp / VS, left: L / sp + .02, t: 0, pow,
    dmg: cost * BOLT_DMG_PER_MP, rad: 5 + pow * 3, chainN: 2 + Math.round(pow * 3), extra: Math.round(pow * 3)};
  sparks.push({...spk, own: true, owner: selfId}); netFx({k: "spark", s: spk}); sfx.zap();
  tempLights.push({x: hx, y: hy, r: 18, i: 1.6, c: [.6, .8, 1], life: .15, max: .15});
}
// where the spark lands: the main sky strike, plus extra strikes around it for a charged cast
function landSpark(s) {
  bolts.push({x: s.x, y: s.y, t: 0, life: .7, chains: [], dmg: s.dmg, rad: s.rad, chainN: s.chainN, own: s.own, ...makeBolt(s.x, s.y)});
  for (let j = 0; j < s.extra; j++) {
    const a = rnd() * 6.283, r = 5 + rnd() * 6, bx = s.x + Math.cos(a) * r, by = s.y + Math.sin(a) * r / VS;
    bolts.push({x: bx, y: by, t: -.1 - j * .09 - rnd() * .05, life: .7, chains: [], dmg: s.dmg * .6, rad: 4, chainN: 0, own: s.own, ...makeBolt(bx, by)});
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.t += dt; s.left -= dt;
    // the same gentle guidance as the fireball, a little sharper
    const gvx = s.vx, gvy = s.vy * VS, sp = Math.hypot(gvx, gvy), tg = seekTarget(s.x, s.y, gvx / sp, gvy / sp, .8, 40);
    if (tg) {
      const cur = Math.atan2(gvy, gvx), want = Math.atan2((tg.y - s.y) * VS, tg.x - s.x);
      let da = want - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
      const na = cur + clamp(da, -2.2 * dt, 2.2 * dt); s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp / VS;
    }
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (rnd() < .8) particles.push({x: s.x, y: s.y, z: 3, vx: (rnd() - .5) * 10, vy: (rnd() - .5) * 4, vz: (rnd() - .5) * 6, g: 0, life: .15, max: .15, ch: ["-", "/", "\\", "'"][rnd() * 4 | 0], c0: [235, 245, 255], c1: [80, 140, 255]});
    const wall = BLK[Math.floor(s.y) * W + Math.floor(s.x)] && matAt(s.x, s.y) !== 1;
    const hitT = bodiesFor(s.owner).some(d => gdist(d.x, d.y, s.x, s.y) < 2.6 + s.pow * 2);
    if (wall || hitT || s.left <= 0) { landSpark(s); sparks.splice(i, 1); }
  }
}
function strikeBolt(b, pulse) {
  if (!pulse) { const [v, pan] = heard(b.x, b.y, 140); sfx.thunder(v, pan, Math.min(.6, gdist(b.x, b.y, player.x, player.y) / 220)); } // sound lags light at a distance
  shakeAt(b.x, b.y, pulse ? .2 : .55);
  const n = pulse ? 10 : 34;
  for (let k = 0; k < n; k++) {
    const a = rnd() * 6.283, s = 10 + rnd() * 28;
    particles.push({x: b.x, y: b.y, z: .5, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 4 + rnd() * 12, g: -30, life: .25 + rnd() * .4, max: .65, ch: ["+", "*", "'", "`", "."][k % 5], c0: [235, 245, 255], c1: [80, 140, 255]});
  }
  if (pulse) return;
  if (!b.own) { addResidue("shock", b.x, b.y, b.rad * .9, false); return; } // someone else's bolt: visuals only
  for (let k = 0; k < 12; k++) particles.push({x: b.x + (rnd() - .5) * 5, y: b.y + (rnd() - .5) * 2, z: .5, vx: (rnd() - .5) * 6, vy: 0, vz: 2 + rnd() * 3, g: 0, life: .8 + rnd() * .8, max: 1.6, ch: "~", c0: [150, 150, 160], c1: [30, 32, 40]});
  hitDummies(b.x, b.y, b.rad, (d, dist) => damage(d, b.dmg * (1 - .4 * dist / b.rad), "shock"));
  if (b.dmg > 80) screenFlashAdd(.1 + Math.min(.25, b.dmg / 600), "#dce8ff");
  // the charge arcs on to more targets, weaker at each jump
  let from = {x: b.x, y: b.y}, mult = .6;
  const hitSet = new Set(targets().filter(d => gdist(d.x, d.y, b.x, b.y) < b.rad));
  for (let j = 0; j < b.chainN; j++) {
    let nx = null, nd = 16;
    for (const d of targets()) { const dd = gdist(d.x, d.y, from.x, from.y); if (!d.dead && !hitSet.has(d) && dd < nd) { nd = dd; nx = d; } }
    if (!nx) break;
    const pts = [[from.x, from.y - 3]]; jag(from.x, from.y - 3, nx.x, nx.y - 3, .4, pts);
    b.chains.push(pts); hitSet.add(nx); damage(nx, b.dmg * mult, "shock"); mult *= .7; from = nx;
  }
  addResidue("shock", b.x, b.y, b.rad * .9);
}

// Residue: what a spell leaves on the ground for a few seconds. Fire leaves a scorch with flames that keep
// burning (and hurting); lightning leaves a blackened crater with glowing cracks that still spit sparks.
function addResidue(kind, x, y, r, own = true, lifeOverride = 0) {
  const cracks = [], flames = [];
  if (kind === "shock" || kind === "crater") for (let k = 0, n = 6 + (rnd() * 3 | 0); k < n; k++) {
    const a = k / n * 6.283 + rnd() * .5, L = r * (.7 + rnd() * .8), pts = [[x, y]];
    jag(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L / VS, .5, pts); cracks.push(pts);
  }
  if (kind === "fire") for (let k = 0; k < 3 + r * .9; k++) {
    const a = rnd() * 6.283, dd = Math.sqrt(rnd()) * r * .8;
    flames.push({x: x + Math.cos(a) * dd, y: y + Math.sin(a) * dd / VS, ph: rnd() * 6, s: .6 + rnd() * .7});
  }
  const life = lifeOverride || (kind === "fire" ? 4.5 : kind === "crater" ? 3.8 : 3.2);
  residues.push({kind, x, y, r, life, max: life, cracks, flames, tick: .3, arcT: .1, arc: null, own});
  if (residues.length > 24) residues.shift();
}

function updateCombat(dt) {
  boltCd = Math.max(0, boltCd - dt);
  updateSparks(dt);
  updateBlades(dt);
  skyFlash = 0; screenFlash = 0; fxFlash.a = Math.max(0, fxFlash.a - dt * 1.4);
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > rings[i].life) rings.splice(i, 1); }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], t0 = b.t; b.t += dt;
    for (let p = 0; p < BOLT_PULSES.length; p++) if (t0 < BOLT_PULSES[p][0] && b.t >= BOLT_PULSES[p][0]) strikeBolt(b, p > 0);
    const br = b.t < 0 ? 0 : boltBright(b.t); skyFlash = Math.max(skyFlash, br); screenFlash = Math.max(screenFlash, br > .5 ? br * .22 : 0);
    if (b.t > b.life) bolts.splice(i, 1);
  }
  for (const d of dummies) {
    d.flash = Math.max(0, d.flash - dt); d.jit = Math.max(0, d.jit - dt);
    if (d.dead) {
      d.dead -= dt;
      if (d.dead <= 0) { d.dead = 0; d.hp = d.mhp; for (let k = 0; k < 14; k++) particles.push({x: d.x + (rnd() - .5) * 3, y: d.y, z: rnd() * 5, vx: 0, vy: 0, vz: 2, g: 0, life: .6, max: .6, ch: "+", c0: [255, 240, 190], c1: [160, 120, 60]}); }
      continue;
    }
    if (d.burn > 0) {
      d.burn -= dt; d.burnT -= dt;
      if (d.burnT <= 0) { d.burnT = .45; damage(d, 4, "burn"); }
      if (rnd() < dt * 18) particles.push({x: d.x + (rnd() - .5) * 2.4, y: d.y, z: 2 + rnd() * 4, vx: (rnd() - .5) * 2, vy: 0, vz: 4 + rnd() * 4, g: 0, life: .4, max: .4, ch: rnd() < .5 ? "^" : "'", c0: [255, 220, 120], c1: [200, 50, 10]});
    }
    if (d.shock > 0) {
      d.shock -= dt;
      if (rnd() < dt * 22) particles.push({x: d.x + (rnd() - .5) * 3, y: d.y, z: 1 + rnd() * 5, vx: (rnd() - .5) * 14, vy: 0, vz: (rnd() - .5) * 10, g: 0, life: .12, max: .12, ch: rnd() < .5 ? "-" : "/", c0: [240, 250, 255], c1: [90, 150, 255]});
    }
  }
  for (let i = residues.length - 1; i >= 0; i--) {
    const r = residues[i]; r.life -= dt;
    if (r.life <= 0) { residues.splice(i, 1); continue; }
    const k = r.life / r.max;
    if (r.kind === "fire") {
      r.tick -= dt;
      if (r.tick <= 0) { r.tick = .5; if (r.own) hitDummies(r.x, r.y, r.r * .9, d => damage(d, 3, "burn")); }
    } else if (r.kind === "smoke") { // poison everyone else inside
      r.tick -= dt;
      if (r.tick <= 0) { r.tick = .5; if (r.own) hitDummies(r.x, r.y, r.r * .9, d => damage(d, 5, "poison")); }
      for (const f of r.flames) {
        if (rnd() < dt * 5 * k) particles.push({x: f.x, y: f.y, z: 1, vx: (rnd() - .5) * 2, vy: 0, vz: 3 + rnd() * 3, g: 0, life: .5, max: .5, ch: "'", c0: [255, 200, 100], c1: [160, 40, 10]});
        if (rnd() < dt * 1.5) particles.push({x: f.x, y: f.y, z: 2, vx: (rnd() - .5) * 2, vy: 0, vz: 2 + rnd() * 2, g: 0, life: 1.4, max: 1.4, ch: "~", c0: [110, 104, 100], c1: [26, 26, 30]});
      }
    } else if (r.kind === "shock") {
      r.arcT -= dt; if (r.arc) r.arc.t -= dt;
      if (r.arcT <= 0 && k > .15) { // a leftover spark jumps between two crack points
        r.arcT = .12 + rnd() * .4 / k;
        const c = r.cracks[rnd() * r.cracks.length | 0], p0 = c[rnd() * c.length | 0], p1 = c[rnd() * c.length | 0];
        const pts = [p0]; jag(p0[0], p0[1] - .5, p1[0], p1[1], .6, pts); r.arc = {pts, t: .07};
      }
    }
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.life -= dt; f.y -= dt * 7 * (f.life / f.max); f.x += f.vx * dt; f.vx *= .92;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}

/* combat drawing */
function strokeWorld(pts, upto, w, rgba) {
  const n = Math.max(2, Math.ceil(pts.length * upto)); if (pts.length < 2) return;
  octx.beginPath(); octx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
  for (let i = 1; i < n && i < pts.length; i++) octx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
  octx.lineWidth = w * dpr; octx.strokeStyle = rgba; octx.stroke();
}
function drawBoltPath(pts, upto, br, scale) { // wide faint halo, blue body, white-hot core
  octx.globalAlpha = 1;
  strokeWorld(pts, upto, 9 * scale, `rgba(90,130,255,${.16 * br})`);
  strokeWorld(pts, upto, 3.6 * scale, `rgba(150,190,255,${.55 * br})`);
  strokeWorld(pts, upto, 1.4 * scale, `rgba(245,250,255,${Math.min(1, br * 1.2)})`);
}
function drawResidueGround() { // scorch marks, under everything else
  for (const r of residues) {
    const k = Math.min(1, r.life / r.max * 2.2), X = sx(r.x), Y = sy(r.y), rx = r.r * CW * 1.15, ry = r.r / VS * CH * 1.15;
    const g = octx.createRadialGradient(X, Y, 0, X, Y, rx);
    const [c0, c1] = {fire: ["rgba(14,8,4,.78)", "rgba(30,14,6,.45)"], shock: ["rgba(4,6,14,.85)", "rgba(10,14,30,.4)"], crater: ["rgba(20,14,8,.7)", "rgba(40,30,18,.35)"], smoke: ["rgba(14,20,18,.45)", "rgba(20,28,26,.25)"]}[r.kind];
    g.addColorStop(0, c0); g.addColorStop(.6, c1); g.addColorStop(1, "rgba(0,0,0,0)");
    octx.save(); octx.globalAlpha = k; octx.translate(X, Y); octx.scale(1, ry / rx); octx.translate(-X, -Y);
    octx.fillStyle = g; octx.beginPath(); octx.arc(X, Y, rx, 0, 6.283); octx.fill(); octx.restore();
    if (r.kind === "crater") { octx.globalAlpha = k; for (const c of r.cracks) strokeWorld(c, 1, 1.6, "rgba(8,6,4,.9)"); octx.globalAlpha = 1; }
  }
}
function drawResidueGlow() {
  for (const r of residues) {
    const k = r.life / r.max;
    if (r.kind === "fire") {
      glow(r.x, r.y, [255, 110, 30], r.r * 2.4, .35 * k);
      for (const f of r.flames) {
        const fl = .55 + .45 * Math.sin(time * 13 * f.s + f.ph) * Math.sin(time * 7.3 + f.ph * 2), h = (.8 + fl) * f.s * Math.min(1, k * 2.5);
        glow(f.x, f.y - h, [255, 140, 40], 3.2 * h, .6);
        glyph(fl > .6 ? "^" : "*", f.x, f.y - h * .9, 255, 200 + fl * 40, 110, Math.min(1, k * 3));
        glyph("'", f.x + Math.sin(time * 5 + f.ph) * .4, f.y - h * 1.9, 255, 150, 50, .7 * Math.min(1, k * 3));
      }
    } else if (r.kind === "shock") {
      const flick = .7 + .3 * Math.sin(time * 40 + r.x);
      for (const c of r.cracks) { strokeWorld(c, 1, 3, `rgba(80,140,255,${.25 * k * flick})`); strokeWorld(c, 1, 1, `rgba(200,230,255,${.8 * k * flick})`); }
      glow(r.x, r.y, [90, 150, 255], r.r * 2, .35 * k);
      if (r.arc && r.arc.t > 0) drawBoltPath(r.arc.pts, 1, .9, .4);
    }
  }
}
const DUMMY_ART = [ // [dx, dy rows above the feet, char, part]
  [-1, 7, "(", "s"], [0, 7, "@", "s"], [1, 7, ")", "s"],
  [-3, 6, "-", "w"], [-2, 6, "=", "w"], [-1, 6, "=", "w"], [0, 6, "#", "b"], [1, 6, "=", "w"], [2, 6, "=", "w"], [3, 6, "-", "w"],
  [-1, 5, "{", "b"], [0, 5, "#", "b"], [1, 5, "}", "b"], [-1, 4, "{", "b"], [0, 4, "#", "b"], [1, 4, "}", "b"],
  [0, 3, "|", "w"], [0, 2, "|", "w"], [0, 1, "|", "w"], [-1, 0, "/", "w"], [0, 0, "|", "w"], [1, 0, "\\", "w"],
];
const DUMMY_COL = {s: [196, 176, 134], w: [132, 96, 60], b: [214, 182, 112]};
function drawDummy(d) {
  const L = lightAt(d.x, d.y), lit = c => c.map((v, j) => Math.min(255, v * L[j] * 1.1));
  octx.globalAlpha = .5; octx.fillStyle = "#000";
  octx.beginPath(); octx.ellipse(sx(d.x), sy(d.y - .1), CW * 2.6, CH * .55, 0, 0, 6.283); octx.fill();
  if (d.dead) { for (const [dx, dy, ch, p] of DUMMY_ART) if (dy < 2) { const c = lit(DUMMY_COL[p]); glyph(ch, d.x + dx, d.y - dy, c[0], c[1], c[2], .8); } return; }
  const j = d.jit > 0 || d.shock > 0 ? (rnd() - .5) * .9 : 0, sway = Math.sin(time * 1.3 + d.x) * .15;
  for (const [dx, dy, ch, p] of DUMMY_ART) {
    let c = lit(DUMMY_COL[p]);
    if (d.burn > 0) c = c.map((v, k) => v * .55 + [120, 40, 10][k] * (1 + Math.sin(time * 20 + dy) * .3));
    if (d.shock > 0 && rnd() < .5) c = [190, 220, 255];
    if (d.flash > 0) c = c.map(v => v + (255 - v) * d.flash / .12);
    glyph(ch, d.x + dx + j + sway * dy / 7, d.y - dy - .3, c[0], c[1], c[2], 1);
  }
  if (d.hp < d.mhp) { // health bar
    const X = sx(d.x) - 4 * CW, Y = sy(d.y - 9.4), w = 8 * CW, h = Math.max(2, 3 * dpr);
    octx.globalAlpha = .85; octx.fillStyle = "#0b0b0f"; octx.fillRect(X - dpr, Y - dpr, w + 2 * dpr, h + 2 * dpr);
    octx.fillStyle = "#c4322b"; octx.fillRect(X, Y, w * Math.max(0, d.hp / d.mhp), h);
  }
}
function drawFloaters() {
  octx.textAlign = "center"; octx.textBaseline = "middle"; octx.lineJoin = "round";
  for (const f of floaters) {
    const t = 1 - f.life / f.max, pop = t < .12 ? 1 + (1 - t / .12) * .6 : 1;
    octx.font = `700 ${Math.round(11 * dpr * f.big * pop)}px "IBM Plex Mono", ui-monospace, monospace`;
    octx.globalAlpha = Math.min(1, f.life / f.max * 2.5);
    octx.lineWidth = 3 * dpr; octx.strokeStyle = "rgba(0,0,0,.85)"; octx.strokeText(f.text, sx(f.x), sy(f.y));
    octx.fillStyle = `rgb(${f.c.join(",")})`; octx.fillText(f.text, sx(f.x), sy(f.y));
  }
  octx.font = FONT;
}
/* ============================== guard, dodge, summoned blades ============================== */
// Dodge roll: a quick burst along your input (or facing), steering locked, ghost trail, then a get-up beat.
const ROLL_TIME = .26, ROLL_GETUP = .12, ROLL_DIST = 30, ROLL_CD = .6; // a real burst: ~115 cells/s on average
function startRoll() {
  if (myClass === 2) { phaseShift(); return; }
  if (player.roll || player.surge || player.rollCd > 0 || player.dead) return;
  dashHits.clear();
  let ix = (keys.r ? 1 : 0) - (keys.l ? 1 : 0) + stick.x, iy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0) + stick.y;
  if (mouseWalk.on) { const d = aimAt(mouseWalk.cx, mouseWalk.cy); ix += d[0]; iy += d[1]; }
  let l = Math.hypot(ix, iy); if (l < .1) { ix = player.dx; iy = player.dy; l = Math.hypot(ix, iy) || 1; }
  ix /= l; iy /= l;
  player.roll = {t: 0, dx: ix, dy: iy}; player.rollCd = ROLL_CD * C().dashCd + ROLL_TIME; sfx.dash();
  player.dx = ix; player.dy = iy; if (Math.abs(ix) > .15) player.face = ix > 0 ? 1 : -1;
  charge.on = false; player.shield = false;
  for (let k = 0; k < 12; k++) particles.push({x: player.x + (rnd() - .5) * 3, y: player.y, z: .3, vx: -ix * 8 + (rnd() - .5) * 8, vy: (rnd() - .5) * 3, vz: 2 + rnd() * 3, g: -8, life: .6, max: .6, ch: [".", ",", "~"][k % 3], c0: [160, 150, 128], c1: [40, 38, 34]});
}
function setShield(on) { player.shield = on && !player.roll && !player.dead; }
function drawShieldWard() { // a curved ward of runes in front of him while the shield is raised
  const k = player.shieldUp; if (k < .05) return;
  const cx = player.x + player.face * 2.2, cy = player.y - 3.4, n = 11;
  glow(cx, cy, [140, 200, 255], 8 * k, .35 * k);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - .5, a = t * 2.4, r = 3.8;
    const x = cx + player.face * (Math.cos(a) * r - r) * .6, y = cy + Math.sin(a) * r;
    const sh = .6 + .4 * Math.sin(time * 6 - i * .7);
    glyph(["(", "[", "|", "#", "|", "]", ")"][i % 7].replace(/[(\[\])]/, c => player.face > 0 ? c : {"(": ")", ")": "(", "[": "]", "]": "["}[c]), x, y, 150 + sh * 90, 200 + sh * 50, 255, k * (.55 + sh * .45));
  }
}

// Summoned blades: giant spectral swords rise around the knight, hover pointing at the target, then
// launch one after another, impale the ground (damage + shockwave) and stay stuck there before dissolving.
const BLADE_COST = 35, BLADE_CD = 5, BLADE_N = 5;
let bladeCd = 0;
const blades = [];
function castBlades(pow = 0) {
  if (bladeCd > 0 || player.roll || player.dead) return;
  const cost = chargeCost(pow, "blades");
  if (player.mp < cost) { noMana(); return; }
  let tx, ty;
  if (!isTouch && mouseXY.seen) [tx, ty] = screenToWorld(mouseXY.x, mouseXY.y);
  else { tx = player.x + player.dx * 22; ty = player.y + player.dy * 22 / VS; }
  let vx = tx - player.x, vy = (ty - player.y) * VS; const l = Math.hypot(vx, vy);
  if (l > 40) { vx *= 40 / l; vy *= 40 / l; tx = player.x + vx; ty = player.y + vy / VS; }
  if (l > .5) { player.dx = vx / l; player.dy = vy / l; if (Math.abs(vx) > .5) player.face = vx > 0 ? 1 : -1; }
  player.mp -= cost; bladeCd = BLADE_CD; player.recoil = .3;
  const near = targets().filter(d => gdist(d.x, d.y, tx, ty) < 14);
  // charged: more swords (up to double), each bigger and hitting harder with the extra mana
  const n = BLADE_N + Math.round(pow * 5), dmg = 55 * cost / BLADE_COST * BLADE_N / n, size = 1 + pow * .35, half = (n - 1) / 2;
  const sent = [];
  for (let i = 0; i < n; i++) {
    const off = (i - half) / half; // -1..1: fan out in an arc above him
    const tgt = near.length ? near[i % near.length] : null;
    sent.push({
      i, t: -i * .06, phase: "rise", dmg, size,
      hx: off * (6.5 + pow * 4), hz: 11 + pow * 3 - off * off * 3.6, // hover offset (relative to knight)
      x: player.x, y: player.y + .5, z: 0,
      tx: (tgt ? tgt.x : tx + (rnd() - .5) * 8) + (rnd() - .5) * 1.5, ty: (tgt ? tgt.y : ty + (rnd() - .5) * 4) + (rnd() - .5) * .8,
      launch: .75 + i * (n > 6 ? .08 : .13), tilt: (rnd() - .5) * .5, life: 0,
    });
  }
  for (const b of sent) blades.push({...b, own: true, who: player}); sfx.bladeSummon();
  netFx({k: "blades", b: sent});
  tempLights.push({x: player.x, y: player.y, r: 30, i: 2, c: [.6, .8, 1], life: .5, max: .5});
  for (let k = 0; k < 30; k++) { const a = rnd() * 6.283; particles.push({x: player.x + Math.cos(a) * 4, y: player.y + Math.sin(a) * 2, z: .5, vx: 0, vy: 0, vz: 6 + rnd() * 8, g: 0, life: .6, max: .6, ch: "|", c0: [220, 240, 255], c1: [80, 130, 255]}); }
}
function updateBlades(dt) {
  bladeCd = Math.max(0, bladeCd - dt);
  for (let i = blades.length - 1; i >= 0; i--) {
    const b = blades[i]; b.t += dt;
    if (b.t < 0) continue;
    if (b.phase === "rise" || b.phase === "hover") {
      const k = Math.min(1, b.t / .45), e = 1 - (1 - k) ** 3; // ease out as it rises into place
      const bob = Math.sin(time * 3 + b.i) * .4;
      const who = b.who || player; b.x = who.x + b.hx * e; b.y = who.y + .3; b.z = b.hz * e + bob;
      b.phase = k < 1 ? "rise" : "hover";
      if (b.t >= b.launch) {
        // lock on as it launches: the nearest enemy (or dummy) close to where it was aimed
        if (b.own) { let best = null, bd = 20; for (const d of targets()) { const dd = gdist(d.x, d.y, b.tx, b.ty); if (dd < bd) { bd = dd; best = d; } } if (best) { b.tgt = best; b.tx = best.x; b.ty = best.y; } }
        b.phase = "fly"; b.fx = b.x; b.fy = b.y; b.fz = b.z; b.ft = 0; b.dur = Math.max(.12, gdist(b.x, b.y, b.tx, b.ty) / 120);
      }
    } else if (b.phase === "fly") {
      b.ft += dt; const k = Math.min(1, b.ft / b.dur);
      if (b.tgt && !b.tgt.dead && b.tgt.hp > 0) { // home in on a target that moves (a fast dodge can still escape)
        const f = Math.min(1, dt * 6); b.tx += (b.tgt.x - b.tx) * f; b.ty += (b.tgt.y - b.ty) * f;
      }
      b.x = b.fx + (b.tx - b.fx) * k; b.y = b.fy + (b.ty - b.fy) * k; b.z = b.fz * (1 - k * k);
      if (rnd() < .9) particles.push({x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, g: 0, life: .2, max: .2, ch: "'", c0: [220, 240, 255], c1: [60, 110, 255]});
      if (k >= 1) { // impact
        b.phase = "stuck"; b.life = 2.4; b.z = 0;
        if (b.own) { hitDummies(b.x, b.y, 4.5 * b.size, d => damage(d, b.dmg, "blade")); hitstop = Math.max(hitstop, .05); }
        shakeAt(b.x, b.y, .35); sfx.bladeImpact(...heard(b.x, b.y));
        rings.push({x: b.x, y: b.y, r: 1, r1: 9, t: 0, life: .35, c: [170, 210, 255]});
        tempLights.push({x: b.x, y: b.y, r: 26, i: 2.4, c: [.6, .8, 1], life: .35, max: .35});
        for (let k2 = 0; k2 < 26; k2++) { const a = rnd() * 6.283, s = 6 + rnd() * 18; particles.push({x: b.x, y: b.y, z: .4, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 5 + rnd() * 10, g: -30, life: .6 + rnd() * .5, max: 1.1, ch: [".", ",", ":", "'"][k2 % 4], c0: [170, 150, 120], c1: [60, 50, 40]}); }
        addResidue("shock", b.x, b.y, 2.2, false);
      }
    } else { // stuck in the ground, fading out
      b.life -= dt;
      if (b.life < .5 && rnd() < dt * 40) particles.push({x: b.x + (rnd() - .5), y: b.y, z: rnd() * 10, vx: 0, vy: 0, vz: 4 + rnd() * 4, g: 0, life: .5, max: .5, ch: ".", c0: [200, 230, 255], c1: [60, 110, 255]});
      if (b.life <= 0) blades.splice(i, 1);
    }
  }
}
function drawGiantSword(X, Y, ang, L, a) { // X,Y = screen position of the tip; ang = direction the tip points
  octx.save(); octx.translate(X, Y); octx.rotate(ang); octx.globalAlpha = a;
  const bw = L * .055, bl = L * .72, gw = L * .2, gl = L * .17;
  // spectral glow
  octx.globalCompositeOperation = "lighter";
  if (!isTouch) { octx.shadowColor = "rgba(110,170,255,.95)"; octx.shadowBlur = 14 * dpr; } // blur is very slow on phones
  octx.fillStyle = "rgba(90,140,255,.35)";
  octx.beginPath(); octx.moveTo(4 * dpr, 0); octx.lineTo(-bl, -bw * 1.9); octx.lineTo(-bl, bw * 1.9); octx.closePath(); octx.fill();
  octx.shadowBlur = 0; octx.globalCompositeOperation = "source-over";
  // blade: steel with a bright edge and a dark fuller
  const g = octx.createLinearGradient(0, -bw, 0, bw);
  g.addColorStop(0, "#f4f8ff"); g.addColorStop(.45, "#aeb9cc"); g.addColorStop(.55, "#6f7b90"); g.addColorStop(1, "#dfe7f5");
  octx.fillStyle = g;
  octx.beginPath(); octx.moveTo(0, 0); octx.lineTo(-bl * .12, -bw); octx.lineTo(-bl, -bw); octx.lineTo(-bl, bw); octx.lineTo(-bl * .12, bw); octx.closePath(); octx.fill();
  octx.strokeStyle = "rgba(60,70,90,.8)"; octx.lineWidth = Math.max(1, dpr * .8);
  octx.beginPath(); octx.moveTo(-bl * .15, 0); octx.lineTo(-bl * .95, 0); octx.stroke();
  // crossguard, grip, pommel
  octx.fillStyle = "#c9a45a"; octx.fillRect(-bl - gw * .12, -gw / 2, gw * .24, gw);
  octx.fillStyle = "#3a2618"; octx.fillRect(-bl - gw * .12 - gl, -bw * .7, gl, bw * 1.4);
  octx.fillStyle = "#d8b56a"; octx.beginPath(); octx.arc(-bl - gw * .12 - gl - bw * .9, 0, bw * 1.1, 0, 6.283); octx.fill();
  octx.restore();
}
function drawBlades(behind) {
  const L = 12 * CH;
  for (const b of blades) {
    if (b.t < 0) continue;
    if ((b.phase !== "fly" && b.y <= player.y) !== behind) continue; // flying blades always draw in front
    let a = 1, ang;
    const X = sx(b.x), Y = sy(b.y - b.z);
    if (b.phase === "stuck") { a = Math.min(1, b.life / .5); ang = Math.PI / 2 + b.tilt; }
    else if (b.phase === "fly") ang = Math.atan2(sy(b.ty) - Y, sx(b.tx) - X);
    else { ang = Math.atan2(sy(b.ty) - Y, sx(b.tx) - X); a = Math.min(1, b.t / .2); }
    // shadow on the ground under it
    octx.globalAlpha = .35 * a * (b.phase === "stuck" ? 1 : Math.max(.2, 1 - b.z / 14)); octx.fillStyle = "#000";
    octx.beginPath(); octx.ellipse(X, sy(b.y), CW * 3, CH * .5, 0, 0, 6.283); octx.fill();
    const tipY = b.phase === "stuck" ? Y + CH * 1.2 : Y; // buried a little
    drawGiantSword(X, tipY, ang, L * b.size, a);
  }
  octx.globalAlpha = 1;
}
function drawCharge() { // what's gathering in his hand (or at his feet for the slam), plus the price
  const pw = chargePower(), sp = spellOf(charge.kind), k = sp ? sp.id : "slam", c = colOf(charge.kind), slam = k === "slam";
  const hx = player.x + (slam ? 0 : player.face * 1.2), hy = player.y - (slam ? 0 : 3.2);
  glow(hx, hy, c, (slam ? 8 : 4) + pw * 14, .5 + pw * .5);
  if (k === "fire") glyph(pw > .5 ? "@" : pw > 0 ? "o" : "*", hx, hy, 255, 235, 190, .9);
  if (k === "bolt") { // crackling arcs jumping around the hand
    for (let i = 0; i < 2 + pw * 4; i++) {
      const a = rnd() * 6.283, r = 1.5 + pw * 3, pts = [[hx, hy]];
      jag(hx, hy, hx + Math.cos(a) * r, hy + Math.sin(a) * r / VS, .7, pts); drawBoltPath(pts, 1, .8, .35);
    }
  }
  if (k === "blades") { // ghost swords appear one by one above him as the summon grows
    const n = BLADE_N + Math.round(pw * 5), half = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const off = half ? (i - half) / half : 0, x = player.x + off * (6.5 + pw * 4), y = player.y - (11 + pw * 3 - off * off * 3.6) * .8;
      glow(x, y, c, 3, .5); glyph("†", x, y + Math.sin(time * 4 + i) * .3, 215, 230, 255, .75);
    }
  }
  if (slam) for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283 + time * 3, r = 3 + pw * 5; glyph(".", hx + Math.cos(a) * r, hy + Math.sin(a) * r / VS, 230, 205, 160, .7); }
  if (pw > 0) {
    octx.globalCompositeOperation = "source-over"; octx.globalAlpha = .9;
    octx.font = `700 ${Math.round(10 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`;
    octx.fillStyle = pw >= 1 ? "#ffe9b8" : `rgb(${c.join(",")})`;
    const extra = k === "blades" ? ` · ${BLADE_N + Math.round(pw * 5)} blades` : k === "missiles" || k === "daggers" ? ` · ${3 + Math.round(pw * 4)}` : "";
    const label = slam ? `SLAM ${Math.round(pw * 100)}%` : `${chargeCost(pw, charge.kind)} MP${extra}`;
    octx.fillText(label + (pw >= 1 ? " MAX" : ""), sx(hx), sy(player.y - 9));
    octx.font = FONT; octx.globalCompositeOperation = "lighter";
  }
}

// Ground slam (hold the slash key): crouch while it charges, then leap and smash down with a shockwave.
const SLAM_CD = 1.4, SLAM_AIR = .34, SLAM_LAND = .28;
let slamCd = 0;
function doSlam(pow) {
  if (slamCd > 0 || player.roll || player.dead) return;
  slamCd = SLAM_CD; player.slam = {t: 0, pow, hit: false, dx: player.dx, dy: player.dy};
}
function slamFx(x, y, pow) { // the landing: shockwave rings, flying dirt, a cracked crater
  sfx.slam(pow, ...heard(x, y));
  const R = 7 + pow * 6;
  shakeAt(x, y, .5 + pow * .5);
  rings.push({x, y, r: 2, r1: R * 1.6, t: 0, life: .4, c: [240, 220, 180]});
  rings.push({x, y, r: 1, r1: R, t: -.05, life: .35, c: [255, 250, 235]});
  tempLights.push({x, y, r: 30 + pow * 20, i: 2.2, c: [1, .9, .7], life: .35, max: .35});
  for (let k = 0; k < 40 + pow * 50; k++) {
    const a = rnd() * 6.283, sp = 8 + rnd() * 22 * (1 + pow);
    particles.push({x, y, z: .4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp / VS, vz: 6 + rnd() * 14, g: -34, life: .6 + rnd() * .6, max: 1.2, ch: [".", ",", ":", ";", "'"][k % 5], c0: [190, 160, 120], c1: [70, 56, 40]});
  }
  addResidue("crater", x, y, 3 + pow * 3.5, false);
}
function updateSlam(dt) {
  slamCd = Math.max(0, slamCd - dt);
  const s = player.slam; if (!s) return;
  s.t += dt;
  if (s.t < SLAM_AIR && s.leap) { // Inferno Leap: an arc onto the chosen landing spot
    const k = s.t / SLAM_AIR; player.x = s.leap.x0 + (s.leap.x1 - s.leap.x0) * k; player.y = s.leap.y0 + (s.leap.y1 - s.leap.y0) * k;
    if (rnd() < .8) particles.push({x: player.x, y: player.y, z: 3, vx: 0, vy: 0, vz: 1, g: 0, life: .35, max: .35, ch: "^", c0: [255, 200, 100], c1: [200, 40, 10]});
  } else if (s.t < SLAM_AIR) { // leap forward a little
    const sp = (5 + s.pow * 5) / SLAM_AIR, tx = player.x + s.dx * sp * dt, ty = player.y + s.dy * sp * dt / VS;
    if (!blockedAt(tx, player.y)) player.x = tx;
    if (!blockedAt(player.x, ty)) player.y = ty;
  } else if (!s.hit && s.leap) {
    s.hit = true; player.x = s.leap.x1; player.y = s.leap.y1;
    explode(player.x, player.y, s.pow, s.dmg, true); netFx({k: "boom", x: player.x, y: player.y, pow: s.pow, dmg: s.dmg});
  } else if (!s.hit) {
    s.hit = true;
    const R = 7 + s.pow * 6, dmg = 100 + s.pow * 160;
    hitDummies(player.x, player.y, R, (d, dist) => { damage(d, dmg * (1 - .45 * dist / R), "phys"); d.jit = .4; meleeMana(d); });
    hitstop = Math.max(hitstop, .08 + s.pow * .06); screenFlashAdd(.06 + s.pow * .12, "#fff0d0");
    slamFx(player.x, player.y, s.pow); netFx({k: "slam", x: player.x, y: player.y, pow: s.pow});
  }
  if (s.t >= SLAM_AIR + SLAM_LAND) player.slam = null;
}
function drawRings() { // shockwaves: a bright ring racing outward along the ground
  for (const r of rings) {
    if (r.t < 0) continue;
    const k = r.t / r.life, rad = r.r + (r.r1 - r.r) * (1 - Math.pow(1 - k, 3)), X = sx(r.x), Y = sy(r.y);
    octx.globalAlpha = (1 - k) * .9; octx.lineWidth = (1 + (1 - k) * 5) * dpr; octx.strokeStyle = `rgb(${r.c.join(",")})`;
    octx.beginPath(); octx.ellipse(X, Y, rad * CW, rad / VS * CH, 0, 0, 6.283); octx.stroke();
  }
}
function drawBolts() {
  octx.lineCap = "round"; octx.lineJoin = "round";
  drawRings();
  for (const s of sparks) { // a crackling head with a jagged tail whipping behind it
    const sp = Math.hypot(s.vx, s.vy * VS), tl = Math.min(7 + s.pow * 5, s.t * sp), z = 3;
    const tx = s.x - s.vx / sp * tl, ty = s.y - s.vy / sp * tl;
    const pts = [[tx, ty - z]]; jag(tx, ty - z, s.x, s.y - z, .5, pts); drawBoltPath(pts, 1, 1, .7 + s.pow * .4);
    if (s.t < .07) { const hx = player.x + player.face * 1.2, p2 = [[hx, player.y - 3.2]]; jag(hx, player.y - 3.2, s.x, s.y - z, .45, p2); drawBoltPath(p2, 1, .8, .5); }
    glow(s.x, s.y - z, [150, 200, 255], 5 + s.pow * 6, 1); glyph("*", s.x, s.y - z, 240, 248, 255, 1);
  }
  for (const b of bolts) {
    if (b.t < 0) continue;
    const br = boltBright(b.t), lead = b.t < .07 ? b.t / .07 : 1;
    drawBoltPath(b.main, lead, br, 1);
    for (const s of b.branches) if (lead >= s.at) drawBoltPath(s.pts, b.t < .07 ? Math.min(1, (lead - s.at) * 4) : 1, br * s.a, .6);
    for (const c of b.chains) drawBoltPath(c, 1, Math.min(1, br * 1.3), .7);
    if (b.t >= .07) glow(b.x, b.y, [170, 200, 255], 14 * br + 4, Math.min(1, br * 1.2));
  }
}

/* ============================== ambient life ============================== */
function initAmbient() {
  for (let k = 0; k < 3; k++) wisps.push({x: G.x, y: G.y, k: k * 2.1});
  for (let k = 0; k < 40; k++) fireflies.push({x: 0, y: -999, ph: rnd() * 6, s: .5 + rnd()});
}
function respawnFly(f) {
  for (let t = 0; t < 12; t++) {
    const x = player.x + (rnd() - .5) * 120, y = player.y + (rnd() - .5) * 60, m = matAt(x, y);
    if (m === 0 || m === 4 || m === 5) { f.x = x; f.y = y; f.z = 1 + rnd() * 5; return; }
  }
}

/* ============================== update ============================== */
let fireAcc = 0;
function update(dt) {
  time += dt;
  let ix = (keys.r ? 1 : 0) - (keys.l ? 1 : 0) + stick.x;
  let iy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0) + stick.y;
  if (mouseWalk.on) {
    const d = aimAt(mouseWalk.cx, mouseWalk.cy), l = Math.hypot(d[0], d[1]);
    if (l > 2.5) { ix += d[0] / l; iy += d[1] / l; } // stop once he reaches the cursor
  }
  let len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; len = 1; }
  player.rollCd = Math.max(0, player.rollCd - dt);
  player.hurt = Math.max(0, player.hurt - dt);
  if (player.dead) { player.dead -= dt; len = 0; if (player.dead <= 0) respawn("after death"); }
  else if (time - player.lastHurt > 5) player.hp = Math.min(player.mhp, player.hp + dt * 6); // out of combat: heal
  player.shieldUp += ((player.shield ? 1 : 0) - player.shieldUp) * Math.min(1, dt * 14);
  if (player.roll) { // dodge roll: fast burst that eases out, steering locked, then he gets up
    const r = player.roll; r.t += dt;
    const k = r.t / ROLL_TIME, sp = ROLL_DIST / ROLL_TIME * 2.2 * Math.max(0, 1 - k) ** 1.2;
    const dist = sp * dt, n = Math.max(1, Math.ceil(dist / .6)); // small sub-steps so a fast dash can't skip through walls
    for (let s = 0; s < n; s++) {
      const tx = player.x + r.dx * dist / n, ty = player.y + r.dy * dist / n / VS;
      if (!blockedAt(tx, player.y)) player.x = tx;
      if (!blockedAt(player.x, ty)) player.y = ty;
    }
    player.ghostT -= dt; if (player.ghostT <= 0 && k < .8) { ghosts.push({x: player.x, y: player.y, ...knightPose(), life: .28}); player.ghostT = .02; }
    if (k < .7) for (let s = 0; s < 2; s++) particles.push({x: player.x - r.dx * 2, y: player.y - r.dy * 2 / VS, z: 2 + rnd() * 3, vx: -r.dx * 30, vy: -r.dy * 30 / VS, vz: 0, g: 0, life: .15, max: .15, ch: Math.abs(r.dx) > Math.abs(r.dy) ? "-" : "|", c0: [230, 240, 255], c1: [90, 130, 200]}); // speed streaks
    if (rnd() < dt * 30 && k < .8) particles.push({x: player.x + (rnd() - .5) * 2, y: player.y, z: .2, vx: -r.dx * 6 + (rnd() - .5) * 4, vy: (rnd() - .5) * 2, vz: 1 + rnd() * 2, g: -6, life: .5, max: .5, ch: [".", ",", "`"][rnd() * 3 | 0], c0: [150, 142, 120], c1: [40, 38, 34]});
    if (r.t >= ROLL_TIME && dashHeld && player.mp > 4 && !player.dead) { player.roll = null; player.surge = {dx: r.dx, dy: r.dy}; } // still holding: keep going
    else { if (r.t >= ROLL_TIME + ROLL_GETUP) player.roll = null; len = 0; }
  }
  if (player.surge) { // sprinting dash: steerable, fast, burns mana every moment it lasts
    const s = player.surge, cost = SURGE_MP * (myClass === 3 ? .5 : 1) * dt;
    if (!dashHeld || player.dead || player.slam || player.mp < cost) { player.surge = null; player.rollCd = ROLL_CD * C().dashCd; }
    else {
      player.mp -= cost;
      if (len > .12) { const t = Math.min(1, dt * 7); s.dx += (ix / len - s.dx) * t; s.dy += (iy / len - s.dy) * t; const l = Math.hypot(s.dx, s.dy) || 1; s.dx /= l; s.dy /= l; }
      ix = s.dx; iy = s.dy; len = 1;
      if (rnd() < .7) particles.push({x: player.x - s.dx * 2, y: player.y - s.dy * 2 / VS, z: 1.5 + rnd() * 3, vx: -s.dx * 26, vy: -s.dy * 26 / VS, vz: 0, g: 0, life: .16, max: .16, ch: Math.abs(s.dx) > Math.abs(s.dy) ? "-" : "|", c0: CLASSES[myClass].glow, c1: [40, 50, 80]});
    }
  }
  if (player.knock) { // shoved by a Shield Charge
    const kn = player.knock, f = Math.max(0, kn.t / KNOCK_T); kn.t -= dt;
    for (let s = 0; s < 3; s++) {
      const tx = player.x + kn.vx * f * dt / 3, ty = player.y + kn.vy * f * dt / 3 / VS;
      if (!blockedAt(tx, player.y)) player.x = tx;
      if (!blockedAt(player.x, ty)) player.y = ty;
    }
    if (kn.t <= 0) player.knock = null;
  }
  shieldCharge();
  if (myClass === 1) { // Berserker: entering bloodlust is announced
    const bl = !player.dead && player.hp < player.mhp * BLOOD_HP;
    if (bl && !player.blood) { floaters.push({x: player.x, y: player.y - 10, text: "BLOODLUST", c: [255, 70, 50], big: 1.3, life: 1.4, max: 1.4, vx: 0}); sfx.slam(.2); }
    player.blood = bl;
  }
  updateSlam(dt);
  if (player.slam || (charge.on && charge.kind === "slam" && charge.t > CHARGE_MIN)) len = 0; // rooted while slamming / winding up
  player.moving = len > .12;
  if (player.moving) {
    const sp = player.surge ? SURGE_SPEED * C().speed : (keys.run || Math.hypot(stick.x, stick.y) > .95 ? 56 : 42) * len * (1 - player.shieldUp * .55) * C().speed; // shield up = slow guarded walk
    const nx = ix / len, ny = iy / len;
    player.dx = nx; player.dy = ny;
    if (Math.abs(nx) > .15) player.face = nx > 0 ? 1 : -1;
    for (let s = 0, n = Math.max(1, Math.ceil(sp * dt / .6)); s < n; s++) {
      const tx = player.x + nx * sp * dt / n, ty = player.y + ny * sp * dt / n / VS;
      if (!blockedAt(tx, player.y)) player.x = tx;
      if (!blockedAt(player.x, ty)) player.y = ty;
    }
    player.anim += dt * (4.5 + sp * .09); // run-cycle frames/s: ~1.4 strides/s jogging, ~1.6 running (MMO-like pace)
    player.running = sp > 48;
    const fr = Math.floor(player.anim) % 6;
    if (fr !== player.lastFr && (fr === 0 || fr === 3)) {
      for (let n = 0; n < (player.running ? 6 : 3); n++) particles.push({x: player.x + (rnd() - .5) * 2, y: player.y, z: .2, vx: -nx * 4 + (rnd() - .5) * 5, vy: (rnd() - .5) * 1.5, vz: 1 + rnd() * 2, g: -6, life: .45, max: .45, ch: [".", ",", "`", "'"][n % 4], c0: [150, 142, 120], c1: [40, 38, 34]});
    }
    player.lastFr = fr;
    if (player.running) { player.ghostT -= dt; if (player.ghostT <= 0) { ghosts.push({x: player.x, y: player.y, ...knightPose(), life: .22}); player.ghostT = .05; } }
  } else player.running = false;
  player.atk = Math.max(0, player.atk - dt); player.atkCd = Math.max(0, player.atkCd - dt); player.recoil = Math.max(0, player.recoil - dt);
  for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1); }
  // mana flows back faster while you keep moving: +4/s walking, +7/s running, on top of the base +5/s
  if (!player.surge) player.mp = Math.min(player.mmp, player.mp + dt * (5 + (player.moving ? (player.running ? 7 : 4) : 0)) * C().regen);
  cd = Math.max(0, cd - dt);

  // camera
  const k = 1 - Math.exp(-dt * 7);
  cam.x += (player.x - cam.x) * k; cam.y += (player.y - 3 - cam.y) * k;
  const hw = Wpx / CW / 2 + 2, hh = Hpx / CH / 2 + 2;
  cam.x = clamp(cam.x, hw, W - hw); cam.y = clamp(cam.y, hh, H - hh);
  shake = Math.max(0, shake - dt);

  // projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i], kind = p.kind || "fire";
    if (kind === "fire" || kind === "missile") { // guidance: fireballs bend gently, arcane missiles hard
      const gvx = p.vx, gvy = p.vy * VS, sp = Math.hypot(gvx, gvy), t = seekTarget(p.x, p.y, gvx / sp, gvy / sp, kind === "missile" ? 1.5 : .9, 45);
      if (t) {
        const cur = Math.atan2(gvy, gvx), want = Math.atan2((t.y - p.y) * VS, t.x - p.x), turn = p.turn || HOMING_TURN;
        let da = want - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
        const na = cur + clamp(da, -turn * dt, turn * dt);
        p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp / VS;
      }
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    const wall = BLK[Math.floor(p.y) * W + Math.floor(p.x)] && matAt(p.x, p.y) !== 1;
    if (kind === "wave") { // passes through everything, hitting each target once
      if (rnd() < .8) particles.push({x: p.x + (rnd() - .5) * p.r, y: p.y + (rnd() - .5) * p.r / VS, z: p.z, vx: -p.vx * .05, vy: -p.vy * .05, vz: 0, g: 0, life: .2, max: .2, ch: "'", c0: [240, 248, 255], c1: [120, 170, 255]});
      if (p.own) for (const d of targets()) if (!p.hits.has(d) && gdist(d.x, d.y, p.x, p.y) < p.r) { p.hits.add(d); damage(d, p.dmg, "holy"); }
      if (wall || p.life <= 0) { for (let k = 0; k < 10; k++) particles.push({x: p.x, y: p.y, z: 3, vx: (rnd() - .5) * 20, vy: (rnd() - .5) * 8, vz: rnd() * 6, g: -10, life: .3, max: .3, ch: "+", c0: [255, 255, 240], c1: [120, 170, 255]}); projectiles.splice(i, 1); }
      continue;
    }
    if (kind === "dagger" || kind === "missile") { // single-target: stop at the first body or wall
      const mis = kind === "missile";
      if (rnd() < .7) particles.push({x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, g: 0, life: .18, max: .18, ch: mis ? "·" : "'", c0: mis ? [230, 200, 255] : [220, 255, 235], c1: mis ? [110, 50, 220] : [60, 140, 100]});
      const body = bodiesFor(p.owner).find(d => gdist(d.x, d.y, p.x, p.y) < (mis ? 2.4 : 2));
      if (body || wall || p.life <= 0) {
        if (body && p.own) damage(body, p.dmg, mis ? "arcane" : "phys");
        if (body || wall) { for (let k = 0; k < (mis ? 12 : 6); k++) particles.push({x: p.x, y: p.y, z: 3, vx: (rnd() - .5) * 16, vy: (rnd() - .5) * 7, vz: rnd() * 5, g: -8, life: .3, max: .3, ch: mis ? "*" : "+", c0: mis ? [240, 210, 255] : [230, 255, 240], c1: mis ? [120, 50, 230] : [70, 160, 110]}); if (mis) tempLights.push({x: p.x, y: p.y, r: 10, i: 1.2, c: [.75, .5, 1], life: .2, max: .2}); }
        projectiles.splice(i, 1);
      }
      continue;
    }
    for (let n = 0; n < 3 + p.pow * 5; n++) particles.push({x: p.x + (rnd() - .5) * (.8 + p.pow * 2), y: p.y, z: p.z + (rnd() - .5) * .8, vx: -p.vx * .08 + (rnd() - .5) * 3, vy: -p.vy * .08, vz: rnd() * 2, g: 0, life: .25 + rnd() * .25, max: .5, ch: rnd() < .5 ? "*" : ".", c0: [255, 200, 110], c1: [200, 40, 10]});
    const hit = BLK[Math.floor(p.y) * W + Math.floor(p.x)] && matAt(p.x, p.y) !== 1 || bodiesFor(p.owner).some(d => gdist(d.x, d.y, p.x, p.y) < fireRadius(p.pow));
    if (hit || p.life <= 0) { explode(p.x, p.y, p.pow, p.dmg, p.own); projectiles.splice(i, 1); }
  }
  // charging a fireball: embers spiral into the sword hand, faster as it fills
  if (charge.on) {
    charge.t += dt;
    const pw = chargePower(), slam = charge.kind === "slam", hx = player.x + (slam ? 0 : player.face * 1.2), hy = player.y;
    if (charge.t > CHARGE_MIN) { // the ground trembles as the power swells; particles are drawn in toward it
      shake = Math.max(shake, .04 + pw * .14);
      const c = colOf(charge.kind), hot = c.map(v => Math.min(255, v + 60)), chs = (spellOf(charge.kind) || {chs: ".,`"}).chs;
      for (let n = 0; n < 1 + pw * 3; n++) {
        const a = rnd() * 6.283, r = (slam ? 5 : 3) + rnd() * 3;
        particles.push({x: hx + Math.cos(a) * r, y: hy + Math.sin(a) * r / VS, z: slam ? .3 : 3 + rnd() * 2, vx: -Math.cos(a) * r * 4, vy: -Math.sin(a) * r * 4 / VS, vz: slam ? 1 : -1, g: 0, life: .22, max: .22, ch: chs[rnd() * chs.length | 0], c0: hot, c1: c});
      }
    }
  }
  for (let i = tempLights.length - 1; i >= 0; i--) { tempLights[i].life -= dt; if (tempLights[i].life <= 0) tempLights.splice(i, 1); }
  updateCombat(dt); updateDelayed(dt);

  // campfire flames
  if (gdist(cam.x, cam.y, S.x, S.y) < 250) {
    fireAcc += dt * 34;
    while (fireAcc > 1) {
      fireAcc--;
      particles.push({x: S.x + (rnd() - .5) * 3, y: S.y - .2, z: .3, vx: (rnd() - .5) * 1.2, vy: 0, vz: 3 + rnd() * 3.5, g: 0, life: .5 + rnd() * .5, max: 1, ch: ["^", "*", "'", "^", "."][rnd() * 5 | 0], c0: [255, 228, 130], c1: [180, 36, 14]});
      if (rnd() < .05) particles.push({x: S.x, y: S.y, z: 2, vx: (rnd() - .5) * 3, vy: 0, vz: 6 + rnd() * 5, g: 0, life: 1.6, max: 1.6, ch: ".", c0: [255, 190, 90], c1: [120, 30, 10]});
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz += p.g * dt;
    if (p.z < 0) { p.z = 0; p.vz *= -.3; p.vx *= .6; p.vy *= .6; }
  }
  const PCAP = (isTouch ? 420 : 1400) * QUALITY[quality].fx; // phones draw every particle: keep the count sane
  if (particles.length > PCAP) particles.splice(0, particles.length - PCAP);

  // wisps + fireflies
  for (const w of wisps) {
    w.x = G.x + Math.sin(time * .23 + w.k) * 30 + Math.sin(time * .61 + w.k * 3) * 6;
    w.y = G.y + Math.cos(time * .17 + w.k * 2) * 11;
    w.z = 3 + Math.sin(time * 1.3 + w.k) * 1;
  }
  for (const f of fireflies) {
    if (gdist(f.x, f.y, player.x, player.y) > 140) respawnFly(f);
    f.x += Math.sin(time * f.s + f.ph) * dt * 2; f.y += Math.cos(time * f.s * 1.3 + f.ph) * dt;
  }

  // regions
  const reg = regionAt(player.x, player.y);
  if (reg !== region) {
    region = reg; $("region").textContent = reg;
    if (!visited.has(reg)) {
      visited.add(reg);
      const xp = REGION_XP[reg] || 0;
      if (xp) { banner(reg, `Discovered · +${xp} XP`); addLog(`Discovered ${reg}. +${xp} XP`, "System", "gold"); gainXP(xp); }
    } else addLog(`Entered ${reg}.`, "System", "sys");
  }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $("banner").classList.remove("show"); }
}

/* ============================== render ============================== */
let glowSprites = {};
function glowSprite(rgb) {
  const key = rgb.join(",");
  if (glowSprites[key]) return glowSprites[key];
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${key},.9)`); g.addColorStop(.35, `rgba(${key},.28)`); g.addColorStop(1, `rgba(${key},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return glowSprites[key] = c;
}
const sx = wx => wx * CW - TLx, sy = wy => wy * CH - TLy;
const glyphCache = new Map(); let glyphFont = "";
function glyphImg(ch, r, g, b) {
  if (glyphFont !== FONT) { glyphCache.clear(); glyphFont = FONT; } // zoom / resize changed the cell size
  const q = v => clamp(v | 0, 0, 255) >> 4; // 16 shades per channel keeps the cache small
  const key = ch + (q(r) << 8 | q(g) << 4 | q(b));
  let c = glyphCache.get(key);
  if (!c) {
    if (glyphCache.size > 3000) glyphCache.clear();
    const w = Math.ceil(CW * 2), h = Math.ceil(CH * 1.5);
    c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.font = FONT; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = `rgb(${q(r) * 17},${q(g) * 17},${q(b) * 17})`; x.fillText(ch, w / 2, h / 2);
    glyphCache.set(key, c);
  }
  return c;
}
function glyph(ch, wx, wy, r, g, b, a = 1) {
  const X = sx(wx), Y = sy(wy);
  if (X < -CW || Y < -CH || X > Wpx + CW || Y > Hpx + CH) return;
  const c = glyphImg(ch, r, g, b);
  octx.globalAlpha = a; octx.drawImage(c, (X - c.width / 2) | 0, (Y - c.height / 2) | 0);
}
function glow(wx, wy, rgb, sizeCells, a) {
  const s = sizeCells * CW, X = sx(wx), Y = sy(wy);
  if (X < -s || Y < -s || X > Wpx + s || Y > Hpx + s) return;
  octx.globalAlpha = a; octx.drawImage(glowSprite(rgb), X - s / 2, Y - s / 2, s, s);
}
function occluded(x, y) {
  for (const o of occluders) if (y < o.yBase - .2 && y > o.yTop + 1 && x > o.x0 - .5 && x < o.x1 + .5 && y - 6 < o.yBase) return true;
  return false;
}
/* facing -> one of 8 compass directions (screen down = south / facing camera) */
const DIR8 = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
// [frame, mirrored]: the pixel-art hero idle faces front-right, so it mirrors for the left side
const IDLE8 = {E: ["idle_hero", false], SE: ["idle_hero", false], S: ["idle_hero", false], SW: ["idle_hero", true], W: ["idle_hero", true], NW: ["idle_N", false], N: ["idle_N", false], NE: ["idle_N", false]};
const ATK_COMBO = ["atk_hslash", "atk_vslash", "atk_thrust", "atk_spin"];
function dir8(dx, dy) { return DIR8[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]; }
// which baked frame to show right now; combat poses face right on the sheet, so they mirror for left
function knightPose() {
  const d = dir8(player.dx, player.dy), left = player.face < 0;
  if (player.dead || player.hurt > 0) return {fr: "hit", flip: left};
  if (player.roll) return {fr: player.roll.t < ROLL_TIME ? "roll" : "get_up", flip: player.roll.dx < -.1 || (Math.abs(player.roll.dx) <= .1 && left)};
  if (player.slam) return {fr: player.slam.t < SLAM_AIR * .45 ? "jump_start" : player.slam.t < SLAM_AIR ? "jump_air" : "land", flip: left};
  if (charge.on && charge.kind === "slam" && charge.t > CHARGE_MIN) return {fr: "crouch", flip: left};
  if (player.atk > 0) {
    const p = 1 - player.atk / .26;
    return {fr: p < .22 ? "atk_wind" : p < .8 ? ATK_COMBO[player.combo] : "atk_recover", flip: left};
  }
  if (player.recoil > 0) return {fr: player.recoil > .1 ? "atk_thrust" : "atk_recover", flip: left};
  if (player.shieldUp > .5) return {fr: "block_front", flip: left};
  if (player.moving) return {fr: `run8_${d}_${Math.floor(player.anim) % 6}`, flip: false};
  return {fr: IDLE8[d][0], flip: IDLE8[d][1]};
}
// stride (optional): {s: -1..1 leg phase, side: true for side/diagonal views}. The sheet's run frames
// barely move their legs, so the leg area is split at the feet centre and the two halves are animated
// in opposition: side views scissor (skew), front/back views lift one leg then the other (squash).
function drawSprite(k, flip, x, y, tilt, sX, sY, lift, stride) {
  const spr = flip ? k.L : k.R, w = k.w, h = k.h, ax = Math.round(flip ? w - k.ax : k.ax);
  octx.save();
  octx.translate(Math.round(sx(x)), Math.round(sy(y) + CH * .4));
  octx.rotate(tilt); octx.scale(sX, sY);
  if (!stride) { octx.drawImage(spr, -ax, -h - lift); octx.restore(); return; }
  const legH = Math.round(h * .38), top = h - legH, s = stride.s;
  octx.drawImage(spr, 0, 0, w, top, -ax, -h - lift, w, top);
  const half = (sx0, sw, sign) => {
    if (sw <= 0) return;
    octx.save(); octx.translate(0, -legH - lift);
    if (stride.side) {
      octx.transform(1, 0, sign * s * .55, 1, 0, 0);
      octx.drawImage(spr, sx0, top, sw, legH, sx0 - ax, 0, sw, legH);
    } else {
      const up = Math.max(0, sign * s) * .3; // this leg is the one lifting
      octx.drawImage(spr, sx0, top, sw, legH, sx0 - ax, 0, sw, legH * (1 - up));
    }
    octx.restore();
  };
  half(0, ax, 1); half(ax, w - ax, -1);
  octx.restore();
}
// The local knight's draw parameters this frame (also what gets sent to other players, lift in CH units)
function knightParams() {
  const pose = knightPose();
  let lift = 0, tilt = 0, sX = 1, sY = 1, stride = null;
  if (player.moving && player.atk <= 0) {
    // one stride per 6 run frames: legs swing, body rises when the legs are spread and dips between steps
    const ph = player.anim / 6 * Math.PI * 2, s = Math.sin(ph), d = dir8(player.dx, player.dy);
    const side = d !== "N" && d !== "S";
    stride = {s, side};
    lift = Math.abs(s) * CH * (player.running ? .7 : .5);
    sY = 1 - .04 * Math.cos(ph * 2); // squash a little as each foot lands
    tilt = side ? player.dx * .07 + s * .02 : s * .05; // lean into the run / rock side to side
  } else if (player.slam) { // leap arc, then a squash on landing
    const s = player.slam;
    if (s.t < SLAM_AIR) lift = Math.sin(s.t / SLAM_AIR * Math.PI) * CH * (4 + s.pow * 4);
    else { const k = (s.t - SLAM_AIR) / SLAM_LAND; sY = 1 - .12 * (1 - k); sX = 1 + .1 * (1 - k); }
  } else if (player.atk <= 0 && !player.roll) {
    // breathing: chest rises (taller, a touch narrower) and the body sways slightly
    const br = Math.sin(time * 2.4);
    sY = 1 + .035 * br; sX = 1 - .012 * br;
    tilt = Math.sin(time * 1.2) * .012;
  }
  if (player.atk > 0) { const p = 1 - player.atk / .26; sX = 1 + .05 * Math.sin(p * Math.PI); }
  if (player.dead) { tilt = player.face * Math.min(1.4, (DEATH_TIME - player.dead) * 4); sY = .9; }
  return {fr: pose.fr, flip: pose.flip, lift: lift / CH, tilt, sX, sY, ss: stride ? stride.s : null, side: stride ? stride.side : false};
}
function drawKnight() {
  const p = knightParams();
  // sprint afterimages
  octx.globalCompositeOperation = "lighter";
  for (const g of ghosts) { octx.globalAlpha = g.life / .22 * .28; if (KN[g.fr]) drawSprite(KN[g.fr], g.flip, g.x, g.y, 0, 1, 1, CH * .3); }
  octx.globalCompositeOperation = "source-over";
  drawKnightAt(player.x, player.y, p, net.color, net.name, net.team, player.face, player.dead ? .5 : player.stealth ? .45 : 1, isProtected(), myClass, player.hp / player.mhp);
}
// any knight, local or remote: shadow, team ring, sprite, visor glow, name tag
function drawKnightAt(x, y, p, ci, name, team, face, alpha, prot, ki = 0, hpk = 1) {
  const set = knSet(ci, ki), k = set[p.fr], cls = CLASSES[ki] || CLASSES[0];
  if (!k) return;
  const occ = occluded(x, y), lift = p.lift * CH;
  octx.globalAlpha = (occ ? .25 : .55) * alpha; octx.fillStyle = "#000";
  const sh = 1 - lift / (CH * 2);
  octx.beginPath(); octx.ellipse(sx(x), sy(y - .1), CW * 3.4 * sh, CH * .7 * sh, 0, 0, 6.283); octx.fill();
  if (net.mode === "tdm") { // team ring at the feet
    octx.globalAlpha = .8 * alpha; octx.strokeStyle = TEAM_COL[team]; octx.lineWidth = 1.5 * dpr;
    octx.beginPath(); octx.ellipse(sx(x), sy(y - .1), CW * 3.8, CH * .8, 0, 0, 6.283); octx.stroke();
  }
  octx.globalAlpha = (occ ? .42 : 1) * alpha * (prot ? .55 + .3 * Math.sin(time * 18) : 1);
  drawSprite(k, p.flip, x, y, p.tilt, p.sX, p.sY, lift, p.ss === null ? null : {s: p.ss, side: p.side});
  octx.globalCompositeOperation = "lighter";
  glow(x + (face > 0 ? .8 : -.8), y - (k.h + lift) / CH * .82, cls.visor, 3.4, (.45 + .15 * Math.sin(time * 3)) * alpha);
  classAura(x, y, ki, alpha, hpk);
  octx.globalCompositeOperation = "source-over";
  octx.font = `600 ${Math.round(10 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`;
  octx.globalAlpha = .85 * alpha; octx.fillStyle = net.mode === "tdm" ? TEAM_COL[team] : `rgb(${PALETTE[ci].map(v => Math.min(255, v + 70)).join(",")})`;
  octx.fillText(`${cls.icon} ${name}`, sx(x), sy(y) - k.h - lift - 2 * dpr);
  octx.font = FONT;
}
function render() {
  // camera transform
  const shx = shake > 0 ? (rnd() - .5) * shake * 14 * dpr : 0, shy = shake > 0 ? (rnd() - .5) * shake * 10 * dpr : 0;
  TLx = Math.round(cam.x * CW - Wpx / 2 + shx); TLy = Math.round(cam.y * CH - Hpx / 2 + shy);
  OX = Math.floor(TLx / CW) - 1; OY = Math.floor(TLy / CH) - 1;
  const lights = gatherLights();
  const LA = new Float32Array(MAX_LIGHTS * 4), LC = new Float32Array(MAX_LIGHTS * 4);
  lights.forEach((l, i) => { LA.set([l.x, l.y, l.r, l.i], i * 4); LC.set([l.c[0], l.c[1], l.c[2], 0], i * 4); });

  // pass 1: per-cell colour + glyph index
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, SW, SH);
  gl.useProgram(P1.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texWorld); gl.uniform1i(P1.u.uWorld, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texMat); gl.uniform1i(P1.u.uMat, 1);
  gl.uniform2f(P1.u.uWS, W, H); gl.uniform2f(P1.u.uOrigin, OX, OY); gl.uniform1f(P1.u.uTime, time);
  // lightning lights up the whole landscape for an instant, cold and blue
  gl.uniform3f(P1.u.uAmb, AMB[0] * (1 + skyFlash * 1.6), AMB[1] * (1 + skyFlash * 1.8), AMB[2] * (1 + skyFlash * 2.2)); gl.uniform1f(P1.u.uVS, VS);
  gl.uniform4fv(P1.u.uL, LA); gl.uniform4fv(P1.u.uLC, LC);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // pass 2: draw glyphs
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, Wpx, Hpx);
  gl.useProgram(P2.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texCells); gl.uniform1i(P2.u.uCells, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texAtlas); gl.uniform1i(P2.u.uAtlas, 1);
  gl.uniform2f(P2.u.uSize, SW, SH); gl.uniform2f(P2.u.uOrigin, OX, OY); gl.uniform2f(P2.u.uCellPx, CW, CH);
  gl.uniform2f(P2.u.uTL, TLx, TLy); gl.uniform2f(P2.u.uRes, Wpx, Hpx); gl.uniform1f(P2.u.uN, [...ATLAS].length);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // overlay: entities, particles, light blooms
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, Wpx, Hpx);
  octx.font = FONT; octx.textAlign = "center"; octx.textBaseline = "middle";
  drawResidueGround();
  octx.globalCompositeOperation = "lighter";
  for (const l of lights) if (l.pri !== 100) glow(l.x, l.y - (l.c[2] > .9 ? 1 : 0), [255, 150, 60].map((v, j) => Math.round(l.c[j] * 255)), l.r * .55, .1 * l.i);
  for (const f of fireflies) {
    const a = Math.max(0, Math.sin(time * 2.2 * f.s + f.ph)); if (a < .05) continue;
    glow(f.x, f.y - f.z, [190, 255, 120], 3.5, .35 * a); glyph("·", f.x, f.y - f.z, 220, 255, 150, a);
  }
  for (const w of wisps) { glow(w.x, w.y - w.z, [140, 255, 190], 9, .5); glyph("o", w.x, w.y - w.z, 210, 255, 225, .95); }
  drawWaystones();
  octx.globalCompositeOperation = "source-over";
  // dummies and knights, back to front
  const ents = dummies.map(d => ({y: d.y, f: () => drawDummy(d)}));
  for (const p of livePeers()) if (p.p) ents.push({y: p.y, f: () => { const hid = p.stealth && isEnemy(p.id); drawKnightAt(p.x, p.y, p.p, colorOf(p.id), hid ? "" : p.name, teamOf(p.id), p.face, p.dead ? .5 : hid ? .1 : p.stealth ? .5 : 1, p.prot, p.cls || 0, p.hp / (p.mhp || 1)); if (!hid) drawRemoteExtras(p); }});
  ents.push({y: player.y, f: drawKnight});
  ents.sort((a, b) => a.y - b.y);
  drawBlades(true);
  for (const e of ents) e.f();
  drawBlades(false);
  drawSmoke();
  octx.globalCompositeOperation = "lighter";
  drawShieldWard();
  drawResidueGlow();
  drawDelayed();
  for (const p of projectiles) {
    const kind = p.kind || "fire", a = Math.atan2(p.vy * VS, p.vx);
    if (kind === "wave") { // a crescent of light, bowed forward
      glow(p.x, p.y - p.z, [170, 210, 255], p.r * 2.4, .6);
      const pa = ((a + Math.PI / 2) % Math.PI + Math.PI) % Math.PI, ch = pa < .39 || pa > 2.75 ? "-" : pa < 1.18 ? "\\" : pa < 1.96 ? "|" : "/";
      for (let k = -4; k <= 4; k++) { const o = k / 4 * p.r, bow = (1 - (k / 4) ** 2) * 1.6; glyph(ch, p.x + Math.cos(a) * bow - Math.sin(a) * o, p.y - p.z + (Math.sin(a) * bow + Math.cos(a) * o) / VS, 240, 248, 255, .95); }
      continue;
    }
    if (kind === "missile") { glow(p.x, p.y - p.z, [180, 110, 255], 5, .9); glyph("o", p.x, p.y - p.z, 245, 225, 255, 1); continue; }
    if (kind === "dagger") {
      const da = ((a % Math.PI) + Math.PI) % Math.PI, ch = da < .39 || da > 2.75 ? "-" : da < 1.18 ? "\\" : da < 1.96 ? "|" : "/";
      glow(p.x, p.y - p.z, [120, 255, 190], 3, .5); glyph(ch, p.x, p.y - p.z, 230, 255, 240, 1); continue;
    }
    const R = fireRadius(p.pow);
    glow(p.x, p.y - p.z, [255, 140, 40], 9 + R * 3.4 * p.pow, .9); glow(p.x, p.y - p.z, [255, 230, 160], 3.5 * (1 + p.pow * 2), 1);
    glyph("@", p.x, p.y - p.z, 255, 250, 225, 1);
    if (p.pow > .15) { // fireball: churning rings of flame filling its (bigger) hit area
      const n = 6 + (p.pow * 14 | 0);
      for (let k = 0; k < n; k++) {
        const a = time * (9 - (k % 2) * 4) * (k % 2 ? -1 : 1) + k * 6.283 / n + p.ph, r = (k % 2 ? .55 : .9) * R;
        glyph(["*", "o", "@", "+"][k % 4], p.x + Math.cos(a) * r, p.y - p.z + Math.sin(a) * r / VS, 255, 150 + (k * 9) % 90, 50, .85);
      }
    }
  }
  if (charge.on && (charge.kind !== "slam" || charge.t > CHARGE_MIN)) drawCharge();
  for (const p of particles) {
    if (p.delay > 0) continue;
    const t = 1 - p.life / p.max, c = p.c0.map((v, j) => v + (p.c1[j] - v) * t);
    glyph(p.ch, p.x, p.y - p.z, c[0], c[1], c[2], Math.min(1, p.life / p.max * 1.6));
  }
  drawBolts();
  if (screenFlash > 0) { octx.globalAlpha = screenFlash; octx.fillStyle = "#c8dcff"; octx.fillRect(0, 0, Wpx, Hpx); }
  if (fxFlash.a > 0) { octx.globalAlpha = fxFlash.a; octx.fillStyle = fxFlash.c; octx.fillRect(0, 0, Wpx, Hpx); }
  octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1;
  drawFloaters();
  drawPointers();
  drawHitMarks();
  if (player.dead) { // respawn countdown
    octx.globalAlpha = .9; octx.textAlign = "center"; octx.textBaseline = "middle";
    octx.font = `700 ${Math.round(26 * dpr)}px "Cinzel", Georgia, serif`; octx.fillStyle = "#f0d8c8";
    octx.fillText(`Respawning in ${Math.max(1, Math.ceil(player.dead))}`, Wpx / 2, Hpx * .62);
    octx.font = FONT;
  }
  octx.globalAlpha = 1;
}


/* ============================== class spell kits ============================== */
/* Each class has its own three spells on F / G / R (phone: the three spell buttons). Sword, shield, dash and
   the hold-Space ground slam are shared. Every spell charges: hold to pour in mana for more damage, size,
   count or distance. Spells live in "slots" s1/s2/s3 so keys, buttons, cooldowns and charging stay generic. */
const SLOT_KEYS = ["s1", "s2", "s3"];
const spellCd = {s1: 0, s2: 0, s3: 0};
const KITS = [
  [ // Knight: holy steel
    {id: "wave", name: "Crescent Wave", icon: ")", cost: 14, cd: .55, full: 1.2, col: [200, 225, 255], chs: ")(", desc: "a wide blade wave that passes through everything in its path", cast: castWave},
    {id: "judgment", name: "Judgment", icon: "‡", cost: 20, cd: 1.2, full: 1.3, col: [255, 215, 110], chs: "+'", desc: "a pillar of golden light slams down on the aim point", cast: castJudgment},
    {id: "blades", name: "Summon Blades", icon: "†", cost: BLADE_COST, cd: BLADE_CD, full: 1.6, col: [190, 215, 255], chs: "|'", desc: "giant homing swords", cast: pow => castBlades(pow)},
  ],
  [ // Berserker: fire
    {id: "fire", name: "Fireball", icon: "*", cost: ORB_COST, cd: .35, full: 1.6, col: [255, 130, 40], chs: "*+", desc: "hold to pour all your mana into one fireball", cast: (pow, dx, dy) => castDir(dx, dy, pow)},
    {id: "leap", name: "Inferno Leap", icon: "^", cost: 18, cd: 1.4, full: 1.1, col: [255, 120, 40], chs: "^'", desc: "leap onto the target and land in an explosion of fire", cast: castLeap},
    {id: "erupt", name: "Eruption", icon: "✸", cost: 30, cd: 3, full: 1.4, col: [255, 90, 30], chs: "^*", desc: "a ring of fire bursts out around you and keeps burning", cast: castEruption},
  ],
  [ // Sorcerer: arcane
    {id: "missiles", name: "Arcane Missiles", icon: "∴", cost: 12, cd: .5, full: 1.3, col: [200, 140, 255], chs: "o·", desc: "a volley of strongly homing violet orbs", cast: castMissiles},
    {id: "bolt", name: "Chain Lightning", icon: "ϟ", cost: BOLT_COST, cd: BOLT_CD, full: 1.4, col: [120, 180, 255], chs: "-/\\", desc: "a spark that calls lightning and chains between targets", cast: pow => castBolt(pow)},
    {id: "meteor", name: "Meteor", icon: "☄", cost: 32, cd: 3.2, full: 1.6, col: [255, 140, 60], chs: "*@", desc: "a meteor falls on the target after a short warning", cast: castMeteor},
  ],
  [ // Shadow: smoke and steel
    {id: "daggers", name: "Shadow Daggers", icon: "≡", cost: 10, cd: .45, full: 1.1, col: [150, 255, 200], chs: "-'", desc: "a fan of fast knives", cast: castDaggers},
    {id: "strike", name: "Shadowstrike", icon: "↯", cost: 16, cd: 2.5, full: 1, col: [120, 255, 190], chs: "~.", desc: "vanish and reappear behind the nearest enemy, stabbing them in the back", cast: castStrike},
    {id: "smoke", name: "Smoke Bomb", icon: "◍", cost: 26, cd: 6, full: 1.2, col: [150, 175, 165], chs: "~≈", desc: "a cloud that hides you from enemies and poisons them", cast: castSmoke},
  ],
];
const kit = (ki = myClass) => KITS[ki] || KITS[0];
const spellOf = kind => { const i = SLOT_KEYS.indexOf(kind); return i < 0 ? null : kit()[i]; };
const SLAM_COL = [230, 200, 150];
const colOf = kind => kind === "slam" ? SLAM_COL : (spellOf(kind) || {col: SLAM_COL}).col;
const LEGACY_READY = {fire: () => cd <= 0, bolt: () => boltCd <= 0, blades: () => bladeCd <= 0};
function slotReady(kind) {
  const sp = spellOf(kind); if (!sp) return false;
  return spellCd[kind] <= 0 && (!LEGACY_READY[sp.id] || LEGACY_READY[sp.id]());
}
// cast a slot's spell now (pow 0..1); used by charge release, the hotbar and taps
function castSlot(kind, pow, dx, dy) {
  const sp = spellOf(kind); if (!sp || !slotReady(kind) || player.dead || player.roll || player.slam) return;
  const mp0 = player.mp;
  sp.cast(pow, dx, dy, kind);
  if (player.mp < mp0) spellCd[kind] = sp.cd; // only start the cooldown if it actually went off
}
function refreshKitUI() { // hotbar slots 2-4 and the phone spell buttons show this class's spells
  kit().forEach((sp, i) => {
    const b = $("slot" + (i + 2)); if (b) { b.childNodes[1].textContent = sp.icon; b.title = `${sp.name} · ${sp.cost} MP · ${["F", "G", "R"][i]} · ${sp.desc} · hold to charge`; }
    const t = $(["castBtn", "boltBtn", "bladeBtn"][i]); if (t) { t.textContent = sp.icon; t.setAttribute("aria-label", sp.name); }
  });
  const ds = DASHES[myClass], b = $("slot6");
  if (b) { b.childNodes[1].textContent = ds.icon; b.title = `${ds.name} · C or Ctrl · ${ds.desc}`; }
  const rb = $("rollBtn"); if (rb) { rb.textContent = ds.icon; rb.setAttribute("aria-label", ds.name); }
}
// pay a spell's (charged) cost; returns the mana spent, or -1 if you can't afford it
function payFor(kind, pow) { const c = chargeCost(pow, kind); if (player.mp < c) { noMana(); return -1; } player.mp -= c; player.recoil = .2 + pow * .1; return c; }
// where a targeted spell lands: the cursor on desktop, ahead of you on touch; snaps onto a nearby enemy
function aimTarget(range, snap = 8) {
  let tx, ty;
  if (!isTouch && mouseXY.seen) [tx, ty] = screenToWorld(mouseXY.x, mouseXY.y);
  else { tx = player.x + player.dx * range * .75; ty = player.y + player.dy * range * .75 / VS; }
  let vx = tx - player.x, vy = (ty - player.y) * VS; const l = Math.hypot(vx, vy);
  if (l > range) { vx *= range / l; vy *= range / l; tx = player.x + vx; ty = player.y + vy / VS; }
  let best = null, bd = snap;
  for (const d of targets()) { if (d.stealth) continue; const dd = gdist(d.x, d.y, tx, ty); if (dd < bd) { bd = dd; best = d; } }
  if (best) { tx = best.x; ty = best.y; }
  if (l > .5) { player.dx = vx / l; player.dy = vy / l; if (Math.abs(vx) > .5) player.face = vx > 0 ? 1 : -1; }
  return [tx, ty];
}
const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
function faceDir(dx) { if (Math.abs(dx) > .2) player.face = dx > 0 ? 1 : -1; }
function shoot(p) { projectiles.push({...p, own: true, owner: selfId, hits: new Set()}); return p; }

// ---- Knight ----
function castWave(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  [dx, dy] = unit(dx, dy); faceDir(dx); player.dx = dx; player.dy = dy; player.atk = .26;
  const sp = 78, p = shoot({kind: "wave", x: player.x + dx * 2, y: player.y + dy / VS, z: 3, vx: dx * sp, vy: dy * sp / VS, life: .55 + pow * .3, ph: 0, pow, dmg: c * 3.4, r: 3.4 + pow * 3.5});
  netFx({k: "proj", p}); sfx.slash(3); sfx.zap(.4);
}
function castJudgment(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  const [x, y] = aimTarget(32), j = {x, y, t: 0, delay: .6, r: 4.6 + pow * 3.4, dmg: c * 2.9, pow};
  judgments.push({...j, own: true}); netFx({k: "judg", j}); sfx.bladeSummon(.6);
}
// ---- Berserker ----
function castLeap(pow, dx, dy, kind) {
  if (slamCd > 0) return;
  const c = payFor(kind, pow); if (c < 0) return;
  const [tx, ty] = aimTarget(24 + pow * 14, 6);
  // land on the last open spot along the way
  let x1 = player.x, y1 = player.y; const L = gdist(player.x, player.y, tx, ty), n = Math.ceil(L / .6);
  for (let i = 1; i <= n; i++) { const x = player.x + (tx - player.x) * i / n, y = player.y + (ty - player.y) * i / n; if (blockedAt(x, y) || matAt(x, y) === 1) break; x1 = x; y1 = y; }
  player.slam = {t: 0, pow, hit: false, dx: player.dx, dy: player.dy, leap: {x0: player.x, y0: player.y, x1, y1}, dmg: c * 3.3};
  sfx.dash();
}
function eruptFx(x, y, pow, own) {
  const R = 9 + pow * 6;
  shakeAt(x, y, .55 + pow * .4); sfx.explode(.7 + pow * .5, ...heard(x, y));
  rings.push({x, y, r: 2, r1: R * 1.5, t: 0, life: .45, c: [255, 120, 40]}); rings.push({x, y, r: 1, r1: R, t: -.06, life: .4, c: [255, 210, 120]});
  tempLights.push({x, y, r: 34 + pow * 20, i: 3, c: [1, .5, .15], life: .6, max: .6});
  for (let k = 0; k < (isTouch ? 40 : 80); k++) { const a = rnd() * 6.283, s = 10 + rnd() * 24; particles.push({x, y, z: .5, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 6 + rnd() * 10, g: -14, life: .5 + rnd() * .5, max: 1, ch: ["^", "*", "'"][k % 3], c0: [255, 230, 140], c1: [200, 40, 10]}); }
  for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; addResidue("fire", x + Math.cos(a) * R * .55, y + Math.sin(a) * R * .55 / VS, 2.6 + pow * 1.5, own); }
}
function castEruption(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  const R = 9 + pow * 6, dmg = c * 2.6;
  hitDummies(player.x, player.y, R, (d, dist) => damage(d, dmg * (1 - .4 * dist / R), "fire"));
  hitstop = Math.max(hitstop, .06); screenFlashAdd(.1 + pow * .1, "#ff9a50");
  eruptFx(player.x, player.y, pow, true); netFx({k: "erupt", x: player.x, y: player.y, pow});
}
// ---- Sorcerer ----
function castMissiles(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  [dx, dy] = unit(dx, dy); faceDir(dx); player.dx = dx; player.dy = dy;
  const n = 3 + Math.round(pow * 4), base = Math.atan2(dy, dx), ps = [];
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * (1.1 / n), sp = 60 + rnd() * 10;
    ps.push(shoot({kind: "missile", x: player.x + Math.cos(a) * 2, y: player.y + Math.sin(a) / VS, z: 3.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp / VS, life: 1.1 + pow * .3, ph: rnd() * 6, pow: 0, dmg: c * 4.6 / n * 1.15, turn: 5}));
  }
  netFx({k: "projs", ps}); sfx.zap(); sfx.teleport(.25);
}
function castMeteor(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  const [x, y] = aimTarget(38, 6), m = {x, y, t: 0, fall: .95, pow: .4 + pow * .6, dmg: c * 5};
  meteors.push({...m, own: true}); netFx({k: "meteor", m}); sfx.fireCast(.7);
}
// ---- Shadow ----
function castDaggers(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  [dx, dy] = unit(dx, dy); faceDir(dx); player.dx = dx; player.dy = dy; player.atk = .2;
  const n = 3 + Math.round(pow * 4), spread = .45 + pow * .35, base = Math.atan2(dy, dx), ps = [];
  for (let i = 0; i < n; i++) {
    const a = base + (n > 1 ? (i / (n - 1) - .5) * spread : 0), sp = 125;
    ps.push(shoot({kind: "dagger", x: player.x + Math.cos(a) * 2, y: player.y + Math.sin(a) / VS, z: 3.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp / VS, life: .34 + pow * .12, ph: 0, pow: 0, dmg: c * 2.4}));
  }
  netFx({k: "projs", ps}); sfx.slash(0); sfx.slash(1, .6);
}
function smokePuff(x, y, n = 24) {
  for (let k = 0; k < n; k++) { const a = rnd() * 6.283, s = 3 + rnd() * 9; particles.push({x, y, z: rnd() * 5, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 1 + rnd() * 3, g: 0, life: .7 + rnd() * .6, max: 1.3, ch: ["~", "≈", "."][k % 3], c0: [150, 175, 165], c1: [30, 40, 36]}); }
}
// walk a straight line from the player and return the last open spot within `dist` (stops at walls / deep water)
function openAlong(dx, dy, dist) {
  let x1 = player.x, y1 = player.y; const n = Math.ceil(dist / .6);
  for (let i = 1; i <= n; i++) { const x = player.x + dx * dist * i / n, y = player.y + dy * dist * i / n / VS; if (blockedAt(x, y) || matAt(x, y) === 1) break; x1 = x; y1 = y; }
  return [x1, y1];
}
function castStrike(pow, dx, dy, kind) {
  // the nearest enemy roughly where you're aiming (or anywhere close), not hidden in smoke
  const range = 30 + pow * 14;
  let t = seekTarget(player.x, player.y, ...unit(dx, dy), 1.4, range);
  if (!t) for (const d of targets()) if (!d.stealth && gdist(d.x, d.y, player.x, player.y) < range * .6 && (!t || gdist(d.x, d.y, player.x, player.y) < gdist(t.x, t.y, player.x, player.y))) t = d;
  if (!t) { addLog("Shadowstrike: no enemy in reach.", "System", "warn"); return; }
  const c = payFor(kind, pow); if (c < 0) return;
  const back = -(t.face || (player.x < t.x ? 1 : -1)); // the side they're turned away from
  let x1 = t.x + back * 3.2, y1 = t.y;
  if (blockedAt(x1, y1) || matAt(x1, y1) === 1) { x1 = t.x - back * 3.2; if (blockedAt(x1, y1) || matAt(x1, y1) === 1) { x1 = t.x; y1 = t.y + 1.5; } }
  const from = [player.x, player.y];
  smokePuff(from[0], from[1]); player.x = x1; player.y = y1; smokePuff(x1, y1, 16);
  player.face = t.x > x1 ? 1 : -1; player.dx = player.face; player.dy = 0; player.atk = .26;
  player.prot = Math.max(player.prot, performance.now() + 250);
  netFx({k: "blink", a: from, b: [x1, y1]}); sfx.teleport(.7); sfx.slash(2);
  const was = player.stealth; player.stealth = true; // the strike from nowhere counts as a backstab
  damage(t, 70 + c * 3, "phys"); t.jit = .4;
  player.stealth = was;
  hitstop = Math.max(hitstop, .1); shake = Math.max(shake, .3);
  rings.push({x: t.x, y: t.y, r: 1, r1: 6, t: 0, life: .25, c: [120, 255, 190]});
}
function castSmoke(pow, dx, dy, kind) {
  const c = payFor(kind, pow); if (c < 0) return;
  const r = 7 + pow * 4, life = 5 + pow * 2;
  addResidue("smoke", player.x, player.y, r, true, life); smokePuff(player.x, player.y, 40);
  netFx({k: "smoke", x: player.x, y: player.y, r, life}); sfx.fireCast(0, .6);
}

// delayed area spells
const judgments = [], meteors = [], rifts = [];
function updateDelayed(dt) {
  for (const k of SLOT_KEYS) spellCd[k] = Math.max(0, spellCd[k] - dt);
  for (let i = rifts.length - 1; i >= 0; i--) {
    const r = rifts[i]; r.t += dt;
    if (r.t >= RIFT_DELAY) { riftBurst(r); rifts.splice(i, 1); }
  }
  for (let i = judgments.length - 1; i >= 0; i--) {
    const j = judgments[i]; j.t += dt;
    if (!j.fired && j.t >= j.delay) {
      j.fired = true;
      if (j.own) hitDummies(j.x, j.y, j.r, (d, dist) => damage(d, j.dmg * (1 - .4 * dist / j.r), "holy"));
      shakeAt(j.x, j.y, .45); const [v, pan] = heard(j.x, j.y, 120); sfx.thunder(v * .6, pan); sfx.hit(1, v, pan);
      rings.push({x: j.x, y: j.y, r: 1, r1: j.r * 1.6, t: 0, life: .4, c: [255, 225, 140]});
      tempLights.push({x: j.x, y: j.y, r: 40, i: 3.2, c: [1, .88, .55], life: .5, max: .5});
      if (gdist(j.x, j.y, player.x, player.y) < 60) screenFlashAdd(.1, "#fff1c4");
      for (let k = 0; k < 40; k++) { const a = rnd() * 6.283, r = rnd() * j.r; particles.push({x: j.x + Math.cos(a) * r, y: j.y + Math.sin(a) * r / VS, z: rnd() * 2, vx: 0, vy: 0, vz: 10 + rnd() * 16, g: 0, life: .5, max: .5, ch: ["+", "'", "|"][k % 3], c0: [255, 250, 220], c1: [255, 180, 60]}); }
    }
    if (j.t > j.delay + .55) judgments.splice(i, 1);
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.t += dt;
    const k = Math.min(1, m.t / m.fall), mx = m.x + (1 - k) * 22, my = m.y - (1 - k) * 46;
    if (rnd() < .9) particles.push({x: mx, y: my, z: 0, vx: 8, vy: -14, vz: 0, g: 0, life: .4, max: .4, ch: ["*", "'", "."][(rnd() * 3) | 0], c0: [255, 220, 140], c1: [160, 40, 10]});
    if (m.t >= m.fall) { explode(m.x, m.y, m.pow, m.dmg, m.own); meteors.splice(i, 1); }
  }
  // Shadow: standing inside your own smoke hides you from enemies
  player.stealth = !player.dead && residues.some(r => r.kind === "smoke" && r.own && gdist(r.x, r.y, player.x, player.y) < r.r * .85);
}
function drawDelayed() {
  for (const r of rifts) { // a tear in the air where the Sorcerer stood, folding in on itself
    const k = r.t / RIFT_DELAY, R = riftR(r.b);
    glow(r.x, r.y - 2, [170, 90, 255], R * (1.4 - k * .6), .5 + .4 * k);
    for (let i = 0; i < 12; i++) {
      const a = time * 7 + i * .5236, d = R * (1 - k * .7) * (.4 + (i % 3) * .3);
      glyph(i % 2 ? "*" : "·", r.x + Math.cos(a) * d, r.y - 2 + Math.sin(a) * d / VS, 220, 180, 255, .9);
    }
  }
  for (const j of judgments) {
    const X = sx(j.x), Y = sy(j.y);
    if (!j.fired) { // a shrinking golden ring warns where the light will fall
      const k = j.t / j.delay;
      octx.globalAlpha = .5 + .5 * k; octx.lineWidth = 2 * dpr; octx.strokeStyle = "rgb(255,220,130)";
      octx.beginPath(); octx.ellipse(X, Y, j.r * CW * (1.6 - k * .6), j.r / VS * CH * (1.6 - k * .6), 0, 0, 6.283); octx.stroke();
      glow(j.x, j.y, [255, 210, 110], j.r * 2, .3 + .3 * k);
    } else { // the pillar of light
      const k = (j.t - j.delay) / .55, w = Math.max(j.r * CW * 1.2, 16 * dpr) * (1 - k * .5), top = Y - Math.max(60 * CH, 400 * dpr);
      const g = octx.createLinearGradient(0, Y, 0, top);
      g.addColorStop(0, `rgba(255,245,210,${.9 * (1 - k)})`); g.addColorStop(.4, `rgba(255,210,110,${.45 * (1 - k)})`); g.addColorStop(1, "rgba(255,200,100,0)");
      octx.globalAlpha = 1; octx.fillStyle = g; octx.fillRect(X - w / 2, top, w, Y - top);
      glow(j.x, j.y, [255, 230, 160], j.r * 3, (1 - k) * .9);
    }
  }
  for (const m of meteors) {
    const k = Math.min(1, m.t / m.fall), mx = m.x + (1 - k) * 22, my = m.y - (1 - k) * 46;
    octx.globalAlpha = .25 + .45 * k; octx.lineWidth = 1.5 * dpr; octx.strokeStyle = "rgb(255,90,50)"; // landing warning
    octx.beginPath(); octx.ellipse(sx(m.x), sy(m.y), (6 + m.pow * 6) * CW, (6 + m.pow * 6) / VS * CH, 0, 0, 6.283); octx.stroke();
    glow(mx, my, [255, 120, 40], 10 + m.pow * 8, 1); glyph("@", mx, my, 255, 240, 200, 1);
  }
}
function drawSmoke() { // smoke clouds drift over everything inside them
  for (const r of residues) {
    if (r.kind !== "smoke") continue;
    const k = Math.min(1, r.life / r.max * 3), n = isTouch ? 26 : 50;
    for (let i = 0; i < n; i++) {
      const a = i * 2.399 + time * (.2 + (i % 5) * .05), d = Math.sqrt((i + .5) / n) * r.r;
      const x = r.x + Math.cos(a) * d, y = r.y + Math.sin(a) * d / VS - 1.5 - Math.sin(time + i) * .8;
      glyph(i % 3 ? "~" : "≈", x, y, 120 + (i % 4) * 12, 140 + (i % 4) * 10, 132, .55 * k);
    }
  }
}

/* ============================== dashes and class signatures ============================== */
/* Tap the dash for a quick dodge (a moment of invulnerability). Keep holding it and the dash carries on as a
   steerable sprint at almost twice running speed, burning mana every moment (no regen while sprinting).
   Each class also has one thing nobody else has:
   Knight - Shield Charge: his dash bowls over anyone in the way (damage + shove). Blocking a hit refunds mana.
   Berserker - Bloodlust: under 40% HP his sword hits 40% harder and heals him for a fifth of the damage.
   Sorcerer - Phase Shift: instead of rolling he teleports. It burns ALL his mana into a rift left where he stood
     (it detonates a moment later, harder the more mana it ate). Mana keeps regenerating; the shift has a 5 s cooldown.
   Shadow - Backstab: sword hits from behind or from inside smoke always crit. Sprinting costs her half. */
const DASH_KEYS = new Set(["KeyC", "Digit6", "ControlLeft"]);
const SURGE_SPEED = 92, SURGE_MP = 26, KNOCK_T = .22, BLOOD_HP = .4, BLOCK_MP = 8;
const PHASE_CD = 5, PHASE_DIST = 26, RIFT_DELAY = .55;
const DASHES = [
  {name: "Shield Charge", icon: "⛨", desc: "dash through enemies, knocking them back · hold to keep charging (drains mana)"},
  {name: "Rampage", icon: "»", desc: "dodge roll · hold to keep sprinting (drains mana)"},
  {name: "Phase Shift", icon: "✧", desc: "teleport; leaves all your mana behind as an exploding rift · 5 s cooldown"},
  {name: "Shadow Dash", icon: "»", desc: "dodge roll · hold to sprint at half the mana cost"},
];
let dashHeld = false;
const dashHits = new Map();
function shieldCharge() { // Knight: anyone the dash runs into is hit and shoved aside (once per 0.6 s each)
  if (myClass !== 0 || player.dead) return;
  const r = player.roll, s = player.surge;
  if (!(r && r.t < ROLL_TIME) && !s) return;
  const dx = s ? s.dx : r.dx, dy = s ? s.dy : r.dy;
  for (const d of targets()) {
    if (d.dead || gdist(d.x, d.y, player.x, player.y) > 4 || time - (dashHits.get(d) || -9) < .6) continue;
    dashHits.set(d, time);
    const sx_ = d.x - player.x, sy_ = (d.y - player.y) * VS, l = Math.hypot(sx_, sy_) || 1;
    const px = (dx * .6 + sx_ / l * .4) * 46, py = (dy * .6 + sy_ / l * .4) * 46; // mostly along the charge, a bit outward
    damage(d, 46, "phys", [px, py]); d.jit = .4;
    shake = Math.max(shake, .3); hitstop = Math.max(hitstop, .06);
    rings.push({x: d.x, y: d.y, r: 1, r1: 5, t: 0, life: .2, c: [190, 220, 255]});
    sfx.bladeImpact(.8);
  }
}
const riftR = b => 5 + b / 12;
function riftBurst(r) {
  const R = riftR(r.b);
  if (r.own) hitDummies(r.x, r.y, R, (d, dist) => damage(d, (20 + r.b * 2.2) * (1 - .4 * dist / R), "arcane"));
  shakeAt(r.x, r.y, .35 + r.b / 200); sfx.thunder(...heard(r.x, r.y, 100));
  rings.push({x: r.x, y: r.y, r: 1, r1: R * 1.5, t: 0, life: .35, c: [200, 140, 255]});
  rings.push({x: r.x, y: r.y, r: R * 1.5, r1: 1, t: 0, life: .3, c: [255, 230, 255]}); // implodes, then bursts
  tempLights.push({x: r.x, y: r.y, r: 30 + r.b / 3, i: 2.6, c: [.7, .45, 1], life: .45, max: .45});
  for (let k = 0; k < (isTouch ? 30 : 60); k++) { const a = rnd() * 6.283, s = 8 + rnd() * 22; particles.push({x: r.x, y: r.y, z: 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: (rnd() - .5) * 10, g: 0, life: .4 + rnd() * .4, max: .8, ch: ["*", "·", "+", "'"][k % 4], c0: [240, 220, 255], c1: [110, 50, 220]}); }
}
function phaseFx(x0, y0, x1, y1) { // a violet streak between the two points and a flash at both ends
  for (let k = 0; k < 20; k++) { const u = k / 19; particles.push({x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, z: 3 + (rnd() - .5) * 2, vx: 0, vy: 0, vz: 0, g: 0, delay: u * .06, life: .3, max: .3, ch: "·", c0: [235, 210, 255], c1: [110, 50, 220]}); }
  for (const [x, y] of [[x0, y0], [x1, y1]]) for (let k = 0; k < 14; k++) { const a = rnd() * 6.283, s = 6 + rnd() * 10; particles.push({x, y, z: 2 + rnd() * 3, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 2, g: 0, life: .4, max: .4, ch: "*", c0: [240, 220, 255], c1: [120, 60, 230]}); }
  sfx.teleport(...heard(x1, y1));
}
function phaseShift() {
  if (player.dead || player.slam) return;
  if (player.rollCd > 0) return;
  let ix = (keys.r ? 1 : 0) - (keys.l ? 1 : 0) + stick.x, iy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0) + stick.y;
  if (Math.hypot(ix, iy) < .1 && !isTouch && mouseXY.seen) { const [tx, ty] = screenToWorld(mouseXY.x, mouseXY.y); ix = tx - player.x; iy = (ty - player.y) * VS; }
  if (Math.hypot(ix, iy) < .1) { ix = player.dx; iy = player.dy; }
  [ix, iy] = unit(ix, iy);
  const [x1, y1] = openAlong(ix, iy, PHASE_DIST), x0 = player.x, y0 = player.y;
  const burned = Math.floor(player.mp);
  player.mp = 0; player.rollCd = PHASE_CD; charge.on = false; player.shield = false;
  player.x = x1; player.y = y1; player.dx = ix; player.dy = iy; faceDir(ix);
  player.prot = Math.max(player.prot, performance.now() + 300); // slips whatever was about to land
  rifts.push({x: x0, y: y0, t: 0, b: burned, own: true});
  phaseFx(x0, y0, x1, y1); netFx({k: "rift", a: [x0, y0], b: [x1, y1], burned});
}

/* ============================== waystone travel ============================== */
// Stand by a waystone and press E (or tap Travel) to pick another; a short channel, then you're there.
const TP_CHANNEL = .6;
let nearWay = null;
let ambT = 0;
function updateSound(dt) {
  audio.chargeHum(charge.on && charge.t > CHARGE_MIN ? chargePower() : -1);
  ambT -= dt; if (ambT > 0) return; ambT = .25;
  const water = clamp(1 - Math.min(riverDist(player.x, player.y), lakeDist(player.x, player.y)) / 30, 0, 1);
  let fire = 0; for (const l of staticLights) if (l.kind === "fire") fire = Math.max(fire, clamp(1 - gdist(l.x, l.y, player.x, player.y) / 40, 0, 1));
  audio.ambience(water, fire);
}
function updateTravel(dt) {
  updateSound(dt);
  nearWay = null;
  if (!player.dead) for (const w of WAYSTONES) if (gdist(player.x, player.y, w.x, w.y) < 7) { nearWay = w; break; }
  if (nearWay && !player.dead) { // standing in a waystone's light pours mana back in
    player.mp = Math.min(player.mmp, player.mp + WAYSTONE_MP * dt);
    if (player.mp < player.mmp && rnd() < dt * 12) particles.push({x: player.x + (rnd() - .5) * 4, y: player.y, z: rnd() * 2, vx: 0, vy: 0, vz: 5 + rnd() * 4, g: 0, life: .6, max: .6, ch: "+", c0: [150, 190, 255], c1: [90, 70, 230]});
  }
  $("travelBtn").hidden = !nearWay || !!player.tp || !$("lobby").hidden;
  if (!nearWay && !$("travel").hidden) $("travel").hidden = true;
  const tp = player.tp; if (!tp) return;
  tp.t += dt;
  if (player.dead || player.moving) { player.tp = null; addLog("Travel interrupted.", "System", "warn"); return; }
  for (let k = 0; k < 3; k++) { // runes spiral up around him while it channels
    const a = rnd() * 6.283, r = 3 + rnd() * 2;
    particles.push({x: player.x + Math.cos(a) * r, y: player.y + Math.sin(a) * r / VS, z: .3, vx: -Math.sin(a) * 8, vy: Math.cos(a) * 8 / VS, vz: 6 + rnd() * 6, g: 0, life: .4, max: .4, ch: ["ᚱ", "*", "+", "'"][k % 4], c0: [220, 200, 255], c1: [110, 70, 230]});
  }
  if (tp.t >= TP_CHANNEL) {
    const from = {x: player.x, y: player.y}, w = tp.dest;
    player.tp = null;
    player.x = w.x + (rnd() - .5) * 4; player.y = w.y + 3; cam.x = player.x; cam.y = player.y - 3;
    tpBurst(from.x, from.y); tpBurst(player.x, player.y); sfx.teleport();
    netFx({k: "tp", a: [from.x, from.y], b: [player.x, player.y]});
    banner(w.name, "waystone");
  }
}
// Waystones drawn live on top of the world so they read from far away: a pillar of light, a floating
// crystal, a slowly turning ring of runes on the ground and the destination's name.
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹ";
function drawWaystones() {
  const L = 4.6 * CH;
  for (const w of WAYSTONES) {
    const X = sx(w.x), Y = sy(w.y);
    if (X < -200 * dpr || X > Wpx + 200 * dpr || Y < -100 * dpr || Y > Hpx + 300 * dpr) continue;
    const near = w === nearWay, pulse = .75 + .25 * Math.sin(time * 2.2 + w.x);
    // pillar of light rising from the stone
    const bw = Math.max((near ? 3 : 2.2) * CW, (near ? 16 : 12) * dpr), top = Y - Math.max(46 * CH, 260 * dpr); // stays bold when zoomed out
    const g = octx.createLinearGradient(0, Y, 0, top);
    g.addColorStop(0, `rgba(210,175,255,${.7 * pulse})`); g.addColorStop(.3, `rgba(150,105,255,${.32 * pulse})`); g.addColorStop(1, "rgba(120,80,255,0)");
    octx.globalAlpha = 1; octx.fillStyle = g; octx.fillRect(X - bw / 2, top, bw, Y - top);
    glow(w.x, w.y, [170, 120, 255], near ? 22 : 16, .55 * pulse);
    // ring of runes turning on the ground, with a glowing circle under them
    octx.strokeStyle = `rgba(180,140,255,${.55 * pulse})`; octx.lineWidth = 2 * dpr;
    octx.beginPath(); octx.ellipse(X, sy(w.y + 1), Math.max(6 * CW, 30 * dpr), Math.max(2.6 * CH, 11 * dpr), 0, 0, 6.283); octx.stroke();
    for (let k = 0; k < RUNES.length; k++) {
      const a = k / RUNES.length * 6.283 + time * .6;
      glyph(RUNES[k], w.x + Math.cos(a) * 6, w.y + 1 + Math.sin(a) * 2.6, 200, 170, 255, .6 + .4 * Math.sin(time * 3 + k));
    }
    // floating crystal above the obelisk
    const cw = Math.max(1.4 * CW, 8 * dpr), ch = Math.max(L * .5, 20 * dpr), cy = Y - Math.max(12 * CH, 64 * dpr) + Math.sin(time * 1.8 + w.y) * .6 * CH;
    glow(w.x, (cy + TLy) / CH, [200, 160, 255], near ? 12 : 9, .9);
    octx.save(); octx.translate(X, cy); octx.scale(Math.cos(time * 1.4 + w.x) * .35 + .75, 1);
    const cg = octx.createLinearGradient(-cw, 0, cw, 0);
    cg.addColorStop(0, "#f6efff"); cg.addColorStop(.5, "#b490ff"); cg.addColorStop(1, "#6a3fd8");
    octx.globalAlpha = .95; octx.fillStyle = cg;
    octx.beginPath(); octx.moveTo(0, -ch); octx.lineTo(cw, 0); octx.lineTo(0, ch * .6); octx.lineTo(-cw, 0); octx.closePath(); octx.fill();
    octx.restore();
    // name, always readable
    octx.globalCompositeOperation = "source-over";
    octx.font = `700 ${Math.round(10 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`; octx.lineJoin = "round";
    const label = `◆ ${w.name}`, ly = cy - ch - 6 * dpr;
    octx.globalAlpha = .9; octx.lineWidth = 3 * dpr; octx.strokeStyle = "rgba(10,5,25,.9)"; octx.strokeText(label, X, ly);
    octx.fillStyle = near ? "#ffffff" : "#d9c6ff"; octx.fillText(label, X, ly);
    if (near) { octx.font = `600 ${Math.round(9 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`; octx.fillStyle = "#e4d6ff"; const hint = isTouch ? "waystone · +MP · tap Travel" : "waystone · +MP · E to travel"; octx.strokeText(hint, X, ly - 12 * dpr); octx.fillText(hint, X, ly - 12 * dpr); }
    octx.font = FONT; octx.globalCompositeOperation = "lighter";
  }
  octx.globalAlpha = 1;
}
function tpBurst(x, y) {
  rings.push({x, y, r: 1, r1: 10, t: 0, life: .4, c: [180, 140, 255]});
  tempLights.push({x, y, r: 26, i: 2.2, c: [.7, .5, 1], life: .45, max: .45});
  for (let k = 0; k < 30; k++) { const a = rnd() * 6.283, s = 4 + rnd() * 12; particles.push({x, y, z: rnd() * 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 4 + rnd() * 8, g: 0, life: .5 + rnd() * .4, max: .9, ch: ["*", "+", "'", "."][k % 4], c0: [235, 220, 255], c1: [100, 60, 220]}); }
}
// The travel screen is the whole world map: every waystone is a pin you can pick, you see where you are,
// and other knights show as dots (enemies red-ringed), so you can choose where to go by eye.
function openTravel() {
  if (!nearWay || player.dead) return;
  const cv = $("travelCanvas"), pins = $("travelPins");
  const aspect = H * VS / W; // map rows are squashed in the world view; stretch them back for the map
  const cw = Math.round(Math.min(innerWidth * .92, innerHeight * .74 / aspect, 720)), ch = Math.round(cw * aspect);
  cv.style.width = cw + "px"; cv.style.height = ch + "px"; cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  const x = cv.getContext("2d");
  x.imageSmoothingEnabled = true; x.drawImage(miniSrc, 0, 0, cv.width, cv.height);
  x.fillStyle = "rgba(6,4,16,.28)"; x.fillRect(0, 0, cv.width, cv.height);
  // paths between waystones read as faint lines from here
  x.strokeStyle = "rgba(190,160,255,.25)"; x.lineWidth = dpr; x.setLineDash([3 * dpr, 4 * dpr]);
  for (const w of WAYSTONES) { if (w === nearWay) continue; x.beginPath(); x.moveTo(nearWay.x / W * cv.width, nearWay.y / H * cv.height); x.lineTo(w.x / W * cv.width, w.y / H * cv.height); x.stroke(); }
  x.setLineDash([]);
  for (const p of livePeers()) {
    if (p.dead) continue;
    const px = p.x / W * cv.width, py = p.y / H * cv.height;
    x.fillStyle = `rgb(${PALETTE[colorOf(p.id)].map(v => Math.min(255, v + 60)).join(",")})`; x.beginPath(); x.arc(px, py, 3 * dpr, 0, 6.283); x.fill();
    if (isEnemy(p.id)) { x.strokeStyle = "#ff4b3e"; x.lineWidth = 1.5 * dpr; x.beginPath(); x.arc(px, py, 5 * dpr, 0, 6.283); x.stroke(); }
  }
  pins.textContent = "";
  const pin = (w, cls, label, onPick) => {
    const b = document.createElement("button"); b.className = "pin " + cls;
    b.style.left = (w.x / W * 100) + "%"; b.style.top = (w.y / H * 100) + "%";
    const t = document.createElement("span"); t.textContent = label; b.appendChild(t);
    if (onPick) b.addEventListener("click", e => { e.stopPropagation(); onPick(); }); else b.disabled = true;
    pins.appendChild(b);
  };
  for (const w of WAYSTONES) {
    if (w === nearWay) { pin(w, "here", `${w.name} · you are here`); continue; }
    pin(w, "dest", `${w.name} · ${Math.round(gdist(w.x, w.y, player.x, player.y))}m`, () => { $("travel").hidden = true; player.tp = {t: 0, dest: w}; charge.on = false; });
  }
  $("travel").hidden = false;
}
$("travelBtn").addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); $("travel").hidden ? openTravel() : ($("travel").hidden = true); });
$("travelClose").addEventListener("click", e => { e.stopPropagation(); $("travel").hidden = true; });
$("travel").addEventListener("click", e => { if (e.target.id === "travel") $("travel").hidden = true; }); // click outside the map

/* ============================== multiplayer ============================== */
/* No server, no sign-in. Everyone in a mode's room connects directly (src/net.js). Each peer draws a random
   rank on load; the lowest rank present is the host (assigns cape colours and teams, keeps score, owns the
   training dummies) and broadcasts that shared state twice a second. The next two ranks are standby hosts.
   Every peer holds the latest snapshot, so when the host leaves the next rank simply carries on from it.
   Combat is "owner decides": your own spells test hits against what you see and tell the victim, who
   applies it (rolling = dodge, shield = 80% block) and announces their own death. */
const PALETTE = [[170, 30, 40], [40, 90, 210], [40, 150, 70], [210, 165, 40], [135, 60, 195], [40, 170, 190], [225, 110, 30], [215, 80, 155], [215, 215, 225], [30, 120, 110], [130, 85, 45], [95, 95, 110]];
const TEAM_COL = ["#ff6b5e", "#62a8ff"], TEAM_NAME = ["Red", "Blue"];
const MODES = {ffa: {name: "Free for All", goal: 15}, tdm: {name: "Team Deathmatch", goal: 30}, practice: {name: "Practice", goal: 0}};
const DEATH_TIME = 3.5, SPAWN_PROT = 2, ROUND_BREAK = 8;
const NAMES = ["Aldric", "Brann", "Cedric", "Daria", "Elyse", "Fenn", "Garrick", "Hale", "Isolde", "Joren", "Kael", "Lyra", "Maren", "Nyx", "Orin", "Perrin", "Rowan", "Sable", "Tamsin", "Wren"];
let savedName = ""; try { savedName = localStorage.getItem("gk.name") || ""; } catch (e) {}
const freshHS = () => ({mode: null, colors: {}, teams: {}, score: {}, teamScore: [0, 0], winner: null, resetIn: 0, round: 0, dummies: []});
const net = {
  mode: "practice", want: "practice", api: null, name: savedName || NAMES[Math.random() * NAMES.length | 0] + "-" + (10 + Math.random() * 90 | 0),
  rank: Math.random(), color: 0, team: 0, host: true, backup: false, curHost: null, curHostT: 0, joinT: 0, placed: false,
  peers: new Map(), hs: freshHS(), dirty: false, sendT: 0, snapT: 0, resetAt: 0, round: 0, winner: null,
};
const nameOf = id => id === selfId ? net.name : (net.peers.get(id) || {}).name || "someone";
const teamOf = id => net.hs.teams[id] ?? (id === selfId ? net.team : 0);
const colorOf = id => net.hs.colors[id] ?? 0;
const isEnemyOf = (a, b) => a !== b && net.mode !== "practice" && (net.mode !== "tdm" || teamOf(a) !== teamOf(b));
const isEnemy = id => isEnemyOf(selfId, id);
const livePeers = () => [...net.peers.values()].filter(p => p.hello && p.buf.length);
// what my attacks can hit: training dummies plus enemy knights
function targets() {
  const t = dummies.filter(d => !d.dead);
  for (const p of livePeers()) if (!p.dead && !p.prot && isEnemy(p.id)) t.push(p);
  return t;
}
// what a projectile from `owner` can visibly collide with (it only *damages* if it's mine)
function bodiesFor(owner) {
  if (owner === selfId || !owner) return targets();
  const b = dummies.filter(d => !d.dead);
  if (!player.dead && isEnemyOf(owner, selfId)) b.push(player);
  for (const p of livePeers()) if (!p.dead && p.id !== owner && isEnemyOf(owner, p.id)) b.push(p);
  return b;
}
// how loud and where (stereo) a sound at x,y should be for this player: fades out over `range`
function heard(x, y, range = 90) { return [clamp(1 - gdist(x, y, player.x, player.y) / range, 0, 1), clamp((x - player.x) / 40, -1, 1)]; }
function netFx(f) { if (net.api) net.api.send("fx", f); }
function shakeAt(x, y, amt) { shake = Math.max(shake, amt * clamp(1.2 - gdist(x, y, player.x, player.y) / 70, 0, 1)); }

function members() {
  const m = [{id: selfId, rank: net.rank}], now = performance.now();
  for (const p of net.peers.values()) if (p.hello && now - (p.heard || 0) < 8000) m.push({id: p.id, rank: p.rank}); // silent peers can't host
  return m.sort((a, b) => a.rank - b.rank);
}
// The current host stays host for as long as it's online. Only when no live host is known does the
// lowest random rank take over (everyone computes the same answer, so no negotiation is needed).
function electHost() {
  if (!net.api) { net.host = true; return; }
  const m = members(), ids = new Set(m.map(e => e.id)), was = net.host;
  const cur = net.curHost && ids.has(net.curHost) && (net.curHost === selfId || performance.now() - net.curHostT < 3000) ? net.curHost : null;
  if (cur) net.host = cur === selfId;
  else net.host = performance.now() - net.joinT > 2500 && m[0].id === selfId; // newcomers first listen for an existing host
  if (net.host && !was) {
    net.curHost = selfId; net.hs.hostSince = Date.now();
    if (m.length > 1) addLog("The host left: you are now hosting this realm.", "System", "sys");
  }
  const successors = m.filter(e => e.id !== (cur || m[0].id)).slice(0, 2);
  net.backup = successors.some(e => e.id === selfId);
}

// Everyone joins the one shared realm. If you're the first one there (you become host), your pick sets the
// mode; otherwise you follow whatever the host is running. The host can switch modes any time.
async function joinRealm(want) {
  net.want = want; net.mode = want;
  $("status").querySelector(".nm").textContent = net.name;
  applyClass(myClass);
  net.host = false; net.joinT = performance.now(); net.connecting = true;
  respawn();
  const turn = await fetchTurn(); // relay credentials for networks that block direct connections
  net.turnOk = turn.iceServers.some(s => [].concat(s.urls).some(u => String(u).startsWith("turn")));
  net.joinT = performance.now(); net.connecting = false;
  net.api = connect(() => ({name: net.name, rank: net.rank, cls: myClass}), {
    hello(d, id) {
      let p = net.peers.get(id);
      if (!p) { p = {id, buf: [], x: 0, y: 0, hp: 120, mhp: 120, dead: false, prot: false, face: 1, p: null}; net.peers.set(id, p); }
      if (!p.hello) addLog(`${d.name} entered the realm.`, "General", "sys");
      Object.assign(p, {hello: true, name: String(d.name).slice(0, 16), rank: +d.rank, cls: clamp(d.cls | 0, 0, CLASSES.length - 1), heard: performance.now()});
    },
    leave(id) { const p = net.peers.get(id); if (p && p.hello) addLog(`${p.name} left the realm.`, "General", "sys"); net.peers.delete(id); },
    st(a, id) {
      const p = net.peers.get(id); if (!p) return;
      p.heard = performance.now();
      p.buf.push({t: performance.now(), x: a[0], y: a[1], p: {fr: a[2], flip: !!a[3], lift: a[4], tilt: a[5], sX: a[6], sY: a[7], ss: a[8], side: !!a[9]},
        hp: a[10], mhp: a[11], dead: !!a[12], face: a[13], ck: a[14], cp: a[15], prot: !!a[16], sh: a[17], stealth: !!a[18]});
      if (p.buf.length > 12) p.buf.shift();
    },
    fx(f, id) { onFx(f, id); },
    hit(h, id) { applyHit(h.dmg, h.kind, id, h.x, h.y, h.kx, h.ky); },
    dh(h) { if (net.host) hostDummyHit(h.i, h.dmg, h.kind); },
    kill(k, id) { onKill(k.by, id); },
    snap(s, id) { applySnap(s, id); },
    joinError() { // usually a network (mobile data, strict wifi) that blocks direct peer connections
      if (!net.joinErrs) net.joinErrs = 0;
      if (net.joinErrs++ === 0) { addLog("A direct link to a knight failed; linking through the relays instead (a little laggier).", "System", "sys"); }
    },
  }, turn.iceServers);
  addLog("Entering the arena. Players who can't connect directly are linked through public relays (a little laggier).", "System", "sys");
}
function setRealmMode(m) { // host only: everyone follows into the new mode with fresh scores
  if (!net.host || !MODES[m]) return;
  const hs = net.hs;
  hs.mode = m; hs.score = {}; hs.teamScore = [0, 0]; hs.teams = {}; hs.winner = null; hs.round++;
  net.dirty = true;
}

// replay someone else's attack as visuals (their client decides what it hit)
function onFx(f, id) {
  const p = net.peers.get(id); if (!p || !p.buf.length) return;
  const [v, pan] = heard(p.x, p.y);
  if (f.k === "fire") sfx.fireCast(f.p.pow, v, pan); else if (f.k === "spark") sfx.zap(v, pan); else if (f.k === "blades") sfx.bladeSummon(v); else if (f.k === "sl") sfx.slash(f.c, v, pan);
  if (f.k === "fire") projectiles.push({...f.p, own: false, owner: id});
  else if (f.k === "spark") sparks.push({...f.s, t: 0, own: false, owner: id});
  else if (f.k === "blades") for (const b of f.b) blades.push({...b, own: false, who: p});
  else if (f.k === "slam") slamFx(f.x, f.y, f.pow);
  else if (f.k === "proj") projectiles.push({...f.p, own: false, owner: id});
  else if (f.k === "projs") for (const q of f.ps) projectiles.push({...q, own: false, owner: id});
  else if (f.k === "judg") judgments.push({...f.j, own: false});
  else if (f.k === "meteor") meteors.push({...f.m, own: false});
  else if (f.k === "boom") explode(f.x, f.y, f.pow, f.dmg, false);
  else if (f.k === "erupt") eruptFx(f.x, f.y, f.pow, false);
  else if (f.k === "rift") { phaseFx(f.a[0], f.a[1], f.b[0], f.b[1]); rifts.push({x: f.a[0], y: f.a[1], t: 0, b: f.burned, own: false}); }
  else if (f.k === "blink") { smokePuff(f.a[0], f.a[1]); smokePuff(f.b[0], f.b[1]); sfx.teleport(...heard(f.b[0], f.b[1])); }
  else if (f.k === "smoke") { addResidue("smoke", f.x, f.y, f.r, false, f.life); smokePuff(f.x, f.y, 30); }
  else if (f.k === "tp") { tpBurst(f.a[0], f.a[1]); tpBurst(f.b[0], f.b[1]); sfx.teleport(...heard(f.b[0], f.b[1])); }
  else if (f.k === "sl") {
    const base = Math.atan2(f.dy, f.dx), s = p.face || 1;
    if (f.c === 3) { swoosh(base, 0, 6.283, 6.5, 3.4, .14, p); swoosh(base, Math.PI, 6.283, 5, 2.2, .14, p); }
    else swoosh(base, -1.25 * s, 2.5 * s, 6, 3.6, .09, p);
  }
}

// I've been hit by someone else's attack
function applyHit(dmg, kind, by, ax, ay, kx, ky) {
  if (player.dead || isProtected() || net.winner) return;
  if (player.roll && player.roll.t < ROLL_TIME) { floaters.push({x: player.x, y: player.y - 8, text: "DODGE", c: [200, 230, 255], big: .9, life: .8, max: .8, vx: 0}); return; }
  let blocked = false;
  if (player.shieldUp > .5 && ax !== undefined && Math.sign(ax - player.x || player.face) === player.face) { dmg *= .2; blocked = true; } // the shield faces where he faces
  dmg = Math.max(1, Math.round(dmg));
  player.hp = Math.max(0, player.hp - dmg); player.hurt = blocked ? 0 : .25; player.lastHurt = time;
  if (blocked && myClass === 0) { player.mp = Math.min(player.mmp, player.mp + BLOCK_MP); floaters.push({x: player.x, y: player.y - 11, text: `+${BLOCK_MP} MP`, c: [130, 190, 255], big: .8, life: .8, max: .8, vx: 0}); }
  if (!blocked && Number.isFinite(kx) && Number.isFinite(ky)) player.knock = {vx: clamp(kx, -60, 60), vy: clamp(ky, -60, 60), t: KNOCK_T};
  if (ax !== undefined && !blocked) hitMarks.push({a: Math.atan2((ay - player.y) * VS, ax - player.x), t: 0, k: Math.min(1, .35 + dmg / 80)});
  if (blocked) sfx.bladeImpact(.7); else sfx.hurt();
  floaters.push({x: player.x + (rnd() - .5) * 2, y: player.y - 7, text: (blocked ? "BLOCK " : "-") + dmg, c: blocked ? [255, 226, 160] : [255, 92, 80], big: 1 + Math.min(1, dmg / 120), life: 1.1, max: 1.1, vx: (rnd() - .5) * 4});
  shake = Math.max(shake, blocked ? .15 : .3); hitstop = Math.max(hitstop, .05);
  if (!blocked) screenFlashAdd(Math.min(.3, .08 + dmg / 400), "#ff2a20");
  if (player.hp <= 0) die(by);
}
function die(by) {
  sfx.death();
  player.dead = DEATH_TIME; player.hp = 0; charge.on = false; player.shield = false; player.roll = null; player.slam = null; player.surge = null; player.knock = null;
  banner("You were slain", `by ${nameOf(by)}`);
  for (let k = 0; k < 50; k++) { const a = rnd() * 6.283, s = 4 + rnd() * 14; particles.push({x: player.x, y: player.y, z: 2 + rnd() * 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s / VS, vz: 4 + rnd() * 8, g: -20, life: .8 + rnd() * .6, max: 1.4, ch: ["*", "'", ".", "+"][k % 4], c0: [255, 140, 120], c1: [90, 20, 20]}); }
  if (net.api) net.api.send("kill", {by});
  onKill(by, selfId);
}
const ARENA_R = 70; // everyone fights in one place: the clearing around the Stone Circle
function spawnPoint() { // somewhere open in the arena, preferring spots far from enemies
  let best = null, bestD = -1;
  for (let k = 0; k < 80; k++) {
    const a = rnd() * 6.283, r = 14 + Math.sqrt(rnd()) * ARENA_R, x = S.x + Math.cos(a) * r, y = S.y + Math.sin(a) * r / VS, m = matAt(x, y);
    if (blockedAt(x, y) || m === 1 || m === 4 || m === 2) continue;
    let dmin = 999;
    for (const p of livePeers()) if (!p.dead && isEnemy(p.id)) dmin = Math.min(dmin, gdist(x, y, p.x, p.y));
    if (dmin > bestD) { bestD = dmin; best = {x, y}; }
    if (dmin > 50) break;
  }
  return best || {x: S.x, y: S.y + 16};
}
/* Kills make you stronger for the rest of the round: each one adds damage, max HP and max MP and heals you.
   The bonus is wiped when a new round starts, so every match begins even. */
// max HP never grows, so a player on a streak can always be brought down; damage and mana are what scale
const KILL_DMG = .06, KILL_DMG_CAP = .6, KILL_HP = 0, KILL_HP_CAP = 0, KILL_MP = 12, KILL_MP_REFILL = 40, KILL_HEAL = .15;
function killBonus() {
  sfx.kill();
  const kb = player.kb;
  const hpGain = Math.max(0, Math.min(KILL_HP, KILL_HP_CAP - kb.hp));
  kb.kills++; kb.dmg = Math.min(KILL_DMG_CAP, kb.dmg + KILL_DMG); kb.hp += hpGain; kb.mp += KILL_MP;
  player.mhp += hpGain; player.mmp += KILL_MP;
  player.hp = Math.min(player.mhp, player.hp + player.mhp * KILL_HEAL); player.mp = Math.min(player.mmp, player.mp + KILL_MP_REFILL);
  floaters.push({x: player.x, y: player.y - 9, text: `+${Math.round(KILL_DMG * 100)}% DMG  +${KILL_MP} MAX MP`, c: [255, 214, 120], big: 1.1, life: 1.6, max: 1.6, vx: 0});
  addLog(`Kill bonus: +${Math.round(kb.dmg * 100)}% damage, ${player.mmp} max MP (${kb.kills} kill${kb.kills === 1 ? "" : "s"} this round).`, "General", "gold");
}
function resetKillBonus() {
  const kb = player.kb;
  player.mhp -= kb.hp; player.mmp -= kb.mp;
  player.kb = {kills: 0, dmg: 0, hp: 0, mp: 0};
}
const isProtected = () => performance.now() < player.prot;
function respawn(why = "join") {
  if (why === "new round") resetKillBonus();
  console.info(`[gizmo-knight] respawn: ${why}`); // so any unexpected teleport is easy to trace
  const p = spawnPoint();
  player.x = p.x; player.y = p.y; cam.x = p.x; cam.y = p.y - 3;
  player.hp = player.mhp; player.mp = player.mmp; player.dead = 0; player.hurt = 0;
  player.prot = performance.now() + (net.mode === "practice" ? 0 : SPAWN_PROT * 1000); // wall clock: a paused tab doesn't stay invulnerable
}
// a death: everyone logs it, the host keeps score
const STREAKS = {2: "Double Kill", 3: "Killing Spree", 5: "Rampage", 7: "Unstoppable", 10: "Godlike"};
const clsOf = id => id === selfId ? myClass : ((net.peers.get(id) || {}).cls || 0);
function feed(by, victim) { // compact kill feed under the minimap; entries fade out after a few seconds
  const el = document.createElement("div"); el.className = "kf" + (by === selfId ? " me" : victim === selfId ? " dead" : "");
  const who = id => { const s = document.createElement("span"); s.textContent = `${CLASSES[clsOf(id)].icon} ${nameOf(id)}`; return s; };
  if (by && by !== victim) { el.append(who(by)); el.append(" ⟶ "); }
  el.append(who(victim));
  const box = $("killfeed"); box.prepend(el); while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => el.classList.add("fade"), 5000); setTimeout(() => el.remove(), 6000);
}
function onKill(by, victim) {
  const msg = by === victim || !by ? `${nameOf(victim)} fell.` : `${nameOf(by)} slew ${nameOf(victim)}.`;
  addLog(msg, "General", by === selfId ? "gold" : victim === selfId ? "warn" : "");
  feed(by, victim);
  if (by === selfId && victim !== selfId) {
    gainXP(25); killBonus(); player.streak = (player.streak || 0) + 1;
    const s = STREAKS[player.streak];
    if (s) { banner(s, `${player.streak} kills without dying`); screenFlashAdd(.12, "#ffe2a0"); } else banner("Enemy slain", nameOf(victim));
  }
  if (victim === selfId) player.streak = 0;
  if (!net.host || net.hs.winner) return;
  const sc = net.hs.score;
  (sc[victim] ||= [0, 0])[1]++;
  if (by && by !== victim) {
    (sc[by] ||= [0, 0])[0]++;
    if (net.mode === "tdm" && teamOf(by) !== teamOf(victim)) net.hs.teamScore[teamOf(by)]++;
  }
  const goal = MODES[net.mode].goal;
  if (net.mode === "tdm") { const t = net.hs.teamScore.findIndex(v => v >= goal); if (t >= 0) net.hs.winner = `${TEAM_NAME[t]} team`; }
  else if (by && sc[by] && sc[by][0] >= goal) net.hs.winner = nameOf(by);
  if (net.hs.winner) net.resetAt = performance.now() + ROUND_BREAK * 1000;
  net.dirty = true;
}
function hostDummyHit(i, dmg, kind) {
  const d = dummies[i]; if (!d || d.dead) return;
  d.hp -= dmg; d.flash = .12; d.jit = .2;
  if (kind === "fire") d.burn = Math.max(d.burn, 2.4);
  if (d.hp <= 0) { d.dead = 4; d.hp = 0; d.burn = 0; }
  net.dirty = true;
}
function applySnap(s, id) {
  const theirs = s.hostSince || 0, now = performance.now();
  if (net.host) {
    // two hosts met (e.g. a slow connection made a newcomer think it was alone): the longer-standing one wins
    const mine = net.hs.hostSince || 0;
    if (!(theirs < mine || (theirs === mine && id < selfId))) return;
    net.host = false; addLog("Another host was already running this realm: following them.", "System", "sys");
  } else if (net.curHost && net.curHost !== id && net.peers.has(net.curHost) && now - net.curHostT < 3000) {
    // a second host is broadcasting too (two groups that can't reach each other): stick with the one we
    // follow unless this one has been hosting longer. Applying both made everyone flip between two matches.
    const cur = net.curHostSince || 0;
    if (!(theirs < cur || (theirs === cur && id < net.curHost))) return;
  }
  const sameHost = net.curHost === id;
  net.curHost = id; net.curHostT = now; net.curHostSince = theirs;
  const prevRound = net.round, prevWinner = net.hs.winner;
  net.hs = s;
  net.resetAt = performance.now() + s.resetIn * 1000;
  s.dummies.forEach(([hp, dead], i) => { const d = dummies[i]; if (!d) return; d.hp = hp; if (dead && !d.dead) d.dead = 4; if (!dead && d.dead) d.dead = 0; });
  onSharedState(prevRound, prevWinner, sameHost);
}
// react to colours/teams/round changes, from a snapshot or from my own host bookkeeping
function onSharedState(prevRound, prevWinner, sameHost = true) {
  const hs = net.hs, c = hs.colors[selfId] ?? net.color, t = hs.teams[selfId] ?? net.team;
  if (c !== net.color) { net.color = c; KN = knSet(c, myClass); }
  if (hs.mode && hs.mode !== net.mode) {
    net.mode = hs.mode; net.placed = false;
    addLog(`The host chose ${MODES[hs.mode].name}.`, "System", "gold");
  }
  if (net.mode === "tdm" && hs.teams[selfId] !== undefined && (t !== net.team || !net.placed)) {
    net.team = t; net.placed = true; addLog(`You fight for the ${TEAM_NAME[t]} team.`, "System", "sys");
  }
  if (hs.winner && !prevWinner) banner(`${hs.winner} wins!`, `next round in ${ROUND_BREAK}s`);
  if (hs.round !== prevRound) {
    // only a real new round from the host we already follow respawns everyone; switching to another host
    // (or a host handover) just adopts its round number and leaves you where you are
    const fresh = sameHost && hs.round > prevRound;
    net.round = hs.round;
    if (fresh) { respawn("new round"); banner(MODES[net.mode].name, net.mode === "practice" ? "no PvP · train together" : "new round · fight!"); }
  }
  net.winner = hs.winner;
}
function hostTick(dt) {
  const hs = net.hs, ids = members().map(m => m.id), prevRound = net.round, prevWinner = net.winner;
  if (hs.mode !== "ffa") { hs.mode = "ffa"; net.dirty = true; } // Free for All only, for now: everyone in one game
  for (const k of Object.keys(hs.colors)) if (!ids.includes(k)) { delete hs.colors[k]; delete hs.teams[k]; net.dirty = true; }
  for (const id of ids) {
    if (hs.colors[id] === undefined) { const used = new Set(Object.values(hs.colors)); let c = 0; while (used.has(c)) c++; hs.colors[id] = c % PALETTE.length; net.dirty = true; }
    if (net.mode === "tdm" && hs.teams[id] === undefined) { const n = [0, 0]; for (const t of Object.values(hs.teams)) n[t]++; hs.teams[id] = n[0] <= n[1] ? 0 : 1; net.dirty = true; }
  }
  if (hs.winner && performance.now() > net.resetAt) { hs.score = {}; hs.teamScore = [0, 0]; hs.winner = null; hs.round++; net.dirty = true; }
  hs.resetIn = hs.winner ? Math.max(0, (net.resetAt - performance.now()) / 1000) : 0;
  hs.dummies = dummies.map(d => [Math.round(d.hp), d.dead > 0 ? 1 : 0]);
  onSharedState(prevRound, prevWinner);
  net.snapT -= dt;
  if (net.dirty || net.snapT <= 0) { net.api.send("snap", hs); net.dirty = false; net.snapT = .5; }
}

function updateNet(dt) {
  if (!net.api) return;
  electHost();
  if (net.host) hostTick(dt);
  // my knight, ~15 times a second (this runs on a 15/s timer; the small margin stops it skipping every other tick)
  net.sendT -= dt;
  if (net.sendT <= .01) {
    net.sendT = 1 / 15;
    const p = knightParams(), r2 = v => Math.round(v * 100) / 100;
    net.api.send("st", [r2(player.x), r2(player.y), p.fr, p.flip ? 1 : 0, r2(p.lift), r2(p.tilt), r2(p.sX), r2(p.sY), p.ss === null ? null : r2(p.ss), p.side ? 1 : 0,
      Math.ceil(player.hp), player.mhp, player.dead ? 1 : 0, player.face, charge.on ? ["s1", "s2", "s3", "slam"].indexOf(charge.kind) : -1, r2(charge.on ? chargePower() : 0), isProtected() ? 1 : 0, r2(player.shieldUp), player.stealth ? 1 : 0]);
  }
}
// other knights are drawn a moment in the past, blended between the two updates around that moment:
// ~110 ms for direct links, ~400 ms for players reached through the relays (fewer, later updates). Runs every frame.
function interpolatePeers() {
  if (!net.api) return;
  for (const p of net.peers.values()) {
    const b = p.buf; if (!b.length) continue;
    const rt = performance.now() - (net.api.viaRelay(p.id) ? 400 : 110);
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
    const k = c.t > a.t ? clamp((rt - a.t) / (c.t - a.t), 0, 1) : 1;
    const jump = Math.hypot(c.x - a.x, c.y - a.y) > 30; // respawned: snap instead of sliding across the map
    p.x = jump ? c.x : a.x + (c.x - a.x) * k; p.y = jump ? c.y : a.y + (c.y - a.y) * k;
    Object.assign(p, {p: c.p, hp: c.hp, mhp: c.mhp, dead: c.dead, face: c.face, ck: c.ck, cp: c.cp, prot: c.prot, sh: c.sh, stealth: c.stealth});
  }
}
// a red glow on the screen edge facing whoever just hit you, fading over ~0.7 s
const hitMarks = [];
function drawHitMarks() {
  for (let i = hitMarks.length - 1; i >= 0; i--) {
    const h = hitMarks[i]; h.t += 1 / 60; if (h.t > .7) { hitMarks.splice(i, 1); continue; }
    const cx = Wpx / 2, cy = Hpx / 2, r = Math.min(Wpx, Hpx) * .46, x = cx + Math.cos(h.a) * r, y = cy + Math.sin(h.a) * r;
    const g = octx.createRadialGradient(x, y, 0, x, y, r * .55);
    g.addColorStop(0, `rgba(255,40,30,${.55 * h.k * (1 - h.t / .7)})`); g.addColorStop(1, "rgba(255,40,30,0)");
    octx.globalAlpha = 1; octx.fillStyle = g; octx.fillRect(x - r * .55, y - r * .55, r * 1.1, r * 1.1);
  }
}
// arrows at the screen edge pointing at knights you can't see (enemies bold, allies faint)
function drawPointers() {
  if (!net.api) return;
  const m = 28 * dpr;
  for (const p of livePeers()) {
    if (p.dead || (p.stealth && isEnemy(p.id))) continue;
    const X = sx(p.x), Y = sy(p.y - 4);
    if (X > m && X < Wpx - m && Y > m && Y < Hpx - m) continue;
    const cx = Wpx / 2, cy = Hpx / 2, dx = X - cx, dy = Y - cy;
    const s = Math.min((Wpx / 2 - m) / Math.abs(dx || 1e-6), (Hpx / 2 - m) / Math.abs(dy || 1e-6));
    const ex = cx + dx * s, ey = cy + dy * s, ang = Math.atan2(dy, dx), enemy = isEnemy(p.id);
    const col = net.mode === "tdm" ? TEAM_COL[teamOf(p.id)] : `rgb(${PALETTE[colorOf(p.id)].map(v => Math.min(255, v + 60)).join(",")})`;
    octx.save(); octx.translate(ex, ey); octx.rotate(ang);
    octx.globalAlpha = enemy ? .95 : .45; octx.fillStyle = col; octx.strokeStyle = "rgba(0,0,0,.8)"; octx.lineWidth = 2 * dpr;
    const z = (enemy ? 11 : 8) * dpr;
    octx.beginPath(); octx.moveTo(z, 0); octx.lineTo(-z * .7, -z * .7); octx.lineTo(-z * .35, 0); octx.lineTo(-z * .7, z * .7); octx.closePath(); octx.stroke(); octx.fill();
    octx.restore();
    if (enemy) {
      octx.globalAlpha = .9; octx.font = `600 ${Math.round(9 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`; octx.fillStyle = col;
      octx.fillText(`${p.name} ${Math.round(gdist(p.x, p.y, player.x, player.y))}m`, ex - Math.cos(ang) * 30 * dpr, ey - Math.sin(ang) * 18 * dpr);
      octx.font = FONT;
    }
  }
  octx.globalAlpha = 1;
}
function drawRemoteExtras(p) { // their HP bar (enemies) and any charge gathering in their hand
  if (p.dead) return;
  const k = knSet(colorOf(p.id), p.cls || 0)[p.p.fr]; if (!k) return;
  if (isEnemy(p.id) && p.hp < p.mhp) {
    const X = sx(p.x) - 4 * CW, Y = sy(p.y) - k.h - p.p.lift * CH - 14 * dpr, w = 8 * CW, h = Math.max(2, 3 * dpr);
    octx.globalAlpha = .85; octx.fillStyle = "#0b0b0f"; octx.fillRect(X - dpr, Y - dpr, w + 2 * dpr, h + 2 * dpr);
    octx.fillStyle = "#c4322b"; octx.fillRect(X, Y, w * Math.max(0, p.hp / p.mhp), h);
  }
  if (p.ck >= 0) {
    octx.globalCompositeOperation = "lighter";
    glow(p.x + p.face * 1.2, p.y - 3.2, p.ck < 3 ? kit(p.cls || 0)[p.ck].col : SLAM_COL, 4 + p.cp * 14, .5 + p.cp * .5);
    octx.globalCompositeOperation = "source-over";
  }
  if (p.sh > .5) { octx.globalCompositeOperation = "lighter"; glow(p.x + p.face * 2.2, p.y - 3.4, [140, 200, 255], 8, .35); octx.globalCompositeOperation = "source-over"; }
}
let scoreT = 0;
function updateScore(dt) {
  scoreT -= dt; if (scoreT > 0) return; scoreT = .25;
  const el = $("score");
  if (!net.api) { el.hidden = true; return; }
  el.hidden = false;
  const hs = net.hs, goal = MODES[net.mode].goal, n = members().length;
  let line;
  if (net.mode === "practice") line = "no PvP · train on the dummies together";
  else if (net.mode === "tdm") line = `<b style="color:${TEAM_COL[0]}">RED ${hs.teamScore[0]}</b> — <b style="color:${TEAM_COL[1]}">${hs.teamScore[1]} BLUE</b>`;
  else {
    const mine = (hs.score[selfId] || [0])[0];
    let lead = null, lk = -1; for (const [id, s] of Object.entries(hs.score)) if (s[0] > lk) { lk = s[0]; lead = id; }
    line = `You <b>${mine}</b> · Leader <b>${lead ? nameOf(lead) : "—"} ${Math.max(0, lk)}</b>`;
  }
  const viaRelay = net.api ? net.api.relayCount() : 0;
  const role = (net.host ? " · you are host" : net.backup ? " · standby host" : "") + (viaRelay ? ` · ${viaRelay} via relay` : "");
  $("modeSel").hidden = true; // mode switching is off while the game is Free for All only
  $("modeSel").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.m === net.mode));
  $("scoreLine").innerHTML = `${MODES[net.mode].name}${goal ? ` · first to ${goal}` : ""} · ${line}`;
  // the collapsed chip: just the mode and the one number that matters
  let mini;
  if (net.mode === "tdm") mini = `<b style="color:${TEAM_COL[0]}">RED ${hs.teamScore[0]}</b>–<b style="color:${TEAM_COL[1]}">${hs.teamScore[1]} BLUE</b>`;
  else if (net.mode === "ffa") mini = `FFA · you ${(hs.score[selfId] || [0])[0]}/${goal}`;
  else mini = "Practice";
  // when alone, say whether we're actually reachable, so "nobody here" and "can't connect" look different
  const ru = relaysUp(), status = n > 1 ? `${n} online` : ru ? `searching for knights · ${ru}/${RELAY_COUNT} relays${net.turnOk ? " · TURN on" : ""}` : "connecting…";
  $("scoreMini").innerHTML = `${mini} · ${status}${hs.winner ? " · ★" : ""}`;
  $("scoreSub").textContent = `${n} knight${n === 1 ? "" : "s"} online${role}${hs.winner ? ` · ${hs.winner} wins! next round in ${Math.ceil(Math.max(0, (net.resetAt - performance.now()) / 1000))}s` : ""}`;
  if (!$("board").hidden) renderBoard();
}
function renderBoard() {
  const rows = members().map(m => ({id: m.id, s: net.hs.score[m.id] || [0, 0]})).sort((a, b) => b.s[0] - a.s[0] || a.s[1] - b.s[1]);
  const b = $("board"); b.textContent = "";
  const head = document.createElement("div"); head.className = "row head"; head.innerHTML = "<span>Knight</span><span>Kills</span><span>Deaths</span>"; b.appendChild(head);
  for (const r of rows) {
    const d = document.createElement("div"); d.className = "row" + (r.id === selfId ? " me" : "");
    const c = net.mode === "tdm" ? TEAM_COL[teamOf(r.id)] : `rgb(${PALETTE[colorOf(r.id)].join(",")})`;
    const nm = document.createElement("span"); nm.textContent = nameOf(r.id); nm.style.borderLeft = `3px solid ${c}`; nm.style.paddingLeft = "6px";
    const k = document.createElement("span"); k.textContent = r.s[0]; const de = document.createElement("span"); de.textContent = r.s[1];
    d.append(nm, k, de); b.appendChild(d);
  }
}

/* ============================== loop ============================== */
let last = performance.now(), fpsAcc = 0, fpsN = 0, msAcc = 0, miniT = 0;
/* Adaptive quality: if a device keeps running under ~40 FPS, step down the render resolution and the amount
   of effects (never back up during a session, so it doesn't flicker between levels). */
const QUALITY = [{dpr: 2, fx: 1}, {dpr: 1.5, fx: .7}, {dpr: 1.15, fx: .5}, {dpr: .9, fx: .35}];
let quality = 0; try { quality = clamp(+sessionStorage.getItem("gk.q") || 0, 0, QUALITY.length - 1); } catch (e) {}
let qT = 0, qFrames = 0, qGrace = 4;
function adaptQuality(dt) {
  if (document.hidden || !$("lobby").hidden) return;
  if (qGrace > 0) { qGrace -= dt; return; } // ignore the first seconds (loading, baking)
  qT += dt; qFrames++;
  if (qT < 3) return;
  const fps = qFrames / qT; qT = 0; qFrames = 0;
  if (fps < 40 && quality < QUALITY.length - 1) {
    quality++; qGrace = 3;
    try { sessionStorage.setItem("gk.q", quality); } catch (e) {}
    console.info(`[gizmo-knight] ${Math.round(fps)} FPS: quality step ${quality}`);
    resize();
  }
}
let frameErrors = 0, netLast = performance.now();
// Networking runs on its own timer, not the draw loop: browsers pause drawing in hidden tabs (and phones when you
// switch apps), which used to freeze a hosting player's whole match. Timers keep going (about once a second there).
setInterval(() => {
  const now = performance.now(), dt = Math.min(1, (now - netLast) / 1000); netLast = now;
  try { updateNet(dt); } catch (e) { if (frameErrors++ < 5) console.error("[gizmo-knight] net error", e); }
}, 1000 / 15);
function frame(now) {
  requestAnimationFrame(frame); // schedule first: one bad frame must never stop the game
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (glLost) return;
  const t0 = performance.now();
  try {
    hitstop = Math.min(hitstop, .07); // hit-stop is a beat, never a stall
    update(hitstop > 0 ? dt * .1 : dt); hitstop = Math.max(0, hitstop - dt);
    interpolatePeers(); updateScore(dt); updateTravel(dt);
    render();
    miniT -= dt; if (miniT <= 0) { drawMini(); miniT = .1; }
    updateHUD();
  } catch (e) { if (frameErrors++ < 5) console.error("[gizmo-knight] frame error", e); }
  msAcc += performance.now() - t0; fpsAcc += dt; fpsN++;
  adaptQuality(dt);
  if (fpsAcc > .5) { $("fps").textContent = `FPS ${Math.round(fpsN / fpsAcc)} · frame ${(msAcc / fpsN).toFixed(1)} ms`; fpsAcc = msAcc = 0; fpsN = 0; }
}
// phones drop the WebGL context when backgrounded or under memory pressure; recover instead of freezing
let glLost = false;
glc.addEventListener("webglcontextlost", e => { e.preventDefault(); glLost = true; setTimeout(() => location.reload(), 2500); });
glc.addEventListener("webglcontextrestored", () => location.reload());

async function start() {
  try { await Promise.race([document.fonts.load('600 16px "IBM Plex Mono"'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  await new Promise(r => setTimeout(r, 30));
  KIMG = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = KATLAS; });
  const tw = performance.now();
  buildWorld();
  console.info(`[gizmo-knight] world built in ${Math.round(performance.now() - tw)} ms`);
  try { P1 = program(FS_CELLS); P2 = program(FS_DRAW); }
  catch (e) { console.error(e); fail("The renderer failed to start on this device."); return; }
  texWorld = makeTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(COL.buffer));
  const M = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) M[i] = MAT[i] * 16;
  texMat = makeTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, W, H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, M);
  buildMini(); resize(); initAmbient(); initDummies();
  addEventListener("resize", resize);
  addLog("You awaken inside the Stone Circle.", "General");
  addLog(isTouch ? "Drag to move. / slash, hold * to charge fire, ϟ lightning, † blades, ◊ shield, » roll." : "Move: WASD or hold left mouse. Shift: run. Space/click: slash. F/right-click (hold to charge): fire. G: lightning. R: blades. Q (hold): shield. C/Ctrl: roll.", "System", "sys");
  region = "Stone Circle"; visited.add(region);
  last = performance.now(); requestAnimationFrame(frame);
  setTimeout(() => $("loading").classList.add("gone"), 150);
  showLobby();
}
// the lobby: pick a name (no account) and a mode; the world already renders behind it
function showLobby() {
  const lb = $("lobby"), inp = $("pname");
  lb.hidden = false; inp.value = net.name;
  // class cards: name, one line, and bars comparing the stats that matter
  const pick = $("classPick"), bar = (label, v, max) => `<span>${label}</span><i><s style="width:${Math.round(Math.min(1, v / max) * 100)}%"></s></i>`;
  pick.textContent = "";
  CLASSES.forEach((c, i) => {
    const b = document.createElement("button");
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", i === myClass);
    b.innerHTML = `<b><span class="ic">${c.icon}</span>${c.name}</b><span>${c.desc}</span><span class="stats">${bar("HP", c.hp, 140)}${bar("MP", c.mp, 100)}${bar("Speed", c.speed - .7, .45)}${bar("Melee", c.melee, 1.3)}${bar("Magic", c.spell, 1.3)}</span>`;
    b.addEventListener("click", () => { myClass = i; pick.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-checked", j === i)); });
    pick.appendChild(b);
  });
  lb.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    const nm = inp.value.trim().replace(/\s+/g, " ").slice(0, 16);
    if (nm) net.name = nm;
    try { localStorage.setItem("gk.name", net.name); } catch (e) {}
    lb.hidden = true;
    audio.start();
    joinRealm(b.dataset.mode);
  }, {once: true}));
}
$("modeSel").addEventListener("click", e => { e.stopPropagation(); const m = e.target.closest("button"); if (m) setRealmMode(m.dataset.m); });
// collapsible panels: the match panel starts as a small chip; both remember how you left them
function setPanel(el, btn, open, key, labels) {
  el.classList.toggle("collapsed", !open); btn.setAttribute("aria-expanded", open); btn.setAttribute("aria-label", labels[open ? 1 : 0]);
  try { localStorage.setItem(key, open ? "1" : "0"); } catch (e) {}
}
const savedOpen = (key, dflt) => { try { const v = localStorage.getItem(key); return v === null ? dflt : v === "1"; } catch (e) { return dflt; } };
const SCORE_L = ["Show match details", "Hide match details"], MAP_L = ["Show map", "Hide map"];
setPanel($("score"), $("scoreChip"), savedOpen("gk.scoreOpen", false), "gk.scoreOpen", SCORE_L);
setPanel($("mapbox"), $("mapToggle"), savedOpen("gk.mapOpen", innerHeight > 500), "gk.mapOpen", MAP_L);
$("mapToggle").textContent = $("mapbox").classList.contains("collapsed") ? "+" : "–";
$("scoreChip").addEventListener("click", e => { e.stopPropagation(); setPanel($("score"), $("scoreChip"), $("score").classList.contains("collapsed"), "gk.scoreOpen", SCORE_L); });
$("mapToggle").addEventListener("click", e => {
  e.stopPropagation(); const open = $("mapbox").classList.contains("collapsed");
  setPanel($("mapbox"), $("mapToggle"), open, "gk.mapOpen", MAP_L); $("mapToggle").textContent = open ? "–" : "+";
  if (open) { const m = $("mini"); m.width = Math.round(m.clientWidth * dpr); m.height = Math.round(m.clientHeight * dpr); } // was 0x0 while hidden
});
function toggleMute() { audio.start(); audio.setMuted(!audio.isMuted()); syncMuteBtn(); }
function syncMuteBtn() { const m = audio.isMuted(), b = $("muteBtn"); b.textContent = m ? "♪̸" : "♪"; b.classList.toggle("off", m); b.setAttribute("aria-label", m ? "Unmute sound" : "Mute sound"); }
$("muteBtn").addEventListener("click", e => { e.stopPropagation(); toggleMute(); });
syncMuteBtn();
$("boardBtn").addEventListener("click", e => { e.stopPropagation(); const b = $("board"); b.hidden = !b.hidden; if (!b.hidden) renderBoard(); });
$("leaveBtn").addEventListener("click", e => { e.stopPropagation(); location.reload(); });
start();
if (import.meta.env.DEV) window.__gk = {player, cam, WAYSTONES, net, damage, livePeers, update, startRoll, hold: v => { dashHeld = v; }, dummies, rifts}; // dev-server-only handle for testing
