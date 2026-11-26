# Visualify Production Image (One multi-stage build for both `api` and `worker` roles)
# Base image pinned by immutable SHA-256 digest (node:22-bookworm-slim)

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS deps
WORKDIR /app

# Install production workspace dependencies cleanly from root lockfile (scripts skipped)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY backend/worker/package.json ./backend/worker/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS runtime

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    EXCALIDRAW_BROWSER_PATH=/usr/bin/chromium

# Runtime Chromium + fonts + curl for HEALTHCHECK (no compilers/build tools in final image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY backend ./backend

# Never bake local env files into image layers; prepare non-root scratch dirs cleanly
RUN find /app -name '.env*' ! -name '.env.example' -delete \
  && mkdir -p /app/renders /tmp/visualify \
  && chown -R node:node /app /tmp/visualify

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-5000}/healthz" || exit 1

# Worker role overrides command to: node backend/src/worker.js
CMD ["node", "backend/src/server.js"]
