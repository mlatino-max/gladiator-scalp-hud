import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../lib/engine.js");

/* a row that should pass every structural gate */
function goodRow(over) {
  return Object.assign({
    symbol: "SOFI", price: 19.0, prevClose: 18.5, gap: 2.7, rvol: 1.5,
    orh: 19.2, orl: 18.9, orReady: true,
    bid: 18.99, ask: 19.0, vwap: 19.0, lastClose5m: 19.3
  }, over || {});
}
function goodCtx(over) {
  return Object.assign({
    equity: 750, coolingOff: false, weeklyDDPct: 0, tradedToday: 0,
    minutesET: 10 * 60, topSymbol: "SOFI"
  }, over || {});
}
function gate(t, key) { return t.gates.find(g => g.key === key); }

test("fully valid ticket arms", () => {
  const t = E.buildTicket(goodRow(), goodCtx());
  assert.equal(t.ok, true, JSON.stringify(t.reasons));
  assert.equal(t.armed, true);
  assert.ok(t.shares >= 1);
  // sizing: risk/share = entry(19.2*1.0005≈19.21) - 18.9 ≈ .31; $15/.31=48; cash 750/19.21=39 → 39
  assert.equal(t.shares, Math.min(Math.floor(15 / (t.entry_est - t.stop)), Math.floor(750 / t.entry_est)));
  assert.equal(t.target, E.r2(t.entry_est + 1.5 * (t.entry_est - t.stop)));
});

test("spread gate blocks wide or missing NBBO", () => {
  let t = E.buildTicket(goodRow({ bid: 18.5, ask: 19.0 }), goodCtx());
  assert.equal(gate(t, "spread").pass, false);
  assert.equal(t.ok, false);
  // fail closed when there is no quote at all (e.g. iex ap=0)
  t = E.buildTicket(goodRow({ bid: 18.99, ask: 0 }), goodCtx());
  assert.equal(gate(t, "spread").pass, false);
});

test("VWAP / OR-close trigger gates the armed state, not the staging", () => {
  const t = E.buildTicket(goodRow({ lastClose5m: 19.1 }), goodCtx()); // below ORH
  assert.equal(t.ok, true);
  assert.equal(t.armed, false);
  assert.equal(gate(t, "trigger").pass, false);
  const t2 = E.buildTicket(goodRow({ vwap: 19.35 }), goodCtx()); // close above ORH but below VWAP
  assert.equal(t2.armed, false);
});

test("stop width, band, score, OR gates block", () => {
  assert.equal(E.buildTicket(goodRow({ orl: 18.0 }), goodCtx()).ok, false);      // stop ~6% wide
  assert.equal(E.buildTicket(goodRow({ price: 150 }), goodCtx()).ok, false);      // out of band
  assert.equal(E.buildTicket(goodRow({ gap: 0.2, rvol: 0.5 }), goodCtx()).ok, false); // score < 2
  assert.equal(E.buildTicket(goodRow({ orReady: false }), goodCtx()).ok, false);  // OR not captured
});

test("risk gates: cooling-off, equity halt, weekly DD, one-trade, window, top-1", () => {
  assert.equal(E.buildTicket(goodRow(), goodCtx({ coolingOff: true })).ok, false);
  assert.equal(E.buildTicket(goodRow(), goodCtx({ equity: 400 })).ok, false);
  assert.equal(E.buildTicket(goodRow(), goodCtx({ weeklyDDPct: 6.5 })).ok, false);
  assert.equal(E.buildTicket(goodRow(), goodCtx({ tradedToday: 1 })).ok, false);
  assert.equal(E.buildTicket(goodRow(), goodCtx({ minutesET: 9 * 60 })).ok, false);   // before window
  assert.equal(E.buildTicket(goodRow(), goodCtx({ minutesET: 15 * 60 + 45 })).ok, false); // after window
  assert.equal(E.buildTicket(goodRow(), goodCtx({ topSymbol: "AAPL" })).ok, false);
});

test("verdict comes from the same ticket the sidebar shows", () => {
  const rows = [goodRow(), goodRow({ symbol: "AAL", gap: 0.1, rvol: 0.5 })];
  const v = E.computeVerdict(rows, goodCtx({ topSymbol: null }));
  assert.equal(v.top, "SOFI");
  assert.equal(v.verdict, "TRADE_ARMED");
  const v2 = E.computeVerdict(rows, goodCtx({ topSymbol: null, coolingOff: true }));
  assert.equal(v2.verdict, "NO_TRADE");
  assert.match(v2.reason, /Cooling-off/);
});

