# Synaptic HUD feed builder. Replaces the desktop routine `synaptic-feed`,
# which only ran while Matt's PC was on and the Claude app was open, and cost
# model tokens for what is a plain data-gathering job.
#
# No code is baked in: feed_vm.py and agents.py are run in place from the
# read-only vault clone (Projects/Trading/SYNAPTIC-HUD is inside vault-sync's
# sparse set), so the vault stays the single copy. Python stdlib only; git and
# ssh are here for the read-only clone of the Hermes worker's published state.
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --create-home feed \
 && mkdir -p /public /work && chown 1000:1000 /public /work
COPY run.sh /usr/local/bin/feed-run
COPY loop.sh /usr/local/bin/feed-loop
RUN chmod +x /usr/local/bin/feed-run /usr/local/bin/feed-loop
USER feed
CMD ["feed-loop"]
