/* GET /api/account
   Real account context for the risk gates: live equity, weekly drawdown
   from portfolio history, cooling-off derived from the last session's
   actual results, and today's trade count for the one-trade/day gate. */
"use strict";
const { engine, alp, fetchJournal, withGuard, etOffsetFrom, TRADING_BASE } = require("../lib/alpaca.js");

module.exports = withGuard(async (req, res) => {
  const clock = await alp(TRADING_BASE, "/v2/clock");
  const off = etOffsetFrom(clock.timestamp);
  const todayET = engine.etDateStr(clock.timestamp || Date.now());

  const [acct, hist, todayOrders, journal] = await Promise.all([
    alp(TRADING_BASE, "/v2/account"),
    alp(TRADING_BASE, "/v2/account/portfolio/history", { period: "1M", timeframe: "1D" }),
    alp(TRADING_BASE, "/v2/orders", { status: "all", after: `${todayET}T00:00:00${off}`, limit: 100, direction: "desc" }),
    fetchJournal(30)
  ]);

  /* Validation doctrine: risk is sized off working capital, not whatever the
     paper account happens to hold (default paper accounts start at $100k —
     2% of that would be a $2,000 risk, not $15). Cap effective equity at
     GLADIATOR_EQUITY_CAP (default $750); raise the env var only when the
     ladder is earned (n≥40, PF≥1.3). */
  const CAP = engine.num(process.env.GLADIATOR_EQUITY_CAP) || 750;
  const realEquity = engine.num(acct.equity) || 0;
  const equity = Math.min(realEquity, CAP);

  /* weekly drawdown: peak equity since Monday (ET) vs now */
  const times = hist.timestamp || [], eqs = hist.equity || [];
  const nowD = new Date(clock.timestamp || Date.now());
  const dow = (nowD.getUTCDay() + 6) % 7; // Monday=0 (approximation is fine at daily granularity)
  const monday = new Date(nowD.getTime() - dow * 864e5);
  const mondayStr = engine.etDateStr(monday);
  let peak = realEquity;
  for (let i = 0; i < times.length; i++) {
    const d = engine.etDateStr(times[i] * 1000);
    const v = engine.num(eqs[i]);
    if (d >= mondayStr && v != null && v > 0 && v > peak) peak = v;
  }
  /* dollars given back this week, measured against working capital — on a
     $100k paper account with $15 risk a pure %-of-account DD would never trip */
  const ddDollars = Math.max(0, peak - realEquity);
  const ddBase = Math.min(peak, CAP);
  const weeklyDDPct = ddBase > 0 ? Math.max(0, engine.r2(ddDollars / ddBase * 100)) : 0;

  /* previous trading day from portfolio history */
  let prevTradingDay = null;
  for (let i = times.length - 1; i >= 0; i--) {
    const d = engine.etDateStr(times[i] * 1000);
    if (d < todayET) { prevTradingDay = d; break; }
  }

  /* cooling-off: the last session traded was the previous trading day AND it netted a loss */
  const prevDayTrades = journal.filter(j => j.date === prevTradingDay && engine.num(j.r) != null);
  const prevDayR = prevDayTrades.reduce((a, j) => a + j.r, 0);
  const coolingOff = prevDayTrades.length > 0 && prevDayR < 0;

  /* one trade per day: any buy today that filled or is still working */
  const WORKING = new Set(["new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled", "held"]);
  const tradedToday = todayOrders.filter(o =>
    o.side === "buy" && (+o.filled_qty > 0 || WORKING.has(o.status))
  ).length;

  res.status(200).json({
    asOf: new Date().toISOString(),
    etDate: todayET,
    paper: TRADING_BASE.includes("paper"),
    account_number: acct.account_number,
    status: acct.status,
    currency: acct.currency,
    equity,
    real_equity: engine.r2(realEquity),
    equity_cap: CAP,
    cash: engine.num(acct.cash),
    buying_power: engine.num(acct.buying_power),
    weeklyDDPct,
    weeklyDDDollars: engine.r2(ddDollars),
    weekPeakEquity: engine.r2(peak),
    prevTradingDay,
    prevDayR: prevDayTrades.length ? engine.r2(prevDayR) : null,
    coolingOff,
    coolingDetail: coolingOff
      ? `net ${prevDayR.toFixed(2)}R on ${prevTradingDay} — observation only today`
      : (prevDayTrades.length ? `last session ${prevDayR >= 0 ? "+" : ""}${prevDayR.toFixed(2)}R — clear` : "no trades last session — clear"),
    tradedToday,
    clock: { is_open: clock.is_open, next_open: clock.next_open, next_close: clock.next_close }
  });
});
