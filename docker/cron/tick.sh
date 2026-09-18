#!/bin/sh
# Fire one HUD cron route exactly the way Vercel Cron did: a GET carrying the
# bearer secret. Retries cover a HUD container that is restarting. The
# optional second argument is the per-request budget in seconds (default
# 120; the Massive loader needs more because the free tier is rate-limited).
name="$1"
budget="${2:-120}"
url="${HUD_URL:-http://hud:3000}/api/cron/${name}"
echo "[$(date '+%F %T %Z')] ${name} -> ${url} (max ${budget}s)"
curl -sS --max-time "${budget}" --retry 3 --retry-delay 60 --retry-all-errors \
  -H "Authorization: Bearer ${CRON_SECRET:-}" "${url}" -w '\nHTTP %{http_code}\n' \
  || echo "[${name}] FAILED after retries"
