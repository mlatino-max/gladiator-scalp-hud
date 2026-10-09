/* GET /api/flowstate data service — the live state behind the Liquidity
   Drift panel. Server-only. Read-only: it uses the GET helpers of
   lib/alpaca.js and nothing else at the broker; there is no write path in
   this file and none may be added.

   Every number is derived from a call just made (or the 15 s cache of one).
   A source that fails or takes longer than 3 s leaves its fields null; the
   panel then keeps its seeded default for them. Nothing is synthesized.

   assemble() is pure (tests feed it fixtures); gather() does the I/O. */
"use strict";
const { engine, alp, pagedBars, fetchJournal, TRADING_BASE, DATA_BASE, FEED } = require("./alpaca.js");
const schema = require("./flowstate-schema.js");

const CACHE_MS = 15_000;
const TIMEOUT_MS = 3_000;
const JOURNAL_DAYS = 90;
const DAILY_DAYS = 320;          // ~220 sessions: enough for SMA200 + ATR14
const DEFAULT_SYMBOL = "SPY";    // the regime index the HUD already snapshots
const SESSION_OPEN = 9 * 60 + 30;
const SESSION_LEN = 390;

const num = engine.num;
function round(x, d) { const n = num(x); if (n == null) return null; const k = Math.pow(10, d); return Math.round(n * k) / k; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function finite(x) { return typeof x === "number" && isFinite(x) ? x : null; }

/* settle a source with a hard timeout; the caller sees null on failure */
function within(promise, ms) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error("timeout")), ms); });
  return Promise.race([promise, timer]).then(
    v => { clearTimeout(t); return { ok: true, value: v }; },
    e => { clearTimeout(t); return { ok: false, error: String((e && e.message) || e) }; }
  );
}

