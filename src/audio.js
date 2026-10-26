/* Sound for Gizmo Knight, synthesized live with the Web Audio API: no audio files to download.
   Effects are short envelopes over oscillators and filtered noise; the ambience is a few slow loops (wind,
   water) plus scattered one-shots (insects, fire crackle) whose volume follows where you stand.
   Browsers only allow audio after a user gesture, so nothing plays until start() is called from a click. */

let ctx = null, master = null, sfxBus = null, ambBus = null, noiseBuf = null, muted = false;
try { muted = localStorage.getItem("gk.muted") === "1"; } catch (e) {}

export function start() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : .8;
  const comp = ctx.createDynamicsCompressor(); // keeps big explosions from clipping
  comp.threshold.value = -14; comp.ratio.value = 6;
  master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = .9; sfxBus.connect(master);
  ambBus = ctx.createGain(); ambBus.gain.value = .55; ambBus.connect(master);
  // two seconds of white noise, reused by every noisy sound
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbience();
}
export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m; try { localStorage.setItem("gk.muted", m ? "1" : "0"); } catch (e) {}
  if (master) master.gain.setTargetAtTime(m ? 0 : .8, ctx.currentTime, .05);
}
// browsers suspend audio in background tabs; resume when the player comes back
document.addEventListener("visibilitychange", () => { if (ctx && !document.hidden && ctx.state === "suspended") ctx.resume(); });

const now = () => ctx.currentTime;
const ok = () => ctx && !muted && ctx.state === "running";
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); }
function noise(t, dur) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(t); s.stop(t + dur + .05); return s; }
function osc(type, f, t, dur) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + .05); return o; }
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
function filt(type, f, q = 1) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function gain() { return ctx.createGain(); }
// v: 0..1 loudness (callers pass distance falloff); pan: -1..1
function out(node, v, pan = 0) {
  const g = gain(); g.gain.value = v;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); chain(node, g, p, sfxBus); }
  else chain(node, g, sfxBus);
}

/* ---------- effects ---------- */
export const sfx = {
  // sword: a band-passed whoosh; later combo moves sweep lower and longer
  slash(step = 0, v = 1, pan = 0) {
    if (!ok()) return; const t = now(), dur = .14 + step * .04;
    const n = noise(t, dur), f = filt("bandpass", 2400 - step * 300, 1.4), g = gain();
    f.frequency.setValueAtTime(3200 - step * 300, t); f.frequency.exponentialRampToValueAtTime(700, t + dur);
    env(g, t, .01, .55, dur); out(chain(n, f, g), v, pan);
  },
  // a landed hit: low thump plus a short click; heavy = bigger
  hit(heavy = 0, v = 1, pan = 0) {
    if (!ok()) return; const t = now();
    const o = osc("sine", 140 + heavy * 20, t, .25), g = gain(); o.frequency.exponentialRampToValueAtTime(48, t + .2);
    env(g, t, .004, .7 + heavy * .3, .2 + heavy * .1); out(chain(o, g), v, pan);
    const n = noise(t, .05), f = filt("highpass", 1800), g2 = gain(); env(g2, t, .002, .35, .05); out(chain(n, f, g2), v, pan);
  },
  hurt(v = 1) { // you took damage: a dull low crunch
    if (!ok()) return; const t = now();
    const n = noise(t, .18), f = filt("lowpass", 600), g = gain(); env(g, t, .005, .8, .18); out(chain(n, f, g), v);
    const o = osc("triangle", 90, t, .2), g2 = gain(); o.frequency.exponentialRampToValueAtTime(40, t + .2); env(g2, t, .005, .5, .2); out(chain(o, g2), v);
  },
  fireCast(pow = 0, v = 1, pan = 0) {
    if (!ok()) return; const t = now(), dur = .25 + pow * .25;
    const n = noise(t, dur), f = filt("lowpass", 500), g = gain();
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2500 + pow * 1500, t + dur * .6);
    env(g, t, .02, .5 + pow * .3, dur); out(chain(n, f, g), v, pan);
  },
  explode(big = .5, v = 1, pan = 0) { // size scales length, depth and loudness
    if (!ok()) return; const t = now(), dur = .5 + big * .9;
    const n = noise(t, dur), f = filt("lowpass", 900 + big * 600), g = gain();
    f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    env(g, t, .005, .9, dur); out(chain(n, f, g), v, pan);
    const o = osc("sine", 75, t, dur), g2 = gain(); o.frequency.exponentialRampToValueAtTime(32, t + dur); env(g2, t, .005, .9 * Math.min(1, .4 + big), dur * .8); out(chain(o, g2), v, pan);
  },
  zap(v = 1, pan = 0) { // the spark leaving the hand
    if (!ok()) return; const t = now();
    const o = osc("sawtooth", 1800, t, .12), f = filt("bandpass", 2600, 3), g = gain();
    for (let i = 1; i < 8; i++) o.frequency.setValueAtTime(900 + Math.random() * 2600, t + i * .014);
    env(g, t, .003, .3, .12); out(chain(o, f, g), v, pan);
  },
  thunder(v = 1, pan = 0, delay = 0) { // sharp crack, then a long rolling rumble (arrives later from far away)
    if (!ok()) return; const t = now() + delay;
    const n = noise(t, .08), f = filt("highpass", 1200), g = gain(); env(g, t, .001, .9, .08); out(chain(n, f, g), v, pan);
    const r = noise(t, 2.2), lp = filt("lowpass", 220), g2 = gain();
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(.9, t + .06);
    for (let i = 1; i < 6; i++) g2.gain.linearRampToValueAtTime(.35 + Math.random() * .5, t + i * .3);
    g2.gain.exponentialRampToValueAtTime(.0001, t + 2.2); out(chain(r, lp, g2), v, pan);
  },
  bladeSummon(v = 1) { // ringing steel
    if (!ok()) return; const t = now();
    for (const [f, d] of [[880, .9], [1320, .7], [1980, .5]]) { const o = osc("triangle", f, t, d), g = gain(); env(g, t, .005, .18, d); out(chain(o, g), v); }
  },
  bladeImpact(v = 1, pan = 0) { this.hit(.6, v * .8, pan); const t = now(); if (!ok()) return; const o = osc("triangle", 1500 + Math.random() * 400, t, .4), g = gain(); env(g, t, .003, .12, .4); out(chain(o, g), v, pan); },
  slam(pow = 0, v = 1, pan = 0) { this.explode(.3 + pow * .5, v, pan); },
  dash(v = 1) { if (!ok()) return; const t = now(); const n = noise(t, .2), f = filt("bandpass", 1600, .8), g = gain(); f.frequency.exponentialRampToValueAtTime(500, t + .2); env(g, t, .01, .45, .2); out(chain(n, f, g), v); },
  teleport(v = 1, pan = 0) { // rising shimmer
    if (!ok()) return; const t = now();
    const o = osc("sine", 300, t, .7), g = gain(); o.frequency.exponentialRampToValueAtTime(1600, t + .6); env(g, t, .05, .3, .65); out(chain(o, g), v, pan);
    const o2 = osc("triangle", 2400, t + .1, .5), g2 = gain(); env(g2, t + .1, .02, .08, .5); out(chain(o2, g2), v, pan);
  },
  kill() { if (!ok()) return; const t = now(); [[660, 0], [990, .09], [1320, .18]].forEach(([f, d]) => { const o = osc("triangle", f, t + d, .35), g = gain(); env(g, t + d, .005, .3, .35); out(chain(o, g), 1); }); },
  death() { if (!ok()) return; const t = now(); const o = osc("sawtooth", 220, t, 1.1), f = filt("lowpass", 900), g = gain(); o.frequency.exponentialRampToValueAtTime(55, t + 1); env(g, t, .02, .4, 1.05); out(chain(o, f, g), 1); },
  ui() { if (!ok()) return; const t = now(); const o = osc("sine", 880, t, .08), g = gain(); env(g, t, .002, .15, .08); out(chain(o, g), 1); },
};

