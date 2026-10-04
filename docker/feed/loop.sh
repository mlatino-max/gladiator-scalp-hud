#!/bin/sh
# Scheduler for the Synaptic HUD feed. A plain loop instead of crond so the
# container can run unprivileged. Weekdays 12:00-23:00 UTC (the US session and
# the after-close runs, in either daylight state) it rebuilds every FEED_EVERY
# seconds; outside that it rebuilds every FEED_IDLE seconds, enough to keep the
# page's "feed is alive" light honest without spending KV commands on a closed
# market.
EVERY="${FEED_EVERY:-600}"
IDLE="${FEED_IDLE:-1800}"
while true; do
  feed-run
  h=$(date -u +%H); d=$(date -u +%u)
  # nothing published yet (fresh deploy, vault still cloning): come back sooner
  if [ ! -f /public/status.json ]; then sleep 300
  elif [ "$d" -le 5 ] && [ "$h" -ge 12 ] && [ "$h" -lt 23 ]; then sleep "$EVERY"; else sleep "$IDLE"; fi
done
