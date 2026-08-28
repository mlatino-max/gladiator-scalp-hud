# GLADIATOR SCALP // COMMAND HUD

Four-floor trading command deck for the $750 ORB15-long paper-validation campaign.
**The HUD observes and gates. It never places an order.** The human runs
`executor.py --approve` — that boundary is the whole point of the system.

## Architecture — one source of truth

```
Alpaca (paper)  ──►  api/scan.js     ─┐
  keys live only     api/account.js  ─┼──►  lib/engine.js  ──►  index.html
  in Vercel env      api/journal.js  ─┘     (shared rules)      (render only)
```

- **`lib/engine.js`** — every gate, score, sizing rule, and journal statistic
  lives here, once. The browser loads it as a script; the serverless functions
  `require()` the same file. The scanner, the ticket, the sidebar gate tree,
  and the lab all call the same functions, so their numbers cannot disagree.
- **`api/scan.js`** — universe rows with real numbers: last trade, prev close,
  gap%, RVOL estimate, 09:30–09:45 opening range, session VWAP, last completed
  5-min close, NBBO bid/ask spread. Core 15 names + Alpaca screener movers.
- **`api/account.js`** — live equity, weekly drawdown from portfolio history,
  cooling-off derived from the previous session's actual results, and today's
  buy-order count for the one-trade-per-day gate.
- **`api/journal.js`** — the journal is reconstructed from closed orders and
  bracket legs at the broker: entry fill, stop leg, target leg, exit, reason
  (target / stop / eod), and R. Nothing is typed by hand except the
  followed-plan flag and notes.

All three endpoints are **read-only proxies**. There is no order route
anywhere in this deployment, and the Alpaca keys never reach the browser.

## Enforced gates (all of them, in code)

Structural: price $3–$100 · score ≥ 2.0 · spread ≤ 0.2% (fails closed with no
NBBO) · OR captured after 09:45 · stop ≤ 3% of entry · top-1 ranked only.
Risk: equity ≥ $500 · weekly DD ≤ 6% · cooling-off after a losing session ·
one trade per day · entry window 09:45–15:30 ET · sizeable ≥ 1 share at 2% risk.
Trigger (arms the ticket, on live bars): **5-min close > OR-high AND > VWAP.**

A ticket is `NO TRADE` until every blocking gate passes, `STAGED` while
waiting on the trigger, and `ARMED` only when the trigger confirms — and even
armed, it still needs the human `--approve`.

## Deploy

1. Push this repo to Vercel (static + `api/` functions, no build step).
2. Set env vars in the Vercel project:
   - `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` — **paper** keys
   - `ALPACA_DATA_FEED` — optional, default `iex` (free tier)
   - `ALPACA_TRADING_BASE` — optional, default `https://paper-api.alpaca.markets`
   - `HUD_ACCESS_TOKEN` — optional; if set, the HUD must send it
     (Ops Console → API TOKEN) or every endpoint returns 401. Set this —
     the account endpoint exposes equity to anyone with the URL otherwise.
3. Open the deployment. The DATA chip goes **LIVE** green.

Opening `index.html` from disk also works: paste the deployment URL into
Ops Console → API BASE URL. With no API at all the HUD runs on **SIM** data,
says so loudly in red, and unlocks the drill-editing cells.

## Evidence discipline

n=5 is interesting. n=40 is validation. 100+ across different market regimes
starts becoming evidence. The go-live gate (n≥40, PF≥1.3, avg≥+0.15R,
maxDD<10%, zero breaches in the last 20) is computed from the broker-synced
journal — the lab reports **NOT MET — stay paper** until the data says
otherwise.

## Tests

```
node --test tests/engine.test.mjs
```

Covers every gate (pass and block), OR/VWAP/RVOL derivations from bars,
journal R math, evidence tiers, and the go-live gate.
