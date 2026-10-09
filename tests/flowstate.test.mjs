/* /api/flowstate: the payload contract, the pure assembler, and the
   read-only fence around the Liquidity Drift panel. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const schema = require("../lib/flowstate-schema.js");
const engine = require("../lib/engine.js");
const { assemble, atr14, realizedVol, pickSymbol } = require("../lib/flowstate.js");

test("a payload with every field null passes the contract", () => {
  const p = schema.emptyPayload();
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === "object") for (const x of Object.values(v)) assert.equal(x, null, k);
    else assert.equal(v, null, k);
  }
  assert.deepEqual(schema.validate(p), { ok: true, errors: [] });
});

test("whole sections may be null too", () => {
  const p = schema.emptyPayload();
  p.price = null; p.agents = null; p.recentCloses = null;
  assert.equal(schema.validate(p).ok, true);
});

test("the contract rejects wrong types, strays, gaps and overflow", () => {
  const bad = schema.emptyPayload();
  bad.price.last = "512.44";
  bad.vol.atr14 = Infinity;
  bad.extra = 1;
  delete bad.trend.sma20;
  bad.session.state = "halted";
  bad.recentCloses = Array.from({ length: 201 }, () => ({ r: 1, agent: "X", at: "2026-10-08T18:22:00Z" }));
  const v = schema.validate(bad);
  assert.equal(v.ok, false);
  const joined = v.errors.join("\n");
  for (const want of ["price.last", "vol.atr14", "payload.extra", "trend.sma20", "session.state", "more than 200"]) {
    assert.ok(joined.includes(want), "expected an error about " + want + "\n" + joined);
  }
});

test("every source down -> a valid payload of nulls, never an invented number", () => {
  const p = assemble({ now: "2026-10-08T20:14:03Z" });
  assert.equal(schema.validate(p).ok, true);
  assert.equal(p.asOf, "2026-10-08T20:14:03.000Z");
  assert.equal(p.session.state, null);
  assert.equal(p.price.last, null);
  assert.equal(p.performance.n, null);
  assert.equal(p.agents, null);
  assert.equal(p.book.openPositions, null);
});

/* ---- fixtures ---- */
function order(id, side, sym, qty, px, at, extra) {
  return Object.assign({ id, side, symbol: sym, filled_qty: String(qty), filled_avg_price: String(px), filled_at: at, client_order_id: id }, extra || {});
}
function bracket(id, sym, qty, entry, at, stop, legFill) {
  const legs = [{ id: id + "-stop", side: "sell", type: "stop", stop_price: String(stop), filled_qty: legFill ? String(qty) : "0", filled_avg_price: legFill ? String(legFill.px) : null, filled_at: legFill ? legFill.at : null }];
  return order(id, "buy", sym, qty, entry, at, { legs });
}
function bars5(day, n, start, step) {
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.parse(`${day}T13:30:00Z`) + i * 5 * 60e3).toISOString();
    const c = start + i * step + (i % 2 && i > 2 ? 0.4 : 0);   // a little chop after the OR
    return { t, o: c, h: c + 0.2, l: c - 0.2, c, v: 1000 };
  });
}
function daily(n, start, step) {
  return Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return { t: new Date(Date.parse("2026-01-02T05:00:00Z") + i * 864e5).toISOString(), o: c, h: c + 2, l: c - 2, c, v: 1e6 };
  });
}

