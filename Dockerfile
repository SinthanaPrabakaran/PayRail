# ==============================================================================
# PayRail Production Multi-Stage Dockerfile
# - Minimal non-root runtime image (node:22-alpine)
# - Reproducible dependency installation from package-lock.json (npm ci)
# - Native Node.js health checks against /health (zero external binary dependencies)
# - Graceful shutdown signal handling (SIGTERM / SIGINT)
# - Zero secrets baked into image layers
# ==============================================================================

# Stage 1: Build & compile TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source and TypeScript configuration
COPY tsconfig.json ./
COPY src/ ./src/

# Compile application and healthcheck script
RUN npm run build

# Stage 2: Production runtime dependencies
FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
# Install production dependencies only, skipping devDependencies
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3: Minimal, secure non-root runtime
FROM node:22-alpine AS runner

# Set non-sensitive production environment variables
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./package.json

# Copy compiled JavaScript output from builder stage
COPY --from=builder --chown=node:node /app/dist ./dist

# Use unprivileged built-in node user
USER node

# Expose internal service port
EXPOSE 3000

# Container healthcheck querying liveness endpoint via native node script
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

# Graceful termination handling: run node directly without wrapping in npm script
CMD ["node", "dist/index.js"]
