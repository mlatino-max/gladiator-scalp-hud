#!/bin/sh
# Fire one HUD cron route exactly the way Vercel Cron did: a GET carrying the
# bearer secret. Retries cover a HUD container that is restarting.
name="$1"
url="${HUD_URL:-http://hud:3000}/api/cron/${name}"
echo "[$(date '+%F %T %Z')] ${name} -> ${url}"
curl -sS --max-time 120 --retry 3 --retry-delay 60 --retry-all-errors \
  -H "Authorization: Bearer ${CRON_SECRET:-}" "${url}" -w '\nHTTP %{http_code}\n' \
  || echo "[${name}] FAILED after retries"
