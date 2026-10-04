#!/bin/sh
# One feed pass: refresh the read-only clone of the Hermes worker's published
# state (if a deploy key is mounted), then run feed_vm.py from the vault clone.
# It writes pc.json, account.json, agents.json and status.json to /public,
# which Caddy serves at /feed/*. Never exits non-zero: a failed pass must not
# restart-loop the container; the last good files stay up and status.json and
# the log say what went wrong.
set -u
SRC="${FEED_SRC:-/vault/repo/Projects/Trading/SYNAPTIC-HUD}"
KEY=/keys/hermes_deploy_key
REPO="${HERMES_REPO:-git@github.com:mlatino-max/hermes-trading.git}"
CLONE=/work/hermes
log() { echo "[$(date -u '+%F %T') UTC] feed: $1"; }

if [ -f "$KEY" ] && [ -s "$KEY" ]; then
  # ssh insists on a private key only its owner can read; the bind-mount keeps
  # the host's mode, so copy it to a file this process owns.
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  cp "$KEY" "$HOME/.ssh/hermes_key" && chmod 600 "$HOME/.ssh/hermes_key"
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/hermes_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  if [ -d "$CLONE/.git" ]; then
    (cd "$CLONE" && git fetch --quiet --depth 1 origin HEAD && git reset --quiet --hard FETCH_HEAD) \
      || log "hermes state fetch failed - keeping the previous copy"
  else
    rm -rf "$CLONE"
    git clone --quiet --depth 1 "$REPO" "$CLONE" || log "hermes state clone failed"
  fi
fi
if [ -d "$CLONE/state" ]; then export HERMES_REPO_DIR="$CLONE"; fi

if [ ! -f "$SRC/feed_vm.py" ]; then
  log "no feed_vm.py at $SRC yet (vault-sync still cloning, or the vault commit is not pushed)"
  exit 0
fi
python "$SRC/feed_vm.py" || log "feed_vm.py exited $?"
exit 0