/* ---------- charge hum: one oscillator that follows the charge level ---------- */
let hum = null;
export function chargeHum(level) { // level < 0 stops it
  if (!ctx) return;
  if (level < 0 || muted) { if (hum) { hum.g.gain.setTargetAtTime(0, now(), .04); const h = hum; setTimeout(() => { try { h.o.stop(); } catch (e) {} }, 200); hum = null; } return; }
  if (!hum) {
    const o = ctx.createOscillator(), f = filt("lowpass", 900), g = gain(); o.type = "sawtooth"; g.gain.value = 0;
    chain(o, f, g, sfxBus); o.start(); hum = {o, f, g};
  }
  hum.o.frequency.setTargetAtTime(80 + level * 220, now(), .05);
  hum.f.frequency.setTargetAtTime(400 + level * 1600, now(), .05);
  hum.g.gain.setTargetAtTime(.05 + level * .12, now(), .05);
}

/* ---------- ambience ---------- */
let wind = null, water = null, nextChirp = 0, nextCrackle = 0;
function startAmbience() {
  // wind: noise through a slowly wandering low-pass
  const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  const f = filt("lowpass", 380, .7), g = gain(); g.gain.value = .14;
  chain(n, f, g, ambBus); n.start(); wind = {f, g};
  // running water: brighter band-passed noise, volume set by how close you are to river or lake
  const w = ctx.createBufferSource(); w.buffer = noiseBuf; w.loop = true; w.loopStart = .7;
  const wf = filt("bandpass", 900, .5), wg = gain(); wg.gain.value = 0;
  chain(w, wf, wg, ambBus); w.start(); water = {g: wg};
}
// called a few times a second with how close the player is to water and to the nearest fire (0..1 each)
export function ambience(nearWater, nearFire) {
  if (!ctx || ctx.state !== "running") return;
  const t = now();
  wind.f.frequency.setTargetAtTime(260 + Math.sin(t * .13) * 120 + Math.sin(t * .041) * 80, t, 1.5);
  wind.g.gain.setTargetAtTime(.1 + (Math.sin(t * .09) * .5 + .5) * .08, t, 1.5);
  water.g.gain.setTargetAtTime(nearWater * .22, t, .6);
  if (t > nextChirp) { // night insects: little pulsed chirps
    nextChirp = t + .6 + Math.random() * 2.5;
    const base = 3800 + Math.random() * 1600, pulses = 2 + (Math.random() * 4 | 0);
    for (let i = 0; i < pulses; i++) { const tt = t + i * .07, o = osc("sine", base, tt, .05), g = gain(); env(g, tt, .005, .035, .04); chain(o, g, ambBus); }
  }
  if (nearFire > .05 && t > nextCrackle) { // campfire crackle
    nextCrackle = t + .05 + Math.random() * .25;
    const n = noise(t, .03), f = filt("highpass", 2000 + Math.random() * 3000), g = gain(); env(g, t, .001, .25 * nearFire, .02 + Math.random() * .03); chain(n, f, g, ambBus);
  }
}
