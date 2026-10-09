/* GLADIATOR SCALP — /api/flowstate payload contract.
   One validator, used twice: the route handler checks what it is about to
   send, the Liquidity Drift panel checks what it received. Every numeric
   field is a finite number or null; null means "not available", and the
   renderer falls back to its seeded default for it. Nothing here does I/O.
   Loaded the same way as engine.js (CommonJS on the server, bundled into
   the browser). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FlowstateSchema = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  var NUM = "num", STR = "str", LIST = "list", OBJ = "obj";

  /* the shape, field by field; nested objects may themselves be null */
  var SHAPE = {
    asOf: STR,
    session: { state: STR, minutesElapsed: NUM, symbol: STR },
    price: { last: NUM, sessionHigh: NUM, sessionLow: NUM, openRangeHigh: NUM, openRangeLow: NUM },
    vol: { atr14: NUM, atrPctOfPrice: NUM, realizedVol5m: NUM },
    trend: { sma20: NUM, sma200: NUM, slopeNormalized: NUM },
    book: { openPositions: NUM, netExposureR: NUM, largestPositionR: NUM },
    performance: { n: NUM, pf: NUM, avgR: NUM, maxDDPct: NUM, winRate: NUM },
    agents: { list: { name: STR, openPositions: NUM, dayR: NUM, state: STR } },
    recentCloses: { list: { r: NUM, agent: STR, at: STR }, max: 200 }
  };
  var SESSION_STATES = ["open", "closed"];
  var AGENT_STATES = ["active", "flat"];

  function isObj(x) { return x != null && typeof x === "object" && !Array.isArray(x); }
  function kindOf(spec) {
    if (typeof spec === "string") return spec;
    return spec.list ? LIST : OBJ;
  }

  function checkLeaf(kind, v, path, errs) {
    if (v === null) return;
    if (kind === NUM) { if (typeof v !== "number" || !isFinite(v)) errs.push(path + ": expected a finite number or null"); }
    else if (kind === STR) { if (typeof v !== "string") errs.push(path + ": expected a string or null"); }
  }
  function checkObj(spec, v, path, errs) {
    if (v === null) return;
    if (!isObj(v)) { errs.push(path + ": expected an object or null"); return; }
    Object.keys(spec).forEach(function (k) {
      if (!(k in v)) { errs.push(path + "." + k + ": missing (send null when unavailable)"); return; }
      check(spec[k], v[k], path + "." + k, errs);
    });
    Object.keys(v).forEach(function (k) {
      if (!(k in spec)) errs.push(path + "." + k + ": not in the contract");
    });
  }
  function check(spec, v, path, errs) {
    var kind = kindOf(spec);
    if (kind === OBJ) return checkObj(spec, v, path, errs);
    if (kind === LIST) {
      if (v === null) return;
      if (!Array.isArray(v)) { errs.push(path + ": expected an array or null"); return; }
      if (spec.max && v.length > spec.max) errs.push(path + ": more than " + spec.max + " entries");
      v.forEach(function (item, i) { checkObj(spec.list, item, path + "[" + i + "]", errs); });
      return;
    }
    checkLeaf(kind, v, path, errs);
  }

  /* -> { ok, errors[] } */
  function validate(payload) {
    var errs = [];
    if (!isObj(payload)) return { ok: false, errors: ["payload: expected an object"] };
    checkObj(SHAPE, payload, "payload", errs);
    if (isObj(payload.session) && payload.session.state != null && SESSION_STATES.indexOf(payload.session.state) < 0) {
      errs.push("payload.session.state: expected open | closed | null");
    }
    (Array.isArray(payload.agents) ? payload.agents : []).forEach(function (a, i) {
      if (isObj(a) && a.state != null && AGENT_STATES.indexOf(a.state) < 0) errs.push("payload.agents[" + i + "].state: expected active | flat | null");
    });
    return { ok: errs.length === 0, errors: errs };
  }

  /* every field present, every value null: the contract's floor */
  function emptyPayload() {
    function fill(spec) {
      var out = {};
      Object.keys(spec).forEach(function (k) {
        var kind = kindOf(spec[k]);
        out[k] = kind === OBJ ? fill(spec[k]) : null;
      });
      return out;
    }
    return fill(SHAPE);
  }

  return { SHAPE: SHAPE, validate: validate, emptyPayload: emptyPayload, MAX_CLOSES: 200 };
});
