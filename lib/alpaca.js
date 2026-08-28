/* Server-only helper for the Vercel API functions.
   Talks to Alpaca with keys from env vars — keys never reach the browser,
   and no endpoint in api/ can place, replace, or cancel an order. */
"use strict";
const engine = require("./engine.js");

const TRADING_BASE = process.env.ALPACA_TRADING_BASE || "https://paper-api.alpaca.markets";
const DATA_BASE = process.env.ALPACA_DATA_BASE || "https://data.alpaca.markets";
const FEED = process.env.ALPACA_DATA_FEED || "iex";

function creds() {
  let key = process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID;
  let secret = process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY;
  if (!key || !secret) {
    /* Self-healing: recover a pair saved in the dashboard the wrong way
       round — variable NAME = the PK… key id, VALUE = the secret. */
    for (const [k, v] of Object.entries(process.env)) {
      if (/^PK[A-Z0-9]{10,}$/.test(k) && typeof v === "string" && v.trim().length >= 30) {
        key = k;
        secret = v.trim();
        break;
      }
    }
  }
  return key && secret ? { key, secret } : null;
}

async function alp(base, path, params) {
  const c = creds();
  if (!c) {
    const err = new Error("Alpaca keys not configured");
    err.status = 503;
    err.hint = "Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (paper keys) in the deployment env.";
    throw err;
  }
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { "APCA-API-KEY-ID": c.key, "APCA-API-SECRET-KEY": c.secret, accept: "application/json" }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Alpaca ${res.status} on ${path}: ${body.slice(0, 300)}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  return res.json();
}

/* multi-symbol market-data endpoints page via next_page_token; merge per symbol */
async function pagedBars(path, params) {
  const out = {};
  let token = null;
  for (let i = 0; i < 10; i++) {
    const page = await alp(DATA_BASE, path, { ...params, page_token: token || undefined });
    const bars = page.bars || {};
    for (const [sym, arr] of Object.entries(bars)) {
      if (!out[sym]) out[sym] = [];
      out[sym].push(...(arr || []));
    }
    token = page.next_page_token;
    if (!token) break;
  }
  return out;
}

/* ---- journal reconstruction from real fills ---- */
function legType(l) { return String(l.type || l.order_type || ""); }

async function fetchJournal(days) {
  const after = new Date(Date.now() - (days || 120) * 864e5).toISOString();
  const orders = await alp(TRADING_BASE, "/v2/orders", {
    status: "closed", limit: 500, after, direction: "desc", nested: "true"
  });
  const sells = orders.filter(o => o.side === "sell" && o.filled_at && +o.filled_qty > 0);
  const entries = [];
  for (const o of orders) {
    if (o.side !== "buy" || !o.filled_at || !(+o.filled_qty > 0)) continue;
    const date = engine.etDateStr(o.filled_at);
    const legs = o.legs || [];
    const stopLeg = legs.find(l => /stop/.test(legType(l)));
    const tpLeg = legs.find(l => legType(l) === "limit");
    const entry = +o.filled_avg_price || null;
    const stop = stopLeg ? (+stopLeg.stop_price || null) : null;
    const target = tpLeg ? (+tpLeg.limit_price || null) : null;
    let exit = null, reason = null;
    if (tpLeg && +tpLeg.filled_qty > 0) { exit = +tpLeg.filled_avg_price || null; reason = "target"; }
    else if (stopLeg && +stopLeg.filled_qty > 0) { exit = +stopLeg.filled_avg_price || null; reason = "stop"; }
    else {
      const s = sells.find(x => x.symbol === o.symbol && engine.etDateStr(x.filled_at) === date);
      if (s) { exit = +s.filled_avg_price || null; reason = "eod"; }
    }
    const r = engine.tradeR(entry, stop, exit);
    entries.push({
      id: o.id, src: "alpaca", date, symbol: o.symbol,
      qty: +o.filled_qty, entry, stop, target, exit, r,
      reason: reason || (o.status === "filled" ? "open" : o.status),
      pnl: exit != null && entry != null ? Math.round((exit - entry) * (+o.filled_qty) * 100) / 100 : null
    });
  }
  return entries; // newest first (orders came back desc)
}

/* ---- request plumbing: CORS, optional token, GET-only, errors ---- */
function withGuard(fn) {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "x-hud-token, content-type");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") return res.status(405).json({ error: "GET only — this API is read-only by design" });
    const token = process.env.HUD_ACCESS_TOKEN;
    if (token) {
      const got = req.headers["x-hud-token"] || (req.query && req.query.token);
      if (got !== token) return res.status(401).json({ error: "missing or bad x-hud-token" });
    }
    try {
      await fn(req, res);
    } catch (e) {
      res.status(e.status || 500).json({ error: String(e.message || e), hint: e.hint });
    }
  };
}

/* offset like "-04:00" taken from an Alpaca RFC3339 timestamp */
function etOffsetFrom(ts) {
  const m = /([+-]\d\d:\d\d)$/.exec(String(ts || ""));
  return m ? m[1] : "-04:00";
}

module.exports = { engine, creds, alp, pagedBars, fetchJournal, withGuard, etOffsetFrom, TRADING_BASE, DATA_BASE, FEED };
