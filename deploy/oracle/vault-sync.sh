#!/bin/sh
# Keeps a sparse, blob-less clone of the vault fresh for the HUD's playbook.
# Only the allowlisted folders are checked out (the vault carries hundreds of
# docx/pdf files elsewhere). Runs forever; a failed sync keeps the previous
# checkout and the HUD keeps its previous index. Never writes to GitHub: the
# key is a read-only deploy key.
set -u
: "${VAULT_REPO:?VAULT_REPO is required}"
: "${VAULT_REF:=master}"
: "${VAULT_SYNC_SECONDS:=600}"
: "${VAULT_SPARSE:=TradeCenter:Projects/Trading:Journal/Daily:Graphify/CLAUDE CODE}"

# ssh insists on a private key nobody else can read; the bind-mount keeps the
# host's mode, so copy it to a file this process owns.
mkdir -p /root/.ssh && chmod 700 /root/.ssh
cp /keys/vault_deploy_key /root/.ssh/vault_key && chmod 600 /root/.ssh/vault_key
export GIT_SSH_COMMAND="ssh -i /root/.ssh/vault_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git config --global --add safe.directory '*'

dir=/vault/repo

sync() {
  if [ ! -d "$dir/.git" ]; then
    rm -rf "$dir"
    git clone --quiet --filter=blob:none --no-checkout --depth 1 \
      --branch "$VAULT_REF" "$VAULT_REPO" "$dir" || return 1
    (
      cd "$dir" || exit 1
      git sparse-checkout init --cone || exit 1
      IFS=:; set -f
      # shellcheck disable=SC2086
      git sparse-checkout set $VAULT_SPARSE || exit 1
      git checkout --quiet "$VAULT_REF"
    ) || return 1
  else
    (
      cd "$dir" || exit 1
      git fetch --quiet --depth 1 origin "$VAULT_REF" || exit 1
      git reset --quiet --hard FETCH_HEAD
    ) || return 1
  fi
  chmod -R a+rX "$dir"
  echo "[vault-sync] $(date '+%F %T') at $(cd "$dir" && git rev-parse --short HEAD)"
}

while :; do
  sync || echo "[vault-sync] $(date '+%F %T') sync failed - keeping the previous checkout"
  sleep "$VAULT_SYNC_SECONDS"
done
