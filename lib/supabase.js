/* Server-only PostgREST client for the Supabase project in the TradeCenter
   Supabase Plan. Authenticates with the service-role key from the
   environment: the hud container is the only writer, and the key never
   reaches the browser, an artifact, or another container. No SDK — a few
   fetch calls keep the image small and the surface auditable. Nothing here
   knows what an order is; every table it writes is a mirror or a log. */
"use strict";

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function base() { return String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""); }
function host() { try { return new URL(base()).host; } catch (e) { return null; } }

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

// Content-Range "0-24/1234" or "*/1234" → 1234; "0-24/*" (no count asked) → null
function countFrom(range) {
  const m = /\/(\d+)$/.exec(String(range || ""));
  return m ? parseInt(m[1], 10) : null;
}

async function rest(path, opts) {
  opts = opts || {};
  if (!configured()) {
    const e = new Error("Supabase not configured");
    e.status = 503;
    e.hint = "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env and recreate hud (docker compose up -d --force-recreate hud).";
    throw e;
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: "application/json", ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.prefer) headers.prefer = opts.prefer;
  const res = await fetch(`${base()}/rest/v1/${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store"
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const e = new Error(`Supabase ${res.status} on ${path.split("?")[0]}: ${text.slice(0, 300)}`);
    e.status = 502;
    e.upstream = res.status;
    throw e;
  }
  const count = countFrom(res.headers.get("content-range"));
  if (res.status === 204 || opts.method === "HEAD") return { rows: [], count };
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : [];
  return { rows: Array.isArray(parsed) ? parsed : [parsed], count };
}

/* rows of a table or view; params are PostgREST filters
   ({ select: "a,b", order: "x.desc", limit: 10, symbol: "eq.SPY" }) */
async function select(table, params) { return (await rest(table + qs(params))).rows; }

/* exact row count, no rows transferred */
async function count(table, params) {
  const r = await rest(table + qs({ select: "*", ...(params || {}) }), { method: "HEAD", prefer: "count=exact" });
  return r.count;
}

/* bulk insert / upsert in chunks. Every row in a request must carry the
   same keys (PostgREST rule) — callers build uniform rows. */
async function insert(table, rows, opts) {
  opts = opts || {};
  if (!rows || !rows.length) return [];
  const prefer = [opts.returning ? "return=representation" : "return=minimal"];
  if (opts.onConflict) prefer.push(opts.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates");
  const path = table + (opts.onConflict ? qs({ on_conflict: opts.onConflict }) : "");
  const size = opts.chunk || 1000;
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const r = await rest(path, { method: "POST", body: rows.slice(i, i + size), prefer: prefer.join(",") });
    out.push(...r.rows);
  }
  return out;
}
function upsert(table, rows, onConflict, opts) { return insert(table, rows, { ...(opts || {}), onConflict }); }

/* Liveness: one row per call. Never throws — a heartbeat must not take a
   scan down, and a paused free-tier project must not either. */
async function heartbeat(source) {
  if (!configured()) return { ok: false, reason: "not configured" };
  try {
    await rest("heartbeats", { method: "POST", body: [{ source: String(source) }], prefer: "return=minimal" });
    return { ok: true };
  } catch (e) {
    console.warn(`[supabase] heartbeat(${source}) failed: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}
async function ping() {
  if (!configured()) return false;
  await rest("heartbeats?select=beat_at&order=beat_at.desc&limit=1");
  return true;
}

module.exports = { configured, host, qs, countFrom, rest, select, count, insert, upsert, heartbeat, ping };
