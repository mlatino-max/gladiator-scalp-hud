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
| `KV_ENV_PREFIX` | prefix the Vercel storage integration put on those two names (this project: `gladiator_scalp_`); bare names still win |
| `ALERT_PUSH_URL` (+ `ALERT_PUSH_TOKEN`) | ntfy-style push endpoint for TRADE_ARMED / gate flips / tier changes / cron failures |
| `GITHUB_VAULT_TOKEN` | read-only token for the vault repo, used at build only |
| `VAULT_REPO`, `VAULT_REF`, `VAULT_ALLOWLIST` | default `mlatino-max/gladiator`, `master`, `TradeCenter,Projects/Trading,Journal/Daily,Graphify/CLAUDE CODE` |
| `GLADIATOR_EQUITY_CAP` | default 750 |

Vercel's Standard Protection gates previews and deployment URLs but not the
production domain on the Pro plan, so `proxy.ts` gates every page with the
`HUD_ACCESS_TOKEN` cookie as well: no cookie → redirect to `/ops`, where the
token is entered once. `/api/*` keeps its own guard; cron jobs are unaffected.

Vault notes ship only if they sit in an allowlisted folder **and** carry
`publish: true` in frontmatter. The build fails on a guarded confidential
name or anything that looks like a credential. Add a deploy hook to the
vault repo so a push rebuilds the site.

## Run locally with Docker (replaces Vercel + Render)

`docker-compose.yml` runs the whole desk on one PC with Docker Desktop:

| container | replaces | what it is |
|---|---|---|
| `hud` | Vercel hosting + Vercel KV | this app, Next.js standalone build; state in `/data/store.json` on the `hud-data` volume (`lib/store.js` FileStore); the vault bind-mounted read-only at `/vault` and re-indexed every 10 min (no `GITHUB_VAULT_TOKEN`) |
| `cron` | Vercel Cron | BusyBox crond in `America/New_York`, weekdays: `screen` 08:45 ET, `regime-snapshot` 09:40 ET, `journal-sync` 16:15 ET, `screen-load` 18:30 ET. Follows DST by itself |
| `alpaca-mcp` | Render `alpaca-mcp-server-paper` | the official `alpaca-mcp-server` (PyPI, pinned) over streamable HTTP on `127.0.0.1:8000/mcp`, paper mode hard-coded |

```
cp .env.example .env        # then paste the PAPER keys + keep the generated tokens
docker compose up -d --build
```

Open `http://localhost:3000/ops`, enter `HUD_ACCESS_TOKEN` once. Every page
and every `/api/*` route is behind that token; the HUD listens on the LAN so a
phone on the same Wi-Fi can use it (`HUD_BIND=127.0.0.1` in `.env` to keep it
on this PC). The MCP server is localhost-only because it can place paper
orders. Register it with Claude Code from the vault (`.mcp.json` there) or:

```
claude mcp add --transport http alpaca-local http://127.0.0.1:8000/mcp
```

Day to day:

```
docker compose ps                         # health
docker compose logs -f cron               # what the jobs did
docker compose exec cron tick journal-sync   # fire a job now
docker compose up -d --build hud          # after a code change
```

Unlike Vercel, nothing outside the LAN can reach this stack. `ALERT_PUSH_URL`
(ntfy) still delivers alerts to a phone anywhere.

## Supabase mirror and screen (TradeCenter Supabase Plan, phases 1–2)

The `hud` container is the only writer to the Supabase project; the
service-role key lives in `.env` and nowhere else. `lib/supabase.js` is a
plain PostgREST client (no SDK), and nothing in it can reach a broker.

| piece | what it does |
|---|---|
| `journal-sync` (16:15 ET) | after the usual cache write, mirrors the same fills the engine paired into `orders`, `fills`, `round_trips` (`lib/journal-mirror.js`). FIFO pairing stays in `lib/engine.js`; the mirror only translates records into rows |
| `GET /api/journal` | adds `mirror`: the table's counts over the same window next to the fresh reconstruction, `mismatch: true` (and a `[journal] mirror mismatch` log line) when they disagree. The recompute stays authoritative until five sessions agree |
| every `/api/scan` and every cron route | inserts a `heartbeats` row so the free-plan project never idles into a pause |
| `screen-load` (18:30 ET) | pulls Massive's grouped daily for the last eight sessions into `bars_daily` and upserts `symbols`; refreshes the ticker reference (type → ETF / leveraged / excluded) weekly. Needs `MASSIVE_API_KEY` in `.env`; without it the route answers 503 with a hint (`lib/massive.js`, `lib/screen.js`) |
| `screen` (08:45 ET) and `GET /api/screen[?record=1]` | reads `v_pullback_screen` (the six rules live in that view) and, when recording, books the run in `screen_runs` / `screen_candidates` |

`/api/ops` shows `supabase.ping` and `massive.configured`. Fire any job by
hand with `docker compose exec cron tick <name> [seconds]`.

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
npm test          # node --test — engine, evidence, store, alerts, supabase, journal-mirror, screen
npm run typecheck
npm run dev       # http://localhost:3000 (no keys → every panel shows ERROR, by design)
```
