/* Composed data services used by the route handlers, the server components
   and the two cron jobs. Every number comes from a call just made; the only
   persisted things are regime/verdict snapshots and the journal cache. */
"use strict";
const { engine, alp, pagedBars, fetchJournal, fetchDailyBars, isTradingDay, etOffsetFrom, TRADING_BASE, DATA_BASE, FEED } = require("./alpaca.js");
const store = require("./store.js");
const alerts = require("./alerts.js");

const STRATEGY = engine.RULES.strategy;
const CORE = ["SOXL", "TQQQ", "INTC", "SOFI", "NIO", "RIVN", "LCID", "AAL", "MARA", "F", "PLTR", "AMD", "MU", "AAPL", "TSLA"];
const INDEXES = ["SPY", "QQQ"];

function equityCap() { return engine.num(process.env.GLADIATOR_EQUITY_CAP) || engine.RULES.equityCap; }

/* ---- /api/scan ---- */
async function scan(extraSymbols) {
  const extra = (extraSymbols || []).map(s => String(s).trim().toUpperCase()).filter(s => /^[A-Z.]{1,6}$/.test(s));
  const clock = await alp(TRADING_BASE, "/v2/clock");
  const off = etOffsetFrom(clock.timestamp);
  const now = new Date(clock.timestamp || Date.now());
  const etNowMin = engine.minutesET(now);
  const todayET = engine.etDateStr(now);

  let dyn = [];
  try {
    const [act, mov] = await Promise.all([
      alp(DATA_BASE, "/v1beta1/screener/stocks/most-actives", { by: "trades", top: 10 }),
      alp(DATA_BASE, "/v1beta1/screener/stocks/movers", { top: 10 })
    ]);
    dyn = [
      ...((act && act.most_actives) || []).map(x => x.symbol),
      ...((mov && mov.gainers) || []).map(x => x.symbol)
    ].filter(s => /^[A-Z.]{1,6}$/.test(s));
  } catch (e) { /* screener unavailable — core universe still works */ }

  const symbols = [...new Set([...CORE, ...extra, ...dyn])].slice(0, 40);
  const all = [...new Set([...symbols, ...INDEXES])];
  const dailyStart = new Date(Date.now() - 45 * 864e5).toISOString();
  const sessionStarted = etNowMin >= engine.RULES.orWindow.start;

  const [snaps, intraday, daily] = await Promise.all([
    alp(DATA_BASE, "/v2/stocks/snapshots", { symbols: all.join(","), feed: FEED }),
    sessionStarted
      ? pagedBars("/v2/stocks/bars", {
          symbols: symbols.join(","), timeframe: "5Min",
          start: `${todayET}T09:30:00${off}`, feed: FEED, limit: 10000
        }).catch(() => ({}))
      : Promise.resolve({}),
    pagedBars("/v2/stocks/bars", {
      symbols: all.join(","), timeframe: "1Day", start: dailyStart, feed: FEED, limit: 10000
    })
  ]);

  function buildRow(sym) {
    const snap = snaps[sym] || {};
    const dayBar = engine.isSessionDate(snap.dailyBar, todayET) ? snap.dailyBar : null;
    const prevClose = engine.prevSessionClose(snap, todayET);
    const last = (snap.latestTrade && engine.num(snap.latestTrade.p)) || (dayBar && engine.num(dayBar.c)) || prevClose;
    const bid = snap.latestQuote ? engine.num(snap.latestQuote.bp) : null;
    const ask = snap.latestQuote ? engine.num(snap.latestQuote.ap) : null;
    const open = dayBar ? engine.num(dayBar.o) : null;
    const gap = prevClose && prevClose > 0
      ? engine.r2(((open != null ? open : last) - prevClose) / prevClose * 100)
      : null;
    const bars5 = intraday[sym] || [];
    const or = engine.openingRange(bars5, etNowMin);
    const dailyBars = (daily[sym] || []).filter(b => engine.etDateStr(b.t) !== todayET);
    const avgVol = dailyBars.length
      ? dailyBars.slice(-20).reduce((a, b) => a + (engine.num(b.v) || 0), 0) / Math.min(20, dailyBars.length)
      : null;
    return {
      symbol: sym, price: last, prevClose, gap,
      rvol: clock.is_open && dayBar ? engine.rvolEstimate(dayBar.v, avgVol, etNowMin) : engine.rvolEstimate(dayBar && dayBar.v, avgVol, null),
      orh: or.orh, orl: or.orl, orReady: or.ready,
      vwap: engine.sessionVWAP(bars5),
      lastClose5m: engine.lastCompletedClose(bars5, etNowMin),
      bid, ask,
      spreadPct: engine.spreadPct({ bid, ask }),
      volume: dayBar ? engine.num(dayBar.v) : null,
      core: CORE.includes(sym), dyn: dyn.includes(sym)
    };
  }

  const rows = symbols.map(buildRow).filter(r => r.price != null);
  const index = {};
  for (const sym of INDEXES) { const r = buildRow(sym); index[sym] = { price: r.price, gap: r.gap }; }

  return {
    asOf: new Date().toISOString(), etDate: todayET, etNowMin, sessionStarted,
    clock: { is_open: clock.is_open, next_open: clock.next_open, next_close: clock.next_close, timestamp: clock.timestamp },
    feed: FEED, rows, index
  };
}

