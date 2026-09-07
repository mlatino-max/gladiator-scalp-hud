# syntax=docker/dockerfile:1
# GLADIATOR SCALP HUD — local container (replaces the Vercel deployment).
# Three stages: deps → build (Next.js standalone output) → slim runtime.
# The vault is NOT baked in: the runtime reads it from a read-only bind mount
# (VAULT_DIR) and rebuilds the published-notes index every few minutes, so a
# vault edit shows up without a rebuild and no GitHub token is needed.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prebuild (scripts/fetch-vault.mjs) has no token here and writes the empty
# bundled index — exactly what CI does. The real index is built at runtime.
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node scripts/fetch-vault.mjs ./scripts/fetch-vault.mjs
COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
