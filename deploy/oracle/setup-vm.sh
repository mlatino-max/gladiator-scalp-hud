#!/bin/sh
# One-time host setup on an Oracle Always Free Ubuntu VM, run as the `ubuntu`
# user over SSH. Idempotent. Installs Docker, opens 80/443 in the host
# firewall (OCI Ubuntu images ship an iptables allowlist that admits only
# port 22, on top of the VCN security list), checks out this repo and leaves
# a `.env` to fill. It never starts the stack: that is a deliberate second
# step once the secrets are in place.
set -eu
REPO=${REPO:-https://github.com/mlatino-max/gladiator-scalp-hud.git}
REF=${REF:-main}
DIR=${DIR:-$HOME/gladiator-scalp-hud}

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
done
if ! command -v netfilter-persistent >/dev/null 2>&1; then
  sudo sh -c 'DEBIAN_FRONTEND=noninteractive apt-get install -y -q iptables-persistent >/dev/null'
fi
sudo netfilter-persistent save >/dev/null

if [ ! -d "$DIR/.git" ]; then
  git clone --quiet --branch "$REF" "$REPO" "$DIR"
else
  git -C "$DIR" fetch --quiet origin "$REF" && git -C "$DIR" checkout --quiet "$REF" && git -C "$DIR" pull --quiet --ff-only
fi

cd "$DIR/deploy/oracle"
mkdir -p secrets && chmod 700 secrets
if [ ! -f .env ]; then
  cp .env.example .env && chmod 600 .env
  echo "[setup] deploy/oracle/.env created from the example - fill it, drop the deploy key in secrets/, then:"
  echo "        cd $DIR/deploy/oracle && sudo docker compose up -d --build"
fi
echo "[setup] done on $(hostname): $(docker --version)"
