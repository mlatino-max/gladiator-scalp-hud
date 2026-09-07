#!/bin/sh
# Container entrypoint for the HUD. Builds the vault index from the mounted
# vault (no GitHub, no token), keeps refreshing it in the background, then
# starts the Next.js standalone server. Nothing here touches the broker.
set -eu
: "${VAULT_DIR:=/vault}"
: "${VAULT_INDEX_PATH:=/data/vault-index.json}"
: "${VAULT_REFRESH_SECONDS:=600}"
export VAULT_DIR VAULT_INDEX_PATH
export VAULT_INDEX_OUT="$VAULT_INDEX_PATH"

refresh() {
  node scripts/fetch-vault.mjs || echo "[vault] refresh failed — keeping the previous index"
}

if [ -d "$VAULT_DIR" ]; then
  refresh
  ( while sleep "$VAULT_REFRESH_SECONDS"; do refresh; done ) &
else
  echo "[vault] $VAULT_DIR is not mounted — the playbook will show no notes"
  unset VAULT_INDEX_PATH
fi

exec node server.js
