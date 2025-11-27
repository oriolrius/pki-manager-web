# syntax=docker/dockerfile:1

################################################################################
# Base Stage - Common dependencies
################################################################################
FROM node:22-alpine AS base

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

################################################################################
# Dependencies Stage - Install production dependencies
################################################################################
FROM base AS dependencies

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy backend package files
COPY backend/package.json ./backend/

# Copy frontend package files
COPY frontend/package.json ./frontend/

# Install dependencies (production only) with build scripts enabled for better-sqlite3
RUN pnpm config set scripts-prepend-node-path true && \
    pnpm install --frozen-lockfile --prod --shamefully-hoist && \
    cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npm run build-release

################################################################################
# Build Backend
################################################################################
FROM base AS build-backend

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy backend package files
COPY backend/package.json ./backend/

# Install all dependencies (including dev dependencies for build)
RUN pnpm install --frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

# Build backend
WORKDIR /app/backend
RUN pnpm build

################################################################################
# Build Frontend
################################################################################
FROM base AS build-frontend

# Accept build arguments for frontend configuration
ARG VITE_API_URL=http://localhost:3000/trpc

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package files for both backend and frontend
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy backend source (needed for tRPC types)
COPY backend/src/ ./backend/src/

# Copy frontend source
COPY frontend/ ./frontend/

# Set environment variable for Vite build
ENV VITE_API_URL=${VITE_API_URL}

# Build frontend
WORKDIR /app/frontend
RUN pnpm build:docker

################################################################################
# Production Backend Stage
################################################################################
FROM node:22-alpine AS backend

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dumb-init for proper signal handling and OpenJDK for keytool (JKS generation)
RUN apk add --no-cache dumb-init openjdk17-jre-headless

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy production dependencies from dependencies stage (includes built native modules)
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=dependencies --chown=nodejs:nodejs /app/backend/node_modules ./backend/node_modules
COPY --from=dependencies --chown=nodejs:nodejs /app/package.json ./
COPY --from=dependencies --chown=nodejs:nodejs /app/pnpm-workspace.yaml ./
COPY --from=dependencies --chown=nodejs:nodejs /app/backend/package.json ./backend/

# Copy built backend
COPY --from=build-backend --chown=nodejs:nodejs /app/backend/dist ./backend/dist

# Copy database migrations (SQL files not copied by TypeScript)
COPY --from=build-backend --chown=nodejs:nodejs /app/backend/src/db/migrations ./backend/dist/db/migrations

# Copy entrypoint script
COPY --chown=nodejs:nodejs docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create data directory with proper permissions
RUN mkdir -p /app/backend/data && \
    chown -R nodejs:nodejs /app/backend/data

# Switch to non-root user
USER nodejs

# Set environment variables with production defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/backend/data/pki.db \
    KMS_URL=http://kms:9998

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]

# Start the application
CMD ["node", "backend/dist/server.js"]

################################################################################
# Production Frontend Stage
################################################################################
FROM nginx:alpine AS frontend

# Create non-root user
RUN addgroup -g 1001 -S nginx-user && \
    adduser -S nginx-user -u 1001

# Copy built frontend
COPY --from=build-frontend --chown=nginx-user:nginx-user /app/frontend/dist /usr/share/nginx/html

# Copy unified nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Copy and setup entrypoint script for runtime config
COPY --chown=nginx-user:nginx-user docker/frontend-entrypoint.sh /usr/local/bin/frontend-entrypoint.sh
RUN chmod +x /usr/local/bin/frontend-entrypoint.sh

# Create necessary directories and set permissions
RUN mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp && \
    chown -R nginx-user:nginx-user /var/cache/nginx && \
    chown -R nginx-user:nginx-user /var/log/nginx && \
    chown -R nginx-user:nginx-user /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx-user:nginx-user /var/run/nginx.pid && \
    chown nginx-user:nginx-user /usr/share/nginx/html/config.json

USER nginx-user

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# Use entrypoint for runtime config substitution
ENTRYPOINT ["/usr/local/bin/frontend-entrypoint.sh"]
