/* Phase 1 of the TradeCenter Supabase Plan: mirror what the journal sync
   already reconstructs into `orders`, `fills` and `round_trips`. The FIFO
   pairing is lib/engine.js buildRoundTrips and is NOT repeated here — this
   file only translates the engine's records into rows. Flat trades only:
   an open or partial position has no exit fill and no R yet. Nothing here
   talks to Alpaca; it receives the orders the sync already fetched. */
"use strict";
const engine = require("./engine.js");
const sb = require("./supabase.js");

const num = (x) => engine.num(x);
/* quantities stay exact: the paper account has traded fractional shares,
   and rounding them would make the mirror disagree with the engine */
const qty = (x) => { const n = num(x); return n == null ? 0 : n; };

function walk(orders, fn) {
  const seen = {};
  for (const o of orders || []) {
    if (!o || !o.id || seen[o.id]) continue;
    seen[o.id] = true;
    fn(o, null);
    for (const l of o.legs || []) {
      if (!l || !l.id || seen[l.id]) continue;
      seen[l.id] = true;
      fn(l, o);
    }
  }
}

/* one row per Alpaca order; bracket legs are orders too and get their own row */
function orderRows(orders, now) {
  const at = now || new Date().toISOString();
  const out = [];
  walk(orders, (o, parent) => {
    out.push({
      alpaca_order_id: o.id,
      client_order_id: o.client_order_id || null,
      symbol: o.symbol || (parent && parent.symbol) || "",
      side: o.side || (parent ? "sell" : ""),
      order_class: o.order_class || (parent && parent.order_class) || null,
      submitted_at: o.submitted_at || o.created_at || (parent && (parent.submitted_at || parent.created_at)) || at,
      status: String(o.status || "unknown"),
      filled_qty: qty(o.filled_qty),
      filled_avg_price: num(o.filled_avg_price),
      legs: !parent && Array.isArray(o.legs) && o.legs.length ? o.legs : null,
      last_synced_at: at
    });
  });
  return out;
}

/* one fill per filled order — exactly the granularity the engine pairs on
   (filled_qty at filled_avg_price), so the mirror can never disagree with it */
function fillRows(orders) {
  const out = [];
  walk(orders, (o, parent) => {
    if (!o.filled_at || !(qty(o.filled_qty) > 0) || num(o.filled_avg_price) == null) return;
    out.push({
      alpaca_fill_id: o.id,
      symbol: o.symbol || (parent && parent.symbol) || "",
      side: o.side || "sell",
      qty: qty(o.filled_qty),
      price: num(o.filled_avg_price),
      filled_at: o.filled_at
    });
  });
  return out;
}

/* one row per flat engine record: entry fill → last exit fill, qty matched,
   exit at the engine's average exit price, R and P&L as the engine scored
   them. risk_dollars comes from the bracket stop until tickets exist
   (phase 3); a null R means the engine could not score the trade either. */
function roundTripRows(trips) {
  const out = [];
  for (const rec of trips || []) {
    if (!rec || rec.src !== "alpaca" || !engine.isFlat(rec) || !(rec.matchedQty > 0)) continue;
    if (rec.entry == null || rec.exit == null || !rec.entryAt || !rec.exitAt) continue;
    const exits = (rec.fills || []).filter(f => f.side === "sell");
    if (!exits.length) continue;
    const last = exits[exits.length - 1];
    const risk = rec.stop != null && rec.entry > rec.stop ? engine.r2((rec.entry - rec.stop) * rec.matchedQty) : null;
    out.push({
      symbol: rec.symbol,
      entry_fill: rec.id,
      exit_fill: last.id,
      qty: rec.matchedQty,
      entry_price: rec.entry,
      exit_price: rec.exit,
      pnl_dollars: rec.pnl != null ? rec.pnl : engine.r2((rec.exit - rec.entry) * rec.matchedQty),
      risk_dollars: risk,
      r_multiple: num(rec.r),
      opened_at: rec.entryAt,
      closed_at: rec.exitAt
    });
  }
  return out;
}

/* write the three tables; returns counts. Upserts, so re-running a sync is
   idempotent and a status change on Alpaca updates the mirrored row. */
async function syncJournalMirror(orders, trips) {
  const o = orderRows(orders), f = fillRows(orders), t = roundTripRows(trips);
  const savedOrders = await sb.upsert("orders", o, "alpaca_order_id", { returning: true });
  const orderId = {};
  for (const r of savedOrders) orderId[r.alpaca_order_id] = r.id;
  const savedFills = await sb.upsert("fills", f.map(x => ({ ...x, order_id: orderId[x.alpaca_fill_id] || null })), "alpaca_fill_id", { returning: true });
  const fillId = {};
  for (const r of savedFills) fillId[r.alpaca_fill_id] = r.id;
  const rows = [];
  let skipped = 0;
  for (const r of t) {
    const e = fillId[r.entry_fill], x = fillId[r.exit_fill];
    if (!e || !x) { skipped++; continue; }
    const { entry_fill, exit_fill, ...rest } = r;
    rows.push({ ...rest, entry_fill_id: e, exit_fill_id: x });
  }
  await sb.upsert("round_trips", rows, "entry_fill_id,exit_fill_id");
  return { orders: o.length, fills: f.length, roundTrips: rows.length, skipped, syncedAt: new Date().toISOString() };
}

/* Phase 1 trust test: the table must agree with the fresh reconstruction
   over the same window. Counts only — the recompute stays authoritative
   until five sessions pass with zero mismatch. */
async function mirrorStatus(trips, days) {
  if (!sb.configured()) return { configured: false };
  const since = new Date(Date.now() - (days || 365) * 864e5).toISOString();
  const recs = (trips || []).filter(r => r && r.src === "alpaca");
  const flat = recs.filter(r => engine.isFlat(r) && r.matchedQty > 0).length;
  const scored = recs.filter(engine.isBrokerTrade).length;
  const [tableFlat, tableScored, stats] = await Promise.all([
    sb.count("round_trips", { opened_at: `gte.${since}` }),
    sb.count("round_trips", { opened_at: `gte.${since}`, r_multiple: "not.is.null" }),
    sb.select("v_journal_stats")
  ]);
  const mismatch = flat !== tableFlat || scored !== tableScored;
  if (mismatch) {
    console.warn(`[journal] mirror mismatch over ${days}d: recompute flat=${flat} scored=${scored}; table flat=${tableFlat} scored=${tableScored}`);
  }
  return {
    configured: true, days, mismatch,
    recompute: { flat, scored },
    table: { flat: tableFlat, scored: tableScored },
    stats: stats && stats[0] ? stats[0] : null
  };
}

module.exports = { orderRows, fillRows, roundTripRows, syncJournalMirror, mirrorStatus };