/* ---- /api/account ---- */
async function account() {
  const clock = await alp(TRADING_BASE, "/v2/clock");
  const off = etOffsetFrom(clock.timestamp);
  const todayET = engine.etDateStr(clock.timestamp || Date.now());

  const [acct, hist, todayOrders, journal] = await Promise.all([
    alp(TRADING_BASE, "/v2/account"),
    alp(TRADING_BASE, "/v2/account/portfolio/history", { period: "1M", timeframe: "1D" }),
    alp(TRADING_BASE, "/v2/orders", { status: "all", after: `${todayET}T00:00:00${off}`, limit: 100, direction: "desc" }),
    fetchJournal(30)
  ]);

  const CAP = equityCap();
  const realEquity = engine.num(acct.equity) || 0;
  const equity = Math.min(realEquity, CAP);

  const times = hist.timestamp || [], eqs = hist.equity || [];
  const nowD = new Date(clock.timestamp || Date.now());
  const dow = (nowD.getUTCDay() + 6) % 7;
  const monday = new Date(nowD.getTime() - dow * 864e5);
  const mondayStr = engine.etDateStr(monday);
  let peak = realEquity;
  for (let i = 0; i < times.length; i++) {
    const d = engine.etDateStr(times[i] * 1000);
    const v = engine.num(eqs[i]);
    if (d >= mondayStr && v != null && v > 0 && v > peak) peak = v;
  }
  const ddDollars = Math.max(0, peak - realEquity);
  const ddBase = Math.min(peak, CAP);
  const weeklyDDPct = ddBase > 0 ? Math.max(0, engine.r2(ddDollars / ddBase * 100)) : 0;

  let prevTradingDay = null;
  for (let i = times.length - 1; i >= 0; i--) {
    const d = engine.etDateStr(times[i] * 1000);
    if (d < todayET) { prevTradingDay = d; break; }
  }
  const prevDayTrades = journal.filter(j => j.date === prevTradingDay && engine.num(j.r) != null);
  const prevDayR = prevDayTrades.reduce((a, j) => a + j.r, 0);
  const coolingOff = prevDayTrades.length > 0 && prevDayR < 0;

  const WORKING = new Set(["new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled", "held"]);
  const tradedToday = todayOrders.filter(o => o.side === "buy" && (+o.filled_qty > 0 || WORKING.has(o.status))).length;

  return {
    asOf: new Date().toISOString(), etDate: todayET,
    paper: TRADING_BASE.includes("paper"),
    account_number: acct.account_number, status: acct.status, currency: acct.currency,
    equity, real_equity: engine.r2(realEquity), equity_cap: CAP,
    cash: engine.num(acct.cash), buying_power: engine.num(acct.buying_power),
    weeklyDDPct, weeklyDDDollars: engine.r2(ddDollars), weekPeakEquity: engine.r2(peak),
    prevTradingDay, prevDayR: prevDayTrades.length ? engine.r2(prevDayR) : null,
    coolingOff,
    coolingDetail: coolingOff
      ? `net ${prevDayR.toFixed(2)}R on ${prevTradingDay} — observation only today`
      : (prevDayTrades.length ? `last session ${prevDayR >= 0 ? "+" : ""}${prevDayR.toFixed(2)}R — clear` : "no trades last session — clear"),
    tradedToday,
    clock: { is_open: clock.is_open, next_open: clock.next_open, next_close: clock.next_close }
  };
}

/* ---- verdict for a fresh scan + account; persists a daily verdict
   snapshot while the entry window is open (gate-block breakdown) ---- */
function ctxFrom(scanData, acctData) {
  return {
    equity: acctData.equity, coolingOff: acctData.coolingOff, weeklyDDPct: acctData.weeklyDDPct,
    tradedToday: acctData.tradedToday, minutesET: scanData.etNowMin
  };
}
async function verdict(scanData, acctData) {
  const v = engine.computeVerdict(scanData.rows, ctxFrom(scanData, acctData));
  const w = engine.RULES.entryWindow;
  if (scanData.etNowMin >= w.start && scanData.etNowMin <= w.end && v.ticket) {
    try {
      await store.saveVerdictSnapshot(STRATEGY, {
        date: scanData.etDate, at: scanData.asOf, verdict: v.verdict, top: v.top, score: v.score,
        firstBlock: engine.firstBlockingGate(v.ticket)
      });
    } catch (e) { /* the store must never take the scan down */ }
  }
  return v;
}

