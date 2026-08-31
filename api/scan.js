/* GET /api/scan[?symbols=EXTRA1,EXTRA2]
   Live universe: static core + Alpaca screener movers, each row carrying the
   real numbers every gate needs — last, prev close, gap, RVOL estimate,
   opening range, session VWAP, last completed 5-min close, NBBO spread. */
"use strict";
const { engine, alp, pagedBars, withGuard, etOffsetFrom, TRADING_BASE, DATA_BASE, FEED } = require("../lib/alpaca.js");

const CORE = ["SOXL", "TQQQ", "INTC", "SOFI", "NIO", "RIVN", "LCID", "AAL", "MARA", "F", "PLTR", "AMD", "MU", "AAPL", "TSLA"];
const INDEXES = ["SPY", "QQQ"];

module.exports = withGuard(async (req, res) => {
  const extra = String((req.query && req.query.symbols) || "")
    .split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z.]{1,6}$/.test(s));

  const clock = await alp(TRADING_BASE, "/v2/clock");
  const off = etOffsetFrom(clock.timestamp);
  const now = new Date(clock.timestamp || Date.now());
  const etNowMin = engine.minutesET(now);
  const todayET = engine.etDateStr(now);

  /* dynamic additions — best effort, some plans don't have the screener */
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

  /* Intraday bars only exist once the session has started. Asking for a
     09:30 start before 09:30 ET makes Alpaca reject the whole request
     ("end should not be before start"), which used to 500 the scanner
     every pre-market morning. */
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
      symbol: sym,
      price: last, prevClose,
      gap,
      rvol: clock.is_open && dayBar ? engine.rvolEstimate(dayBar.v, avgVol, etNowMin) : engine.rvolEstimate(dayBar && dayBar.v, avgVol, null),
      orh: or.orh, orl: or.orl, orReady: or.ready,
      vwap: engine.sessionVWAP(bars5),
      lastClose5m: engine.lastCompletedClose(bars5, etNowMin),
      bid, ask,
      spreadPct: engine.spreadPct({ bid, ask }),
      volume: dayBar ? engine.num(dayBar.v) : null,
      core: CORE.includes(sym),
      dyn: dyn.includes(sym)
    };
  }

  const rows = symbols.map(buildRow).filter(r => r.price != null);
  const index = {};
  for (const sym of INDEXES) {
    const r = buildRow(sym);
    index[sym] = { price: r.price, gap: r.gap };
  }

  res.status(200).json({
    asOf: new Date().toISOString(),
    etDate: todayET, etNowMin, sessionStarted,
    clock: { is_open: clock.is_open, next_open: clock.next_open, next_close: clock.next_close },
    feed: FEED,
    rows, index
  });
});
