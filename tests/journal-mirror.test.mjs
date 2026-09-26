import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../lib/engine.js");
const M = require("../lib/journal-mirror.js");

/* same shapes as tests/evidence.test.mjs: /v2/orders?status=closed&nested=true */
function buy(o) {
  return Object.assign({
    id: "b1", client_order_id: "c-b1", side: "buy", symbol: "CMG", status: "filled", order_class: "bracket",
    submitted_at: "2026-08-27T14:04:00Z", filled_at: "2026-08-27T14:05:00Z", filled_qty: "10", filled_avg_price: "52.00", legs: []
  }, o);
}
function sell(o) {
  return Object.assign({
    id: "s1", side: "sell", symbol: "CMG", status: "filled", order_class: "simple",
    submitted_at: "2026-08-27T19:51:00Z", filled_at: "2026-08-27T19:52:00Z", filled_qty: "10", filled_avg_price: "52.50", legs: []
  }, o);
}
function stopLeg(o) {
  return Object.assign({ id: "L-stop", type: "stop", side: "sell", symbol: "CMG", status: "held", stop_price: "51.00",
    submitted_at: "2026-08-27T14:04:00Z", filled_at: null, filled_qty: "0", filled_avg_price: null }, o);
}
function tpLeg(o) {
  return Object.assign({ id: "L-tp", type: "limit", side: "sell", symbol: "CMG", status: "held", limit_price: "53.50",
    submitted_at: "2026-08-27T14:04:00Z", filled_at: null, filled_qty: "0", filled_avg_price: null }, o);
}
const stoppedOut = () => [buy({ legs: [tpLeg({ status: "canceled" }), stopLeg({ status: "filled", filled_at: "2026-08-27T17:02:00Z", filled_qty: "10", filled_avg_price: "50.91" })] })];

test("orders: one row per order, legs included, parent legs kept as jsonb", () => {
  const rows = M.orderRows(stoppedOut(), "2026-09-08T00:00:00Z");
  assert.deepEqual(rows.map(r => r.alpaca_order_id), ["b1", "L-tp", "L-stop"]);
  const parent = rows[0], leg = rows[2];
  assert.equal(parent.legs.length, 2);
  assert.equal(parent.status, "filled");
  assert.equal(parent.filled_qty, 10);
  assert.equal(parent.filled_avg_price, 52);
  assert.equal(parent.client_order_id, "c-b1");
  assert.equal(leg.legs, null);
  assert.equal(leg.order_class, "bracket", "a leg inherits the class of its parent");
  assert.equal(leg.side, "sell");
  assert.equal(leg.last_synced_at, "2026-09-08T00:00:00Z");
  assert.deepEqual(Object.keys(parent), Object.keys(leg), "uniform keys — PostgREST bulk rule");
});

test("fills: exactly the fills the engine pairs on — filled orders, one aggregate fill each", () => {
  const rows = M.fillRows(stoppedOut());
  assert.deepEqual(rows.map(r => [r.alpaca_fill_id, r.side, r.qty, r.price]), [["b1", "buy", 10, 52], ["L-stop", "sell", 10, 50.91]]);
  assert.equal(rows[1].filled_at, "2026-08-27T17:02:00Z");
  assert.equal(M.fillRows([buy({ filled_at: null, filled_qty: "0" })]).length, 0, "an unfilled order is not a fill");
  assert.equal(M.fillRows([sell({ filled_avg_price: null })]).length, 0, "no price, no fill (the engine skips it too)");
});

test("round trips: flat records only, scored exactly as the engine scored them", () => {
  const orders = stoppedOut();
  const trips = E.buildRoundTrips(orders);
  const rows = M.roundTripRows(trips);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.entry_fill, "b1");
  assert.equal(r.exit_fill, "L-stop");
  assert.equal(r.qty, 10);
  assert.equal(r.entry_price, 52);
  assert.equal(r.exit_price, 50.91);
  assert.equal(r.pnl_dollars, trips[0].pnl);
  assert.equal(r.r_multiple, trips[0].r);
  assert.equal(r.r_multiple, E.tradeR(52, 51, 50.91));
  assert.equal(r.risk_dollars, 10, "(entry − stop) × qty until tickets exist");
  assert.equal(r.opened_at, "2026-08-27T14:05:00Z");
  assert.equal(r.closed_at, "2026-08-27T17:02:00Z");

  const open = M.roundTripRows(E.buildRoundTrips([buy({ legs: [stopLeg(), tpLeg()] })]));
  assert.equal(open.length, 0, "an open position has no exit fill");
  const partial = M.roundTripRows(E.buildRoundTrips([buy({ legs: [stopLeg()] }), sell({ filled_qty: "4" })]));
  assert.equal(partial.length, 0, "a partial has no R yet");
  const noStop = M.roundTripRows(E.buildRoundTrips([buy({ legs: [] }), sell()]));
  assert.equal(noStop.length, 1);
  assert.equal(noStop[0].r_multiple, null, "no stop → the engine cannot score it, and neither can the table");
  assert.equal(noStop[0].risk_dollars, null);
  assert.equal(noStop[0].pnl_dollars, 5);
  assert.equal(M.roundTripRows([{ ...trips[0], src: "manual" }]).length, 0, "typed rows never reach the mirror");
});

