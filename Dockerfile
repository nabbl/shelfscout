FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -g 1001 shelfscout && useradd -u 1001 -g shelfscout -m shelfscout
COPY --from=builder --chown=shelfscout:shelfscout /app/.next/standalone ./
COPY --from=builder --chown=shelfscout:shelfscout /app/.next/static ./.next/static
COPY --from=builder --chown=shelfscout:shelfscout /app/public ./public
COPY --from=builder --chown=shelfscout:shelfscout /app/db ./db
COPY --from=builder --chown=shelfscout:shelfscout /app/server ./server
COPY --from=builder --chown=shelfscout:shelfscout /app/src ./src
COPY --from=builder --chown=shelfscout:shelfscout /app/node_modules ./node_modules
COPY --from=builder --chown=shelfscout:shelfscout /app/package.json ./package.json
USER shelfscout
EXPOSE 3000
CMD ["node","server.js"]

