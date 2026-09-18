/* Phase 2 of the TradeCenter Supabase Plan: the pullback screen's data path.
   `loadBars` fills `bars_daily` from Massive's grouped daily and upserts the
   `symbols` reference; `runScreen` reads `v_pullback_screen` (the six rules
   live in that view and in the Ops Manual, not here) and records the run in
   `screen_runs` / `screen_candidates`. The view is the screen; this file
   moves rows and keeps the books. Nothing here touches a broker order. */
"use strict";
const { engine, alp, TRADING_BASE } = require("./alpaca.js");
const sb = require("./supabase.js");
const massive = require("./massive.js");
const store = require("./store.js");

const SCREEN_VERSION = "pullback-2026-08-31";
const SESSIONS = Math.max(8, parseInt(process.env.SCREEN_SESSIONS || "8", 10) || 8);
const REFERENCE_DAYS = 7;
/* a grouped-daily pull that is really there has thousands of rows; fewer
   means a half-finished load worth redoing */
const LOADED_MIN_ROWS = 1000;
/* Massive's grouped daily for a session is final by the evening; before this
   minute (ET) "today" is not a loadable session yet */
const TODAY_FINAL_MIN = 17 * 60;

/* ---- pure helpers (tested) ---- */

function barRow(r, date) {
  const o = engine.num(r && r.o), h = engine.num(r && r.h), l = engine.num(r && r.l), c = engine.num(r && r.c), v = engine.num(r && r.v);
  const symbol = String((r && r.T) || "").trim();
  if (!symbol || o == null || h == null || l == null || c == null || v == null) return null;
  if (Math.max(o, h, l, c) >= 1e8) return null;      // outside numeric(12,4)
  return { symbol, session_date: date, open: o, high: h, low: l, close: c, volume: Math.round(v), source: "massive" };
}

const ETF_TYPES = new Set(["ETF", "ETN", "ETV", "ETS", "FUND", "SP"]);
const COMMON_TYPES = new Set(["CS", "ADRC"]);
const LEVERAGED = /\b(2x|3x|-1x|1\.5x|ultra|ultrashort|ultrapro|leveraged|inverse|bull|bear)\b|\bdaily\b.*\b(long|short)\b/i;
const CRYPTO_PROXY = /\b(bitcoin|ethereum|ether|crypto|blockchain|solana|xrp|digital asset)/i;

/* symbols row from a Massive reference ticker. Type decides: common stock
   screens, funds are flagged is_etf (the view excludes them), everything
   else — warrants, units, rights, preferreds — is excluded with its type as
   the reason. Crypto proxies are excluded by name (Ops Manual universe). */
function classifyTicker(t) {
  const symbol = String((t && t.ticker) || "").trim();
  if (!symbol) return null;
  const type = String((t && t.type) || "").toUpperCase();
  const name = String((t && t.name) || "");
  const row = {
    symbol, name: name || null, asset_class: "us_equity",
    is_etf: ETF_TYPES.has(type), is_leveraged: ETF_TYPES.has(type) && LEVERAGED.test(name),
    excluded: false, exclude_reason: null, updated_at: new Date().toISOString()
  };
  if (!COMMON_TYPES.has(type) && !ETF_TYPES.has(type)) { row.excluded = true; row.exclude_reason = type ? `type:${type}` : "type:unknown"; }
  else if (CRYPTO_PROXY.test(name)) { row.excluded = true; row.exclude_reason = "crypto_proxy"; }
  return row;
}

/* the last n sessions from an Alpaca calendar (ascending {date} rows):
   never a future date, and today only once its bars are final */
function sessionDatesFrom(calendar, todayET, todayFinal, n) {
  const dates = (calendar || []).map(d => d && d.date).filter(Boolean).filter(d => d < todayET || (d === todayET && todayFinal)).sort();
  return dates.slice(-(n || SESSIONS));
}

/* ---- loader ---- */

async function sessionDates(n) {
  const clock = await alp(TRADING_BASE, "/v2/clock");
  const now = new Date(clock.timestamp || Date.now());
  const todayET = engine.etDateStr(now);
  const todayFinal = !clock.is_open && engine.minutesET(now) >= TODAY_FINAL_MIN;
  const start = engine.etDateStr(new Date(now.getTime() - 45 * 864e5));
  const cal = await alp(TRADING_BASE, "/v2/calendar", { start, end: todayET });
  return { todayET, dates: sessionDatesFrom(cal, todayET, todayFinal, n) };
}

async function referenceDue() {
  const last = await store.lastCronRun("symbol-reference").catch(() => null);
  if (last && last.ok && last.finished && Date.now() - Date.parse(last.finished) < REFERENCE_DAYS * 864e5) return false;
  return true;
}