/* ---- journal + evidence ---- */
async function journal(days) {
  const recs = engine.annotateBreaches(await fetchJournal(days), { equityCap: equityCap(), today: engine.etDateStr(Date.now()) });
  return { asOf: new Date().toISOString(), days, count: recs.length, entries: recs };
}
async function evidence(days) {
  const [j, snaps, verdicts, cached] = await Promise.all([
    journal(days || 365),
    store.loadRegimeSnapshots(STRATEGY).catch(() => ({})),
    store.loadVerdictSnapshots(STRATEGY).catch(() => []),
    store.loadJournal(STRATEGY).catch(() => null)
  ]);
  const entries = j.entries.map(e => Object.assign({}, e, { regime: engine.regimeFor(e.date, snaps) }));
  const stats = engine.evidenceStats(entries, { startEquity: equityCap(), strategy: STRATEGY });
  /* the persisted copy is a cache; if it disagrees with the fresh
     reconstruction the fresh one wins and the page says so */
  const cacheDrift = cached && cached.entries
    ? cached.entries.length !== entries.length || cached.stats && cached.stats.n !== stats.n
    : false;
  return {
    asOf: j.asOf, strategy: STRATEGY, days: j.days, entries, stats,
    regime: { snapshots: snaps, breakdown: engine.regimeBreakdown(entries, snaps) },
    gateBlocks: engine.gateBlockBreakdown(verdicts), verdictDays: verdicts,
    cache: cached ? { syncedAt: cached.syncedAt, count: cached.entries ? cached.entries.length : 0, drift: cacheDrift } : null,
    store: store.store().kind
  };
}

/* ---- cron: regime snapshot (~09:35 ET on trading days) ---- */
async function regimeSnapshot(opts) {
  opts = opts || {};
  const started = new Date().toISOString();
  const clock = await alp(TRADING_BASE, "/v2/clock");
  const todayET = engine.etDateStr(clock.timestamp || Date.now());
  const run = { name: "regime-snapshot", started, date: todayET };
  if (!opts.force && !(await isTradingDay(todayET))) {
    run.skipped = "not a trading day"; run.finished = new Date().toISOString(); run.ok = true;
    await store.recordCronRun(run.name, run);
    return run;
  }
  const spy = await fetchDailyBars("SPY", 120);
  const universe = await pagedBars("/v2/stocks/bars", {
    symbols: CORE.join(","), timeframe: "1Day",
    start: new Date(Date.now() - 60 * 864e5).toISOString(), feed: FEED, limit: 10000
  }).catch(() => null);
  let breadth = null;
  if (universe) {
    let above = 0, counted = 0;
    for (const sym of CORE) {
      const bars = (universe[sym] || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1));
      const closes = bars.map(b => engine.num(b.c)).filter(c => c != null);
      if (closes.length < 20) continue;
      const s20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      counted++;
      if (closes[closes.length - 1] > s20) above++;
    }
    breadth = counted ? engine.r4(above / counted) : null;
  }
  const r = engine.regimeFromBars(spy, breadth);
  const snap = { date: todayET, strategy: STRATEGY, capturedAt: new Date().toISOString(), ...r };
  await store.saveRegimeSnapshot(STRATEGY, snap);
  run.snapshot = snap; run.ok = true; run.finished = new Date().toISOString();
  await store.recordCronRun(run.name, run);
  return run;
}

/* ---- cron: journal sync (~16:15 ET on trading days) ---- */
async function journalSync(opts) {
  opts = opts || {};
  const started = new Date().toISOString();
  const run = { name: "journal-sync", started };
  const ev = await evidence(365);
  const doc = { syncedAt: ev.asOf, strategy: STRATEGY, entries: ev.entries, stats: ev.stats };
  await store.saveJournal(STRATEGY, doc);
  run.count = ev.entries.length; run.n = ev.stats.n; run.tier = ev.stats.tier.tier;
  run.fired = await alerts.evaluate(STRATEGY, { etDate: ev.asOf.slice(0, 10), tier: ev.stats.tier }).catch(e => ["alert error: " + e.message]);
  run.ok = true; run.finished = new Date().toISOString();
  await store.recordCronRun(run.name, run);
  return run;
}

/* ---- ops status: what preflight.py checks, from inside ---- */
async function opsStatus() {
  const out = { asOf: new Date().toISOString(), store: store.store().kind, tokenEnforced: !!process.env.HUD_ACCESS_TOKEN,
    cronSecret: !!process.env.CRON_SECRET, alerts: !!process.env.ALERT_PUSH_URL, feed: FEED, tradingBase: TRADING_BASE,
    paper: TRADING_BASE.includes("paper"), equityCap: equityCap(), vaultToken: !!process.env.GITHUB_VAULT_TOKEN };
  try { out.storePing = await store.store().ping(); } catch (e) { out.storePing = false; out.storeError = e.message; }
  out.cron = {
    regime: await store.lastCronRun("regime-snapshot").catch(() => null),
    journal: await store.lastCronRun("journal-sync").catch(() => null)
  };
  try {
    const acct = await alp(TRADING_BASE, "/v2/account");
    out.account = { number: acct.account_number, status: acct.status, ok: true };
  } catch (e) { out.account = { ok: false, error: e.message, hint: e.hint }; }
  return out;
}

module.exports = { STRATEGY, CORE, INDEXES, equityCap, scan, account, verdict, ctxFrom, journal, evidence, regimeSnapshot, journalSync, opsStatus };
