/* Server-only helper. Talks to Alpaca with keys from env vars — keys never
   reach the browser, and nothing here can place, replace, or cancel an
   order. Request plumbing for route handlers lives in lib/http.js. */
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
    headers: { "APCA-API-KEY-ID": c.key, "APCA-API-SECRET-KEY": c.secret, accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Alpaca ${res.status} on ${path}: ${body.slice(0, 300)}`);
    err.status = res.status === 429 ? 429 : res.status === 401 || res.status === 403 ? 502 : 502;
    err.upstream = res.status;
    if (res.status === 401 || res.status === 403) {
      err.hint = "Alpaca rejected the keys. If Render/Vercel were just redeployed, the live container may still hold old keys — check the Events tab.";
    }
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

/* ---- journal reconstruction from real fills ----
   Matching rules live in lib/engine.js so the browser and the server
   cannot disagree about what counts as a trade. */
async function fetchOrders(days) {
  const after = new Date(Date.now() - (days || 120) * 864e5).toISOString();
  return alp(TRADING_BASE, "/v2/orders", {
    status: "closed", limit: 500, after, direction: "desc", nested: "true"
  });
}
async function fetchJournal(days) {
  const orders = await fetchOrders(days);
  return engine.buildRoundTrips(orders); // newest first
}

/* daily bars for one symbol, ascending, enough for a 50-day SMA */
async function fetchDailyBars(symbol, calendarDays) {
  const start = new Date(Date.now() - (calendarDays || 120) * 864e5).toISOString();
  const bars = await pagedBars("/v2/stocks/bars", {
    symbols: symbol, timeframe: "1Day", start, feed: FEED, limit: 10000
  });
  return (bars[symbol] || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1));
}

/* is `dateET` (YYYY-MM-DD) a trading day per the exchange calendar? */
async function isTradingDay(dateET) {
  const cal = await alp(TRADING_BASE, "/v2/calendar", { start: dateET, end: dateET });
  return Array.isArray(cal) && cal.some(d => d.date === dateET);
}

/* offset like "-04:00" taken from an Alpaca RFC3339 timestamp */
function etOffsetFrom(ts) {
  const m = /([+-]\d\d:\d\d)$/.exec(String(ts || ""));
  return m ? m[1] : "-04:00";
}

module.exports = {
  engine, creds, alp, pagedBars, fetchOrders, fetchJournal, fetchDailyBars, isTradingDay,
  etOffsetFrom, TRADING_BASE, DATA_BASE, FEED
};
