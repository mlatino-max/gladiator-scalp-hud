/* Liquidity Drift — the field, the positions and the render loop, as a p5
   instance-mode sketch (new p5(sketch, container)) so it cannot collide with
   anything else on the page. The art is the original artifact's: a layered
   flow field (regime + volatility octave + book pressure + liquidity pools +
   level magnetism) with positions released into it and coloured by R.

   What changed for the HUD:
   - every live parameter eases to its new target over 90 frames
     (cubic in-out); a manual slider sets it directly;
   - particles live in typed arrays and are drawn in colour buckets from a
     64-step LUT, so the particle loop allocates nothing;
   - exits draw their R from the journal's recent closes when there are any;
   - the field is not rebuilt on frames where nothing is easing and
     evolution is 0.
   No text or legend is drawn for agents. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P5 = any;

export type ParamKey =
  | "particleCount" | "flowSpeed" | "noiseScale" | "volatility" | "trailLength"
  | "rangePull" | "vortexCount" | "driftBias" | "evolution" | "rUnit" | "structure";
export type Mode = "live" | "manual";
export type Pool = { name: string; open: number; s: number; r: number };
export type LiveTargets = Partial<Record<ParamKey, number | null>> & {
  orHigh?: number | null; orLow?: number | null; pools?: Pool[] | null; closed?: boolean;
};
export type Sampler = { n: number; cum: Float64Array; vals: Float64Array; total: number; draw: (u: number) => number } | null;

export const W = 1200, H = 900;
const SCL = 10;
const BG = [14, 15, 18];
const BG_RGB = BG.join(",");
const DASH = [9, 14], NO_DASH: number[] = [];
const MAXP = 6000;
const EASE_FRAMES = 90;
const LUT_N = 64;
const R_MIN = -1, R_MAX = 2.5;
const RING = 1400;
const MAX_PULSES = 16;
const PULSE_MS = 400;

export const DEFAULTS: Record<Exclude<ParamKey, "structure">, number> = {
  particleCount: 2600, flowSpeed: 1.1, noiseScale: 0.0035, volatility: 0.55, trailLength: 16,
  rangePull: 0.85, vortexCount: 4, driftBias: 0.2, evolution: 0.4, rUnit: 95
};
export const PALETTES: Record<string, [string, string, string]> = {
  gladiator: ["#c7453a", "#8f8c82", "#4fc08d"],
  terminal: ["#d64545", "#6e7b70", "#49e08a"],
  ice: ["#b05a8e", "#6d7a8c", "#56c7e8"],
  ember: ["#b03a2e", "#9a8f7d", "#e8a33d"]
};

/* one eased scalar */
class Eased {
  v: number; from: number; to: number; t = EASE_FRAMES;
  constructor(v: number) { this.v = v; this.from = v; this.to = v; }
  set(to: number) { if (to === this.to && this.t >= EASE_FRAMES) return; this.from = this.v; this.to = to; this.t = 0; }
  jump(v: number) { this.v = v; this.from = v; this.to = v; this.t = EASE_FRAMES; }
  get moving() { return this.t < EASE_FRAMES; }
  tick() {
    if (this.t >= EASE_FRAMES) return false;
    this.t++;
    const x = this.t / EASE_FRAMES;
    const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    this.v = this.from + (this.to - this.from) * e;
    return true;
  }
}

type Vortex = { key: string; x: number; y: number; r: Eased; s: Eased; open: number; dying: boolean };

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand01(seed: number) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x888888;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export type DriftController = {
  setMode: (k: ParamKey, m: Mode) => void;
  setManual: (k: ParamKey, v: number) => void;
  setLive: (t: LiveTargets) => void;
  setSampler: (s: Sampler) => void;
  pulse: (r: number, agent: string | null) => void;
  setStale: (b: boolean) => void;
  setPalette: (c: [string, string, string]) => void;
  regenerate: (seed: number) => void;
  togglePause: () => boolean;
  download: () => void;
  values: () => Record<string, number>;
  setVisible: (b: boolean) => void;
  destroy: () => void;
};