/* ---- pure helpers over market data ---- */
function atr14(daily) {
  if (!daily || daily.length < 15) return null;
  const tail = daily.slice(-15);
  let sum = 0;
  for (let i = 1; i < tail.length; i++) {
    const h = num(tail[i].h), l = num(tail[i].l), pc = num(tail[i - 1].c);
    if (h == null || l == null || pc == null) return null;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / 14;
}
function smaAt(closes, len, endExclusive) {
  if (endExclusive < len) return null;
  let s = 0;
  for (let i = endExclusive - len; i < endExclusive; i++) s += closes[i];
  return s / len;
}
/* stdev of 5-minute log returns across the session's bars (per bar, not annualized) */
function realizedVol(bars5) {
  const closes = (bars5 || []).map(b => num(b.c)).filter(c => c != null && c > 0);
  if (closes.length < 3) return null;
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  return Math.sqrt(v);
}

/* unrealized R of a broker position, using the stop of its newest open lot */
function positionR(pos, lots) {
  const sym = pos.symbol;
  const lot = lots.find(l => l.symbol === sym && num(l.stop) != null && num(l.entry) != null);
  if (!lot) return null;
  const entry = num(pos.avg_entry_price) != null ? num(pos.avg_entry_price) : num(lot.entry);
  const last = num(pos.current_price);
  const stop = num(lot.stop);
  if (entry == null || last == null || stop == null) return null;
  const short = String(pos.side || "").toLowerCase() === "short" || (num(pos.qty) || 0) < 0;
  const risk = short ? stop - entry : entry - stop;
  if (!(risk > 0)) return null;
  return (short ? entry - last : last - entry) / risk;
}

/* raw = { clock, positions, journal, snapshot, bars5, daily, symbol, now }
   — any source may be null (failed / timed out) */
function assemble(raw) {
  const out = schema.emptyPayload();
  const now = raw.now ? new Date(raw.now) : new Date();
  out.asOf = now.toISOString();
  const todayET = engine.etDateStr(now);

  /* session */
  const clock = raw.clock;
  out.session.symbol = raw.symbol || null;
  if (clock && typeof clock.is_open === "boolean") {
    out.session.state = clock.is_open ? "open" : "closed";
    if (clock.is_open) {
      out.session.minutesElapsed = clamp(engine.minutesET(clock.timestamp || now) - SESSION_OPEN, 0, SESSION_LEN);
    }
  }

  /* price: the latest session of the chosen symbol */
  const snap = raw.snapshot;
  const dayBar = snap && snap.dailyBar ? snap.dailyBar : null;
  const sessionDate = dayBar ? engine.etDateStr(dayBar.t) : null;
  const last = (snap && snap.latestTrade && num(snap.latestTrade.p)) || (dayBar && num(dayBar.c)) || null;
  out.price.last = round(last, 4);
  if (dayBar) {
    out.price.sessionHigh = round(dayBar.h, 4);
    out.price.sessionLow = round(dayBar.l, 4);
  }
  const bars5 = (raw.bars5 || []).filter(b => {
    const m = engine.minutesET(b.t);
    return (!sessionDate || engine.etDateStr(b.t) === sessionDate) && m >= SESSION_OPEN && m < SESSION_OPEN + SESSION_LEN;
  });
  if (bars5.length) {
    /* the scan's own OR function, so the band matches the OR the HUD shows */
    const nowMin = sessionDate === todayET && clock && clock.is_open ? engine.minutesET(clock.timestamp || now) : 24 * 60;
    const or = engine.openingRange(bars5, nowMin);
    if (or.ready) {
      out.price.openRangeHigh = round(or.orh, 4);
      out.price.openRangeLow = round(or.orl, 4);
    }
    out.vol.realizedVol5m = round(realizedVol(bars5), 6);
  }

  /* vol + trend from completed daily bars */
  const daily = (raw.daily || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1));
  const atr = atr14(daily);
  out.vol.atr14 = round(atr, 4);
  if (atr != null && last) out.vol.atrPctOfPrice = round(atr / last, 6);
  const closes = daily.map(b => num(b.c)).filter(c => c != null);
  const n = closes.length;
  const s20 = smaAt(closes, 20, n), s20prev = smaAt(closes, 20, n - 5);
  out.trend.sma20 = round(s20, 4);
  out.trend.sma200 = round(smaAt(closes, 200, n), 4);
  if (s20 != null && s20prev != null && atr) {
    /* five-session change of the 20-day mean, in ATRs: + = rising */
    out.trend.slopeNormalized = round(clamp((s20 - s20prev) / atr, -1, 1), 3);
  }

  /* book + agents + closes from the journal (round trips from real fills) */
  const journal = raw.journal;
  const positions = raw.positions;
  if (Array.isArray(positions)) out.book.openPositions = positions.length;
  if (Array.isArray(journal)) {
    const openLots = journal.filter(j => j.reason === "open" || j.reason === "partial");   // newest first
    if (Array.isArray(positions)) {
      const rs = positions.map(p => positionR(p, openLots)).filter(r => r != null);
      if (rs.length) {
        out.book.netExposureR = round(rs.reduce((a, b) => a + b, 0), 3);
        out.book.largestPositionR = round(rs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0), 3);
      }
    }

    const tag = j => String(j.strategy || engine.RULES.unattributed).toUpperCase();
    const closed = journal.filter(j => engine.isFlat(j) && num(j.r) != null && j.src === "alpaca");

    /* performance across the whole book, with the engine's own arithmetic */
    const book = closed.map(j => Object.assign({}, j, { strategy: "book" }));
    if (book.length) {
      const st = engine.evidenceStats(book, { strategy: "book" });
      out.performance = {
        n: st.n, pf: round(finite(st.pf), 3), avgR: round(st.avgR, 3),
        maxDDPct: round(st.maxDDPct, 2), winRate: round(st.winRate, 3)
      };
    } else {
      out.performance.n = 0;
    }

    /* agents = the distinct owner tags in the journal, never a fixed list */
    const names = [...new Set(journal.filter(j => j.src === "alpaca").map(tag))].sort();
    out.agents = names.map(name => {
      const mine = journal.filter(j => tag(j) === name);
      const open = mine.filter(j => j.reason === "open" || j.reason === "partial").length;
      const today = mine.filter(j => closed.includes(j) && j.exitDate === todayET);
      return {
        name, openPositions: open,
        dayR: round(today.reduce((a, j) => a + num(j.r), 0), 3),
        state: open > 0 ? "active" : "flat"
      };
    });

    out.recentCloses = closed
      .filter(j => j.exitAt)
      .sort((a, b) => (a.exitAt < b.exitAt ? -1 : a.exitAt > b.exitAt ? 1 : 0))
      .slice(-schema.MAX_CLOSES)
      .map(j => ({ r: round(j.r, 3), agent: tag(j), at: new Date(j.exitAt).toISOString() }));
  }
  return out;
}

