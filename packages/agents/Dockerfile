# LLM-Connector-Hub Unified Service
# Deploys all connector agents as a single Cloud Run service

FROM node:20-slim AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace files
COPY package*.json ./
COPY tsconfig*.json ./
COPY packages/agents/package*.json ./packages/agents/
COPY packages/agents/tsconfig*.json ./packages/agents/
COPY packages/core/package*.json ./packages/core/
COPY packages/agentics-contracts/package*.json ./packages/agentics-contracts/
COPY packages/contracts/package*.json ./packages/contracts/

# Install dependencies (skip scripts to avoid prepublish builds)
RUN npm install --ignore-scripts --legacy-peer-deps || npm install --ignore-scripts

# Copy source
COPY packages/agents/src ./packages/agents/src
COPY packages/core/src ./packages/core/src
COPY packages/agentics-contracts/src ./packages/agentics-contracts/src
COPY packages/contracts/src ./packages/contracts/src

# Copy tsconfig for referenced projects
COPY packages/agentics-contracts/tsconfig*.json ./packages/agentics-contracts/
COPY packages/core/tsconfig*.json ./packages/core/

# Build with lenient config
WORKDIR /app/packages/agents
RUN npx tsc -p tsconfig.build.json || true

# Production image
FROM node:20-slim AS runtime

WORKDIR /app

# Security: Run as non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 connector-hub
USER connector-hub

# Copy built artifacts and dependencies
COPY --from=builder --chown=connector-hub:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=connector-hub:nodejs /app/packages/agents/dist ./packages/agents/dist
COPY --from=builder --chown=connector-hub:nodejs /app/packages/agents/package.json ./packages/agents/

# Environment defaults
ENV NODE_ENV=production
ENV PORT=8080
ENV SERVICE_NAME=connector-hub-agents
ENV SERVICE_VERSION=1.0.0

EXPOSE 8080

# Start server
CMD ["node", "packages/agents/dist/server/index.js"]
