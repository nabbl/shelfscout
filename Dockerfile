FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN node --version && npm --version && npm ci --foreground-scripts --no-audit --no-fund
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Apply Debian security fixes newer than the base image. npm/npx are build tools;
# web and worker run directly with Node and do not need their bundled dependencies.
RUN apt-get update && apt-get upgrade -y && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && groupadd -g 1001 shelfscout && useradd -u 1001 -g shelfscout -m shelfscout \
    && mkdir -p /data && chown shelfscout:shelfscout /data && chmod 700 /data
COPY --from=builder --chown=shelfscout:shelfscout /app/.next/standalone ./
COPY --from=builder --chown=shelfscout:shelfscout /app/.next/static ./.next/static
COPY --from=builder --chown=shelfscout:shelfscout /app/public ./public
COPY --from=builder --chown=shelfscout:shelfscout /app/db ./db
COPY --from=builder --chown=shelfscout:shelfscout /app/server ./server
COPY --from=builder --chown=shelfscout:shelfscout /app/scripts/load-env.ts ./scripts/load-env.ts
COPY --from=builder --chown=shelfscout:shelfscout /app/src ./src
COPY --from=builder --chown=shelfscout:shelfscout /app/node_modules ./node_modules
COPY --from=builder --chown=shelfscout:shelfscout /app/package.json ./package.json
USER shelfscout
EXPOSE 3000
CMD ["node","server.js"]