test("opening range and VWAP from 5-min bars", () => {
  const mk = (hhmmUTC, o, h, l, c, v) => ({ t: `2026-08-28T${hhmmUTC}:00Z`, o, h, l, c, v, vw: (h + l + c) / 3 });
  // 13:30 UTC == 09:30 ET (EDT)
  const bars = [mk("13:30", 10, 10.5, 9.9, 10.2, 1000), mk("13:35", 10.2, 10.8, 10.1, 10.6, 800), mk("13:40", 10.6, 10.7, 10.3, 10.4, 500), mk("13:45", 10.4, 11, 10.4, 10.9, 700)];
  const or = E.openingRange(bars, 10 * 60);
  assert.equal(or.orh, 10.8);
  assert.equal(or.orl, 9.9);
  assert.equal(or.ready, true);
  assert.equal(E.openingRange(bars, 9 * 60 + 40).ready, false); // window not elapsed yet
  const vwap = E.sessionVWAP(bars);
  assert.ok(vwap > 10 && vwap < 11);
  // last completed bar at 09:52 ET is the 09:45 bar (closes 09:50)
  assert.equal(E.lastCompletedClose(bars, 9 * 60 + 52), 10.9);
  assert.equal(E.lastCompletedClose(bars, 9 * 60 + 48), 10.4);
});

test("rvol estimate pro-rates the session", () => {
  // half the session elapsed, half the average volume traded → rvol 1.0
  assert.equal(E.rvolEstimate(500000, 1000000, 9 * 60 + 30 + 195), 1.0);
  assert.equal(E.rvolEstimate(null, 1000000, 600), null);
});

test("journal stats and evidence tiers", () => {
  // src:"alpaca" — only broker-reconstructed round trips move the gate
  const mkT = (r, plan) => ({ src: "alpaca", date: "2026-08-01", symbol: "X", r, reason: r > 0 ? "target" : "stop", plan: plan || "yes" });
  const j5 = [mkT(1.5), mkT(1.5), mkT(-1), mkT(1.5), mkT(-1)];
  const s5 = E.journalStats(j5, 750);
  assert.equal(s5.n, 5);
  assert.equal(s5.tier.tier, "ANECDOTE");
  assert.equal(s5.goLive, false); // never at n=5, whatever the PF
  const j45 = Array.from({ length: 45 }, (_, i) => mkT(i % 2 ? 1.5 : -1));
  const s45 = E.journalStats(j45, 750);
  assert.equal(s45.tier.tier, "VALIDATION");
  assert.ok(s45.pf > 1.3);
  assert.equal(s45.goLive, s45.avgR >= 0.15 && s45.maxDDPct < 10);
  const breach = E.journalStats([mkT(1.5, "no"), ...j45], 750);
  assert.equal(breach.breachesLast20, 1);
  assert.equal(breach.goLive, false);
  assert.equal(E.evidenceTier(120).tier, "EVIDENCE");
  // no_trade rows never count toward n
  assert.equal(E.journalStats([{ src: "alpaca", date: "d", reason: "no_trade", r: null }], 750).n, 0);
});

test("hand-typed rows can never advance the validation gate", () => {
  const typed = (i) => ({
    id: "m" + i, src: "manual", date: "2026-08-01", symbol: "FAKE",
    entry: 10, stop: 9, exit: 10.5, r: 0.5, reason: "target", plan: "yes"
  });
  // forty perfect typed trades: the exact shape the manual journal form produces
  const forty = Array.from({ length: 40 }, (_, i) => typed(i));
  const st = E.journalStats(forty, 750);
  assert.equal(st.n, 0, "typed rows do not count toward n");
  assert.equal(st.manualExcluded, 40, "and the lab must say how many it dropped");
  assert.equal(st.goLive, false, "typing cannot clear the go-live gate");
  assert.equal(E.isTrade(typed(0)), true, "still a trade for display purposes");
  assert.equal(E.isBrokerTrade(typed(0)), false, "but not a broker trade");

  // mixing them in must not pad a real journal either
  const broker = Array.from({ length: 5 }, () => ({
    src: "alpaca", date: "2026-08-01", symbol: "SOXL", r: 1.5, reason: "target", plan: "yes"
  }));
  const mixed = E.journalStats([...forty, ...broker], 750);
  assert.equal(mixed.n, 5, "n counts the fills, not the typing");
  assert.equal(mixed.manualExcluded, 40);
});

