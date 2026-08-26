# Multi-stage Dockerfile for Playwright Evasion Backend
FROM mcr.microsoft.com/playwright:v1.45.0-jammy AS base

WORKDIR /app

# Install system utilities needed for stealth browser pool
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    dumb-init \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Copy root workspace configurations
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/

# Install root & workspace dependencies
RUN npm install

# Copy backend source code
COPY apps/backend ./apps/backend

WORKDIR /app/apps/backend

# Install Chromium browser binary for Playwright
RUN npx playwright install chromium

EXPOSE 4000

ENV PORT=4000 \
    NODE_ENV=development \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["npm", "run", "dev"]
