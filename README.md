# GLADIATOR SCALP // COMMAND HUD v2

Four-floor trading command deck **plus the evidence dashboard**, one Next.js
app, one rule engine. Spec: `SPEC.md` in the GLADIATOR vault.

**The HUD observes and gates. It never places an order.** There is no order
route in this deployment and none may be added. The human runs
`executor.py --approve` — that boundary is the whole point of the system.

## Architecture — one source of truth

```
Alpaca (paper) ──► lib/alpaca.js ──► lib/services.js ──► app/api/*   (read-only route handlers)
                                        │                    │
                                   lib/engine.js ◄───────────┘        (every gate, size, breach, stat)
                                        │
   Vercel KV ◄──── lib/store.js ◄── crons: regime-snapshot 14:40 UTC · journal-sync 21:15 UTC
   vault repo ──► scripts/fetch-vault.mjs (build) ──► content/vault/index.json ──► /playbook, /journal/[date]
```

- **`lib/engine.js`** — gates, ranking, sizing, FIFO round-trip reconstruction,
  **breach detection** (`NO_STOP`, `MANUAL_EXIT`, `SECOND_TRADE`,
  `OUTSIDE_WINDOW`, `OVERSIZED`, `HELD_OVERNIGHT`), the five-tile
  `evidenceStats`, regime classification. Pure. Required by the server,
  bundled for the browser. A rule changes here once.
- **`app/api/*`** — `scan`, `account`, `journal`, `evidence`, `ops` (GET-only,
  token via `x-hud-token` header or the httpOnly cookie set by `POST /api/session`),
  two cron routes guarded by `CRON_SECRET`.
- **Data states**: `LIVE`, `STALE`, `ERROR`. There is no SIM data path. A
  failed fetch renders an explicit error panel with the endpoint, status and
  last-good time; no number is ever painted from fallback data.

## Routes

`/` deck · `/floor/1..4` · `/evidence` gate scoreboard + equity/DD curve ·
`/evidence/trades` every round trip, excluded rows greyed with reason,
drill-down drawer with fills, FIFO match and the hand-check formula ·
`/evidence/regime` results by regime + first-blocking-gate on no-trade days ·
`/journal/[date]` daily note + fills + ticket · `/lab` · `/playbook` · `/ops`.
Keys `0-4 e j r a p o`, `Ctrl+K` palette.

## Deploy (Vercel)

Env vars (names differ from the Render MCP host — see the ops runbook):

| var | purpose |
|---|---|
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | **paper** keys |
| `HUD_ACCESS_TOKEN` | required on `/api/*`; enter once on `/ops` → httpOnly cookie |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer` to the cron routes |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV (Upstash REST). Without them the store is in-memory and `/ops` says so |
| `ALERT_PUSH_URL` (+ `ALERT_PUSH_TOKEN`) | ntfy-style push endpoint for TRADE_ARMED / gate flips / tier changes / cron failures |
| `GITHUB_VAULT_TOKEN` | read-only token for the vault repo, used at build only |
| `VAULT_REPO`, `VAULT_REF`, `VAULT_ALLOWLIST` | default `mlatino-max/gladiator`, `master`, `TradeCenter,Projects/Trading,Journal/Daily,Graphify/CLAUDE CODE` |
| `GLADIATOR_EQUITY_CAP` | default 750 |

Turn on **Vercel Authentication** (deployment protection) for production and
previews. Cron jobs bypass it; browsers do not.

Vault notes ship only if they sit in an allowlisted folder **and** carry
`publish: true` in frontmatter. The build fails on a guarded confidential
name or anything that looks like a credential. Add a deploy hook to the
vault repo so a push rebuilds the site.

## Evidence discipline

Go live only when all five hold, computed from broker fills only:
n ≥ 40 · PF ≥ 1.3 · avg ≥ +0.15R · maxDD < 10% · 0 breaches in the last 20
flat round trips. Breaches are derived from fills, never typed. A trade
without a bracket stop can never earn an R and is excluded from n, but it
cannot hide from the breach window. Regime is snapshotted each morning and
never backfilled: fills before the first snapshot read `UNKNOWN` forever.

## Develop

```
npm ci
npm test          # node --test — engine, evidence, store, alerts
npm run typecheck
npm run dev       # http://localhost:3000 (no keys → every panel shows ERROR, by design)
```