test("assemble derives agents from the journal's owner tags and keeps closes newest last", () => {
  const orders = [
    /* a scalp win (+1R) and a scalp loss (-1R) today, an rsi2 lot still open */
    bracket("scalp-1", "AAPL", 10, 100, "2026-10-08T14:00:00Z", 99, { px: 99, at: "2026-10-08T15:00:00Z" }),
    order("scalp-2", "buy", "MU", 5, 50, "2026-10-08T14:10:00Z", { legs: [{ id: "scalp-2-stop", side: "sell", type: "stop", stop_price: "49", filled_qty: "0", filled_at: null }] }),
    order("scalp-2x", "sell", "MU", 5, 51, "2026-10-08T16:00:00Z"),
    bracket("rsi2-1", "SPY", 2, 500, "2026-10-07T19:00:00Z", 490, null)
  ];
  const journal = engine.buildRoundTrips(orders);
  const p = assemble({
    now: "2026-10-08T20:14:03Z",
    clock: { is_open: true, timestamp: "2026-10-08T15:30:00-04:00" },
    positions: [{ symbol: "SPY", qty: "2", side: "long", avg_entry_price: "500", current_price: "505", market_value: "1010" }],
    journal, symbol: "SPY",
    snapshot: { latestTrade: { p: 512.44 }, dailyBar: { t: "2026-10-08T04:00:00Z", o: 510, h: 515.1, l: 508.72, c: 512 } },
    bars5: bars5("2026-10-08", 40, 510, 0.05),
    daily: daily(220, 400, 0.5)
  });
  const v = schema.validate(p);
  assert.ok(v.ok, v.errors.join("\n"));

  assert.equal(p.session.state, "open");
  assert.equal(p.session.minutesElapsed, 360);
  assert.equal(p.session.symbol, "SPY");
  assert.equal(p.price.last, 512.44);
  assert.equal(p.price.sessionHigh, 515.1);
  /* OR = the 09:30-09:45 bars, via the scan's own function */
  assert.equal(p.price.openRangeHigh, engine.r4(510 + 0.1 + 0.2));
  assert.equal(p.price.openRangeLow, engine.r4(510 - 0.2));

  assert.deepEqual(p.agents.map(a => a.name), ["RSI2", "SCALP"]);
  const scalp = p.agents.find(a => a.name === "SCALP");
  assert.equal(scalp.state, "flat");
  assert.equal(scalp.openPositions, 0);
  assert.equal(scalp.dayR, 0);           // -1R + +1R
  const rsi2 = p.agents.find(a => a.name === "RSI2");
  assert.equal(rsi2.state, "active");
  assert.equal(rsi2.openPositions, 1);

  assert.deepEqual(p.recentCloses.map(c => c.r), [-1, 1]);   // newest last
  assert.equal(p.performance.n, 2);
  assert.equal(p.performance.winRate, 0.5);
  assert.equal(p.performance.pf, 1);

  assert.equal(p.book.openPositions, 1);
  assert.equal(p.book.netExposureR, 0.5);   // (505-500)/(500-490)
  assert.equal(p.book.largestPositionR, 0.5);

  assert.ok(p.trend.slopeNormalized > 0, "a rising series has a positive slope");
  assert.ok(p.trend.sma200 != null && p.trend.sma20 > p.trend.sma200);
  assert.ok(p.vol.atrPctOfPrice > 0 && p.vol.realizedVol5m > 0);
});

test("profit factor with no losses is reported as null, not Infinity", () => {
  const journal = engine.buildRoundTrips([bracket("scalp-9", "AAPL", 1, 100, "2026-10-08T14:00:00Z", 99, null),
    order("scalp-9x", "sell", "AAPL", 1, 102, "2026-10-08T15:00:00Z")]);
  const p = assemble({ now: "2026-10-08T20:00:00Z", journal });
  assert.equal(p.performance.n, 1);
  assert.equal(p.performance.pf, null);
  assert.equal(schema.validate(p).ok, true);
});

test("helpers: ATR needs 15 bars, realized vol needs 3, symbol falls back to SPY", () => {
  assert.equal(atr14(daily(10, 100, 1)), null);
  assert.equal(atr14(daily(15, 100, 0)), 4);
  assert.equal(realizedVol([{ c: 1 }, { c: 2 }]), null);
  assert.equal(pickSymbol([], null), "SPY");
  assert.equal(pickSymbol([{ symbol: "KO", market_value: "10" }, { symbol: "QQQ", market_value: "-900" }], null), "QQQ");
  assert.equal(pickSymbol(null, "TSLA"), "TSLA");
});
