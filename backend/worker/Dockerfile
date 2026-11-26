# Visualify Worker Image (Node 22 + Chromium + Fonts, Non-Root)
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV EXCALIDRAW_BROWSER_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only workspace manifests first for layer caching with exact lockfile
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY backend/worker/package.json ./backend/worker/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci --omit=dev --ignore-scripts

COPY backend ./backend

RUN mkdir -p /app/renders /tmp/visualify && chown -R node:node /app /tmp/visualify

USER node

# Smoke command: docker run --rm visualify-worker npm --workspace=@visualify/worker run smoke:docker
CMD ["node", "backend/worker/src/scripts/dockerSmoke.js"]
