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
  const mkT = (r, plan) => ({ date: "2026-08-01", symbol: "X", r, reason: r > 0 ? "target" : "stop", plan: plan || "yes" });
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
  assert.equal(E.journalStats([{ date: "d", reason: "no_trade", r: null }], 750).n, 0);
});

test("tradeR", () => {
  assert.equal(E.tradeR(10, 9.5, 10.75), 1.5);
  assert.equal(E.tradeR(10, 10.5, 11), null); // inverted stop → invalid
});
