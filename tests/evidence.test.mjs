import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../lib/engine.js");

/* Shapes mirror /v2/orders?status=closed&nested=true. Times are UTC in EDT
   (13:45Z = 09:45 ET). */
function buy(o) {
  return Object.assign({
    id: "b1", side: "buy", symbol: "CMG", status: "filled",
    filled_at: "2026-08-27T14:05:00Z", filled_qty: "10", filled_avg_price: "52.00", legs: []
  }, o);
}
function sell(o) {
  return Object.assign({
    id: "s1", side: "sell", symbol: "CMG", status: "filled",
    filled_at: "2026-08-27T19:52:00Z", filled_qty: "10", filled_avg_price: "52.50", legs: []
  }, o);
}
function stopLeg(o) {
  return Object.assign({ id: "L-stop", type: "stop", stop_price: "51.00",
    filled_at: null, filled_qty: "0", filled_avg_price: null }, o);
}
function tpLeg(o) {
  return Object.assign({ id: "L-tp", type: "limit", limit_price: "53.50",
    filled_at: null, filled_qty: "0", filled_avg_price: null }, o);
}
const trips = (orders) => E.annotateBreaches(E.buildRoundTrips(orders), { equityCap: 750, today: "2026-09-01" });

test("round trips carry entry/exit timestamps and the fills that made them", () => {
  const j = E.buildRoundTrips([buy({
    legs: [tpLeg(), stopLeg({ filled_at: "2026-08-27T17:02:00Z", filled_qty: "10", filled_avg_price: "50.91" })]
  })]);
  assert.equal(j[0].entryAt, "2026-08-27T14:05:00Z");
  assert.equal(j[0].exitAt, "2026-08-27T17:02:00Z");
  assert.deepEqual(j[0].exitKinds, ["stop"]);
  assert.equal(j[0].fills.length, 2);
  assert.equal(j[0].fills[0].kind, "entry");
  assert.equal(j[0].fills[1].kind, "stop");
  assert.equal(j[0].strategy, "scalp");
});

test("a clean bracket trade has no breaches", () => {
  const j = trips([buy({ filled_qty: "10", filled_avg_price: "52.00",
    legs: [tpLeg(), stopLeg({ stop_price: "51.00", filled_at: "2026-08-27T17:02:00Z", filled_qty: "10", filled_avg_price: "50.91" })] })]);
  assert.deepEqual(j[0].breaches, []);
  assert.equal(j[0].breachRulesVersion, E.RULES.breachRulesVersion);
});

test("NO_STOP: a position opened without a bracket stop", () => {
  const j = trips([buy({ legs: [] }), sell()]);
  assert.ok(j[0].breaches.includes("NO_STOP"));
  assert.equal(j[0].r, null, "and it can never earn an R");
});

test("MANUAL_EXIT: standalone sell outside the 15:50-16:00 flat window", () => {
  const early = trips([buy({ legs: [stopLeg()] }), sell({ filled_at: "2026-08-27T16:30:00Z" })]); // 12:30 ET
  assert.ok(early[0].breaches.includes("MANUAL_EXIT"));
  const timeStop = trips([buy({ legs: [stopLeg()] }), sell({ filled_at: "2026-08-27T19:55:00Z" })]); // 15:55 ET
  assert.ok(!timeStop[0].breaches.includes("MANUAL_EXIT"), "the 15:55 flat is the rule working");
  const bracket = trips([buy({ legs: [stopLeg({ filled_at: "2026-08-27T16:30:00Z", filled_qty: "10", filled_avg_price: "50.95" })] })]);
  assert.ok(!bracket[0].breaches.includes("MANUAL_EXIT"), "a bracket leg is never manual");
});

test("SECOND_TRADE: the second entry of a day, by fill order, not the first", () => {
  const j = trips([
    buy({ id: "b-a", symbol: "AAL", filled_at: "2026-08-27T14:05:00Z", legs: [stopLeg({ id: "La", stop_price: "51" })] }),
    buy({ id: "b-b", symbol: "NIO", filled_at: "2026-08-27T15:05:00Z", legs: [stopLeg({ id: "Lb", stop_price: "51" })] })
  ]);
  const a = j.find(x => x.id === "b-a"), b = j.find(x => x.id === "b-b");
  assert.ok(!a.breaches.includes("SECOND_TRADE"));
  assert.ok(b.breaches.includes("SECOND_TRADE"));
});

