/* Liquidity Drift — payload -> field parameters. Pure functions, no DOM.
   Each mapping returns null when its inputs are null, and the panel keeps
   its seeded default for that parameter. The numbers here are the art
   direction of the panel; the data they read is never altered.
   Loaded like engine.js (CommonJS for the tests, bundled for the browser). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DriftMap = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  var SESSION_LEN = 390;
  var PAD = 0.08;              // share of canvas height kept clear above/below the session range
  var MAX_PARTICLES = 6000;
  var RECENT_WEIGHT = 3;       // the last 50 closes count three times
  var RECENT_N = 50;

  function num(x) { return typeof x === "number" && isFinite(x) ? x : null; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function lin(x, a, b, c, d) { return c + (clamp((x - a) / (b - a), 0, 1)) * (d - c); }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function get(o, k) { return o && typeof o === "object" ? o[k] : null; }

  /* price -> canvas y, with the session range as the axis extent */
  function priceAxis(price, h) {
    var hi = num(get(price, "sessionHigh")), lo = num(get(price, "sessionLow"));
    if (hi == null || lo == null || !(hi > lo)) return null;
    var top = h * PAD, span = h * (1 - 2 * PAD);
    return { y: function (p) { return top + (hi - p) / (hi - lo) * span; }, pxPerDollar: span / (hi - lo) };
  }

  var MAP = {
    /* trend: SMA20 slope in ATRs, already -1..1; + = up the screen = profit */
    driftBias: function (p) {
      var s = num(get(get(p, "trend"), "slopeNormalized"));
      return s == null ? null : clamp(s, -1, 1);
    },
    /* turbulence octave weight from ATR as a share of price */
    volatility: function (p) {
      var a = num(get(get(p, "vol"), "atrPctOfPrice"));
      return a == null ? null : lin(a, 0.002, 0.020, 0.15, 1.5);
    },
    /* tick velocity from 5-minute realized vol, eased through the band */
    flowSpeed: function (p) {
      var rv = num(get(get(p, "vol"), "realizedVol5m"));
      if (rv == null) return null;
      return 0.4 + smooth(clamp((rv - 0.001) / (0.010 - 0.001), 0, 1)) * (2.4 - 0.4);
    },
    /* level magnetism decays as the session ages: 1.3 at the bell -> ~0.4 at the close */
    rangePull: function (p) {
      var m = num(get(get(p, "session"), "minutesElapsed"));
      if (m == null) return null;
      return 0.4 + 0.9 * Math.exp(-clamp(m, 0, SESSION_LEN) / 110);
    },
    /* base 800 + 600 per open position (book + every agent), capped */
    particleCount: function (p) {
      var book = num(get(get(p, "book"), "openPositions"));
      var agents = Array.isArray(get(p, "agents")) ? p.agents : null;
      if (book == null && !agents) return null;
      var open = book || 0;
      (agents || []).forEach(function (a) { open += num(get(a, "openPositions")) || 0; });
      return Math.min(MAX_PARTICLES, 800 + 600 * open);
    }
  };

  /* opening range onto canvas y; null unless all four prices are known */
  function structure(p, h) {
    var price = get(p, "price");
    var axis = priceAxis(price, h);
    var orh = num(get(price, "openRangeHigh")), orl = num(get(price, "openRangeLow"));
    if (!axis || orh == null || orl == null || !(orh >= orl)) return null;
    return { orHigh: axis.y(orh), orLow: axis.y(orl) };
  }

  /* 1R on screen = 1R in the journal: with working capital fully deployed
     at the engine's per-trade risk, one R is riskPct of the price per share
     (riskDollars / shares = capital*riskPct / (capital/price)). Converted to
     pixels on the same price axis, then held inside the slider's range. */
  function rUnit(p, h, riskPct) {
    var price = get(p, "price");
    var axis = priceAxis(price, h);
    var last = num(get(price, "last"));
    if (!axis || last == null || !(riskPct > 0)) return null;
    return clamp(riskPct * last * axis.pxPerDollar, 30, 220);
  }

  /* one liquidity pool per active agent: sign = sign of its day R,
     radius grows with |day R| */
  function pools(p, h) {
    var agents = get(p, "agents");
    if (!Array.isArray(agents)) return null;
    return agents.filter(function (a) { return a && a.state === "active" && a.name; }).map(function (a) {
      var r = num(a.dayR) || 0, mag = Math.min(Math.abs(r), 3) / 3;
      return {
        name: String(a.name),
        open: num(a.openPositions) || 0,
        s: (r < 0 ? -1 : 1) * (r === 0 ? 0.35 : 0.6 + mag * 0.9),
        r: h * (0.08 + mag * 0.18)
      };
    });
  }

  /* every parameter target the payload supports; null = keep the default */
  function targets(p, h, riskPct) {
    var out = {};
    Object.keys(MAP).forEach(function (k) { out[k] = MAP[k](p); });
    var st = structure(p, h);
    out.orHigh = st ? st.orHigh : null;
    out.orLow = st ? st.orLow : null;
    out.rUnit = rUnit(p, h, riskPct);
    out.evolution = null;
    out.pools = pools(p, h);
    var state = get(get(p, "session"), "state");
    out.closed = state != null && state !== "open";
    if (out.closed) { out.flowSpeed = 0.25; out.evolution = 0.08; }   // after-hours drift
    return out;
  }

  /* exit-R sampler over recentCloses (oldest first), the last 50 weighted up.
     Returns null with no closes: the panel then keeps its synthetic exits. */
  function sampler(closes) {
    var rs = (Array.isArray(closes) ? closes : []).map(function (c) { return num(get(c, "r")); }).filter(function (r) { return r != null; });
    if (!rs.length) return null;
    var cum = new Float64Array(rs.length), vals = new Float64Array(rs), total = 0;
    for (var i = 0; i < rs.length; i++) {
      total += i >= rs.length - RECENT_N ? RECENT_WEIGHT : 1;
      cum[i] = total;
    }
    return {
      n: rs.length, cum: cum, vals: vals, total: total,
      /* u in [0,1) -> an R drawn from the empirical distribution */
      draw: function (u) {
        var want = u * total, lo = 0, hi = cum.length - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] > want) hi = mid; else lo = mid + 1; }
        return vals[lo];
      }
    };
  }

  function closeKey(c) { return c ? String(c.at) + "|" + String(c.agent) + "|" + String(c.r) : ""; }

  return { MAP: MAP, targets: targets, structure: structure, rUnit: rUnit, pools: pools, sampler: sampler, closeKey: closeKey, MAX_PARTICLES: MAX_PARTICLES };
});