test("an unreviewed trade is not a clean one — the cache-clear hole", () => {
  const mk = (plan) => ({ src: "alpaca", date: "2026-08-01", symbol: "X", r: 1.5, reason: "target", plan });
  assert.equal(E.planState(mk("yes")), "yes");
  assert.equal(E.planState(mk("no")), "no");
  assert.equal(E.planState(mk(null)), "unknown", "no recorded flag is unknown, not clean");
  assert.equal(E.planState(mk(undefined)), "unknown");
  assert.equal(E.planState(undefined), "unknown");

  // forty passing trades that nobody has reviewed: the state a fresh browser
  // (or a cleared cache) produces, since the flags only live in localStorage
  const unreviewed = Array.from({ length: 40 }, () => mk(null));
  const su = E.journalStats(unreviewed, 750);
  assert.equal(su.n, 40);
  assert.equal(su.unreviewedLast20, E.RULES.validation.cleanLast);
  assert.equal(su.goLive, false, "unreviewed trades must not certify the gate");

  // the same trades, actually reviewed and clean, do pass
  const reviewed = Array.from({ length: 40 }, () => mk("yes"));
  const sr = E.journalStats(reviewed, 750);
  assert.equal(sr.unreviewedLast20, 0);
  assert.equal(sr.goLive, true, "reviewed and clean still clears the gate");

  // one unreviewed row inside the clean-last-20 window is enough to block
  const oneBlank = [mk(null), ...Array.from({ length: 39 }, () => mk("yes"))];
  assert.equal(E.journalStats(oneBlank, 750).unreviewedLast20, 1);
  assert.equal(E.journalStats(oneBlank, 750).goLive, false);

  // ...but outside the window it does not
  const oldBlank = [...Array.from({ length: 39 }, () => mk("yes")), mk(null)];
  assert.equal(E.journalStats(oldBlank, 750).unreviewedLast20, 0);
  assert.equal(E.journalStats(oldBlank, 750).goLive, true);
});

test("tradeR", () => {
  assert.equal(E.tradeR(10, 9.5, 10.75), 1.5);
  assert.equal(E.tradeR(10, 10.5, 11), null); // inverted stop → invalid
});

/* ---- ranking: real setups must reach the top ---- */
function row(o) {
  return Object.assign({
    symbol: "X", price: 20, gap: 1, rvol: 1, orh: 20.2, orl: 20.0,
    orReady: true, bid: 19.99, ask: 20.01, vwap: 20, lastClose5m: 20.3
  }, o);
}

test("a clean tradeable setup outranks a huge-score untradeable one", () => {
  // QNRX-style: score 1077 but 27.9% spread and 14.6% OR width — untradeable
  const junk = row({ symbol: "QNRX", price: 7.66, gap: 1070, rvol: 7,
    orh: 8.19, orl: 7.07, bid: 6.7, ask: 8.85 });
  // a real ORB candidate: score 3.0, tight spread, tight range
  const good = row({ symbol: "SOFI", price: 19, gap: 1.5, rvol: 1.5,
    orh: 19.2, orl: 18.9, bid: 18.99, ask: 19.0 });
  const r = E.rank([junk, good]);
  assert.equal(r[0].symbol, "SOFI", "tradeable setup must rank first");
  assert.equal(r[0].tier, 0);
  assert.equal(r[1].symbol, "QNRX");
  assert.equal(r[1].tier, 2, "blown spread and width = disqualified");
  // and the verdict follows the ranking
  const v = E.computeVerdict([junk, good], goodCtx({ topSymbol: null, equity: 750 }));
  assert.equal(v.top, "SOFI");
  assert.equal(v.eligibleCount, 1);
});

test("rank score caps each term; doctrine score is untouched", () => {
  const monster = row({ gap: 1070, rvol: 40 });
  assert.equal(E.score(monster), 1110, "displayed score stays the doctrine's");
  assert.equal(E.rankScore(monster), 20, "ranking caps both terms at 10");
  // two monsters still order by their real, uncapped tiebreak
  const a = E.rank([row({ symbol: "A", gap: 1070, rvol: 40 }), row({ symbol: "B", gap: 2000, rvol: 40 })]);
  assert.equal(a[0].symbol, "B");
  // a capped monster cannot beat a clean setup that scores far lower
  const mixed = E.rank([
    row({ symbol: "JUNK", price: 5, gap: 900, rvol: 9, orh: 6, orl: 5.2, bid: 4.9, ask: 5.1 }),
    row({ symbol: "CLEAN", price: 19, gap: 1.2, rvol: 1.0, orh: 19.2, orl: 18.95, bid: 18.99, ask: 19.0 })
  ]);
  assert.equal(mixed[0].symbol, "CLEAN");
});

