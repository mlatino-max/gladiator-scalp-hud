#!/bin/sh
# Scheduler for the HERMES desk. A plain loop instead of crond so the container
# can run unprivileged (uid 1000, the owner of the shared /data volume).
# Every HERMES_EVERY seconds: render if there is no desk yet, or if it is a
# weekday inside the window the sleeves run in (Chicago time, 08:00-16:45 -
# the session plus the after-close run). Outside it a tick costs nothing: no KV
# call is made. US holidays are not modelled; a holiday render just redraws the
# same record.
EVERY="${HERMES_EVERY:-1800}"
OUT="${HERMES_DIR:-/data/hermes}"
in_window() {
  python - <<'PY'
import os, sys
from datetime import datetime
from zoneinfo import ZoneInfo
now = datetime.now(ZoneInfo(os.environ.get("HERMES_TZ", "America/Chicago")))
minutes = now.hour * 60 + now.minute
sys.exit(0 if now.weekday() < 5 and 8 * 60 <= minutes <= 16 * 60 + 45 else 1)
PY
}
while true; do
  if [ ! -f "$OUT/hermes_desk.png" ] || in_window; then
    hermes-run
  fi
  # no desk yet (fresh deploy, vault still cloning): come back sooner
  if [ -f "$OUT/hermes_desk.png" ]; then sleep "$EVERY"; else sleep 300; fi
done
