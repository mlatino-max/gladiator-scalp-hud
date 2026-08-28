/* GLADIATOR SCALP — shared rule engine.
   Single source of truth for every gate, score, and journal statistic.
   Loaded by the browser as a classic script (window.GladiatorEngine) and
   required by the Vercel API functions (CommonJS). Pure functions only —
   no I/O, no DOM, no fetch. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GladiatorEngine = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  var RULES = {
    priceMin: 3,
    priceMax: 100,
    minScore: 2.0,
    maxSpreadPct: 0.2,      // spread > 0.2% of price disqualifies
    maxStopPct: 3.0,        // stop distance > 3% of entry disqualifies
    riskPct: 0.02,          // 2% of equity at risk per trade
    targetR: 1.5,
    minEquity: 500,         // below this: halt
    maxWeeklyDDPct: 6,      // weekly drawdown > 6%: stand down
    entrySlipMult: 1.0005,  // limit placed a hair above OR high
    entryWindow: { start: 9 * 60 + 45, end: 15 * 60 + 30 }, // minutes ET
    orWindow: { start: 9 * 60 + 30, end: 9 * 60 + 45 },
    sessionMinutes: 390,
    timeStop: "15:55 ET",
    validation: { minTrades: 40, minPF: 1.3, minAvgR: 0.15, maxDDPct: 10, cleanLast: 20 },
    evidence: { anecdote: 10, validation: 40, evidence: 100 }
  };

  function num(x) {
    var n = typeof x === "string" ? parseFloat(x) : x;
    return typeof n === "number" && isFinite(n) ? n : null;
  }
  function r2(x) { var n = num(x); return n == null ? null : Math.round(n * 100) / 100; }
  function r4(x) { var n = num(x); return n == null ? null : Math.round(n * 10000) / 10000; }
  function fmtN(x) { var n = num(x); return n == null ? "—" : n.toFixed(2); }

  /* ---- time helpers (America/New_York) ---- */
  var _etFmt = null;
  function etParts(d) {
    if (!_etFmt) {
      _etFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    }
    var out = {};
    _etFmt.formatToParts(new Date(d)).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  /* minutes since midnight ET */
  function minutesET(d) {
    var p = etParts(d == null ? Date.now() : d);
    return (+p.hour % 24) * 60 + (+p.minute);
  }
  /* YYYY-MM-DD in ET */
  function etDateStr(d) {
    var p = etParts(d == null ? Date.now() : d);
    return p.year + "-" + p.month + "-" + p.day;
  }

  /* ---- core scoring ---- */
  function score(row) {
    if (!row) return 0;
    return Math.abs(num(row.gap) || 0) + (num(row.rvol) || 0);
  }
  function inBand(row) {
    var p = num(row && row.price);
    return p != null && p >= RULES.priceMin && p <= RULES.priceMax;
  }
  function orWidthPct(row) {
    if (!row) return null;
    var p = num(row.price), h = num(row.orh), l = num(row.orl);
    if (p == null || p <= 0 || h == null || l == null) return null;
    return (h - l) / p * 100;
  }
  /* spread as % of mid; null when NBBO is missing (fail closed upstream) */
  function spreadPct(row) {
    if (!row) return null;
    var pre = num(row.spreadPct);
    if (pre != null) return pre;
    var b = num(row.bid), a = num(row.ask);
    if (b == null || a == null || b <= 0 || a <= 0 || a < b) return null;
    return (a - b) / ((a + b) / 2) * 100;
  }
  function rank(rows) {
    return (rows || []).slice()
      .map(function (r) { return Object.assign({}, r, { score: r2(score(r)) }); })
      .sort(function (a, b) { return b.score - a.score; });
  }
  /* scanner-level structural screen for one row */
  function rowEligible(row) {
    var fails = [];
    if (!inBand(row)) fails.push("price outside $" + RULES.priceMin + "–$" + RULES.priceMax);
    if (score(row) < RULES.minScore) fails.push("score < " + RULES.minScore.toFixed(1));
    var w = orWidthPct(row);
    if (w == null || w <= 0) fails.push("no opening range");
    else if (w > RULES.maxStopPct) fails.push("OR width " + w.toFixed(1) + "% > " + RULES.maxStopPct + "%");
    var s = spreadPct(row);
    if (s == null) fails.push("no NBBO / spread unknown");
    else if (s > RULES.maxSpreadPct) fails.push("spread " + s.toFixed(2) + "% > " + RULES.maxSpreadPct + "%");
    return { pass: fails.length === 0, fails: fails };
  }

  /* ---- intraday derivations from 5-min bars ---- */
  function sessionVWAP(bars) {
    var pv = 0, vol = 0;
    (bars || []).forEach(function (b) {
      var v = num(b.v) || 0;
      var px = num(b.vw);
      if (px == null) px = ((num(b.h) || 0) + (num(b.l) || 0) + (num(b.c) || 0)) / 3;
      if (v > 0 && px > 0) { pv += px * v; vol += v; }
    });
    return vol > 0 ? r4(pv / vol) : null;
  }
  /* OR = 09:30–09:45 ET; ready once the window has fully elapsed */
  function openingRange(bars, etNowMin) {
    var h = null, l = null, vol = 0, count = 0;
    (bars || []).forEach(function (b) {
      var m = minutesET(b.t);
      if (m >= RULES.orWindow.start && m < RULES.orWindow.end) {
        var bh = num(b.h), bl = num(b.l);
        if (bh != null && (h == null || bh > h)) h = bh;
        if (bl != null && (l == null || bl < l)) l = bl;
        vol += num(b.v) || 0;
        count++;
      }
    });
    var ready = count > 0 && num(etNowMin) != null && etNowMin >= RULES.orWindow.end;
    return { orh: h, orl: l, orVol: vol, ready: ready };
  }
  /* close of the last fully completed 5-min bar */
  function lastCompletedClose(bars, etNowMin) {
    var best = null, bestM = -1;
    (bars || []).forEach(function (b) {
      var m = minutesET(b.t);
      if (num(etNowMin) != null && m + 5 <= etNowMin && m > bestM) { bestM = m; best = num(b.c); }
    });
    return best;
  }
  /* relative volume vs the average daily volume, pro-rated by session elapsed */
  function rvolEstimate(todayVol, avgDailyVol, etNowMin) {
    var tv = num(todayVol), av = num(avgDailyVol);
    if (tv == null || av == null || av <= 0) return null;
    var elapsed = num(etNowMin) == null ? RULES.sessionMinutes
      : Math.min(RULES.sessionMinutes, Math.max(0, etNowMin - (9 * 60 + 30)));
    var frac = Math.max(0.1, elapsed / RULES.sessionMinutes);
    return r2(tv / (av * frac));
  }

  /* ---- the ticket: every gate the screen claims, enforced here ---- */
  function g(key, label, pass, detail, blocking) {
    return { key: key, label: label, pass: !!pass, detail: detail == null ? "" : String(detail), blocking: blocking !== false };
  }
  /* ctx: { equity, coolingOff, weeklyDDPct, tradedToday, minutesET,
            topSymbol, orReady?, vwap?, lastClose5m? } — per-row fields fall
     back to the row itself so the scanner and the ticket agree. */
  function buildTicket(row, ctx) {
    ctx = ctx || {};
    row = row || {};
    var equity = num(ctx.equity) || 0;
    var price = num(row.price) || 0;
    var orh = num(row.orh), orl = num(row.orl);
    var entry = orh != null ? r2(orh * RULES.entrySlipMult) : null;
    var stop = orl != null ? r2(orl) : null;
    var riskPs = (entry != null && stop != null) ? r4(entry - stop) : null;
    var sc = score(row);
    var sPct = spreadPct(row);
    var stopPct = (entry != null && entry > 0 && riskPs != null) ? riskPs / entry * 100 : null;
    var orReady = ctx.orReady != null ? !!ctx.orReady : !!row.orReady;
    var vwap = num(ctx.vwap != null ? ctx.vwap : row.vwap);
    var lastClose5m = num(ctx.lastClose5m != null ? ctx.lastClose5m : row.lastClose5m);
    var mins = num(ctx.minutesET);
    var weeklyDD = num(ctx.weeklyDDPct) || 0;
    var traded = num(ctx.tradedToday) || 0;

    var maxRisk = equity * RULES.riskPct;
    var shares = 0;
    if (riskPs != null && riskPs > 0 && entry > 0) {
      shares = Math.max(0, Math.min(Math.floor(maxRisk / riskPs), Math.floor(equity / entry)));
    }

    var inWindow = mins == null ? null : (mins >= RULES.entryWindow.start && mins <= RULES.entryWindow.end);
    var triggerKnown = lastClose5m != null && vwap != null && orh != null;
    var triggerPass = !!(triggerKnown && lastClose5m > orh && lastClose5m > vwap);

    var gates = [
      g("band", "Price $" + RULES.priceMin + "–$" + RULES.priceMax, inBand(row), price ? "$" + price.toFixed(2) : "no price"),
      g("score", "Score ≥ " + RULES.minScore.toFixed(1), sc >= RULES.minScore, sc.toFixed(2)),
      g("spread", "Spread ≤ " + RULES.maxSpreadPct + "%", sPct != null && sPct <= RULES.maxSpreadPct,
        sPct == null ? "no NBBO" : sPct.toFixed(3) + "%"),
      g("or", "OR captured (09:45)", orReady && riskPs != null && riskPs > 0,
        orReady ? (riskPs != null && riskPs > 0 ? "OR " + fmtN(orl) + "–" + fmtN(orh) : "invalid OR") : "not captured"),
      g("stopWidth", "Stop ≤ " + RULES.maxStopPct + "% of entry", stopPct != null && stopPct > 0 && stopPct <= RULES.maxStopPct,
        stopPct == null ? "n/a" : stopPct.toFixed(2) + "%"),
      g("top1", "Top-1 ranked", !!ctx.topSymbol && row.symbol === ctx.topSymbol,
        ctx.topSymbol ? "top: " + ctx.topSymbol : "no ranking"),
      g("oneTrade", "First trade of day", traded < 1, traded + " taken today"),
      g("cool", "Cooling-off clear", !ctx.coolingOff, ctx.coolingOff ? "loss last session — observe only" : "clear"),
      g("equity", "Equity ≥ $" + RULES.minEquity, equity >= RULES.minEquity, "$" + equity.toFixed(0)),
      g("dd", "Weekly DD ≤ " + RULES.maxWeeklyDDPct + "%", weeklyDD <= RULES.maxWeeklyDDPct, weeklyDD.toFixed(1) + "%"),
      g("window", "Entry window 09:45–15:30 ET", inWindow === true, inWindow == null ? "clock unknown" : (inWindow ? "open" : "closed")),
      g("size", "Can size ≥ 1 share", shares >= 1, shares + " sh (risk $" + maxRisk.toFixed(2) + ")"),
      g("trigger", "5m close > OR-H & VWAP", triggerPass,
        !triggerKnown ? "awaiting live bars" :
          "close " + fmtN(lastClose5m) + " vs ORH " + fmtN(orh) + " / VWAP " + fmtN(vwap), false)
    ];

    var reasons = gates.filter(function (x) { return x.blocking && !x.pass; })
      .map(function (x) { return x.label + " — " + x.detail; });
    var ok = reasons.length === 0;
    var armed = ok && triggerPass;
    var target = (entry != null && riskPs != null) ? r2(entry + RULES.targetR * riskPs) : null;

    return {
      ok: ok, armed: armed, reasons: reasons, gates: gates,
      symbol: row.symbol || "—", setup: "ORB15-long",
      score: r2(sc), gap_pct: r2(row.gap), rvol: r2(row.rvol),
      spread_pct: sPct == null ? null : r4(sPct),
      vwap: vwap, last_close_5m: lastClose5m,
      entry_est: entry, stop: stop, target: target, shares: shares,
      position_value: entry != null ? r2(shares * entry) : null,
      dollars_at_risk: riskPs != null ? r2(shares * Math.max(riskPs, 0)) : null,
      entry_trigger: "5-min close above " + fmtN(orh) + " AND above session VWAP, then buy",
      time_stop: RULES.timeStop + " — flat by close, no exceptions",
      order_type: "bracket: limit entry, stop-loss + " + RULES.targetR + "R take-profit legs, TIF day",
      or_high: orh, or_low: orl, price: price || null
    };
  }

  /* one verdict for the whole desk — scanner, chip, and ticket all use this */
  function computeVerdict(rows, ctxBase) {
    var ranked = rank(rows);
    var top = ranked[0] || null;
    if (!top) return { verdict: "NO_DATA", top: null, score: null, reason: "universe empty", ticket: null, ranked: ranked };
    var ctx = Object.assign({}, ctxBase || {}, { topSymbol: top.symbol });
    var ticket = buildTicket(top, ctx);
    var verdict = ticket.armed ? "TRADE_ARMED" : (ticket.ok ? "STAGED" : "NO_TRADE");
    return {
      verdict: verdict, top: top.symbol, score: ticket.score,
      reason: ticket.armed ? "all gates pass — awaiting human --approve"
        : ticket.ok ? "structural gates pass — waiting on 5m close > OR-H & VWAP"
          : ticket.reasons[0] || "blocked",
      ticket: ticket, ranked: ranked
    };
  }

  /* ---- journal & evidence ---- */
  function tradeR(entry, stop, exit) {
    var e = num(entry), s = num(stop), x = num(exit);
    if (e == null || s == null || x == null) return null;
    var risk = e - s;
    if (!(risk > 0)) return null;
    return Math.round(((x - e) / risk) * 1000) / 1000;
  }
  function isTrade(j) { return j && j.reason !== "no_trade" && num(j.r) != null; }
  function evidenceTier(n) {
    if (!n) return { tier: "NONE", label: "NO DATA", note: "no completed paper trades yet — the empty journal is honest" };
    if (n < RULES.evidence.anecdote) return { tier: "ANECDOTE", label: "n=" + n + " · ANECDOTE", note: "interesting, not evidence — do not scale, do not trust" };
    if (n < RULES.evidence.validation) return { tier: "HYPOTHESIS", label: "n=" + n + " · HYPOTHESIS", note: "keep paper trading toward n=40 before drawing conclusions" };
    if (n < RULES.evidence.evidence) return { tier: "VALIDATION", label: "n=" + n + " · VALIDATION", note: "n≥40 — now the PF / avg-R / DD gates decide, not vibes" };
    return { tier: "EVIDENCE", label: "n=" + n + " · EVIDENCE", note: "100+ trades — evidence if it spans different market regimes" };
  }
  /* journal: newest first. Simulated compounding at riskPct per R. */
  function journalStats(journal, startEquity) {
    var trades = (journal || []).filter(isTrade);
    var n = trades.length;
    var rs = trades.map(function (j) { return num(j.r); });
    var wins = rs.filter(function (r) { return r > 0; });
    var losses = rs.filter(function (r) { return r <= 0; });
    var winSum = wins.reduce(function (a, b) { return a + b; }, 0);
    var lossSum = Math.abs(losses.reduce(function (a, b) { return a + b; }, 0));
    var pf = lossSum > 0 ? winSum / lossSum : (wins.length ? Infinity : 0);
    var avg = n ? rs.reduce(function (a, b) { return a + b; }, 0) / n : 0;
    var eq = num(startEquity) || 750, peak = eq, maxDD = 0;
    var path = [eq];
    trades.slice().reverse().forEach(function (j) {
      eq += eq * RULES.riskPct * num(j.r);
      path.push(eq);
      if (eq > peak) peak = eq;
      var dd = peak > 0 ? (peak - eq) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    });
    var breaches = (journal || []).filter(function (j) { return j.plan === "no"; }).length;
    var breachesLast20 = trades.slice(0, RULES.validation.cleanLast)
      .filter(function (j) { return j.plan === "no"; }).length;
    var v = RULES.validation;
    var goLive = n >= v.minTrades && pf >= v.minPF && avg >= v.minAvgR && maxDD < v.maxDDPct && breachesLast20 === 0;
    return {
      n: n, pf: pf, avgR: avg, winRate: n ? wins.length / n : 0,
      maxDDPct: maxDD, breaches: breaches, breachesLast20: breachesLast20,
      equityPath: path, goLive: goLive, tier: evidenceTier(n)
    };
  }

  return {
    RULES: RULES,
    num: num, r2: r2, r4: r4, fmtN: fmtN,
    minutesET: minutesET, etDateStr: etDateStr,
    score: score, inBand: inBand, orWidthPct: orWidthPct, spreadPct: spreadPct,
    rank: rank, rowEligible: rowEligible,
    sessionVWAP: sessionVWAP, openingRange: openingRange,
    lastCompletedClose: lastCompletedClose, rvolEstimate: rvolEstimate,
    buildTicket: buildTicket, computeVerdict: computeVerdict,
    tradeR: tradeR, isTrade: isTrade, evidenceTier: evidenceTier, journalStats: journalStats
  };
});