test("tier 1 keeps the pre-market sweep useful", () => {
  // pre-market: no OR yet, no NBBO — in-band with a real score is 'pending'
  const pre = row({ symbol: "PLTR", price: 50, gap: 3, rvol: 2,
    orh: null, orl: null, orReady: false, bid: null, ask: null });
  assert.equal(E.rankTier(pre), 1);
  // out-of-band junk stays disqualified even pre-market
  const junkPre = row({ symbol: "WHLR", price: 0.4, gap: 240, rvol: 3,
    orh: null, orl: null, orReady: false, bid: null, ask: null });
  assert.equal(E.rankTier(junkPre), 2);
  assert.equal(E.rank([junkPre, pre])[0].symbol, "PLTR");
});

test("regression: this morning's live top-5 no longer crowd out a real setup", () => {
  // verbatim shape of the 2026-08-28 09:48 ET production scan
  const live = [
    row({ symbol: "QNRX", price: 7.66, gap: 1070, rvol: 7.13, orh: 8.19, orl: 7.07, bid: 6.7, ask: 8.85 }),
    row({ symbol: "AEMD", price: 3.5, gap: 268, rvol: 4, orh: 3.7, orl: 3.39, bid: 3.26, ask: 3.75 }),
    row({ symbol: "WHLR", price: 0.42, gap: 238, rvol: 2.6, orh: 0.47, orl: 0.42, bid: 0.417, ask: 0.423 }),
    row({ symbol: "FNGR", price: 1.1, gap: 180, rvol: 3, orh: 1.4, orl: 1.09, bid: 1.07, ask: 1.14 }),
    row({ symbol: "SOFI", price: 19.08, gap: 1.2, rvol: 1.1, orh: 19.2, orl: 19.05, bid: 19.07, ask: 19.09 })
  ];
  const r = E.rank(live);
  assert.equal(r[0].symbol, "SOFI", "the only tradeable name must be top-1");
  assert.ok(r.slice(1).every(x => x.tier === 2), "all four microcaps disqualified");
});

/* ---- journal: round trips reconstructed from real broker fills ----
   Shapes mirror what /v2/orders?status=closed&nested=true actually returns.
   The bug these guard: sells were only matched to buys on the SAME ET date,
   so anything held overnight stayed "open" with r=null forever and never
   counted toward n=40. */
