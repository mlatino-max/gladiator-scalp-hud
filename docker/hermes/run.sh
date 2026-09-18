#!/bin/sh
# One HERMES desk render: hydrate the archive from the cloud sleeves' KV, draw,
# publish atomically, record the outcome in status.json for /api/hermes.
# Never exits non-zero: a failed render must not restart-loop the container,
# the last good picture stays up and status.json says what went wrong.
set -u
SRC="${HERMES_SRC:-/vault/repo/Projects/Trading/HERMES-ART}"
OUT="${HERMES_DIR:-/data/hermes}"
TZ_DRAW="${HERMES_TZ:-America/Chicago}"
mkdir -p "$OUT/bot" "$OUT/tmp"

status() { # ok(true|false) message
  printf '{"ok":%s,"at":"%s","message":"%s"}\n' "$1" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$2" > "$OUT/status.json.tmp" \
    && mv "$OUT/status.json.tmp" "$OUT/status.json"
  echo "[$(date '+%F %T %Z')] hermes: $2"
}

if [ ! -f "$SRC/hermes_kv_hydrate.py" ] || [ ! -f "$SRC/hermes_art.py" ]; then
  status false "vault clone has no HERMES-ART scripts yet at $SRC (vault-sync still cloning, or the vault commit is not pushed)"
  exit 0
fi
if [ -z "${KV_REST_API_URL:-}${KV_ENV_PREFIX:-}" ]; then
  status false "KV_REST_API_URL / KV_REST_API_TOKEN are not set in .env (the cloud sleeves' Upstash store)"
  exit 0
fi

if python "$SRC/hermes_kv_hydrate.py" --dir "$OUT/bot" --tz "$TZ_DRAW" --render --out "$OUT/tmp/hermes_desk" > "$OUT/tmp/last.log" 2>&1; then
  mv "$OUT/tmp/hermes_desk.png" "$OUT/hermes_desk.png"
  [ -f "$OUT/tmp/hermes_desk.html" ] && mv "$OUT/tmp/hermes_desk.html" "$OUT/hermes_desk.html"
  status true "$(grep -m1 '^hydrated' "$OUT/tmp/last.log" | sed 's/^hydrated [^:]*: //; s/"/ /g')"
else
  status false "render failed: $(tail -n 1 "$OUT/tmp/last.log" | sed 's/"/ /g; s/\\/\//g' | cut -c1-240)"
fi
exit 0