test("OUTSIDE_WINDOW: entries before 09:45 or after 15:30 ET", () => {
  const pre = trips([buy({ filled_at: "2026-08-27T13:40:00Z", legs: [stopLeg()] })]);  // 09:40 ET
  assert.ok(pre[0].breaches.includes("OUTSIDE_WINDOW"));
  const late = trips([buy({ filled_at: "2026-08-27T19:35:00Z", legs: [stopLeg()] })]); // 15:35 ET
  assert.ok(late[0].breaches.includes("OUTSIDE_WINDOW"));
  const ok = trips([buy({ filled_at: "2026-08-27T13:45:00Z", legs: [stopLeg()] })]);   // 09:45 ET
  assert.ok(!ok[0].breaches.includes("OUTSIDE_WINDOW"));
});

test("OVERSIZED: dollars at risk above 2% of capped equity", () => {
  // 10 sh x (52-51) = $10 risk on $15 cap: fine
  const ok = trips([buy({ legs: [stopLeg({ stop_price: "51.00" })] })]);
  assert.ok(!ok[0].breaches.includes("OVERSIZED"));
  // 10 sh x (52-50) = $20 risk: oversized
  const big = trips([buy({ legs: [stopLeg({ stop_price: "50.00" })] })]);
  assert.ok(big[0].breaches.includes("OVERSIZED"));
});

test("HELD_OVERNIGHT: cross-date exit, and an open lot from a previous day", () => {
  const closed = trips([
    buy({ id: "b-cde", symbol: "CDE", filled_at: "2026-08-25T14:00:00Z", legs: [stopLeg({ id: "L", stop_price: "51" })] }),
    sell({ id: "s-cde", symbol: "CDE", filled_at: "2026-08-27T18:00:00Z" })
  ]);
  assert.ok(closed[0].breaches.includes("HELD_OVERNIGHT"));
  const open = trips([buy({ id: "b-open", filled_at: "2026-08-25T14:00:00Z", legs: [stopLeg()] })]);
  assert.equal(open[0].reason, "open");
  assert.ok(open[0].breaches.includes("HELD_OVERNIGHT"), "still open days later is a breach, not a pending trade");
});

test("evidenceStats: five tiles, excluded rows visible, verdict never softened", () => {
  const mk = (i, r, extra) => Object.assign({
    id: "t" + i, src: "alpaca", strategy: "scalp", date: "2026-08-0" + ((i % 9) + 1), symbol: "X",
    entry: 10, stop: 9, exit: 10 + r, r, pnl: r * 10, reason: r > 0 ? "target" : "stop", breaches: [], breachRulesVersion: 1
  }, extra || {});
  const five = [mk(1, 1.5), mk(2, 1.5), mk(3, -1), mk(4, 1.5), mk(5, -1)];
  const s5 = E.evidenceStats(five, { startEquity: 750 });
  assert.equal(s5.n, 5);
  assert.equal(s5.tier.tier, "ANECDOTE");
  assert.equal(s5.goLive, false);
  assert.equal(s5.verdict, "GO-LIVE GATE: NOT MET");
  assert.equal(s5.gates.find(g => g.key === "pf").noise, true, "PF is labeled noise below n=40");
  assert.equal(s5.rPath.length, 6);
  assert.equal(s5.rPath[5], 2.5);

  // excluded rows are counted and reported, never silently dropped
  const withJunk = [
    ...five,
    mk(6, null, { stop: null, r: null, reason: "eod" }),
    mk(7, null, { r: null, reason: "partial" }),
    mk(8, null, { r: null, exit: null, reason: "open" })
  ];
  const sj = E.evidenceStats(withJunk, { startEquity: 750 });
  assert.equal(sj.n, 5);
  assert.deepEqual(sj.excluded, { noStop: 1, badR: 0, partial: 1, open: 1, total: 3 });

  // 45 alternating trades clear n, PF and avg-R
  const many = Array.from({ length: 45 }, (_, i) => mk(i, i % 2 ? 1.5 : -1));
  const sm = E.evidenceStats(many, { startEquity: 750 });
  assert.equal(sm.tier.tier, "VALIDATION");
  assert.ok(sm.pf > 1.3);
  assert.equal(sm.goLive, sm.avgR >= 0.15 && sm.maxDDPct < 10);

  // one breach in the last-20 window blocks; the same breach outside it does not
  const recentBreach = [mk(99, 1.5, { breaches: ["MANUAL_EXIT"] }), ...many];
  assert.equal(E.evidenceStats(recentBreach, { startEquity: 750 }).breachesLast20, 1);
  assert.equal(E.evidenceStats(recentBreach, { startEquity: 750 }).goLive, false);
  const oldBreach = [...many, mk(99, 1.5, { breaches: ["MANUAL_EXIT"] })];
  assert.equal(E.evidenceStats(oldBreach, { startEquity: 750 }).breachesLast20, 0);

  // a NO_STOP trade cannot hide from the breach window by having no R
  const noStop = [mk(98, null, { stop: null, r: null, reason: "eod", breaches: ["NO_STOP"] }), ...many];
  assert.equal(E.evidenceStats(noStop, { startEquity: 750 }).breachesLast20, 1);
});

