/* Massive (formerly Polygon) REST — end-of-day grouped bars and the ticker
   reference list for the pullback screen. Key from MASSIVE_API_KEY
   (POLYGON_API_KEY also accepted), sent as a bearer header so it never lands
   in a URL or a log line. The free tier allows 5 requests a minute, so a 429
   waits and retries instead of failing the load. Read-only market data;
   nothing here knows a broker exists. */
"use strict";

const BASE = String(process.env.MASSIVE_API_BASE || "https://api.massive.com").replace(/\/+$/, "");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function apiKey() { return process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || null; }
function configured() { return !!apiKey(); }

async function get(path, params, opts) {
  opts = opts || {};
  const key = apiKey();
  if (!key) {
    const e = new Error("Massive key not configured");
    e.status = 503;
    e.hint = "Set MASSIVE_API_KEY in .env (massive.com dashboard → API keys) and recreate hud.";
    throw e;
  }
  const url = new URL(/^https?:/.test(path) ? path : BASE + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") url.searchParams.set(k, String(v));
  const tries = opts.tries || 6;
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, cache: "no-store" });
    if (res.status === 429 && i < tries) {
      const ra = parseInt(res.headers.get("retry-after") || "", 10);
      await sleep((ra > 0 ? ra : 15) * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new Error(`Massive ${res.status} on ${url.pathname}: ${body.slice(0, 200)}`);
      e.status = 502;
      e.upstream = res.status;
      throw e;
    }
    return res.json();
  }
}

/* every US-listed stock's OHLCV for one session; [] on a holiday */
async function groupedDaily(date) {
  const j = await get(`/v2/aggs/grouped/locale/us/market/stocks/${date}`, { adjusted: "true", include_otc: "false" });
  return Array.isArray(j.results) ? j.results : [];
}

/* every active stock ticker with its type, following next_url */
async function referenceTickers(opts) {
  opts = opts || {};
  const out = [];
  let j = await get("/v3/reference/tickers", { market: "stocks", active: "true", limit: 1000, sort: "ticker", order: "asc" });
  for (let page = 0; page < (opts.maxPages || 40); page++) {
    out.push(...(j.results || []));
    if (!j.next_url) break;
    j = await get(j.next_url);
  }
  return out;
}

module.exports = { BASE, configured, get, groupedDaily, referenceTickers };