function buy(o) {
  return Object.assign({
    id: "b1", side: "buy", symbol: "CMG", status: "filled",
    filled_at: "2026-08-27T13:45:00Z", filled_qty: "10", filled_avg_price: "52.00", legs: []
  }, o);
}
function sell(o) {
  return Object.assign({
    id: "s1", side: "sell", symbol: "CMG", status: "filled",
    filled_at: "2026-08-27T19:55:00Z", filled_qty: "10", filled_avg_price: "52.50", legs: []
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
const one = (j, sym) => j.find(x => x.symbol === sym);

test("bracket stop-out reproduces the real CMG round trip at -1.09R", () => {
  const j = E.buildRoundTrips([buy({
    legs: [tpLeg(), stopLeg({ filled_at: "2026-08-27T17:02:00Z", filled_qty: "10", filled_avg_price: "50.91" })]
  })]);
  assert.equal(j.length, 1);
  assert.equal(j[0].reason, "stop");
  assert.equal(j[0].entry, 52);
  assert.equal(j[0].stop, 51);
  assert.equal(j[0].target, 53.5);
  assert.equal(j[0].exit, 50.91);
  assert.equal(j[0].r, -1.09);
  assert.equal(j[0].pnl, -10.9);
  assert.equal(E.isTrade(j[0]), true);
});

test("a position held overnight closes and counts — the multi-day matching bug", () => {
  // buy Tue, sell Thu: the old same-date matcher left this "open" with r=null
  const j = E.buildRoundTrips([
    buy({ id: "b-cde", symbol: "CDE", filled_at: "2026-08-25T14:00:00Z",
      filled_qty: "40", filled_avg_price: "10.00",
      legs: [stopLeg({ id: "L", stop_price: "9.50" })] }),
    sell({ id: "s-cde", symbol: "CDE", filled_at: "2026-08-27T18:00:00Z",
      filled_qty: "40", filled_avg_price: "10.75" })
  ]);
  const t = one(j, "CDE");
  assert.equal(t.reason, "close", "cross-date exit is a closed trade, not 'open'");
  assert.equal(t.date, "2026-08-25");
  assert.equal(t.exitDate, "2026-08-27");
  assert.equal(t.exit, 10.75);
  assert.equal(t.r, 1.5);
  assert.equal(E.isTrade(t), true, "it must count toward n");
  assert.equal(E.journalStats(j, 750).n, 1);
});

test("same-day discretionary exit still reads as eod", () => {
  const j = E.buildRoundTrips([
    buy({ id: "b-spy", symbol: "SPY", filled_at: "2026-08-27T14:00:00Z",
      filled_avg_price: "600.00", legs: [stopLeg({ id: "L", stop_price: "597.00" })] }),
    sell({ id: "s-spy", symbol: "SPY", filled_at: "2026-08-27T19:50:00Z", filled_avg_price: "604.50" })
  ]);
  assert.equal(one(j, "SPY").reason, "eod");
  assert.equal(one(j, "SPY").r, 1.5);
});

test("FIFO: one sell closes the oldest lot only, and is never counted twice", () => {
  const j = E.buildRoundTrips([
    buy({ id: "b-ko-1", symbol: "KO", filled_at: "2026-08-25T14:00:00Z",
      filled_qty: "10", filled_avg_price: "60.00", legs: [stopLeg({ id: "L1", stop_price: "59.00" })] }),
    buy({ id: "b-ko-2", symbol: "KO", filled_at: "2026-08-26T14:00:00Z",
      filled_qty: "10", filled_avg_price: "62.00", legs: [stopLeg({ id: "L2", stop_price: "61.00" })] }),
    sell({ id: "s-ko", symbol: "KO", filled_at: "2026-08-27T18:00:00Z",
      filled_qty: "10", filled_avg_price: "63.00" })
  ]);
  const first = j.find(x => x.id === "b-ko-1");
  const second = j.find(x => x.id === "b-ko-2");
  assert.equal(first.reason, "close");
  assert.equal(first.r, 3);                       // (63-60)/1
  assert.equal(second.reason, "open", "the newer lot is still held");
  assert.equal(second.r, null);
  assert.equal(E.journalStats(j, 750).n, 1, "one sell cannot close two buys");
});

test("a partly closed lot reports no R until it is flat", () => {
  const j = E.buildRoundTrips([
    buy({ id: "b-p", symbol: "MARA", filled_qty: "48", filled_avg_price: "11.61",
      legs: [stopLeg({ id: "L", stop_price: "11.30" })] }),
    sell({ id: "s-p", symbol: "MARA", filled_qty: "20", filled_avg_price: "12.08" })
  ]);
  assert.equal(j[0].reason, "partial");
  assert.equal(j[0].matchedQty, 20);
  assert.equal(j[0].r, null);
  assert.equal(E.isTrade(j[0]), false);
  assert.equal(E.journalStats(j, 750).n, 0);
});

test("a bracket leg closes its own parent, not whichever lot is oldest", () => {
  const j = E.buildRoundTrips([
    buy({ id: "b-old", symbol: "AMD", filled_at: "2026-08-25T14:00:00Z",
      filled_qty: "5", filled_avg_price: "100.00", legs: [] }),
    buy({ id: "b-brk", symbol: "AMD", filled_at: "2026-08-26T14:00:00Z",
      filled_qty: "5", filled_avg_price: "110.00",
      legs: [stopLeg({ id: "L-b", stop_price: "108.00",
        filled_at: "2026-08-26T17:00:00Z", filled_qty: "5", filled_avg_price: "107.90" })] })
  ]);
  assert.equal(j.find(x => x.id === "b-brk").reason, "stop");
  assert.equal(j.find(x => x.id === "b-old").reason, "open", "the untouched lot stays open");
});

test("an unsold position stays open and never fakes an R", () => {
  const j = E.buildRoundTrips([buy({ id: "b-open", legs: [stopLeg()] })]);
  assert.equal(j[0].reason, "open");
  assert.equal(j[0].exit, null);
  assert.equal(j[0].r, null);
  assert.equal(E.journalStats(j, 750).n, 0);
});

test("journal comes back newest first and ignores unfilled orders", () => {
  const j = E.buildRoundTrips([
    buy({ id: "b-a", symbol: "AAL", filled_at: "2026-08-25T14:00:00Z" }),
    buy({ id: "b-b", symbol: "NIO", filled_at: "2026-08-27T14:00:00Z" }),
    buy({ id: "b-dead", symbol: "F", status: "canceled", filled_at: null, filled_qty: "0" })
  ]);
  assert.deepEqual(j.map(x => x.id), ["b-b", "b-a"]);
});

/* ---- pre-market gap reference ----
   Alpaca's snapshot: dailyBar = latest session, prevDailyBar = the one before.
   Intraday dailyBar is today, so prevDailyBar is the previous close. But
   pre-market today's bar does not exist yet, so dailyBar IS the previous
   close — reading prevDailyBar then measures the gap from two sessions ago.
   Live on 2026-08-31 09:15 ET this reported MARA at -9.27% when it was
   +0.94%, and SOXL at -9.91% when it was -0.19%. */
test("prevSessionClose uses the last completed session, pre-market included", () => {
  const mondayET = "2026-08-31";
  // pre-market Monday: dailyBar is Friday, prevDailyBar is Thursday
  const pre = {
    dailyBar: { c: 10.66, t: "2026-08-28T04:00:00Z" },
    prevDailyBar: { c: 11.86, t: "2026-08-27T04:00:00Z" }
  };
  assert.equal(E.prevSessionClose(pre, mondayET), 10.66, "Friday's close, not Thursday's");

  // intraday Monday: dailyBar is today, so the previous close is prevDailyBar
  const intra = {
    dailyBar: { c: 10.80, t: "2026-08-31T04:00:00Z" },
    prevDailyBar: { c: 10.66, t: "2026-08-28T04:00:00Z" }
  };
  assert.equal(E.prevSessionClose(intra, mondayET), 10.66, "Friday's close intraday too");

  // the gap it produces is the real one
  const last = 10.76;
  const gapPre = E.r2((last - E.prevSessionClose(pre, mondayET)) / E.prevSessionClose(pre, mondayET) * 100);
  assert.equal(gapPre, 0.94, "MARA was flat, not down 9%");

  // degenerate shapes must not throw
  assert.equal(E.prevSessionClose({ prevDailyBar: { c: 5, t: "2026-08-27T04:00:00Z" } }, mondayET), 5);
  assert.equal(E.prevSessionClose({}, mondayET), null);
  assert.equal(E.prevSessionClose(null, mondayET), null);
});

test("isSessionDate is the one answer to which session a bar belongs to", () => {
  const todayET = "2026-08-31";
  assert.equal(E.isSessionDate({ c: 10.8, t: "2026-08-31T04:00:00Z" }, todayET), true);
  assert.equal(E.isSessionDate({ c: 10.8, t: "2026-08-28T04:00:00Z" }, todayET), false);
  // a bar with no timestamp must not be promoted to today: etDateStr(undefined)
  // falls back to the current date, which would have said "yes"
  assert.equal(E.isSessionDate({ c: 10.8 }, todayET), false, "no timestamp is not today");
  assert.equal(E.isSessionDate(null, todayET), false);
  assert.equal(E.isSessionDate(undefined, todayET), false);
});

test("prevSessionClose has no reference when nothing precedes today", () => {
  const todayET = "2026-08-31";
  // today's bar exists but there is no session before it in the snapshot
  assert.equal(E.prevSessionClose({ dailyBar: { c: 10.80, t: "2026-08-31T04:00:00Z" } }, todayET), null);
  // the row is NOT dropped for that — price still resolves from the day bar —
  // so it goes on scoring, on RVOL alone, with no gap term
  assert.equal(E.score({ gap: null, rvol: 1.1 }), 1.1, "no gap reference means RVOL carries the score");
  assert.equal(E.score({ gap: null, rvol: null }), 0);
});

test("a flat pre-market name does not fake its way into the sweep", () => {
  // MARA at Monday 09:15: unchanged from Friday, no OR yet, no real gap
  const maraPre = { symbol: "MARA", price: 10.76, gap: 0.94, rvol: null,
    orh: null, orl: null, orReady: false, bid: 10.76, ask: 10.77 };
  assert.ok(E.score(maraPre) < E.RULES.minScore, "score 0.94 is below the 2.0 floor");
  assert.equal(E.rankTier(maraPre), 2, "below the score floor = disqualified, not surfaced");
  // and with the old phantom gap it would have looked like a live candidate
  const phantom = Object.assign({}, maraPre, { gap: -9.27 });
  assert.ok(E.score(phantom) > E.RULES.minScore, "the bug made a flat name score 9.27");
});