test("evidenceStats is strategy-scoped: another tenant's fills never pad n", () => {
  const mk = (i, strategy) => ({ id: "t" + i, src: "alpaca", strategy, date: "2026-08-01", symbol: "X",
    entry: 10, stop: 9, exit: 11.5, r: 1.5, reason: "target", breaches: [] });
  const mixed = [...Array.from({ length: 5 }, (_, i) => mk(i, "scalp")), ...Array.from({ length: 50 }, (_, i) => mk(100 + i, "orb-v2"))];
  assert.equal(E.evidenceStats(mixed, { strategy: "scalp" }).n, 5);
  assert.equal(E.evidenceStats(mixed, { strategy: "orb-v2" }).n, 50);
  assert.equal(E.evidenceStats(mixed).n, 5, "default tenant is scalp");
});

test("regimeFromBars: SPY vs SMA20/50, breadth can only downgrade", () => {
  const rising = Array.from({ length: 60 }, (_, i) => ({ t: "d" + i, c: 100 + i }));
  assert.equal(E.regimeFromBars(rising).regime, "GREEN");
  const falling = Array.from({ length: 60 }, (_, i) => ({ t: "d" + i, c: 200 - i }));
  assert.equal(E.regimeFromBars(falling).regime, "RED");
  // above the 50 but a sharp dip under the 20
  const dip = rising.map((b, i) => (i >= 55 ? { t: b.t, c: 140 } : b)); // SMA20 ≈145, SMA50 ≈133
  assert.equal(E.regimeFromBars(dip).regime, "YELLOW");
  assert.equal(E.regimeFromBars(rising.slice(0, 30)).regime, "UNKNOWN", "fewer than 50 bars is unknown, not guessed");
  assert.equal(E.regimeFromBars(rising, 0.3).regime, "YELLOW", "weak breadth downgrades GREEN");
  assert.equal(E.regimeFromBars(rising, 0.3).source, "spy_breadth");
  assert.equal(E.regimeFromBars(rising).source, "spy_only");
});

test("regimeFor / regimeBreakdown never backfill: no snapshot is UNKNOWN", () => {
  const snaps = { "2026-08-27": { regime: "GREEN" } };
  assert.equal(E.regimeFor("2026-08-27", snaps), "GREEN");
  assert.equal(E.regimeFor("2026-08-26", snaps), "UNKNOWN");
  const recs = [
    { src: "alpaca", date: "2026-08-27", r: 1.5, reason: "target" },
    { src: "alpaca", date: "2026-08-26", r: -1, reason: "stop" },
    { src: "alpaca", date: "2026-08-26", r: null, reason: "open" }
  ];
  const b = E.regimeBreakdown(recs, snaps);
  assert.equal(b.find(x => x.regime === "GREEN").n, 1);
  assert.equal(b.find(x => x.regime === "UNKNOWN").n, 1);
  assert.equal(b.find(x => x.regime === "RED").n, 0);
});

test("gateBlockBreakdown counts the first blocking gate on NO_TRADE days", () => {
  const snaps = [
    { date: "2026-08-25", verdict: "NO_TRADE", firstBlock: "spread" },
    { date: "2026-08-26", verdict: "NO_TRADE", firstBlock: "spread" },
    { date: "2026-08-27", verdict: "NO_TRADE", firstBlock: "score" },
    { date: "2026-08-28", verdict: "TRADE_ARMED", firstBlock: null }
  ];
  const g = E.gateBlockBreakdown(snaps);
  assert.equal(g.days, 4);
  assert.equal(g.noTradeDays, 3);
  assert.deepEqual(g.blockers[0], { gate: "spread", days: 2 });
});

test("firstBlockingGate reads the ticket in gate order and ignores the arm gate", () => {
  const t = { gates: [
    { key: "band", blocking: true, pass: true },
    { key: "score", blocking: true, pass: false },
    { key: "spread", blocking: true, pass: false },
    { key: "trigger", blocking: false, pass: false }
  ] };
  assert.equal(E.firstBlockingGate(t), "score");
  assert.equal(E.firstBlockingGate({ gates: [{ key: "trigger", blocking: false, pass: false }] }), null);
  assert.equal(E.firstBlockingGate(null), null);
});