export function createDrift(P5Ctor: P5, container: HTMLElement, opts: { seed: number; reducedMotion: boolean; palette: [string, string, string] }): DriftController {
  let p: P5 = null;
  let seed = opts.seed;
  const reduced = opts.reducedMotion;

  /* ---- parameters ---- */
  const val = {} as Record<Exclude<ParamKey, "structure">, Eased>;
  (Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).forEach(k => { val[k] = new Eased(DEFAULTS[k]); });
  const VAL_KEYS = Object.keys(val) as (keyof typeof val)[];
  const orHigh = new Eased(H * 0.45), orLow = new Eased(H * 0.55);
  let seededOR: [number, number] = [H * 0.45, H * 0.55];
  const mode: Record<ParamKey, Mode> = {
    particleCount: "live", flowSpeed: "live", noiseScale: "manual", volatility: "live", trailLength: "manual",
    rangePull: "live", vortexCount: "live", driftBias: "live", evolution: "live", rUnit: "live", structure: "live"
  };
  let live: LiveTargets = {};
  let sampler: Sampler = null;
  let stale = false;
  let paused = false, visible = true;
  let veilK = 1;   // < 1 when the flow is slower than the artifact's; overlays scale with it
  /* per-frame style strings, one cache per call site, rebuilt only when
     the quantized alpha moves (no string work on a steady frame) */
  function alphaStyle(rgb: string) {
    let q = -1, str = "";
    return (a: number) => {
      const n = Math.round(a * 4000);
      if (n !== q) { q = n; str = `rgba(${rgb},${(n / 4000).toFixed(4)})`; }
      return str;
    };
  }
  /* the veil is painted a little darker than the ground: an 8-bit canvas
     stops fading once (pixel - veil) * alpha rounds to zero, so a faint
     veil the colour of the ground leaves a grey haze of stuck trails.
     Offsetting the veil by that rounding margin makes pixels stall on the
     ground itself. */
  let veilQ = -1, veilStr = "";
  function veilStyle(a: number) {
    const n = Math.round(a * 4000);
    if (n !== veilQ) {
      veilQ = n;
      const aq = Math.max(1, n) / 4000, off = Math.floor(0.5 / aq);
      veilStr = `rgba(${BG.map(c => Math.max(0, c - off)).join(",")},${aq.toFixed(4)})`;
    }
    return veilStr;
  }
  const orLineStyle = alphaStyle("255,255,255"), orFillStyle = alphaStyle("255,255,255"),
    ribbonStyle = alphaStyle("255,255,255"), textStyle = alphaStyle("255,255,255");
  let readout = "", readoutAt = -1;
  let fieldDirty = true;

  /* ---- field ---- */
  let cols = 0, rows = 0;
  let fieldX = new Float32Array(0), fieldY = new Float32Array(0);
  let zPhase = 0;
  let vortices: Vortex[] = [];

  /* ---- particles (structure of arrays) ---- */
  const X = new Float32Array(MAXP), Y = new Float32Array(MAXP), PX = new Float32Array(MAXP), PY = new Float32Array(MAXP);
  const ENTRY = new Float32Array(MAXP), LIFE = new Float32Array(MAXP), MAXLIFE = new Float32Array(MAXP);
  const JIT = new Uint8Array(MAXP), FATE = new Float32Array(MAXP), R = new Float32Array(MAXP);
  const AGENT = new Int16Array(MAXP);
  let count = 0;

  /* ---- ledger (bounded) ---- */
  const curve = new Float32Array(RING);
  let curveLen = 0, curveHead = 0;
  /* running totals in one typed array: closing a position writes no boxed numbers */
  const LG = new Float64Array(6);   // n, grossWin, grossLoss, equity, peak, maxDD
  const L_N = 0, L_WIN = 1, L_LOSS = 2, L_EQ = 3, L_PEAK = 4, L_DD = 5;

  /* ---- colour LUT + draw buckets ---- */
  const lutStyle: string[] = new Array(LUT_N * 2).fill("");
  const lutWidth4 = new Float32Array(LUT_N * 2);   // line widths in quarter pixels
  const lutRGB = new Uint8Array(LUT_N * 3);
  const BUCKETS = LUT_N * 2;
  const counts = new Int32Array(BUCKETS), offs = new Int32Array(BUCKETS), order = new Int32Array(MAXP), bucketOf = new Int16Array(MAXP);

  function buildLUT(c: [string, string, string]) {
    const loss = hexRgb(c[0]), flat = hexRgb(c[1]), prof = hexRgb(c[2]);
    for (let i = 0; i < LUT_N; i++) {
      const r = R_MIN + (i + 0.5) / LUT_N * (R_MAX - R_MIN);
      /* the original formula: flat->profit over 1.6R, flat->loss over 0.9R */
      const t = r >= 0 ? Math.min(1, r / 1.6) : Math.min(1, -r / 0.9);
      const to = r >= 0 ? prof : loss;
      const rgb = [0, 1, 2].map(j => Math.round(flat[j] + (to[j] - flat[j]) * t));
      const mag = Math.min(Math.abs(r), 2.5);
      const a = (26 + mag * 46) / 255;
      lutRGB.set(rgb, i * 3);
      for (let w = 0; w < 2; w++) {
        lutStyle[i * 2 + w] = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
        lutWidth4[i * 2 + w] = 4 * (0.55 + mag * 0.85) * (w ? 1.3 : 0.9);
      }
    }
  }
  buildLUT(opts.palette);
  function lutIndex(r: number) {
    const i = ((r - R_MIN) / (R_MAX - R_MIN) * LUT_N) | 0;
    return i < 0 ? 0 : i >= LUT_N ? LUT_N - 1 : i;
  }

  /* ---- pulses (fixed pool) ---- */
  const pulseX = new Float32Array(MAX_PULSES), pulseY = new Float32Array(MAX_PULSES), pulseR = new Float32Array(MAX_PULSES), pulseT = new Float64Array(MAX_PULSES);
  let pulseNext = 0;

  /* ---------------------------------------------------------------- */

  function targetFor(k: Exclude<ParamKey, "structure" | "vortexCount">): number {
    const v = live[k];
    return typeof v === "number" && isFinite(v) ? v : DEFAULTS[k];
  }
  function applyLive() {
    (["particleCount", "flowSpeed", "volatility", "rangePull", "driftBias", "evolution", "rUnit"] as const).forEach(k => {
      if (mode[k] === "live") val[k].set(targetFor(k));
    });
    if (mode.structure === "live") {
      const h = live.orHigh, l = live.orLow;
      const ok = typeof h === "number" && typeof l === "number";
      orHigh.set(ok ? h : seededOR[0]); orLow.set(ok ? l : seededOR[1]);
    }
    if (mode.vortexCount === "live") syncPools();
  }

  /* live pools: one per active agent, eased in and out */
  function syncPools() {
    const pools = live.pools;
    if (!Array.isArray(pools)) {
      /* no agent data: fall back to the seeded pools once, not on every poll */
      const alive = vortices.filter(v => !v.dying);
      if (!(alive.length === DEFAULTS.vortexCount && alive.every(v => v.key.startsWith("seed:")))) seededVortices(DEFAULTS.vortexCount, true);
      return;
    }
    const want = new Map(pools.map(pl => [pl.name, pl]));
    vortices.forEach(v => {
      const pl = want.get(v.key);
      if (pl) { v.r.set(pl.r); v.s.set(pl.s); v.open = pl.open; v.dying = false; want.delete(v.key); }
      else { v.s.set(0); v.dying = true; v.open = 0; }
    });
    want.forEach(pl => {
      const h = hash(pl.name + ":" + seed);
      vortices.push({
        key: pl.name, open: pl.open, dying: false,
        x: W * (0.1 + rand01(h) * 0.8), y: H * (0.12 + rand01(h ^ 0x9e3779b9) * 0.76),
        r: new Eased(pl.r), s: (() => { const e = new Eased(0); e.set(pl.s); return e; })()
      });
    });
  }
  /* the artifact's seeded pools (manual mode, or no agent data) */
  function seededVortices(n: number, ease: boolean) {
    vortices.forEach(v => { if (!v.key.startsWith("seed:")) { v.s.set(0); v.dying = true; } });
    const keep = vortices.filter(v => !v.key.startsWith("seed:"));
    const fresh: Vortex[] = [];
    for (let i = 0; i < n; i++) {
      const h = hash("seed:" + i + ":" + seed);
      const s = (rand01(h ^ 7) < 0.5 ? -1 : 1) * (0.6 + rand01(h ^ 11) * 0.9);
      const e = new Eased(ease ? 0 : s); if (ease) e.set(s);
      fresh.push({ key: "seed:" + i, open: 0, dying: false, x: W * (0.08 + rand01(h) * 0.84), y: H * (0.08 + rand01(h ^ 3) * 0.84), r: new Eased(H * (0.10 + rand01(h ^ 5) * 0.16)), s: e });
    }
    vortices = keep.concat(fresh);
    fieldDirty = true;
  }

  function tickEases() {
    let moving = false;
    for (let j = 0; j < VAL_KEYS.length; j++) if (val[VAL_KEYS[j]].tick()) moving = true;
    if (orHigh.tick()) moving = true;
    if (orLow.tick()) moving = true;
    for (let i = vortices.length - 1; i >= 0; i--) {
      const v = vortices[i];
      if (v.r.tick()) moving = true;
      if (v.s.tick()) moving = true;
      if (v.dying && !v.s.moving) vortices.splice(i, 1);
    }
    return moving;
  }

  /* ---- seeded RNG (mulberry32) and a Box-Muller gaussian. Local and
     tiny so they inline into the particle loop: p5's random() hands back
     a boxed number on every call. ---- */
  const RNG = new Uint32Array(1);
  const GSPARE = new Float64Array(2);   // [has spare, spare]
  function rseed(n: number) { RNG[0] = n >>> 0; GSPARE[0] = 0; }
  function rnd() {
    RNG[0] = (RNG[0] + 0x6d2b79f5) >>> 0;
    let t = RNG[0];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss() {
    if (GSPARE[0]) { GSPARE[0] = 0; return GSPARE[1]; }
    let u = 0, v = 0, q = 0;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; q = u * u + v * v; } while (q >= 1 || q === 0);
    const m = Math.sqrt(-2 * Math.log(q) / q);
    GSPARE[0] = 1; GSPARE[1] = v * m;
    return u * m;
  }
  /* exit R drawn from the journal sampler, searched in place */
  function drawFate() {
    const sm = sampler;
    if (!sm) return NaN;
    const want = rnd() * sm.total, cum = sm.cum;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > want) hi = mid; else lo = mid + 1; }
    return sm.vals[lo];
  }

  /* ---- value noise: 4 octaves, halving amplitude, cosine-smoothed lattice
     over a seeded 4096-entry table. Kept local (not p5's noise) so it
     inlines into the field loop and returns unboxed numbers. ---- */
  const NT = 4096, NMASK = NT - 1;
  const ntab = new Float64Array(NT);
  const COS_T = new Float64Array(1025);   // 0.5 * (1 - cos(t * PI)) sampled on [0,1]
  for (let i = 0; i <= 1024; i++) COS_T[i] = 0.5 * (1 - Math.cos((i / 1024) * Math.PI));
  function seedNoise() { for (let i = 0; i < NT; i++) ntab[i] = rnd(); }
  /* inputs and output travel through a scratch array: a call with no
     arguments and no return value boxes nothing */
  const NIO = new Float64Array(4);   // [x, y, z, out]
  function noise3() {
    let x = NIO[0], y = NIO[1], z = NIO[2];
    if (x < 0) x = -x; if (y < 0) y = -y; if (z < 0) z = -z;
    let xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    let r = 0, amp = 0.5;
    for (let o = 0; o < 4; o++) {
      let of = xi + (yi << 4) + (zi << 8);
      const rx = COS_T[(xf * 1024) | 0], ry = COS_T[(yf * 1024) | 0];
      let a = ntab[of & NMASK]; a += rx * (ntab[(of + 1) & NMASK] - a);
      let b = ntab[(of + 16) & NMASK]; b += rx * (ntab[(of + 17) & NMASK] - b);
      a += ry * (b - a);
      of += 256;
      let c = ntab[of & NMASK]; c += rx * (ntab[(of + 1) & NMASK] - c);
      let d = ntab[(of + 16) & NMASK]; d += rx * (ntab[(of + 17) & NMASK] - d);
      c += ry * (d - c);
      a += COS_T[(zf * 1024) | 0] * (c - a);
      r += a * amp;
      amp *= 0.5;
      xi <<= 1; xf *= 2; yi <<= 1; yf *= 2; zi <<= 1; zf *= 2;
      if (xf >= 1) { xi++; xf--; }
      if (yf >= 1) { yi++; yf--; }
      if (zf >= 1) { zi++; zf--; }
    }
    NIO[3] = r;
  }

  /* ---- the field: a sum of regimes, not a single octave ---- */
  function rebuildField() {
    const ns = val.noiseScale.v, vol = val.volatility.v, bias = val.driftBias.v, pull = val.rangePull.v;
    const oh = orHigh.v, ol = orLow.v;
    const sigma = H * 0.030;
    const z = zPhase;
    const TWO_PI = Math.PI * 2;
    for (let gy = 0; gy < rows; gy++) {
      const py = gy * SCL;
      const dH = py - oh, dL = py - ol;
      const d = Math.abs(dH) < Math.abs(dL) ? dH : dL;
      const prox = Math.exp(-(d * d) / (2 * sigma * sigma));
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * SCL;
        const idx = gx + gy * cols;
        /* 1. regime */
        NIO[0] = px * ns; NIO[1] = py * ns; NIO[2] = z; noise3();
        const a1 = NIO[3] * TWO_PI * 1.35;
        let vx = Math.cos(a1), vy = Math.sin(a1);
        /* 2. realized volatility */
        NIO[0] = px * ns * 4.3 + 137.1; NIO[1] = py * ns * 4.3 + 91.7; NIO[2] = z * 2.1; noise3();
        const n2 = NIO[3];
        const a2 = n2 * TWO_PI * 2.2;
        vx += Math.cos(a2) * vol; vy += Math.sin(a2) * vol;
        /* 3. book pressure */
        vx += 0.55; vy -= bias * 0.95;
        /* 4. liquidity pools */
        for (let i = 0; i < vortices.length; i++) {
          const vt = vortices[i], vr = vt.r.v;
          const ddx = px - vt.x, ddy = py - vt.y;
          const dist2 = ddx * ddx + ddy * ddy;
          if (dist2 < vr * vr) {
            const dist = Math.sqrt(dist2) + 1e-4;
            const f = 1 - dist / vr;
            const w = f * f * vt.s.v;
            vx += (-ddy / dist) * w * 1.25; vy += (ddx / dist) * w * 1.25;
            vx += (-ddx / dist) * w * 0.18; vy += (-ddy / dist) * w * 0.18;
          }
        }
        /* 5. level magnetism */
        if (prox > 0.012 && pull > 0) {
          const breach = Math.min(1, Math.max(0, (n2 - 0.72) * 5.0));
          const hold = prox * pull * (1 - breach);
          vy *= 1 - 0.85 * hold;
          vx += hold * 0.9 * (vx >= 0 ? 1 : -1);
          vy += -Math.sign(d) * hold * 0.22;
          if (breach > 0.4) vy += Math.sign(d) * breach * 0.9 * prox;
        }
        const m = Math.sqrt(vx * vx + vy * vy) + 1e-6;
        fieldX[idx] = vx / m; fieldY[idx] = vy / m;
      }
    }
    fieldDirty = false;
  }

  /* ---- positions ---- */
  function cohortTotal() {
    let open = 0;
    for (let i = 0; i < vortices.length; i++) if (!vortices[i].dying) open += vortices[i].open;
    return open;
  }
  function reset(i: number, stagger: boolean) {
    const open = cohortTotal();
    let agent = -1;
    /* 600 particles per open agent position belong to that agent's cohort */
    if (open > 0 && count > 0 && rnd() < Math.min(1, (600 * open) / count)) {
      let pick = rnd() * open;
      for (let k = 0; k < vortices.length; k++) {
        const v = vortices[k];
        if (v.dying || v.open <= 0) continue;
        pick -= v.open;
        if (pick <= 0) { agent = k; break; }
      }
    }
    if (agent >= 0) {
      const v = vortices[agent];
      X[i] = Math.min(W - 2, Math.max(2, v.x + gauss() * v.r.v * 0.55));
      Y[i] = Math.min(H - 4, Math.max(4, v.y + gauss() * v.r.v * 0.55));
    } else {
      X[i] = rnd() * W;
      Y[i] = Math.min(H - 4, Math.max(4, (orHigh.v + orLow.v) * 0.5 + gauss() * H * 0.20));
    }
    PX[i] = X[i]; PY[i] = Y[i]; ENTRY[i] = Y[i];
    MAXLIFE[i] = Math.floor(140 + rnd() * 280);
    LIFE[i] = stagger ? Math.floor(rnd() * MAXLIFE[i]) : 0;
    JIT[i] = rnd() < 0.5 ? 0 : 1;
    FATE[i] = drawFate();
    R[i] = 0;
    AGENT[i] = agent;
  }
  function ledger(r: number) {
    LG[L_N]++;
    if (r >= 0) LG[L_WIN] += r; else LG[L_LOSS] -= r;
    LG[L_EQ] += r;
    if (LG[L_EQ] > LG[L_PEAK]) LG[L_PEAK] = LG[L_EQ];
    if (LG[L_PEAK] - LG[L_EQ] > LG[L_DD]) LG[L_DD] = LG[L_PEAK] - LG[L_EQ];
    curve[curveHead] = LG[L_EQ]; curveHead = (curveHead + 1) % RING; if (curveLen < RING) curveLen++;
  }
  function close(i: number, r: number) { ledger(r); reset(i, false); }
  function resize(n: number) {
    n = Math.max(0, Math.min(MAXP, Math.round(n)));
    if (n > count) { const old = count; count = n; for (let i = old; i < n; i++) reset(i, true); }
    else count = n;
  }

  /* one pass over every position; the loop lives here so no function value
     is created per particle */
  function stepAll() {
    const sp = val.flowSpeed.v, ru = val.rUnit.v;
    for (let i = 0; i < count; i++) {
      const gx = (X[i] / SCL) | 0, gy = (Y[i] / SCL) | 0;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) { reset(i, false); continue; }
      const idx = gx + gy * cols;
      PX[i] = X[i]; PY[i] = Y[i];
      X[i] += fieldX[idx] * sp; Y[i] += fieldY[idx] * sp;
      LIFE[i]++;
      const rf = (ENTRY[i] - Y[i]) / ru;     // upward drift from entry is profit
      const fate = FATE[i];
      const out = X[i] < -2 || X[i] > W + 2 || Y[i] < -2 || Y[i] > H + 2;
      const done = LIFE[i] > MAXLIFE[i] || out;
      if (fate !== fate) {   // NaN: no journal yet -> the artifact's own stop / target / time stop
        if (rf <= -1) { ledger(-1); reset(i, false); }
        else if (rf >= 2.5) { ledger(2.5); reset(i, false); }
        else if (done) { ledger(rf < -1 ? -1 : rf > 2.5 ? 2.5 : rf); reset(i, false); }
        else R[i] = rf;
        continue;
      }
      /* journal exits: the field steers the path, the closing R is the journal's */
      if (done) { ledger(fate); reset(i, false); continue; }
      const t = LIFE[i] / MAXLIFE[i];
      R[i] = rf + (fate - rf) * (t * t * (3 - 2 * t));
    }
  }

  /* ---- drawing ---- */
  function drawParticles(ctx: CanvasRenderingContext2D) {
    counts.fill(0);
    for (let i = 0; i < count; i++) { const b = lutIndex(R[i]) * 2 + JIT[i]; bucketOf[i] = b; counts[b]++; }
    let acc = 0;
    for (let b = 0; b < BUCKETS; b++) { offs[b] = acc; acc += counts[b]; }
    for (let i = 0; i < count; i++) order[offs[bucketOf[i]]++] = i;
    let start = 0;
    ctx.lineCap = "round";
    /* draw at 1/4 scale with integer coordinates: quarter-pixel precision,
       and small integers cross into the canvas API without boxing */
    ctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
    for (let b = 0; b < BUCKETS; b++) {
      const n = counts[b];
      if (!n) continue;
      ctx.strokeStyle = lutStyle[b];
      ctx.lineWidth = lutWidth4[b];
      ctx.beginPath();
      for (let j = start; j < start + n; j++) {
        const i = order[j];
        ctx.moveTo((PX[i] * 4) | 0, (PY[i] * 4) | 0);
        ctx.lineTo((X[i] * 4) | 0, (Y[i] * 4) | 0);
      }
      ctx.stroke();
      start += n;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function drawStructure(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = orLineStyle(0.063 * veilK);
    ctx.lineWidth = 1;
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.moveTo(0, orHigh.v); ctx.lineTo(W, orHigh.v);
    ctx.moveTo(0, orLow.v); ctx.lineTo(W, orLow.v);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.fillStyle = orFillStyle(0.012 * veilK);
    ctx.fillRect(0, orHigh.v, W, orLow.v - orHigh.v);
    ctx.restore();
  }
  function drawEquityRibbon(ctx: CanvasRenderingContext2D) {
    if (curveLen < 3) return;
    const baseY = H - 54, h = 86;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < curveLen; k++) { const v = curve[(curveHead - curveLen + k + RING) % RING]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-6) hi = lo + 1;
    ctx.save();
    ctx.strokeStyle = ribbonStyle(0.18 * veilK);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < curveLen; k++) {
      const v = curve[(curveHead - curveLen + k + RING) % RING];
      const x = 40 + (k / (curveLen - 1)) * (W - 80);
      const y = baseY - ((v - lo) / (hi - lo)) * h;
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  function drawReadout(ctx: CanvasRenderingContext2D) {
    const nClosed = LG[L_N], maxDD = LG[L_DD];
    const pf = LG[L_LOSS] > 0 ? LG[L_WIN] / LG[L_LOSS] : 0;
    const avg = nClosed ? (LG[L_WIN] - LG[L_LOSS]) / nClosed : 0;
    ctx.save();
    ctx.fillStyle = textStyle(0.23 * veilK);
    ctx.font = "13px 'Courier New', monospace";
    ctx.textBaseline = "bottom";
    /* the text changes every frame; rebuild it twice a second */
    const now = (p && p.frameCount) || 0;
    if (now - readoutAt >= 30 || readoutAt < 0 || now < readoutAt) {
      readout = `n ${nClosed}   pf ${pf.toFixed(2)}   avg ${avg >= 0 ? "+" : ""}${avg.toFixed(3)}R   dd ${maxDD.toFixed(1)}R   seed ${seed}`;
      readoutAt = now;
    }
    ctx.fillText(readout, 40, H - 18);
    ctx.restore();
  }
  function drawPulses(ctx: CanvasRenderingContext2D, now: number) {
    for (let k = 0; k < MAX_PULSES; k++) {
      const age = now - pulseT[k];
      if (!(age >= 0 && age < PULSE_MS)) continue;
      const t = age / PULSE_MS;
      const li = lutIndex(pulseR[k]) * 3;
      ctx.strokeStyle = `rgba(${lutRGB[li]},${lutRGB[li + 1]},${lutRGB[li + 2]},${(0.85 * (1 - t)).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pulseX[k], pulseY[k], 6 + t * 54, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function frame(ctx: CanvasRenderingContext2D, evolve: boolean) {
    /* the slider sets trail memory at the artifact's speed (1.1); slower
       flow keeps the same trail length in pixels, so the after-hours
       drift settles instead of fading to black */
    veilK = Math.min(1, Math.max(0.15, val.flowSpeed.v / DEFAULTS.flowSpeed));
    const veil = (55 + (Math.min(40, Math.max(2, val.trailLength.v)) - 2) / 38 * (3.2 - 55)) * veilK;
    ctx.fillStyle = veilStyle(veil / 255);
    ctx.fillRect(0, 0, W, H);
    const moving = tickEases();
    if (moving && Math.round(val.particleCount.v) !== count) resize(val.particleCount.v);
    const evo = val.evolution.v;
    if (evolve && p.frameCount % 2 === 0 && (evo > 0 || moving || fieldDirty)) {
      if (evo > 0) zPhase += 0.0019 * evo;
      rebuildField();
    } else if (fieldDirty) rebuildField();
    stepAll();
    drawParticles(ctx);
    drawStructure(ctx);
    drawEquityRibbon(ctx);
    drawReadout(ctx);
    drawPulses(ctx, typeof performance !== "undefined" ? performance.now() : 0);
    if (stale) { ctx.fillStyle = "rgba(255,176,32,0.95)"; ctx.fillRect(0, 0, W, 1); }
  }

  /* reduced motion: one static composite of 600 simulated steps */
  function staticComposite() {
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    ctx.fillStyle = `rgb(${BG[0]},${BG[1]},${BG[2]})`;
    ctx.fillRect(0, 0, W, H);
    (Object.keys(val) as (keyof typeof val)[]).forEach(k => val[k].jump(val[k].to));
    orHigh.jump(orHigh.to); orLow.jump(orLow.to);
    vortices = vortices.filter(v => !v.dying); vortices.forEach(v => { v.r.jump(v.r.to); v.s.jump(v.s.to); });
    resize(val.particleCount.v);
    rebuildField();
    for (let s = 0; s < 600; s++) frame(ctx, false);
  }

  function init() {
    rseed(hash("drift:" + seed));
    seedNoise();
    cols = Math.floor(W / SCL) + 1; rows = Math.floor(H / SCL) + 1;
    fieldX = new Float32Array(cols * rows); fieldY = new Float32Array(cols * rows);
    const mid = H * (0.38 + rnd() * 0.24);
    const half = H * (0.035 + rnd() * 0.055);
    seededOR = [mid - half, mid + half];
    orHigh.jump(seededOR[0]); orLow.jump(seededOR[1]);
    vortices = [];
    if (mode.vortexCount === "live" && Array.isArray(live.pools)) syncPools();
    else seededVortices(Math.round(val.vortexCount.v), false);
    vortices.forEach(v => { v.s.jump(v.s.to); v.r.jump(v.r.to); });
    zPhase = rnd() * 1000;
    applyLive();
    orHigh.jump(orHigh.to); orLow.jump(orLow.to);
    rebuildField();
    count = 0;
    resize(val.particleCount.v);
    LG.fill(0); curveLen = curveHead = 0;
    p.background(BG[0], BG[1], BG[2]);
    if (reduced) { staticComposite(); p.noLoop(); }
  }

  function runState() {
    if (!p) return;
    if (reduced) return;
    if (!paused && visible) p.loop(); else p.noLoop();
  }

  const sketch = (s: P5) => {
    p = s;
    s.setup = () => {
      const c = s.createCanvas(W, H);
      c.elt.style.width = "100%"; c.elt.style.height = "auto";
      s.pixelDensity(1);
      init();
      runState();
    };
    s.draw = () => frame(s.drawingContext as CanvasRenderingContext2D, true);
  };
  const inst = new P5Ctor(sketch, container);

  return {
    setMode(k, m) {
      mode[k] = m;
      if (m === "live") {
        applyLive();
        if (k === "vortexCount") fieldDirty = true;
      }
      if (reduced && p) { staticComposite(); p.redraw(); }
    },
    setManual(k, v) {
      if (k === "structure") return;
      if (k === "vortexCount") { val.vortexCount.jump(v); seededVortices(Math.round(v), false); vortices = vortices.filter(x => !x.dying); }
      else val[k].jump(v);
      if (k === "particleCount") resize(v);
      fieldDirty = true;
      if (reduced && p) { staticComposite(); p.redraw(); }
    },
    setLive(t) {
      live = t;
      applyLive();
      if (reduced && p) { staticComposite(); p.redraw(); }
    },
    setSampler(sm) { sampler = sm; },
    pulse(r, agent) {
      if (!p || count === 0) return;
      let i = -1;
      if (agent) {
        const vi = vortices.findIndex(v => v.key === agent);
        if (vi >= 0) for (let j = 0; j < count; j++) if (AGENT[j] === vi) { i = j; break; }
      }
      if (i < 0) i = Math.floor(rnd() * count);
      const k = pulseNext; pulseNext = (pulseNext + 1) % MAX_PULSES;
      pulseX[k] = X[i]; pulseY[k] = Y[i]; pulseR[k] = r; pulseT[k] = performance.now();
      close(i, r);
    },
    setStale(b) { stale = b; },
    setPalette(c) { buildLUT(c); },
    regenerate(sd) { seed = sd; if (p) { init(); runState(); } },
    togglePause() { paused = !paused; runState(); return paused; },
    download() { if (p) p.saveCanvas("liquidity-drift-" + seed, "png"); },
    values() {
      const out: Record<string, number> = {};
      (Object.keys(val) as (keyof typeof val)[]).forEach(k => { out[k] = val[k].v; });
      if (mode.vortexCount === "live") out.vortexCount = vortices.filter(v => !v.dying).length;
      out.count = count;
      return out;
    },
    setVisible(b) { visible = b; runState(); },
    destroy() { inst.remove(); p = null; }
  };
}
