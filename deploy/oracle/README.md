# HUD on Oracle Cloud Always Free

The scalp HUD and its cron sidecar on a free Oracle VM, so the desk exists
with the PC off. Same image as `docker-compose.yml` at the repo root; this
folder only changes how the vault arrives (sparse git clone, read-only deploy
key) and how the HUD is reached (Caddy, HTTPS, token wall). The Alpaca MCP
server is deliberately absent: it can place paper orders and stays on the PC.

## Files

| file | role |
|---|---|
| `docker-compose.yml` | `vault-sync`, `hud`, `cron`, `hermes`, `caddy` |
| `vault-sync.sh` | keeps `/vault/repo` at the tip of `master`, allowlisted folders only |
| `Caddyfile` | `HUD_HOST` → `hud:3000` with automatic Let's Encrypt |
| `setup-vm.sh` | one-time host prep: Docker, iptables 80/443, checkout, `.env` |
| `.env.example` | every variable the stack reads |
| `secrets/vault_deploy_key` | private half of the read-only deploy key (not in git) |

## Bring-up

0. On the PC: `sh deploy/oracle/provision.sh` (needs `~/.oci/config`; see the vault runbook). Re-run until A1 capacity appears.
1. On the VM: `curl -fsSL https://raw.githubusercontent.com/mlatino-max/gladiator-scalp-hud/main/deploy/oracle/setup-vm.sh | sh`
2. Fill `deploy/oracle/.env` (`HUD_HOST`, tokens, paper keys) and drop the deploy key in `secrets/`.
3. `sudo docker compose up -d --build`
4. Verify: `curl -sI https://$HUD_HOST/` is a 307 to `/ops`; `/api/ops` is 401 without the token and reports `account.ok` with it; `docker compose logs vault-sync` shows a commit hash; `docker compose exec cron sh -c 'cat /etc/crontabs/root'`.

## HERMES paper desk (`hermes` sidecar)

Replaces the desktop routine `hermes-desk-refresh`, which only ran while the PC
was on. `docker/hermes` is Python + matplotlib and nothing else: the scripts
(`hermes_art.py`, `chartkit.py`, `hermes_kv_hydrate.py`) are run in place from
the vault clone, `Projects/Trading/HERMES-ART`, which is already inside
`VAULT_SPARSE`. Every 30 minutes on weekdays 08:00-16:45 Chicago it reads the
cloud sleeves' Upstash record (`sleeve:rsi2:log`, `sleeve:trend:log`,
`sleeve:alerts`, `sleeve:health` - four read commands a run), appends what is
new to its own archive in `/data/hermes/bot` (KV keeps only the last 1000 log
lines; the archive is what gives the picture its history), rewrites the UTC
stamps to Chicago time, and publishes `/data/hermes/hermes_desk.png`. The HUD
serves it at `/hermes` (page) and `/api/hermes` (PNG, `?meta=1` for status),
behind the same token as everything else. Nothing is committed to the vault:
the deploy key is read-only and stays that way.

Turn it on (VM, in `deploy/oracle`):

1. `git pull`, then add `KV_REST_API_URL` and `KV_REST_API_TOKEN` to `.env`.
   Use the store's **read-only** token (`KV_REST_API_READ_ONLY_TOKEN` in the
   Vercel project `gladiator-sleeves`): the sidecar only runs `LRANGE` and `GET`.
2. `sudo docker compose up -d --build hud hermes`
3. `sudo docker compose logs hermes` shows `hermes: rsi2=… (+…), trend=…`; then
   `https://$HUD_HOST/hermes`. A missing key, an unpushed vault commit or a
   failed render is reported on that page and in `/data/hermes/status.json`;
   the last good picture stays up.

To seed the archive with the record from before the cloud sleeves existed, copy
the PC's `rsi2/rsi2.log`, `trend/trend.log` and `ALERT.txt` into
`/data/hermes/bot` once, before the first run; later runs only append.

## DNS: gladiatorhud.com

The domain was registered at Vercel on 2026-09-16 (team `tino24`, $11.25/yr,
Vercel nameservers). It is the HUD's public name; the cloud sleeves API keeps
`sleeves.gladiatorhud.com` (project `gladiator-sleeves`). Cut-over, once the VM
has a public IP:

1. Remove the apex and `www` from the `gladiator-sleeves` project, where the
   checkout attached them by default:
   `vercel domains rm gladiatorhud.com --scope tino24` (leave `sleeves.`).
2. Point both at the VM: `vercel dns add gladiatorhud.com @ A <ip> --scope tino24`
   and `vercel dns add gladiatorhud.com www A <ip> --scope tino24`.
3. Set `HUD_HOST=gladiatorhud.com` in `.env` and `docker compose up -d caddy`.
   Caddy serves the apex and 301s `www` to it; certificates are automatic
   because 80/443 are open.
4. `curl -sI https://gladiatorhud.com/` is a 307 to `/ops`;
   `curl -sI https://www.gladiatorhud.com/` is a 301 to the apex.

## Shapes

`VM.Standard.A1.Flex` (Ampere, arm64) 2 OCPU / 12 GB is plenty and builds the
image on the VM in a few minutes. If the region has no A1 capacity, the
x86 `VM.Standard.E2.1.Micro` (1 GB) runs the built image but cannot build it:
build on the PC with `docker buildx build --platform linux/amd64` and push to
Docker Hub, then replace `build:` with `image:` here.
