# HERMES paper desk renderer. Replaces the desktop routine `hermes-desk-refresh`,
# which only ran while Matt's PC was on (2026-09-17: PC unplugged 08:10-19:52,
# no desk that day). This sidecar draws the same picture from the cloud sleeves'
# KV record and leaves it on the shared data volume for the HUD to serve.
#
# No code is baked in: hermes_art.py, chartkit.py and hermes_kv_hydrate.py are
# run in place from the read-only vault clone (Projects/Trading/HERMES-ART is
# inside vault-sync's sparse set), so the vault stays the single copy.
# Versions are the ones the script is verified with on the PC.
FROM python:3.13-slim
ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg MPLCONFIGDIR=/tmp/mpl
RUN pip install matplotlib==3.11.1 numpy==2.5.2 tzdata \
 && useradd --uid 1000 --create-home hermes
COPY run.sh /usr/local/bin/hermes-run
COPY loop.sh /usr/local/bin/hermes-loop
RUN chmod +x /usr/local/bin/hermes-run /usr/local/bin/hermes-loop
# uid 1000 = `node` in the hud image, the owner of /data on the shared volume
USER hermes
CMD ["hermes-loop"]