/* refresh the symbols reference from Massive. Two batches so a row Matt
   excluded by hand keeps its flag: only type-excluded rows carry the
   `excluded` columns in their payload. */
async function syncSymbolReference() {
  const run = { name: "symbol-reference", started: new Date().toISOString() };
  const tickers = await massive.referenceTickers();
  const rows = tickers.map(classifyTicker).filter(Boolean);
  const excluded = rows.filter(r => r.excluded);
  const kept = rows.filter(r => !r.excluded).map(({ excluded: _e, exclude_reason: _r, ...rest }) => rest);
  await sb.upsert("symbols", excluded, "symbol", { chunk: 2000 });
  await sb.upsert("symbols", kept, "symbol", { chunk: 2000 });
  run.tickers = tickers.length; run.excluded = excluded.length; run.kept = kept.length;
  run.ok = true; run.finished = new Date().toISOString();
  await store.recordCronRun(run.name, run);
  return run;
}

/* fill bars_daily for the last SESSIONS sessions (only the ones missing,
   unless force), upsert the symbols seen, refresh the reference weekly */
async function loadBars(opts) {
  opts = opts || {};
  const run = { name: "screen-load", started: new Date().toISOString(), sessions: [] };
  void sb.heartbeat("screen-load");
  const { todayET, dates } = await sessionDates(SESSIONS);
  run.date = todayET;
  for (const date of dates) {
    const have = await sb.count("bars_daily", { session_date: `eq.${date}` });
    if (!opts.force && have >= LOADED_MIN_ROWS) { run.sessions.push({ date, rows: have, skipped: "already loaded" }); continue; }
    const rows = (await massive.groupedDaily(date)).map(r => barRow(r, date)).filter(Boolean);
    if (!rows.length) { run.sessions.push({ date, rows: 0, note: "no bars from Massive (holiday, or not final yet)" }); continue; }
    await sb.upsert("bars_daily", rows, "symbol,session_date", { chunk: 2000 });
    await sb.upsert("symbols", rows.map(r => ({ symbol: r.symbol })), "symbol", { ignoreDuplicates: true, chunk: 2000 });
    run.sessions.push({ date, rows: rows.length });
  }
  run.loaded = run.sessions.filter(s => !s.skipped && s.rows > 0).length;
  if (opts.reference || await referenceDue()) {
    try { run.reference = await syncSymbolReference(); }
    catch (e) { run.reference = { ok: false, error: e.message }; }
  }
  run.ok = true; run.finished = new Date().toISOString();
  await store.recordCronRun(run.name, run);
  return run;
}

/* ---- the screen ---- */

async function runScreen(opts) {
  opts = opts || {};
  void sb.heartbeat("screen");
  const [survivors, latest] = await Promise.all([
    sb.select("v_pullback_screen", { limit: 500 }),
    sb.select("bars_daily", { select: "session_date", order: "session_date.desc", limit: 1 })
  ]);
  const sessionDate = latest && latest[0] ? latest[0].session_date : null;
  const universeCount = sessionDate ? await sb.count("bars_daily", { session_date: `eq.${sessionDate}` }) : 0;
  const out = {
    asOf: new Date().toISOString(), screenVersion: SCREEN_VERSION, sessionDate, sessions: SESSIONS,
    universeCount, survivorCount: survivors.length, survivors, run: null
  };
  if (opts.record && sessionDate) {
    const [saved] = await sb.insert("screen_runs", [{
      screen_version: SCREEN_VERSION, session_date: sessionDate,
      universe_count: universeCount, survivor_count: survivors.length,
      notes: opts.notes || null
    }], { returning: true });
    const candidates = survivors.map((s, i) => ({
      run_id: saved.id, symbol: s.symbol, rank: i + 1,
      last_close: s.last_close, window_high: s.window_high, window_low: s.window_low,
      pullback_pct: s.pullback_pct, stop_dist_pct: s.stop_dist_pct, reward_risk: s.reward_risk,
      rejected_reason: null
    }));
    await sb.insert("screen_candidates", candidates);
    out.run = { id: saved.id, runAt: saved.run_at, candidates: candidates.length };
    await store.recordCronRun("screen", { name: "screen", started: out.asOf, finished: new Date().toISOString(), ok: true, runId: saved.id, sessionDate, survivors: survivors.length });
  }
  return out;
}

module.exports = {
  SCREEN_VERSION, SESSIONS, barRow, classifyTicker, sessionDatesFrom,
  sessionDates, syncSymbolReference, loadBars, runScreen
};