/* the symbol the field is drawn for: the largest open position, else SPY */
function pickSymbol(positions, wanted) {
  if (wanted && /^[A-Z.]{1,6}$/.test(wanted)) return wanted;
  const held = (positions || []).filter(p => /^[A-Z.]{1,6}$/.test(p.symbol || ""));
  if (!held.length) return DEFAULT_SYMBOL;
  held.sort((a, b) => Math.abs(num(b.market_value) || 0) - Math.abs(num(a.market_value) || 0));
  return held[0].symbol;
}

async function gather(wanted) {
  const [clockR, posR, jourR] = await Promise.all([
    within(alp(TRADING_BASE, "/v2/clock"), TIMEOUT_MS),
    within(alp(TRADING_BASE, "/v2/positions"), TIMEOUT_MS),
    within(fetchJournal(JOURNAL_DAYS), TIMEOUT_MS)
  ]);
  const positions = posR.ok && Array.isArray(posR.value) ? posR.value : null;
  const symbol = pickSymbol(positions, wanted);
  const [snapR, dailyR] = await Promise.all([
    within(alp(DATA_BASE, "/v2/stocks/snapshots", { symbols: symbol, feed: FEED }), TIMEOUT_MS),
    within(pagedBars("/v2/stocks/bars", {
      symbols: symbol, timeframe: "1Day", feed: FEED, limit: 10000,
      start: new Date(Date.now() - DAILY_DAYS * 864e5).toISOString()
    }), TIMEOUT_MS)
  ]);
  const snapshot = snapR.ok && snapR.value ? snapR.value[symbol] || null : null;
  /* 5-minute bars of the snapshot's session (today while open, else the last one) */
  let bars5 = null;
  if (snapshot && snapshot.dailyBar) {
    const day = engine.etDateStr(snapshot.dailyBar.t);
    /* a UTC window that holds 09:30-16:00 ET in both EDT and EST; assemble()
       keeps only the regular session */
    const b5 = await within(pagedBars("/v2/stocks/bars", {
      symbols: symbol, timeframe: "5Min", feed: FEED, limit: 10000,
      start: `${day}T13:00:00Z`, end: `${day}T21:30:00Z`
    }), TIMEOUT_MS);
    bars5 = b5.ok ? b5.value[symbol] || [] : null;
  }
  return {
    clock: clockR.ok ? clockR.value : null,
    positions, journal: jourR.ok ? jourR.value : null,
    snapshot, bars5, daily: dailyR.ok ? dailyR.value[symbol] || [] : null,
    symbol, now: Date.now(),
    failed: [clockR, posR, jourR, snapR, dailyR].filter(r => !r.ok).length
  };
}

/* 15-second cache, shared by concurrent callers */
const cache = new Map();   // symbol key -> { at, body, pending }
async function flowstate(wanted) {
  const key = wanted || "";
  const hit = cache.get(key) || { at: 0, body: null, pending: null };
  if (hit.body && Date.now() - hit.at < CACHE_MS) return hit.body;
  if (hit.pending) return hit.pending;
  if (cache.size > 32) cache.clear();
  const pending = gather(wanted).then(raw => {
    const body = assemble(raw);
    const v = schema.validate(body);
    if (!v.ok) {
      const err = new Error("flowstate failed its own contract: " + v.errors.slice(0, 3).join("; "));
      err.status = 500;
      throw err;
    }
    cache.set(key, { at: Date.now(), body, pending: null });
    return body;
  });
  cache.set(key, { at: hit.at, body: hit.body, pending });
  pending.catch(() => cache.set(key, { at: hit.at, body: hit.body, pending: null }));
  return pending;
}

module.exports = { flowstate, assemble, gather, pickSymbol, atr14, realizedVol, positionR, CACHE_MS, TIMEOUT_MS };