test("fractional shares survive the mirror exactly (the paper account has traded them)", () => {
  const orders = [buy({ filled_qty: "0.664601045", legs: [stopLeg({ status: "filled", filled_at: "2026-08-27T17:02:00Z", filled_qty: "0.664601045", filled_avg_price: "50.91" })] })];
  assert.equal(M.orderRows(orders)[0].filled_qty, 0.664601045);
  assert.equal(M.fillRows(orders)[0].qty, 0.664601045);
  const trips = E.buildRoundTrips(orders);
  const [r] = M.roundTripRows(trips);
  assert.equal(r.qty, 0.664601045);
  assert.equal(r.pnl_dollars, trips[0].pnl);
  assert.equal(r.risk_dollars, E.r2((52 - 51) * 0.664601045));
});

function mockSupabase(respond) {
  const saved = { ...process.env };
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, prefer: init.headers.prefer };
    calls.push(call);
    const r = respond(call) || {};
    return { ok: true, status: 200, headers: { get: (k) => (r.headers || {})[k] || null }, text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)) };
  };
  return { calls, restore() { globalThis.fetch = realFetch; for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); } };
}

test("syncJournalMirror wires fills to orders and round trips to fills by the ids Postgres returns", async () => {
  let seq = 100;
  const env = mockSupabase((c) => {
    if (/\/orders\?/.test(c.url)) return { body: c.body.map(r => ({ id: seq++, alpaca_order_id: r.alpaca_order_id })) };
    if (/\/fills\?/.test(c.url)) return { body: c.body.map(r => ({ id: seq++, alpaca_fill_id: r.alpaca_fill_id })) };
    return {};
  });
  try {
    const orders = stoppedOut();
    const out = await M.syncJournalMirror(orders, E.buildRoundTrips(orders));
    assert.deepEqual({ orders: out.orders, fills: out.fills, roundTrips: out.roundTrips, skipped: out.skipped }, { orders: 3, fills: 2, roundTrips: 1, skipped: 0 });
    const [o, f, t] = env.calls;
    assert.match(o.url, /orders\?on_conflict=alpaca_order_id$/);
    assert.match(f.url, /fills\?on_conflict=alpaca_fill_id$/);
    assert.equal(f.body[0].order_id, 100, "buy fill → its order row");
    assert.equal(f.body[1].order_id, 102, "stop-leg fill → the leg's own order row");
    assert.match(t.url, /round_trips\?on_conflict=entry_fill_id%2Cexit_fill_id$/);
    assert.equal(t.body[0].entry_fill_id, 103);
    assert.equal(t.body[0].exit_fill_id, 104);
    assert.equal("entry_fill" in t.body[0], false);
    assert.equal(t.prefer, "return=minimal,resolution=merge-duplicates");
  } finally { env.restore(); }
});

test("mirrorStatus compares the same window and flags a count mismatch", async () => {
  const env = mockSupabase((c) => {
    if (c.method === "HEAD") return { headers: { "content-range": /r_multiple=not\.is\.null/.test(c.url) ? "*/1" : "*/2" } };
    if (/v_journal_stats/.test(c.url)) return { body: [{ trades: 1, win_rate_pct: 0 }] };
    return {};
  });
  try {
    const trips = E.buildRoundTrips(stoppedOut());
    const agree = await M.mirrorStatus(trips, 30);
    assert.equal(agree.mismatch, true, "table says 2 flat, recompute has 1");
    assert.deepEqual(agree.recompute, { flat: 1, scored: 1 });
    assert.deepEqual(agree.table, { flat: 2, scored: 1 });
    assert.equal(agree.stats.trades, 1);
    assert.match(env.calls[0].url, /opened_at=gte\./, "window applied to the table too");
  } finally { env.restore(); }
});
