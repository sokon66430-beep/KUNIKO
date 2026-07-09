# ---- Build stage ----------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage --------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# Mutable store data lives on a mounted volume (survives restarts/redeploys).
ENV DATA_DIR=/data

# Next.js standalone server + assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Read-only product master, bundled into the image (buildSeed reads it).
COPY --from=builder /app/data/master.json ./data/master.json

# Persistent data directory (host mounts a volume here).
RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
CMD ["node", "server.js"]
